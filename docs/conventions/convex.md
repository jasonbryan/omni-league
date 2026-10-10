# Convex conventions

Applies to everything under `convex/`. Once the project is scaffolded, read `convex/_generated/ai/guidelines.md` (installed with `npx convex ai-files install`) before writing Convex code; it overrides training-data knowledge of the Convex API.

## Functions

- Every public `query`, `mutation`, and `action` declares `args` and `returns` validators.
- Every public function authenticates the caller (`ctx.auth.getUserIdentity()`) and checks that the caller may access the specific league, team, or record, unless the function is deliberately public (e.g. a published schedule). Never trust an id or role passed in `args` as proof of identity.
- Logic only the backend calls is `internalQuery` / `internalMutation` / `internalAction`.
- Shared authorization lives in helper functions under `convex/lib/`, reused by every function rather than re-implemented.
- Actions call the database only through `ctx.runQuery` / `ctx.runMutation`; external API calls (Stripe) happen only in actions or HTTP actions.
- **14-day compatibility** ([ADR 0013](../decisions/0013-pwa-stack.md) section 4). The service worker lets an open tab or installed app run the previous frontend until it reloads, and the app forces that reload only after 14 days. So every public function keeps accepting the previous release's arguments, and keeps returning what the previous frontend reads, for at least 14 days after a release (expand/contract, as for schema changes): add an optional argument or a new function first, and remove the old form in a release at least 14 days later. The PR reviewer checks it on every change to a public function's `args` or `returns`.

## Data

- `convex/schema.ts` defines every table with validators.
- Queries read through indexes (`withIndex`); `.filter()` on large tables is a bug.
- Changes that affect existing data ship with the PR template's Migration section filled in. Schema changes run one PR at a time (see the dev cycle).

## Environments

Agents work against their own dev deployment or a preview deployment. Production deploys go through `gate:production`.

Environment variable reads under `convex/` use bracket access, `process.env["NAME"]`, never `process.env.NAME`: the Angular app's compiler also checks `convex/` code (through `convex/_generated/api.d.ts`) with `noPropertyAccessFromIndexSignature` (ADR 0006). `lint` also runs `@convex-dev/no-process-env` (ADR 0002), which points to the typed `env` exported by `./_generated/server`.

`convex/_generated/` is committed. After any change under `convex/`, regenerate it with `npx convex dev` (or `CONVEX_AGENT_MODE=anonymous npx convex dev --once` with no Convex account) and commit the result.

## Tests

Every public function has tests covering the happy path, the unauthenticated caller, and a caller from a different league or team. The test library is chosen via `gate:technology`.
