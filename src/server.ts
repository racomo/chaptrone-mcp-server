import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { z } from "zod";
import fetch from "node-fetch";

// ENV
const BASE = process.env.CHAPTR_ONE_BASE || "https://chptr-one-render.onrender.com";
const API_KEY = process.env.CHAPTRONE_MCP_KEY || ""; // optional shared secret sent as x-mcp-key

// Optional LLM for rubric verification (keep empty to mock)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ---- tiny helper
async function postJSON(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { "x-mcp-key": API_KEY } : {})
    },
    body: JSON.stringify(body)
  });
  return res;
}

async function getJSON(url: string) {
  const res = await fetch(url, {
    headers: { ...(API_KEY ? { "x-mcp-key": API_KEY } : {}) }
  });
  return res;
}

// ---- MCP server
const server = new Server(
  {
    name: "chaptrone-mcp",
    version: "0.1.0",
    description: "MCP server exposing Chaptr One tools: verification, dashboards, and voice."
  },
  { capabilities: { tools: {} } }
);

// Tool: log_signal -> POST /api/behavior/log
server.tool(
  "log_signal",
  {
    title: "Log a learning/behavioral signal",
    description: "Write a signal for dashboards (stage, sentiment, emotion, scores)",
    inputSchema: z.object({
      user_id: z.string(),
      session_id: z.string().optional(),
      stage: z.enum(["awareness", "reframe", "experiment"]),
      sentiment: z.string().default("positive"),
      emotion: z.string().default("curious"),
      awareness_score: z.number().default(0),
      reframe_score: z.number().default(0),
      action_followup_score: z.number().default(0)
    })
  },
  async ({ input }) => {
    const res = await postJSON(`${BASE}/api/behavior/log`, input);
    const ok = res.ok;
    const text = await res.text().catch(() => "");
    return { content: [{ type: "text", text: ok ? "ok" : `error: ${text}` }] };
  }
);

// Tool: get_employee_dashboard -> GET /api/dashboard/employee/:id
server.tool(
  "get_employee_dashboard",
  {
    title: "Fetch an employee dashboard summary",
    inputSchema: z.object({ user_id: z.string() })
  },
  async ({ input }) => {
    const res = await getJSON(`${BASE}/api/dashboard/employee/${encodeURIComponent(input.user_id)}`);
    const json = await res.json().catch(() => ({}));
    return { content: [{ type: "json", json }] };
  }
);

// Tool: say -> returns a URL to your /stream-voice endpoint
server.tool(
  "say",
  {
    title: "Synthesize speech and return a playable URL",
    inputSchema: z.object({ text: z.string().max(1800), voiceId: z.string().optional() })
  },
  async ({ input }) => {
    const url = `${BASE}/stream-voice?text=${encodeURIComponent(input.text)}${
      input.voiceId ? `&voiceId=${encodeURIComponent(input.voiceId)}` : ""
    }&cb=${Date.now()}`;
    return { content: [{ type: "text", text: url }] };
  }
);

// Tool: verify_user -> demo rubric scoring with LLM (or mocked if no OPENAI_API_KEY)
server.tool(
  "verify_user",
  {
    title: "Run a verification rubric on a user's latest signals",
    inputSchema: z.object({
      user_id: z.string(),
      rubric: z
        .array(
          z.object({
            id: z.string(),
            description: z.string(),
            weight: z.number().min(0).max(1)
          })
        )
        .default([
          { id: "fluency", description: "Understands core AI concepts & can explain them", weight: 0.4 },
          { id: "application", description: "Applies AI to role-specific tasks/workflows", weight: 0.4 },
          { id: "reflection", description: "Reflects, reframes, and follows up on actions", weight: 0.2 }
        ])
    })
  },
  async ({ input }) => {
    // pull recent summary
    const dash = await getJSON(`${BASE}/api/dashboard/employee/${encodeURIComponent(input.user_id)}`);
    const summary = await dash.json().catch(() => ({} as any));

    if (!OPENAI_API_KEY) {
      // mock a deterministic score from CGI
      const cgi = Number(summary?.cognitive_growth_index || 0);
      const score = Math.max(0, Math.min(1, (cgi + 0.1))); // tiny optimism
      return {
        content: [
          {
            type: "json",
            json: {
              ok: true,
              mode: "mock",
              user_id: input.user_id,
              weighted_score: score,
              details: input.rubric.map(r => ({ id: r.id, score, weight: r.weight })),
              source: "dashboard"
            }
          }
        ]
      };
    }

    // real LLM scoring
    const prompt = `
You are a verifier. Given this employee summary JSON and a rubric, assign a 0..1 score for each rubric item and an overall weighted score.
Return valid JSON only: {weighted_score:number, details:[{id,score,weight}], rationale:string}

Employee summary (JSON):
${JSON.stringify(summary, null, 2)}

Rubric (JSON):
${JSON.stringify(input.rubric, null, 2)}
    `.trim();

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
      })
    });

    if (!resp.ok) {
      const msg = await resp.text().catch(() => "");
      return { content: [{ type: "text", text: `verification error: ${msg}` }] };
    }

    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content || "{}";
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = { weighted_score: 0, details: [], rationale: "parse_error" }; }

    return { content: [{ type: "json", json: { ok: true, mode: "openai", user_id: input.user_id, ...parsed } }] };
  }
);

// Start MCP on stdio
const transport = new StdioServerTransport();
await server.connect(transport);
