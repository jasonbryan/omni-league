# 0004: Unit and Convex function test runners

- **Status:** Proposed
- **Gate:** `gate:technology`
- **Issue:** #3
- **Date:** 2026-10-07

## Context

`docs/conventions/angular.md` requires a unit test for every component and service that contains logic. `docs/conventions/convex.md` requires tests for every public Convex function covering three cases: the authenticated happy path, an unauthenticated caller, and a caller from a different league or team. Neither convention names a runner yet. The scaffold (#10) and CI (#12) need these decisions:

1. The unit test runner for the Angular app, covering components, services, and the Convex adapter (#11).
2. The test library and runtime for Convex functions.
3. Whether `convex/_generated/` is committed or generated in CI.

Constraints from #3:

- Convex tests run without a live deployment, so CI needs no secrets (#8, #12).
- Everything runs headless on GitHub-hosted runners.
- If both suites use Vitest, the ADR must name one Vitest version that both sides accept, citing the package manifests, and must say whether the suites share one config.

Facts verified on 2026-10-07:

- **Angular 22.2 is the latest stable major** (`@angular/cli` 22.2.2, `@angular/core` 22.2.1).
- **`ng new` defaults to Vitest.** In the Angular CLI 22.2.2 template, `ng new` sets the `test` target to the `@angular/build:unit-test` builder and adds `vitest ^5.0.0` and `jsdom ^30.0.0`. A throwaway `ng new` and `@schematics/angular` 22.2.2 `utility/latest-versions/package.json` both confirm this.
- **Karma is deprecated upstream.** angular.dev still lists Karma as supported but recommends Vitest for new projects. The Karma README states: "Karma is deprecated and is not accepting new features or general bug fixes."

### Assumptions about decisions still open

| Open decision                                 | What this ADR assumes                                                                                           | What happens if the decision goes the other way                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1 package manager                            | npm, pnpm, Yarn (node-modules linker), or Bun.                                                                  | **Every** case lists `vite` as a direct devDependency (see "Packages to add"). Vitest 5 no longer depends on Vite directly. Yarn does not install peers automatically. pnpm installs the peer, but `convex/test.setup.ts` references `vite/client` types, and pnpm only links direct dependencies at the root. Yarn PnP is not assumed. The smoke test below used npm. **Note for #10:** `ng new` picks a package manager by detection. On the test machine it chose Bun because Bun was installed, so the scaffold must pass `--package-manager` explicitly. |
| #1 Node version                               | Node 24 LTS or Node 26.                                                                                         | The intersection of the engine ranges below is Node `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0` (Angular is the narrowest), which accepts both.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| #1 repository layout                          | A single root package with `src/` (Angular) and `convex/` at the root, as in Convex's quickstarts and ADR 0002. | In a workspace, the Convex Vitest config moves into the package that owns `convex/`, and the commands get the package-manager filter prefix. The runners and versions stay the same.                                                                                                                                                                                                                                                                                                                                                                          |
| #2 lint (ADR 0002, PR #16)                    | TypeScript stays on 6.0.x, and the ESLint config is ESM.                                                        | The smoke test used TypeScript 6.0.3. `vitest.config.mts` is ESM. ADR 0002 already lists a root `vitest.config.ts` under `allowDefaultProject`. It needs updating to the `.mts` name.                                                                                                                                                                                                                                                                                                                                                                         |
| #4 e2e runner (ADR 0005, drafted in parallel) | Possibly Playwright.                                                                                            | This ADR does **not** adopt Vitest browser mode, so it adds no browser-automation tool and has no provider to align. If browser mode is adopted later, the provider must be the one #4 chose (`@vitest/browser-playwright` if #4 picks Playwright, `@vitest/browser-webdriverio` if WebdriverIO). Otherwise that ADR must justify a second tool.                                                                                                                                                                                                              |
| #5 Angular baseline                           | CSR, zoneless, and whichever forms API #5 picks.                                                                | The builder sets up zoneless TestBed when `zone.js` is absent. Rendering mode and the forms API do not change the runner.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| #6 styling                                    | CSS, SCSS, or Tailwind.                                                                                         | The builder compiles styles through the same build pipeline as `ng build`. Nothing changes here.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| #8 CI                                         | CI calls the two package scripts below on a GitHub-hosted Ubuntu runner, with no secrets.                       | Neither suite reads a secret, opens a network connection to Convex, or needs a browser.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Options: Angular unit tests

### Option U1: Vitest through Angular's `@angular/build:unit-test` builder, with jsdom (CLI default)

- **What it is.** `ng test` builds the specs with the application's esbuild pipeline, then runs them in Vitest. The DOM is emulated with jsdom. Versions: `@angular/build` 22.2.2 (MIT), `vitest` 5.0.3 (MIT), `jsdom` 30.1.2 (MIT).
- **Pros.**
  - **It is what `ng new` generates.** The scaffold keeps CLI defaults, and the Angular team supports it.
  - **Fast and headless.** It needs no browser binary, so it runs on any runner without extra setup.
  - **Same build as production.** Specs compile with the same AOT/esbuild pipeline as `ng build`.
- **Cons and risks.**
  - **jsdom is not a real browser.** There is no layout, and APIs such as `IntersectionObserver` and `matchMedia` need stubs. Layout and visual behaviour belong to e2e (#4).
  - **The builder owns the Vitest config.** `runnerConfig` can add options, but the builder deletes `test.projects` and `test.include` with a warning (`@angular/build` 22.2.2, `src/builders/unit-test/runners/vitest/plugins.js`). So the Angular suite cannot be one project in a shared multi-project Vitest config (see "One Vitest version, two configs").
  - **Relative `vi.mock` is not supported.** The builder warns that `vi.mock` does not work for relative imports. Specs use Angular DI to substitute dependencies, for example a fake Convex client through #11's injection token.
  - **Do not install `happy-dom`.** The builder picks `happy-dom` automatically whenever it is installed (`findTestEnvironment` in the same file), which would silently switch the DOM environment.

### Option U2: Vitest browser mode through the same builder

- **What it is.** The same builder with `browsers: ["chromiumHeadless"]` and a provider package: `@vitest/browser-playwright` 5.0.3 (MIT) plus `playwright` 1.64.0 (Apache-2.0), or `@vitest/browser-webdriverio` 5.0.0 (MIT, community-maintained since Vitest 5).
- **Pros.** Specs run in a real browser, with real layout, focus, and events.
- **Cons and risks.**
  - **A browser binary is needed** locally and in CI (`playwright install chromium`). Runs are slower.
  - **It adds a browser-automation dependency.** That dependency must match #4's e2e runner, which is not decided yet.
  - **Little gain for now.** The conventions put user flows and accessibility in e2e (#4), and unit specs test logic and template bindings, which jsdom covers.

### Option U3: Jest with `jest-preset-angular`

- **What it is.** `jest` 30.5.2 (MIT) with `jest-preset-angular` 17.0.2 (MIT, peers `@angular/* >=20 <23`, `jest ^30`), or `@angular-builders/jest` 22.0.1 (MIT).
- **Pros.** A mature ecosystem with full module mocking.
- **Cons and risks.**
  - **It leaves the CLI default.** That means a third-party preset to keep in step with each Angular major.
  - **Two runners in the repo.** Convex documents its test setup only with Vitest (see Option C1). `convex-test` is ESM-only (`"type": "module"`) and finds modules through Vite's `import.meta.glob`, so the Convex suite would still need Vitest.
  - **`@angular-builders/jest` peers on `@angular-devkit/build-angular`,** the older webpack-based builder package that `ng new` no longer installs.

### Option U4: Karma with Jasmine

- **What it is.** `karma` 6.4.4 (MIT) with `karma-jasmine` 5.1.0 (MIT), still accepted by the builder's `runner` option.
- **Cons.** Karma is deprecated upstream. It needs a real browser. And the Convex suite would still need Vitest.
- **Not viable for a new project.**

## Options: Convex function tests

### Option C1: `convex-test` on Vitest with the `edge-runtime` environment

- **What it is.** Convex's mock of the backend, which runs real function code against an in-memory database. Versions: `convex-test` 0.0.60 (Apache-2.0, peer `convex ^1.43.0`; current `convex` is 1.46.0) and `@edge-runtime/vm` 5.0.0 (MIT), both run by `vitest` 5.0.3.
- **Pros.**
  - **This is Convex's documented approach** (docs.convex.dev, "convex-test").
  - **No backend, no network, no credentials.** Each test gets a fresh database, so seeding is a plain `t.run(ctx => ctx.db.insert(...))`.
  - **Auth is simulated per call.** `t.withIdentity({...})` sets the identity, and a plain `t` is unauthenticated. All three required cases are expressible, as the pattern below shows.
  - **Fast.** The smoke test below ran three tests in under 200 ms.
- **Cons and risks.**
  - **It is a mock.** Convex's documentation lists the differences: error message text can differ, size and time limits are not enforced, the runtime is an Edge Runtime mock, text and vector search are simplified, and cron jobs are not supported (the functions they call can be called directly).
  - **Pre-1.0 version (0.0.x)** with no `vitest` peer range. Its own CI runs Vitest 1.6.1. Compatibility with Vitest 5 is therefore **verified by the smoke test below, not by a declared range.** Minor and patch bumps of `convex-test` should be checked against the suite.
  - **The glob pattern in Convex's docs fails on Vite 8.** The docs recommend `import.meta.glob("./**/!(*.*.*)*.*s")`. Under Vite 8.3.0 (the version `@angular/build` 22.2.2 pins) and Vite 8.3.3, that pattern matches **no files**. Under Vite 7.3.7 it works. The negation-array form below works on Vite 8 and is the pattern to use.

### Option C2: Tests against a local Convex backend

- **What it is.** The open-source backend binary (`get-convex/convex-backend`, licence FSL-1.1-Apache-2.0, latest release `precompiled-2026-10-06-a3538c6` with Linux x64 and arm64 builds). It is started by the `convex` CLI as an anonymous local deployment (`CONVEX_AGENT_MODE=anonymous npx convex dev --once`) and tested through `ConvexHttpClient`.
- **Pros.** It is the real runtime and query engine, so limits, errors, and index behaviour are exact.
- **Cons and risks.**
  - **Network on every cold start.** The CLI asks `version.convex.dev` for the backend version and downloads a zip from GitHub releases. No credentials are needed, but the network is.
  - **Beta.** The CLI prints "CONVEX_AGENT_MODE=anonymous mode is in beta, functionality may change in the future."
  - **No identity injection.** Calling functions as a given user needs signed JWTs from a configured auth provider (#7, undecided). `convex-test` simulates identities directly.
  - **Slower** (process start, deploy, network), and seeding and reset need custom internal functions.
  - **Not verified on a GitHub-hosted runner.** The system verified it on macOS arm64 only (see Evidence). It is not part of this recommendation, so the no-credentials check on a runner is left to #4, which needs the same backend for e2e.

### Option C3: Both

`convex-test` for every function's three required cases, plus a smaller suite against a local backend. This is the end state Convex's docs point to, but C2's open items (runner verification, signing in as a test user) depend on #4 and #7. It can be added by a later ADR without changing C1.

## Decision 3: `convex/_generated/`

| Option                                         | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Commit it**                                  | Convex's recommendation. The CLI's `codegen --help` says the folder "should be committed to the repo (your code won't typecheck without it!)", and the CLI's error text links to the "Check generated code into version control" best practice. The output contains no deployment-specific values: the only match for "deployment" is a doc comment in `server.js`, and regenerating gave byte-identical files. Tests, typecheck, and build need no Convex CLI at all.                                      |
| Generate in CI with `npx convex codegen`       | **Fails without a deployment.** In `convex` 1.46.0, `codegen` loads deployment credentials and runs against a backend. With no `.env.local` it exits 1 with `✖ No CONVEX_DEPLOYMENT set, run \`npx convex dev\` to configure a Convex project`. With a preview deploy key in `CONVEX_DEPLOY_KEY`, it refuses: "Codegen requires an existing deployment so doesn't support CONVEX_DEPLOY_KEY. Generate code in dev and commit it to the repo instead." Any other deploy key is a secret, which #8 rules out. |
| Generate in CI with an anonymous local backend | Works without an account (`CONVEX_AGENT_MODE=anonymous npx convex dev --once`, then `npx convex codegen`). It carries all of C2's cons: network downloads, beta status, and no verification on a GitHub runner.                                                                                                                                                                                                                                                                                             |

**Commit `convex/_generated/`.** Whoever changes `convex/` regenerates it with `npx convex dev` (against their own dev deployment or an anonymous local one) and commits the result. Drift is caught by `typecheck`, because new functions referenced from tests or the app fail to typecheck against a stale `api.d.ts`, and by PR review. A CI drift check (regenerate, then `git diff --exit-code convex/_generated`) is possible only with a local backend. It is left to #8 or #12 once #4 has verified the local backend on a runner.

## Recommendation

**Angular: Option U1.** Use Vitest through `@angular/build:unit-test` with jsdom, exactly as `ng new` generates it. Do not install `happy-dom`, and do not adopt browser mode now.

**Convex: Option C1.** Use `convex-test` on the same Vitest install, in the `edge-runtime` environment, from a root `vitest.config.mts` scoped to `convex/`. The suite passes the module map with the Vite-8-compatible negation-array glob.

**`convex/_generated/`: committed.**

### One Vitest version, two configs

- **Version:** `vitest` **5.0.3** (range `^5.0.0`, the CLI's own).
  - `@angular/build` 22.2.2 declares the optional peer `"vitest": "^4.0.8 || ^5.0.0"` (package manifest, `peerDependencies`).
  - `convex-test` 0.0.60 declares **no** `vitest` peer. Its only peer is `"convex": "^1.43.0"`.
  - `@edge-runtime/vm` is an optional peer of `vitest` 5.0.3 (`"@edge-runtime/vm": "*"`), and `jsdom` is one too (`"jsdom": "*"`).
  - So 5.0.3 satisfies every declared range, and the smoke test confirms it at runtime.
- **Configs:** **separate.** One Vitest install, two independent configurations. They cannot be merged into one multi-project config:
  - The builder deletes `test.projects` and `test.include` from any `runnerConfig`.
  - The builder must compile the Angular specs itself (TestBed and AOT setup).
  - When `runnerConfig` is unset, the builder starts Vitest with `config: false` (`executor.js`), so `ng test` never reads the root `vitest.config.mts`.
  - The root config only includes `convex/**/*.test.ts`, so `vitest run` never picks up the Angular specs under `src/`.
- **DOM environment:** `jsdom` (Angular suite). The Convex suite uses `edge-runtime`.

| Suite            | Config                                                                       | Environment  | Command (script)                                        |
| ---------------- | ---------------------------------------------------------------------------- | ------------ | ------------------------------------------------------- |
| Angular unit     | `angular.json` `test` target (`@angular/build:unit-test`, no `runnerConfig`) | jsdom        | `ng test --watch=false` (`test`)                        |
| Convex functions | root `vitest.config.mts`                                                     | edge-runtime | `vitest run --config vitest.config.mts` (`test:convex`) |

For local watch mode, use `ng test` and `vitest --config vitest.config.mts`. The `ng test` watch default is "true in TTY environments and false otherwise", so CI runs once either way. `--watch=false` makes the script explicit.

`vitest.config.mts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'convex',
    include: ['convex/**/*.test.ts'],
    environment: 'edge-runtime',
  },
});
```

`convex/test.setup.ts`:

```ts
/// <reference types="vite/client" />
// Every Convex module except multi-dot files (*.d.ts, *.test.ts, test.setup.ts).
// Do not use the docs' "./**/!(*.*.*)*.*s" pattern: it matches nothing on Vite 8.
export const modules = import.meta.glob(['./**/*.{js,ts}', '!./**/*.*.{js,ts}']);
```

`convex/tsconfig.json` (created by the Convex CLI) includes `./**/*`, so the `typecheck` script from #10 also type-checks Convex tests.

### Convex test pattern for the three required cases

The tables below are **illustrative only**. `groups`, `memberships`, and `notes` are stand-ins for whatever league and team tables the product issues define. **This ADR does not decide the data model**, and nothing here goes into `convex/schema.ts`. The pattern carries over unchanged, with "group" read as "league" or "team".

Illustrative schema and function (smoke test only):

```ts
// convex/schema.ts (illustrative)
export default defineSchema({
  groups: defineTable({ name: v.string() }),
  memberships: defineTable({ groupId: v.id('groups'), authUserId: v.string() }).index(
    'by_group_and_user',
    ['groupId', 'authUserId'],
  ),
  notes: defineTable({ groupId: v.id('groups'), body: v.string() }).index('by_group', ['groupId']),
});

// convex/lib/auth.ts (shared authorization helper, per convex.md)
export async function requireGroupMember(ctx: QueryCtx, groupId: Id<'groups'>) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new ConvexError('UNAUTHENTICATED');
  const membership = await ctx.db
    .query('memberships')
    .withIndex('by_group_and_user', (q) =>
      q.eq('groupId', groupId).eq('authUserId', identity.subject),
    )
    .unique();
  if (membership === null) throw new ConvexError('FORBIDDEN');
  return identity;
}

// convex/notes.ts: public query `listForGroup({ groupId })` calls requireGroupMember, then reads by index.
```

The test:

```ts
// convex/notes.test.ts
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { modules } from './test.setup';

async function seed() {
  const t = convexTest({ schema, modules });
  const ids = await t.run(async (ctx) => {
    const groupA = await ctx.db.insert('groups', { name: 'A' });
    const groupB = await ctx.db.insert('groups', { name: 'B' });
    // authUserId equals the subject faked by withIdentity (ADR 0008: helpers key on identity.subject)
    await ctx.db.insert('memberships', { groupId: groupA, authUserId: 'alice' });
    await ctx.db.insert('memberships', { groupId: groupB, authUserId: 'bob' });
    await ctx.db.insert('notes', { groupId: groupA, body: 'A only' });
    return { groupA, groupB };
  });
  return { t, ...ids };
}

describe('notes.listForGroup', () => {
  test('member of the group reads its notes', async () => {
    // 1. authenticated happy path
    const { t, groupA } = await seed();
    const alice = t.withIdentity({ subject: 'alice' });
    const notes = await alice.query(api.notes.listForGroup, { groupId: groupA });
    expect(notes.map((n) => n.body)).toEqual(['A only']);
  });

  test('unauthenticated caller is rejected', async () => {
    // 2. no identity
    const { t, groupA } = await seed();
    await expect(t.query(api.notes.listForGroup, { groupId: groupA })).rejects.toThrow(
      /UNAUTHENTICATED/,
    );
  });

  test('caller from a different group is rejected', async () => {
    // 3. cross-tenant
    const { t, groupA } = await seed();
    const bob = t.withIdentity({ subject: 'bob' }); // member of group B only
    await expect(bob.query(api.notes.listForGroup, { groupId: groupA })).rejects.toThrow(
      /FORBIDDEN/,
    );
  });
});
```

Notes on the pattern:

- **Identity.** `withIdentity` sets `ctx.auth.getUserIdentity()`. When `issuer` and `subject` are given, `tokenIdentifier` is `${issuer}|${subject}`. The issuer defaults to `https://convex.test`.
- **Helpers key users on `identity.subject`, not `tokenIdentifier`** (ADR 0008, auth provider, PR #25). With Better Auth, `subject` is the Better Auth user id, stable across sessions, and `auth.config.ts` lists exactly one issuer, so `subject` alone cannot collide. `tokenIdentifier` is `${CONVEX_SITE_URL}|${subject}`: its issuer part is the deployment's HTTP-action URL, which changes if production later moves HTTP actions to a custom domain, and every stored key would then stop matching. If a second issuer is ever added, the key changes to `tokenIdentifier` through a migration in that ADR. The app stores the value as `users.authUserId` with an index; the illustrative `memberships.authUserId` above stands in for it. Tests fake the claims the real token carries (`subject`, `issuer`, `email`, `emailVerified`, `name`, `sessionId`; ADR 0008 "Convex function tests with faked identities"). The three-case test shape does not change.
- **Assert on error codes, not messages.** Assertions match a stable code carried by `ConvexError`. Convex warns that error message text can differ between `convex-test` and the real backend.
- **Internal functions** (for example #10's `convex/health.ts` `internalQuery`) are called the same way with `internal.*` from `./_generated/api`.

### Evidence (smoke test, 2026-10-07, macOS arm64, Node 24.16.0)

Run in a throwaway directory outside the repo:

1. **Convex suite, no deployment.** Versions: `convex` 1.46.0, `convex-test` 0.0.60, `vitest` 5.0.3, `vite` 8.3.0, `@edge-runtime/vm` 5.0.0, `typescript` 6.0.3. With `.env.local` removed and no `CONVEX_*` variables set, `npx vitest run` passed **3/3** (the three tests above). A probe test showed that the docs' extglob pattern matches 0 files on Vite 8.3.0 and 8.3.3 but works on Vite 7.3.7, while the array pattern matches the expected 5 modules.
   - **Identity key changed after this run.** This run keyed memberships on `tokenIdentifier`. The pattern above now keys on `identity.subject` (ADR 0008). The same three cases keyed on `subject`, with the claim shape of a real Better Auth token, passed 4/4 on `convex-test` 0.0.60 and `vitest` 5.0.3 in ADR 0008's scratch run (the fourth test checks the faked identity's shape against the real token).
2. **Both suites in one Angular 22 workspace, one Vitest.**
   - Setup: `npx @angular/cli@22.2.2 new web --defaults --ssr=false`, reinstalled with npm, then `convex`, `convex-test`, and `@edge-runtime/vm` added. The `npm ls` output shows a single `vitest@5.0.3` (`@angular/build`'s copy is `deduped`) and `jsdom@30.1.2`.
   - Results:
     - `ng test --watch=false` ran only the CLI's `src/app/app.spec.ts` (2/2 passed). It ignored `convex/` and the root config.
     - `vitest run` ran only `convex/notes.test.ts` (3/3 passed).
     - `tsc -p convex/tsconfig.json --noEmit` and `tsc -p tsconfig.spec.json --noEmit` both exited 0.
3. **Codegen without credentials.**
   - `npx convex codegen` with no `.env.local` exited 1 (`No CONVEX_DEPLOYMENT set`).
   - `CONVEX_AGENT_MODE=anonymous npx convex dev --once` downloaded the backend binary, reported "[Local] Port 3210 • No Convex account", and wrote `convex/_generated/`. After deleting the folder, `npx convex codegen` against that anonymous deployment regenerated byte-identical files (matching SHA-1s).
   - Caveat: the test machine has a Convex login in `~/.convex/config.json`. Anonymous agent mode selects the anonymous path regardless (`deploymentSelection.js`, `convex` 1.46.0), but this is not a clean-runner test. That is why the local backend is not part of the recommendation.

## Consequences

### Packages to add (devDependencies)

All versions and licences were checked against the npm registry on 2026-10-07.

| Package            | Version                | Licence    | Notes                                                                                                                                                                 |
| ------------------ | ---------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest`           | 5.0.3                  | MIT        | Added by `ng new` (`^5.0.0`). Engines `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`. Requires `vite ^6.4 \|\| ^7 \|\| ^8`.                                                    |
| `jsdom`            | 30.1.2                 | MIT        | Added by `ng new` (`^30.0.0`). Engines `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`.                                                                                        |
| `vite`             | 8.3.3 (range `^8.3.0`) | MIT        | Required peer of `vitest` 5 and source of the `vite/client` types. Kept on Vite 8, the major `@angular/build` 22.2.2 pins (8.3.0). Engines `^20.19.0 \|\| >=22.12.0`. |
| `convex-test`      | 0.0.60                 | Apache-2.0 | Peer `convex ^1.43.0`. No lifecycle scripts.                                                                                                                          |
| `@edge-runtime/vm` | 5.0.0                  | MIT        | Provides Vitest's `edge-runtime` environment. Depends on `@edge-runtime/primitives` 6.0.0. Engines `>=18`.                                                            |

`@angular/build` (MIT) and `convex` (Apache-2.0) are already covered by ADR 0001. **Optional, accepted with this ADR but not installed by #10:** `@vitest/coverage-v8` 5.0.3 (MIT, peer `vitest 5.0.3`) for coverage reports, if wanted later.

**Not added:** `happy-dom`, because the builder would auto-select it. Also not added: `@vitest/browser-*`, `playwright` (that is #4's decision), `jest`, `jest-preset-angular`, `@angular-builders/jest`, `karma`, and `karma-*`.

**Version policy:**

- Minor and patch bumps need no gate (AGENTS.md). For `convex-test` (0.0.x), any bump is effectively a minor one, so the Convex suite must pass before merging it.
- A future `vitest` major requires the new major to be inside `@angular/build`'s peer range.
- The `vite` major follows `@angular/build`'s pinned `vite`.
- **Peer conflict with `better-auth` 1.6 (ADR 0008, PR #25).** `better-auth` 1.6.x declares an optional peer `vitest ^2 || ^3 || ^4`, so `npm install` next to `vitest` 5.0.3 fails with `ERESOLVE` (`peerOptional vitest@"^2.0.0 || ^3.0.0 || ^4.0.0" from better-auth@1.6.33`). ADR 0008 adds an npm `overrides` entry, `"overrides": { "better-auth": { "vitest": "$vitest" } }`, which points that peer at the project's own `vitest`. Verified in ADR 0008's scratch run: the install succeeded and `npm ls` showed a single `vitest@5.0.3`. `better-auth` 1.7 accepts Vitest 5, so the entry is removed once `@convex-dev/better-auth` supports 1.7. It is recorded in ADR 0003 (#1). Before any future `vitest` major, check that every package with a `vitest` peer (currently `@angular/build` and `better-auth`) accepts it, or that an override is recorded.

### Setup for #10

1. `ng new` with an explicit `--package-manager` (per #1). Keep the generated `test` target, `vitest`, and `jsdom`.
2. Add `convex`, `convex-test`, `@edge-runtime/vm`, and `vite`. Add `vitest.config.mts` and `convex/test.setup.ts` as above.
3. Scripts: `"test": "ng test --watch=false"` and `"test:convex": "vitest run --config vitest.config.mts"`.
4. Commit `convex/_generated/`. Generate it with `npx convex dev` against the owner-approved dev deployment, or with an anonymous local deployment, which needs no account. The output is the same.
5. ESLint (ADR 0002): add `vitest.config.mts` to `allowDefaultProject`. Keep `convex/_generated/` on the ignore list.

### What changes

- CI (#12) runs two test jobs or steps with no secrets and no browser install.
- **Every Convex function PR carries the three-case tests** in the shape above.
- **Every change under `convex/` must include the regenerated `_generated/` files.**

### What becomes harder

- **No module-level mocking of relative imports in Angular specs.** Use DI fakes instead.
- **Vitest upgrades are gated by Angular.** A Vitest major cannot be adopted until `@angular/build` supports it.
- **Convex behaviour that the mock does not model** (limits, exact errors, runtime built-ins, crons) is not covered until a local-backend suite (Option C3) is added by a later ADR, after #4 verifies the backend on a runner.

## Sources

- angular.dev: [Testing](https://angular.dev/guide/testing) (Vitest default, jsdom/happy-dom, browser providers, Karma status, `runnerConfig` overrides)
- npm registry, checked 2026-10-07 (versions, licences, peers, engines):
  - Angular: [@angular/build](https://www.npmjs.com/package/@angular/build), [@angular/cli](https://www.npmjs.com/package/@angular/cli), [@schematics/angular](https://www.npmjs.com/package/@schematics/angular)
  - Vitest and DOM: [vitest](https://www.npmjs.com/package/vitest), [vite](https://www.npmjs.com/package/vite), [jsdom](https://www.npmjs.com/package/jsdom), [happy-dom](https://www.npmjs.com/package/happy-dom), [@vitest/browser-playwright](https://www.npmjs.com/package/@vitest/browser-playwright), [@vitest/browser-webdriverio](https://www.npmjs.com/package/@vitest/browser-webdriverio), [@vitest/coverage-v8](https://www.npmjs.com/package/@vitest/coverage-v8)
  - Convex: [convex](https://www.npmjs.com/package/convex), [convex-test](https://www.npmjs.com/package/convex-test), [@edge-runtime/vm](https://www.npmjs.com/package/@edge-runtime/vm)
  - Jest: [jest](https://www.npmjs.com/package/jest), [jest-preset-angular](https://www.npmjs.com/package/jest-preset-angular), [@angular-builders/jest](https://www.npmjs.com/package/@angular-builders/jest)
  - Karma and Playwright: [karma](https://www.npmjs.com/package/karma), [playwright](https://www.npmjs.com/package/playwright)
- Package source inspected:
  - `@angular/build` 22.2.2: `src/builders/unit-test/schema.json`, `runners/vitest/{plugins,executor,index}.js`
  - `convex-test` 0.0.60: `package.json`, `dist/index.js`
  - `convex` 1.46.0: `dist/cjs/cli/codegen.js`, `lib/api.js`, `lib/deploymentSelection.js`, `lib/localDeployment/download.js`
- Vitest: [Migration guide (v5)](https://vitest.dev/guide/migration), [Test environments](https://vitest.dev/guide/environment)
- Convex: [Testing with convex-test](https://docs.convex.dev/testing/convex-test), [Check generated code into version control](https://docs.convex.dev/understanding/best-practices/other-recommendations#check-generated-code-into-version-control)
- [get-convex/convex-backend](https://github.com/get-convex/convex-backend) (licence FSL-1.1-Apache-2.0; release `precompiled-2026-10-06-a3538c6`)
- [Karma README](https://github.com/karma-runner/karma) (deprecation notice)
