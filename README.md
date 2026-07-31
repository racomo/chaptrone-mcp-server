# ops-status — C2 telemetry (machine-published)

This is an **orphan branch** of `chaptrone-mcp-server`. It shares no history with
`main` and holds no product code — only infrastructure telemetry for the
Cordero / ChaptrOne command center.

> ⚠️ **Never merge `ops-status` into `main`.** It is a data channel, not code.

## Flow

```
Gansito (VPS, root)                          Claude Code
──────────────────                           ───────────
status-collector.sh  ──► status.json  ──►  reads this branch ──► renders dashboard
   (GREEN, read-only)      (this file)      (git pull ops-status)
```

- **Producer:** `gansito-status-collector.sh` on the VPS (GREEN, read-only —
  `pm2 jlist`, `systemctl is-active`, `df`, `free`, `/proc/loadavg`, HTTP GET of
  app health). Published by `gansito-status-publish.sh` on a ~2-min cron.
- **Consumer:** Claude Code renders the command-center view from `status.json`.

## Files

- `status.json` — latest snapshot, overwritten each publish (currently a seed placeholder).
- `STATUS_SCHEMA.md` — the data contract.

## Governance

Collecting + publishing read-only telemetry is **GREEN**. Standing up the
publisher credential (a deploy key / PAT with write to this repo) is a one-time
**YELLOW** — notify Raul when enabling it.
