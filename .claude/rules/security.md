# Security

- No secrets, keys or tokens in code, docs, logs or commits. `web/.env` and
  `.dev.vars` are 1Password named pipes: never read them into output.
- D1 queries use bound parameters only; never build SQL by string concatenation.
- No `eval()`, `new Function()` or other dynamic code execution.
- TypeScript: no `any`; type the data.
- SVG and other markup from data is sanitised before it reaches the page
  (see `web/src/lib/export-layout/svg.ts`); keep it that way.
- Don't weaken `web/public/_headers` or remove a security check to make a test
  pass.
