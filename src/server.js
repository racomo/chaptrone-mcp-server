// src/server.js
/**
 * Chptr One — HTTP bridge for MCP + healthz
 * Exposes: /healthz and /mcp/manifest.json and a few helper endpoints
 */
const express = require('express');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');

// env
dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.PUBLIC_BASE_URL || 'https://chptr-one-render.onrender.com';

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.set('trust proxy', 1);

// --- health check (Render + you) ---
app.get('/healthz', (_req, res) =>
  res.status(200).json({ ok: true, service: 'chptr-one', ts: Date.now() })
);

// --- minimal manifest Goose can load as an HTTP extension ---
app.get('/mcp/manifest.json', (_req, res) => {
  res.json({
    name: 'chaptrone-mcp',
    version: '1.0.0',
    description: 'HTTP bridge for Chaptr One',
    base_url: BASE_URL,
    authentication: 'none',
    tools: [
      {
        operationId: 'generateStory',
        summary: 'Generate a narrated AI story segment',
        method: 'POST',
        path: '/api/generate-story-stream',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            language: { type: 'string', enum: ['en', 'es', 'fr', 'da'] },
            level: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] }
          },
          required: ['language', 'level']
        }
      },
      { operationId: 'getVoices', summary: 'List voices', method: 'GET', path: '/api/get-voices' },
      { operationId: 'getSession', summary: 'Get session', method: 'GET', path: '/api/get-session' }
    ],
    contact: { name: 'Cordero MGMT', url: BASE_URL }
  });
});

// optional debug
app.get('/mcp/tools', (_req, res) => {
  res.json({ tools: ['generateStory', 'getVoices', 'getSession'], base_url: BASE_URL });
});

// start
app.listen(PORT, () => {
  console.log(`✅ HTTP bridge up on :${PORT} — health at /healthz, manifest at /mcp/manifest.json`);
});
