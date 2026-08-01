# EmpowHer site — Phase 2 build (staged)

Static, no-build multi-page marketing site for **EmpowHer**, sharing the Phase 1
Chptr One visual system. Six pages, byte-identical header/footer/typography.

> ⚠️ **Staging location.** This is an orphan branch of `chaptrone-mcp-server`,
> used only because repo creation is not permitted for the current integration.
> It is meant to move to a dedicated `racomo/empowher-site` repo. To promote:
> `git clone --branch empowher-site --single-branch … && push to the new repo's main`.

## Pages
- `index.html` — home (spine, three doors, Assess→Develop→Evidence loop, SMS proof)
- `coaching.html`, `teams.html` — 1:1 and team coaching (+ identical closing block)
- `ai-adoption.html` — the only page carrying the Article 4 narrative
- `about.html` — Cordero Management ApS
- `chptr-one.html` — Phase 1 Chptr One page (+ "Part of something bigger")

## Verified
- Lighthouse mobile 100 / 100 / 96 / 100 on every page.
- Loop closed: each service page links into Chptr One once; Chptr One links out to 2 services.
- No ban-list words, no risk-tier claims; Article 4 only on ai-adoption.
- Links relative (`.html`) so the folder deploys as-is; swap to clean URLs with host rewrites.

Products of Cordero Management ApS · CVR 44895048 · Denmark.
