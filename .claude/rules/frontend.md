---
paths:
  - "web/src/pages/**"
  - "web/src/components/**"
  - "web/src/styles/**"
  - "web/src/scripts/**"
---

# Site front end (Astro, plain CSS)

- Astro components and pages; scoped `<style>` blocks; no Tailwind, React or
  other UI framework.
- Colours, type, spacing and sizes come from `web/src/styles/tokens.css`. Don't
  add raw hex values or px sizes; add a token if one is missing.
- House rules (from the token file): no gradients, no card shadows, radius at
  most 2px, one accent colour, tap targets at least `--tap-min` (44px).
- Borders on controls use `--control-border` (3:1 contrast), not `--rule`.
- Every page works in both polarities (`prefers-color-scheme` and
  `data-scan-polarity`) and prints cleanly (`@media print`).
- Latin text gets `lang="la"`. Icon-only buttons get `aria-label`. Status
  messages use `role="status"` / `aria-live`.
- Every new page must be linked from its day, section or index; `pnpm build`
  fails on unreachable pages.
- Don't remove or hide an existing control (export options, scan/typeset
  switch, polarity, skip-to-music) without the maintainer's approval.
