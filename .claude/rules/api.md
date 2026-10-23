---
paths:
  - "web/functions/**"
  - "web/src/lib/admin/**"
  - "workers/corrections/src/**"
---

# Admin API and corrections Worker

- Admin endpoints (Pages Functions, code in `web/src/lib/admin/`) require
  Cloudflare Access plus the `EDITORS` allowlist (`auth.ts`). Never add an
  unauthenticated admin route.
- The public Worker's submission route (POST) checks Turnstile and `Origin`,
  honours the `CORRECTIONS_ENABLED` kill switch, and rate-limits by a D1 row
  count per hashed submitter. Keep all of these on any new route that accepts
  data from the public.
- Validate request bodies by hand at the boundary, as the existing handlers do
  (`parseSections`, the Worker's checks); reject with a 4xx.
- Errors are `json({ error: "<plain sentence>" }, status)` with the right
  status code; never 200 for an error. The message is shown to editors, so
  write it as an instruction.
- D1 queries use bound parameters (`.bind(...)`) only.
- No secrets in code. Bindings and secrets live in `wrangler.toml` and
  Cloudflare; see `cantusorgani-docs/ADMIN-SETUP.md`.
