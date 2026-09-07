---
paths:
  - "src/api/**"
  - "**/routes/**"
  - "**/endpoints/**"
  - "**/controllers/**"
---

# API Development Rules

- All endpoints must include input validation (Zod for TS, Pydantic for Python)
- Use standard error response format: `{ error: string, code: number, details?: any }`
- Return appropriate HTTP status codes — never use 200 for errors
- Include OpenAPI documentation comments on all endpoints
- Rate limiting required on all public endpoints
- Authentication middleware on all protected routes
