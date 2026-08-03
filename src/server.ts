import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---- ENV
const BASE = process.env.CHAPTR_ONE_BASE || "https://chptr-one-render.onrender.com";
const API_KEY = process.env.CHAPTRONE_MCP_KEY || ""; // optional shared secret sent as x-mcp-key

// Optional LLM for rubric verification (leave empty to mock)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ---- tiny fetch helpers (Node 20+ global fetch — no node-fetch dependency)
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra, ...(API_KEY ? { "x-mcp-key": API_KEY } : {}) };
}

async function postJSON(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

async function getJSON(url: string): Promise<Response> {
  return fetch(url, { headers: authHeaders() });
}

// A text content block carrying a JSON payload (MCP has no "json" content type;
// results are returned as text and, where useful, structuredContent).
function jsonText(payload: unknown) {
  const text = JSON.stringify(payload, null, 2);
  return { content: [{ type: "text" as const, text }], structuredContent: payload as Record<string, unknown> };
}

// ---- MCP server (high-level McpServer — provides registerTool)
const server = new McpServer(
  {
    name: "chaptrone-mcp",
    version: "0.1.0",
  },
  { capabilities: { tools: {} } }
);

// Tool: log_signal -> POST /api/behavior/log
server.registerTool(
  "log_signal",
  {
    title: "Log a learning/behavioral signal",
    description: "Write a signal for dashboards (stage, sentiment, emotion, scores)",
    inputSchema: {
      user_id: z.string(),
      session_id: z.string().optional(),
      stage: z.enum(["awareness", "reframe", "experiment"]),
      sentiment: z.string().default("positive"),
      emotion: z.string().default("curious"),
      awareness_score: z.number().default(0),
      reframe_score: z.number().default(0),
      action_followup_score: z.number().default(0),
    },
  },
  async (args) => {
    const res = await postJSON(`${BASE}/api/behavior/log`, args);
    const text = await res.text().catch(() => "");
    return {
      content: [{ type: "text", text: res.ok ? "ok" : `error: ${text}` }],
      isError: !res.ok,
    };
  }
);

// Tool: get_employee_dashboard -> GET /api/dashboard/employee/:id
server.registerTool(
  "get_employee_dashboard",
  {
    title: "Fetch an employee dashboard summary",
    description: "Read the dashboard summary for a single employee by user_id",
    inputSchema: { user_id: z.string() },
  },
  async (args) => {
    const res = await getJSON(`${BASE}/api/dashboard/employee/${encodeURIComponent(args.user_id)}`);
    const json = await res.json().catch(() => ({}));
    return jsonText(json);
  }
);

// Tool: say -> returns a URL to the /stream-voice endpoint
server.registerTool(
  "say",
  {
    title: "Synthesize speech and return a playable URL",
    description: "Build a /stream-voice URL for the given text (optional voiceId)",
    inputSchema: { text: z.string().max(1800), voiceId: z.string().optional() },
  },
  async (args) => {
    const url =
      `${BASE}/stream-voice?text=${encodeURIComponent(args.text)}` +
      (args.voiceId ? `&voiceId=${encodeURIComponent(args.voiceId)}` : "") +
      `&cb=${Date.now()}`;
    return { content: [{ type: "text", text: url }] };
  }
);

// Tool: verify_user -> rubric scoring with an LLM (mocked when no OPENAI_API_KEY)
server.registerTool(
  "verify_user",
  {
    title: "Run a verification rubric on a user's latest signals",
    description: "Score a user's dashboard summary against a weighted rubric (OpenAI, or a deterministic mock)",
    inputSchema: {
      user_id: z.string(),
      rubric: z
        .array(
          z.object({
            id: z.string(),
            description: z.string(),
            weight: z.number().min(0).max(1),
          })
        )
        .default([
          { id: "fluency", description: "Understands core AI concepts & can explain them", weight: 0.4 },
          { id: "application", description: "Applies AI to role-specific tasks/workflows", weight: 0.4 },
          { id: "reflection", description: "Reflects, reframes, and follows up on actions", weight: 0.2 },
        ]),
    },
  },
  async (args) => {
    // pull recent summary
    const dash = await getJSON(`${BASE}/api/dashboard/employee/${encodeURIComponent(args.user_id)}`);
    const summary = (await dash.json().catch(() => ({}))) as Record<string, unknown>;

    if (!OPENAI_API_KEY) {
      // deterministic mock derived from the cognitive growth index
      const cgi = Number((summary as any)?.cognitive_growth_index || 0);
      const score = Math.max(0, Math.min(1, cgi + 0.1)); // tiny optimism
      return jsonText({
        ok: true,
        mode: "mock",
        user_id: args.user_id,
        weighted_score: score,
        details: args.rubric.map((r) => ({ id: r.id, score, weight: r.weight })),
        source: "dashboard",
      });
    }

    // real LLM scoring
    const prompt = `
You are a verifier. Given this employee summary JSON and a rubric, assign a 0..1 score for each rubric item and an overall weighted score.
Return valid JSON only: {"weighted_score":number,"details":[{"id":string,"score":number,"weight":number}],"rationale":string}

Employee summary (JSON):
${JSON.stringify(summary, null, 2)}

Rubric (JSON):
${JSON.stringify(args.rubric, null, 2)}
    `.trim();

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const msg = await resp.text().catch(() => "");
      return { content: [{ type: "text", text: `verification error: ${msg}` }], isError: true };
    }

    const data = (await resp.json()) as any;
    const text = data?.choices?.[0]?.message?.content || "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { weighted_score: 0, details: [], rationale: "parse_error" };
    }

    return jsonText({ ok: true, mode: "openai", user_id: args.user_id, ...parsed });
  }
);

// ---- Start MCP on stdio
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is reserved for the JSON-RPC stream.
  console.error("chaptrone-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
