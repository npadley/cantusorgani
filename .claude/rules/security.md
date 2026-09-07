# Security Rules

- Never hardcode secrets, API keys, or credentials in source code
- Use parameterized queries only — never string concatenation for SQL
- No `eval()`, `new Function()`, or dynamic code execution
- No `any` types in TypeScript — use proper typing
- Validate all user inputs at API boundaries
- Output encoding for all rendered content
- Secrets via environment variables only
- No disabled security headers
- Authentication required on all protected endpoints
- Rate limiting on public APIs
