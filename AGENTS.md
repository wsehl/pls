# AGENTS.md

## Coding preferences (General)

- Keep things simple. Channel "yagni" energy unless told otherwise.
- Keep components modular and concerns clearly separated.
- Take advantage of type safety.
- Treat the prompt as the specification. Verify assumptions against the repository.
- Use established project dependencies before writing custom code or adding packages.
- Make durable architectural decisions. Do not add a temporary path that is intended to be replaced later.
- Comment intent, constraints, and non-obvious behavior. Keep comments up to date; when making changes, it's important to keep things in sync.
- Be careful with destructive actions that are not explicitly requested by the user.
- Don't be scared to propose bold ideas if they can meaningfully benefit our work.
- Do not preserve backward compatibility unless the task requires it. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Do not create endless smoke tests and "regression tests" for feature deletions. Tests should be focused.

## Coding preferences (TypeScript focused)

- `any` is the enemy, inferred types are our friend. Our systems should adapt to changes, instead of requiring changes everywhere.
- Avoid one-line functions that are just casting wrappers.
- If not already specified in the project, the generally preferred stack is pnpm, Vite, React, Tailwind CSS.
- When building more complex web apps, pull out TanStack Query, TanStack Start or Router (for SPA), zod.
