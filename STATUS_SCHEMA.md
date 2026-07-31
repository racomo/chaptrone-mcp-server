# status.json — data contract (v2)

Overwritten each publish. All byte counts are integers (units are formatted at
render time). Times are ISO-8601 UTC.

```jsonc
{
  "generated_at": "2026-07-31T17:07:10Z",   // top-level snapshot time
  "generator": "gansito-status-collector",
  "governance": "GREEN-readonly",

  "servers": [
    {
      "host": "v924445030.local",            // hostname
      "collected_at": "2026-07-31T17:07:10Z",
      "uptime_seconds": 313,                  // integer
      "loadavg": [0.03, 0.02, 0.00],          // 1 / 5 / 15 min
      "cpu_count": 4,                         // for normalizing loadavg
      "mem_total_bytes": 16856244224,
      "mem_used_bytes": 588435456,
      "disk_total_bytes": 270553174016,       // root fs
      "disk_used_bytes": 7588712448,
      "services": { "gansito": "active" },     // name -> `systemctl is-active`
      "pm2": [ /* raw `pm2 jlist`: name, pm_id, pm2_env.status,
                  monit.cpu, monit.memory, pm2_env.restart_time */ ]
    }
    // An UNREACHABLE host still appears, as: { "host": "hetzner-de", "error": "unreachable" }
  ],

  "apps": [
    {
      "name": "chptrone",
      "url": "https://api.empowher.io/healthz",
      "http_status": 200,                     // integer; 0 = unreachable
      "ok": true,                             // true when 2xx/3xx
      "response_time_ms": 47,
      "checked_at": "2026-07-31T17:07:10Z"
    }
  ]
}
```

## Rules

1. **Unreachable ≠ omitted.** A host that can't be probed appears as
   `{ "host": "...", "error": "unreachable" }`; an app that can't be reached is
   `http_status: 0, ok: false`. The dashboard renders these as 🔴, not as gaps.
2. **Bytes are integers.** No `"1.2 GB"` strings — the renderer formats units.
3. **Consumer computes health banding**, not the producer. The snapshot carries
   raw numbers; Claude Code applies the ⚠️/🔴 thresholds.
