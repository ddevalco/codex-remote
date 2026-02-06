# Code Style Rules

You are working on a Svelte 5 app with Vite, plus Cloudflare Workers and a local Bun service.

## Tech Stack

- **Frontend**: Svelte 5 + Vite
- **Routing**: `sv-router`
- **State**: Svelte 5 runes (`$state`, `$derived`, `$effect`)
- **Auth**: WebAuthn passkeys (Auth worker), JWTs
- **Workers**: Cloudflare Workers + D1
- **Local bridge**: Bun (Anchor)

## Project Structure

```
src/             # Svelte UI
services/        # Cloudflare Workers + Anchor
migrations/      # D1 SQL migrations
.docs/           # Project docs
```

## Imports

Order imports with blank lines between groups:

1. External packages
2. Internal modules (relative paths)

Use `import type` for type-only imports.

## Formatting

- Double quotes for strings
- 2-space indentation in new code (match existing file style if different)
- Trailing commas in multi-line structures
- Use semicolons in `.ts` files

## TypeScript

- Use `type` for unions/intersections, `interface` for object shapes when helpful
- Export types alongside implementations when used across files
- Prefer `Record<string, unknown>` over `any`

## Svelte

- Use Svelte 5 runes for local state and effects
- Prefer `$state` for mutable state, `$derived` for computed values, `$effect` for side effects
- Keep stores in `src/lib/*` as classes with a single global instance (see existing stores)

## Styling

- Keep design tokens in `src/lib/styles/tokens.css` and import them once via `src/global.css`
- Use layout primitives from `src/lib/styles/layout.css` (`.stack`, `.row`, `.split`) instead of ad-hoc flex/grid layout
- Override layout gaps with `--stack-gap`, `--row-gap`, or `--split-gap` on the component class when needed
- Component styles stay in `<style>` blocks; keep `src/global.css` limited to global resets and imports

## Workers (Auth/Orbit)

- Use standard Web APIs (no Node-only APIs)
- Keep CORS helpers in `services/auth/src/utils.ts`
- Use JWT verify/sign with `jose` in Auth; raw `crypto.subtle` in Orbit

## Bun (Anchor)

- Keep process/env wiring in `services/anchor/src/index.ts`
- Avoid adding new dependencies unless necessary

## Do NOT

- Add new docs unless asked
- Use `any`
