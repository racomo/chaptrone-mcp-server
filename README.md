# chaptrone-mcp-server
Adding Goose to backend of ChaptrOne
# Chaptr One MCP Server

MCP tools for Goose (desktop) to interact with your Chaptr One backend.

## Tools
- **log_signal** → POST /api/behavior/log
- **get_employee_dashboard** → GET /api/dashboard/employee/:id
- **say** → returns a playable /stream-voice URL
- **verify_user** → LLM rubric scoring (uses OpenAI if key provided, else mock)

## Dev
```bash
npm i
cp .env.example .env   # update CHAPTR_ONE_BASE & optional CHAPTRONE_MCP_KEY
npm run dev            # hot dev
npm run build
npm start              # runs dist/server.js with .env
