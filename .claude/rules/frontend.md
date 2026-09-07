---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "src/components/**"
  - "src/app/**"
---

# Frontend Rules

- One component per file, named with PascalCase
- Use Server Components by default in Next.js — add `'use client'` only when needed
- Tailwind utility classes for styling — avoid inline styles
- All interactive elements must be keyboard accessible
- Include `aria-label` on icon-only buttons
- Use semantic HTML (`<nav>`, `<main>`, `<section>`) over generic `<div>`
- Images require `alt` text
