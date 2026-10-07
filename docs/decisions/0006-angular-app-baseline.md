# 0006: Angular app baseline

- **Status:** Proposed
- **Gate:** `gate:technology`
- **Issue:** #5
- **Date:** 2026-10-07

## Context

ADR 0001 fixes Angular (latest stable major) and Convex but leaves four baseline choices open. The scaffold (#10), the Convex adapter (#11), hosting (#9), and previews (#15) all depend on them:

1. **Rendering mode:** client-side only, server-side rendering, or prerendering.
2. **Forms API:** `docs/conventions/angular.md` says to use signal-based forms when the installed version has them, and typed reactive forms otherwise.
3. **Convex adapter:** an in-repo, signal-based wrapper around `ConvexClient`, or a third-party package. Components never call the Convex client directly (angular.md).
4. **Convex URL configuration:** how the deployment URL reaches the app. This covers local dev (`npx convex dev`), CI with no URL, and previews built by `npx convex deploy --cmd ... --cmd-url-env-var-name <name>`.

### Verified platform facts (2026-10-07)

| Fact | Value | Source |
| --- | --- | --- |
| Current Angular major | v22, Active since 2026-06-03; `@angular/core` `latest` is 22.2.1 | angular.dev/reference/releases; npm |
| Zoneless | Default for new apps from v21. `provideZonelessChangeDetection` is stable since v20.2. | angular.dev/guide/zoneless; angular.dev/api/core/provideZonelessChangeDetection |
| Signal forms | **Stable since v22.0.** `form()` and `FormField` are tagged `@publicApi 22.0` in `@angular/forms` 22.2.1 types. Only the WebMCP integration (`provideExperimentalWebMcpForms`, `experimentalWebMcpTool`) is `@experimental`. | angular.dev/api/forms/signals/form; `@angular/forms@22.2.1` `types/_structure-chunk.d.ts`, `types/signals.d.ts` |
| `resource()` | Stable since v22.0 | angular.dev/api/core/resource |
| `@angular/ssr` | 22.2.2, MIT | npm |
| `convex` | 1.46.0, Apache-2.0 | npm |
| `ConvexClient` API | `onUpdate(query, args, cb, onError?)` returns `Unsubscribe` (callable, plus `unsubscribe()` and `getCurrentValue()`). Also `mutation()`, `action()`, `setAuth(fetchToken, onChange?)`, `close(): Promise<void>`, and a `disabled` option. `clearAuth()` exists on the underlying `BaseConvexClient` (`client.client`), not on `ConvexClient` itself. | docs.convex.dev/api/classes/browser.ConvexClient; `convex@1.46.0` `dist/esm-types/browser/simple_client.d.ts`, `sync/client.d.ts` |
| `npx convex deploy --cmd` | Runs the command with `spawnSync(cmd, { shell: true })`. It sets the URL variable (named by `--cmd-url-env-var-name`, or a name inferred from `package.json`) and the site-URL variable. | docs.convex.dev/cli; `convex@1.46.0` `dist/esm/cli/lib/deploy2.js` (`runCommand`) |
| Inferred URL variable name | `CONVEX_URL` when no known framework is detected. `VITE_CONVEX_URL` if `vite` is a direct dependency, `NEXT_PUBLIC_CONVEX_URL` for Next.js, and so on. `npx convex dev` writes the same name to `.env.local`, or keeps an existing recognised name such as `CONVEX_URL`. | `convex@1.46.0` `dist/esm/cli/lib/envvars.js` (`suggestedEnvVarNames`, `resolveEnvVarName`) |
| Angular CLI 22 test deps | `ng new` adds `vitest` and `jsdom` but not `vite` directly, so Convex infers `CONVEX_URL` today. | `@schematics/angular@22.2.2` `utility/latest-versions/package.json` |
| Build-time `define` | Set in `angular.json` (`define`) or with `ng build --define KEY=VALUE`, and `ng serve` also accepts `--define`. The command line overrides `angular.json`. Values are inserted as code. | angular.dev/tools/cli/build-system-migration; angular.dev/cli/serve |

### Assumptions about decisions still open

| Open decision | What this ADR assumes | If it goes the other way |
| --- | --- | --- |
| #1 package manager, Node, layout | Any package manager. Node 24 LTS (at least 24.10) or 26. A single root package with `src/` and `convex/`. | The URL wrapper script uses `node:util` `parseEnv`, which is no longer experimental from Node 24.10.0. On Node 22 it still exists but is experimental, so the script would use `process.loadEnvFile` or a 10-line parser instead. In a workspace layout, paths get the app prefix. |
| #2 lint (PR #16) | ESLint core `no-restricted-imports` blocks `convex/browser` outside `src/app/core/data/convex/**`. | **Folder confirmed:** the adapter lives in `src/app/core/data/convex/`, so ADR 0002's `ignores` glob is unchanged. |
| #3 unit runner | Vitest through the Angular unit-test builder (CLI 22 default), `TestBed` with zoneless change detection. | Adapter specs are runner-agnostic. They use `TestBed.tick()` to flush effects, not runner-specific timers. |
| #4 e2e | A console-error check runs against a build with no Convex URL (#13). | The no-URL behaviour below logs nothing, so it holds for any runner. |
| #6 UI library | Form controls bind with signal forms' `[formField]`. | `FormField` binds native inputs and components that implement `FormValueControl`/`FormCheckboxControl`. It also accepts a `ControlValueAccessor` "for backwards compatibility" (type docs). A #6 library whose inputs are CVA-only still works, but #6 should state which binding path it uses. |
| #7 auth | Undecided. The adapter exposes an auth extension point (`CONVEX_AUTH`, below), and #11 ships it unused. | Any provider that can produce a JWT through an async function fits `setAuth`. No adapter API change is needed. |
| #9 hosting | Static hosting with SPA fallback. The Angular build output is `dist/<app>/browser`. | CSR needs no server runtime, so the $0 option in #9 stays open. SSR would remove it (see Rendering). |

## Options

### 1. Rendering mode

#### Option 1A: Client-side rendering only (baseline)

- **What it is:** the CLI default with no `@angular/ssr`. The build output is static files.
- **Pros:** No server runtime, so any static host works, including the $0 options in #9. Convex live queries need a browser WebSocket anyway, so every data-driven page renders on the client. No hydration, no `TransferState`, and no server path in the adapter. `docs/product/requirements.md` names no public, search-indexed, or link-preview page.
- **Cons:** Search engines and link-preview bots see an empty shell. The first paint waits for JavaScript, so later work has to keep the bundle small for phones on mobile networks.

#### Option 1B: Server-side rendering (`@angular/ssr` 22.2.2, MIT, `RenderMode.Server`)

- **Pros:** Indexable HTML and link previews for public pages. Faster first contentful paint.
- **Cons:** Needs a server runtime (Node, or a platform using Web `Request`/`Response`), which rules out pure static hosting. The adapter needs a server path: either `ConvexClient` with `disabled: true` plus one-shot fetches through `ConvexHttpClient`, or skipping on the server and rendering loading states. `TransferState` would be needed to avoid a loading flash. Auth tokens would have to reach the server (cookies), which affects #7. Per-request cost (angular.dev/guide/ssr).

#### Option 1C: CSR plus build-time prerender of selected routes (`outputMode: "static"`)

- **Pros:** Static hosting still works. Public pages with build-time content get real HTML.
- **Cons:** Prerendered pages "can't include data specific to the user loading them" (angular.dev/guide/ssr). League data changes live, so prerendered content goes stale unless the build reruns. Non-prerendered paths need the fallback set to Client. It adds `@angular/ssr` and `@angular/platform-server`.

### 2. Forms API

#### Option 2A: Signal forms (`@angular/forms/signals`)

- **What it is:** `form(model, schema)`, the `[formField]` directive, schema validators (`required`, `email`, `validate`, `validateAsync`, `validateHttp`, Standard Schema), and `submit()`. Stable since v22.0. It ships in `@angular/forms`, so no new package is needed.
- **Pros:** Matches angular.md's rule ("when present") and ADR 0001's "current APIs". The model is a `WritableSignal`, so form state composes with `computed()`/`linkedSignal()` and needs no RxJS. Validation lives in one schema.
- **Cons:** The API is newer, with fewer community examples than reactive forms. Third-party controls that only implement `ControlValueAccessor` go through the compatibility path. The WebMCP parts are experimental and must not be used.

#### Option 2B: Typed reactive forms (`FormGroup`/`FormControl`)

- **Pros:** Mature, widely documented, and recommended by angular.dev/guide/forms for complex forms.
- **Cons:** Observable-based (`valueChanges`), which conflicts with the signals-first conventions. Choosing it would depart from angular.md's rule and require amending angular.md.

### 3. Convex adapter

#### Option 3A: In-repo adapter around `ConvexClient` (`convex` 1.46.0, Apache-2.0, already covered by ADR 0001)

- **Pros:** No new dependency. The API is exactly what #11 tests: the names `value()`/`isLoading()`/`error()`/`pending()`, the args-change semantics, and the no-URL behaviour. The size is small (an estimated 250 to 350 lines plus specs). It keeps up with Convex and Angular releases without waiting on a third party.
- **Cons:** The project owns maintenance. Pagination (`onPaginatedUpdate_experimental` is experimental in `convex` 1.46.0), connection-state signals, and auth helpers are later work.

#### Option 3B: `convex-angular` 1.10.0 (MIT, npm)

- **What it is:** a community package (one maintainer, azhukaudev). It provides `provideConvex`, `injectQuery` (with `data()`, `isLoading()`, `error()`, `skipToken`), `injectMutation().mutate`, `injectAction().run`, pagination, auth integrations (Clerk, Auth0, Better Auth, custom), route guards and resolvers, SSR support, and a `testing` entry point.
- **Health (2026-10-07):** last publish 1.10.0 on 2026-07-11, last repo push 2026-08-29, 36 GitHub stars, 0 open issues, about 1,200 downloads in the week of 2026-09-28. Releases carry npm provenance.
- **Pros:** Covers features the in-repo adapter would add later (pagination, auth wiring, SSR/`TransferState`).
- **Cons and risks:**
  - **Single maintainer.**
  - **Not tested on the current stack:** its repo builds and tests against Angular 21.2.17 and `convex` 1.42.1. Its peer range (`@angular/core >=21.2.17`, `convex >=1.42.1`) is open-ended, so installing on Angular 22 and `convex` 1.46 is untested upstream. The README says pagination relies on experimental Convex APIs and is "tested against `convex` 1.41.x".
  - **Extra peer dependencies:** it requires `@angular/router` and `rxjs`.
  - **Different semantics from #11:** `data()` instead of `value()`, and stale data with `isRefetching()` during resubscribe. #11 would have to be rewritten.
  - **Lint exemption:** ADR 0002's restricted-imports rule would need a similar exemption for `convex-angular`.

#### Option 3C: No adapter (services call `ConvexClient` directly)

Rejected. It repeats subscription and teardown code in every service, has no shared loading or error model, and gives tests no single seam for a fake client.

### 4. Convex URL configuration

#### Option 4A: Build-time `define`, set by a small wrapper script (no new package)

- **Pros:**
  - **No generated or rewritten tracked files,** so the working tree stays clean.
  - **Works for every entry point.** `npx convex deploy --cmd` sets the variable in the command's environment, `npx convex dev` writes it to `.env.local`, and CI simply has none.
  - **The URL is visible in the bundle,** so #15 can check it with `grep`.
  - **No extra request at startup.**
- **Cons:** The URL is fixed per build, so one artifact cannot be promoted across environments. That costs nothing here, because `npx convex deploy --cmd` builds once per deployment anyway. It adds one script (`scripts/ng-convex.mjs`).

#### Option 4B: Environment file rewritten before the build

- **Cons:** Writes into `src/`. A committed `environment.ts` would leave the tree dirty after every build. An untracked generated file would have to exist before `typecheck`, `lint`, and `test`, so every script would need the generator first. It has no advantage over 4A.

#### Option 4C: Runtime config fetch (`config.json` served beside the app)

- **Pros:** One build can serve many environments.
- **Cons:**
  - **Delays the first render** by a round trip before bootstrap.
  - **Needs a cache policy** for the config file.
  - **Breaks the CI console check.** In CI with no file, the browser logs a failed 404 fetch to the console, which fails the console-error check in #13 unless a placeholder file is always deployed.
  - **Adds a host concern.** #9 would have to serve and invalidate the file.

## Recommendation

### Rendering: Option 1A, client-side rendering only

Adopt CSR only. **Revisit** through a new ADR that supersedes this section if either of these happens:

- The owner answers yes to "Will any page be public and need search indexing or link previews at launch?". The orchestrator is relaying this question on #5.
- A measured mobile LCP problem on a real page cannot be fixed by bundle work.

**If the owner answers yes,** this ADR is revised before merge instead:

- Public routes use `RenderMode.Prerender` with `outputMode: "static"` when their content is build-time. Otherwise they use `RenderMode.Server`, and every signed-in route stays `RenderMode.Client`.
- **Packages added:** `@angular/ssr` and `@angular/platform-server` 22.x (MIT).
- **#9:** with `RenderMode.Server`, the host needs a server runtime, and the $0 static-only option drops out. With prerender only, static hosting stays possible.
- **#11:** gains the criterion "on the server platform, no `ConvexClient` (WebSocket) is created". The provider uses `isPlatformServer` and either returns `null` (helpers render loading) or uses `ConvexHttpClient` with `TransferState`.
- **Adapter choice:** Option 3B's built-in SSR support would then count in its favour, and the adapter decision would be reweighed.
- **#7:** must make a token available server-side (cookie-based) for any authenticated SSR route.

### Forms: Option 2A, signal forms

Use signal forms, because they are stable in Angular 22. This follows angular.md's rule unchanged, so angular.md is **not** amended. Do not use the experimental WebMCP APIs. Custom form controls implement `FormValueControl`/`FormCheckboxControl`. A `ControlValueAccessor` is used only when a #6 library requires it.

### Adapter: Option 3A, in-repo, with the API below

The in-repo adapter is small, needs no new dependency, and fits #11's tests exactly. Option 3B was considered and is not adopted, mainly because of its single maintainer and its untested Angular 22 / `convex` 1.46 support. If pagination or auth wiring later grows large, adopting `convex-angular` can be proposed through its own `gate:technology` ADR.

### Convex URL: Option 4A, build-time `define`, variable `CONVEX_URL`

The variable name `CONVEX_URL` is the one Convex infers for this project today. It is still always passed explicitly (below), so a future direct `vite` dependency cannot silently change it to `VITE_CONVEX_URL`.

## Adapter specification (fixes #11)

### Location and public surface

The adapter lives in `src/app/core/data/convex/`. Code outside the folder imports only from `src/app/core/data/convex/index.ts`. Only this folder imports `convex/browser`, as ADR 0002's rule enforces. Types from `convex/server` (`FunctionReference`, `FunctionArgs`, `FunctionReturnType`) and `convex/values` (`ConvexError`) may be used anywhere.

```ts
// src/app/core/data/convex/index.ts
export function provideConvex(): EnvironmentProviders;               // registered once in app.config.ts
export function provideConvexAuth(source: ConvexAuthSource): EnvironmentProviders; // used by the #7 follow-up

export const CONVEX_URL: InjectionToken<string | null>;               // default factory: build-time __CONVEX_URL__
export const CONVEX_CLIENT_FACTORY: InjectionToken<(url: string) => ConvexClientLike>; // default: wraps new ConvexClient(url)
export const CONVEX_CLIENT: InjectionToken<ConvexClientLike | null>;  // provided by provideConvex(); null when no URL
export const CONVEX_AUTH: InjectionToken<ConvexAuthSource>;           // optional; absent until #7

export interface ConvexClientLike {
  onUpdate: ConvexClient['onUpdate'];
  mutation: ConvexClient['mutation'];
  action: ConvexClient['action'];
  setAuth: ConvexClient['setAuth'];
  clearAuth(): void;                 // real client: client.client.clearAuth()
  close(): Promise<void>;
}

export interface ConvexAuthSource {
  fetchToken: (args: { forceRefreshToken: boolean }) => Promise<string | null | undefined>;
  signedIn: Signal<boolean>;
  onChange?: (isAuthenticated: boolean) => void;
}

export const skipToken: unique symbol;
export type SkipToken = typeof skipToken;

export function injectQuery<Q extends FunctionReference<'query'>>(
  query: Q,
  args: FunctionArgs<Q> | (() => FunctionArgs<Q> | SkipToken),
  options?: { injector?: Injector },
): QueryRef<FunctionReturnType<Q>>;

export interface QueryRef<T> {
  readonly value: Signal<T | undefined>;
  readonly isLoading: Signal<boolean>;
  readonly error: Signal<Error | undefined>;
}

export function injectMutation<M extends FunctionReference<'mutation'>>(
  mutation: M, options?: { injector?: Injector },
): CallRef<FunctionArgs<M>, FunctionReturnType<M>>;

export function injectAction<A extends FunctionReference<'action'>>(
  action: A, options?: { injector?: Injector },
): CallRef<FunctionArgs<A>, FunctionReturnType<A>>;

export interface CallRef<Args, R> {
  run(args: Args): Promise<Awaited<R>>;
  readonly pending: Signal<boolean>;
  readonly error: Signal<Error | undefined>;
}

export class ConvexNotConfiguredError extends Error {}  // name: 'ConvexNotConfiguredError'
```

### Provider and lifecycle

- **Registration.** `app.config.ts` lists `provideConvex()` once at the root, next to the other root providers. It is not registered in route or component providers.
- **`CONVEX_URL`** resolves through its default factory to the build-time constant (`typeof __CONVEX_URL__ === 'undefined' ? null : __CONVEX_URL__`). An empty string is treated as `null`. Tests override the token.
- **`CONVEX_CLIENT`** is created by a factory in the root environment injector:
  - If the URL is `null`, it returns `null`.
  - Otherwise it calls `CONVEX_CLIENT_FACTORY(url)`, applies auth (below), and registers `inject(DestroyRef).onDestroy(() => void client.close())`.
  - **Effect:** exactly one client per app, and `close()` is called exactly once when the application (root environment injector) is destroyed.
- **Test seams.** Provider specs override `CONVEX_CLIENT_FACTORY` with a fake to observe the URL and `close()`. Helper specs override `CONVEX_CLIENT` with a fake directly.

### Query helper (`injectQuery`)

- **Injection context.** It must run in an injection context unless `options.injector` is given. Otherwise Angular's injection-context error is thrown. The owning injector is `options.injector ?? inject(Injector)`.
- **Args.** Args may be a plain object (static) or a function, which is read reactively as a signal computation.
  - Changed args are compared structurally using `convexToJson` from `convex/values` and `JSON.stringify`. A new object with equal content does not resubscribe.
- **Subscribing.** The subscription is opened in an `effect()` owned by that injector, a side effect that leaves Angular, as angular.md allows.
  - The effect runs on the next change-detection pass, so specs call `TestBed.tick()` before asserting on subscriptions.
  - It calls `client.onUpdate(query, args, onValue, onError)`, always with `onError` supplied, and the effect's cleanup calls the returned `unsubscribe()`.
- **States:**

| Situation | `value()` | `isLoading()` | `error()` | Subscription |
| --- | --- | --- | --- | --- |
| Created with ready args, before the first emission | `undefined` | `true` (set synchronously at creation) | `undefined` | Opened on the first effect run |
| Emission `v` | `v` | `false` | `undefined` | Same subscription; later emissions replace `value()` and open no new subscription |
| Error emission `e` | `undefined` | `false` | `e` | Same subscription; a later successful emission clears `error()` |
| Args change to new ready args, **until the new subscription's first emission** | **`undefined`** | **`true`** | `undefined` | Old one unsubscribed, new one opened |
| Args are `skipToken` (at creation or after a change) | `undefined` | `false` | `undefined` | None (any previous one is unsubscribed) |
| Owning injector destroyed | unchanged | unchanged | unchanged | Unsubscribed (effect cleanup) |
| No Convex URL (`CONVEX_CLIENT` is `null`) | `undefined` | `false` | `ConvexNotConfiguredError` | None; nothing is logged |

- **Why the value is cleared on args change.** The previous value belongs to different args, for example another team's roster under the new team's header, so `value()` returns to `undefined` with `isLoading()` true. A component that deliberately wants to keep showing old content can do so with `linkedSignal()`.
- **Cache hits.** If the client already holds the new args' result in memory, `onUpdate` delivers it soon after registration, per the Convex docs, so the gap is brief.

### Mutation and action helpers (`injectMutation`, `injectAction`)

- **Shared behaviour.** Two helpers share one internal implementation, so behaviour is identical. They call `client.mutation()` and `client.action()` respectively.
- **`run(args)`:**
  - Sets `pending()` to true while any call from this helper is in flight (counted, so overlapping calls keep it true until the last one settles).
  - Resolves with the result. On success, `error()` is set to `undefined`. This is how an earlier error is cleared: on the next successful call.
  - On rejection, it sets `error()` to the rejection (an `Error`, which is `ConvexError` for application errors from `convex/values`) and **rejects the returned promise with the same error.**
  - `error()` is not cleared when a call starts, only when a later call resolves (or is replaced when a later call rejects).
- **No Convex URL.** `run()` returns a rejected promise with `ConvexNotConfiguredError`, sets `error()` to it, and never sets `pending()` to true. Nothing is logged.
- **After destroy.** If the owning injector is destroyed mid-call, the promise still settles. Signal updates after destroy are harmless and are not suppressed.

### No URL configured (CI, e2e build, fresh clone)

- **Startup:** no `ConvexClient` is created (no WebSocket), and nothing is thrown or logged at startup. No `console.error`, `console.warn`, or `console.info`.
- **Helpers report the condition through their `error()` signal,** holding a `ConvexNotConfiguredError` with the message `"Convex URL not configured: set CONVEX_URL (see src/app/core/data/convex/README.md)"`. As specified above, query helpers have `isLoading()` false, and `run()` rejects with the same error.
- **Feature pages decide how to show it.** Its distinct class lets them render a configuration message instead of a generic error.
- **Check for #11:** #11 currently has no acceptance criterion for helper behaviour with no URL. It needs one; see the PR description.

### Auth extension point (for #7)

- **No auth in #11.** `CONVEX_AUTH` is declared in #11 and nothing provides it.
- **When `CONVEX_AUTH` is provided** (the #7 follow-up calls `provideConvexAuth(source)`), the `CONVEX_CLIENT` factory, right after creating the client:
  - calls `client.setAuth(source.fetchToken, source.onChange)`;
  - creates an `effect` on `source.signedIn`. A `true` → `false` transition calls `client.clearAuth()`, and `false` → `true` calls `client.setAuth(...)` again.
- **Live queries need no change.** They keep their subscriptions, and Convex reruns them with the new identity.
- **Why the API stays fixed.** Any provider that produces a JWT through an async function fits here, so the #7 outcome adds a provider function and changes no #11 API.

## URL configuration specification

- **`angular.json`.** The build target's `options` includes `"define": { "__CONVEX_URL__": "null" }`, so a bare `ng build`/`ng serve` produces the no-URL app.
- **Global declaration.** `src/app/core/data/convex/convex-url.ts` declares `declare const __CONVEX_URL__: string | null;` and the `CONVEX_URL` token.
- **`scripts/ng-convex.mjs <build|serve> [extra ng args]`** (about 40 lines, Node built-ins only):
  1. Resolves the URL from `process.env.CONVEX_URL`. If that is unset or empty, it reads `CONVEX_URL` from `.env.local` with `node:util` `parseEnv`. If neither exists, the URL is none.
  2. If a URL is found, validates it with `new URL()`. It must be `https:`, or `http:` on `localhost`/`127.0.0.1` for a local Convex backend, with no quote characters. If the URL is invalid, the script exits 1 with a message, so a broken URL fails the build instead of shipping.
  3. Prints one line, `Convex URL: <url> (from <source>)` or `Convex URL: none`. The deployment URL is public, because it ships to every browser, so logging it is safe. It is not a secret.
  4. Spawns `ng <command> --define=__CONVEX_URL__='<url>'` (no shell, argv array, so quoting works the same on every OS). With no URL, it adds no flag and keeps the `null` default.
- **Scripts.** #11 changes the scaffold's (#10) scripts to `"build": "node scripts/ng-convex.mjs build"` and `"start": "node scripts/ng-convex.mjs serve"`. `typecheck`, `lint`, and `test` do not use the wrapper, because they need no URL.
- **`.env.example`** (committed, empty) contains `CONVEX_URL=`. The README says to copy it to `.env.local` before the first `npx convex dev`. `resolveEnvVarName` then keeps the existing `CONVEX_URL` name instead of inferring one.

**How each environment gets its URL:**

| Environment | How the URL arrives | Result |
| --- | --- | --- |
| Local dev | `npx convex dev` writes `CONVEX_URL` to `.env.local`, and `start` reads it | Client connects to the developer's dev deployment |
| CI (#12) and e2e build (#13) | No env var and no `.env.local` | `Convex URL: none`, `__CONVEX_URL__` is `null`, no client, clean console |
| Preview (#15) | `npx convex deploy --cmd "<runner> run build" --cmd-url-env-var-name CONVEX_URL` (plus `--preview-create <branch>`) | Convex sets `CONVEX_URL` (the canonical cloud URL) in the command's environment. The wrapper uses it. The log line and a `grep` of `dist/<app>/browser/*.js` show the same URL that `npx convex deploy` reported. |
| Production (later, `gate:production`) | Same command with the production deploy key | Same mechanism |

**Always pass `--cmd-url-env-var-name CONVEX_URL` explicitly.** Convex infers the name from `package.json`, and a future direct `vite` dependency would change the inferred name to `VITE_CONVEX_URL`.

## Consequences

- **New dependencies:** none. Signal forms are part of `@angular/forms`, and the adapter uses `convex` (ADR 0001). `@angular/ssr` is not added.
- **#10 (scaffold):** CSR, zoneless by default (no `provideZoneChangeDetection`, no `zone.js`), and the `build` script stays `ng build` until #11 replaces it. It also adds the `define` default to `angular.json`, or #11 does.
- **#11 (adapter):** implements the specification above: the folder, tokens, helpers, state table, no-URL behaviour, auth token, wrapper script, `.env.example`, and the `build`/`start` scripts. It needs one added criterion for helper behaviour with no URL (see the PR description).
- **#9 (hosting):** static hosting with SPA fallback is sufficient, and no server runtime is needed.
- **#15 (previews):** uses `--cmd-url-env-var-name CONVEX_URL` explicitly, and checks the bundle with `grep` plus the wrapper's log line.
- **#7 (auth):** plugs in through `provideConvexAuth()` and needs no adapter API change.
- **#6 (UI library):** must state how its form controls bind to signal forms (`FormValueControl`, or the `ControlValueAccessor` compatibility path).
- **Harder later:**
  - Public, indexable pages require reopening rendering with a superseding ADR, plus SSR work in the adapter.
  - Pagination, connection-state signals, and optimistic updates are not in the baseline API. They are added to the adapter as features need them, or replaced by a package through a new gate.
  - One build per environment, which is already the case with `npx convex deploy --cmd`.

## Sources

- Angular (angular.dev, checked 2026-10-07):
  - [Releases and support](https://angular.dev/reference/releases)
  - [Zoneless](https://angular.dev/guide/zoneless)
  - [`provideZonelessChangeDetection`](https://angular.dev/api/core/provideZonelessChangeDetection)
  - [Signal forms overview](https://angular.dev/guide/forms/signals/overview)
  - [`form()` API (stable since v22.0)](https://angular.dev/api/forms/signals/form)
  - [Forms overview](https://angular.dev/guide/forms)
  - [`resource()` API (stable since v22.0)](https://angular.dev/api/core/resource)
  - [Server and hybrid rendering](https://angular.dev/guide/ssr)
  - [Build system: `define`](https://angular.dev/tools/cli/build-system-migration)
  - [`ng serve` options](https://angular.dev/cli/serve)
- Package contents (npm tarballs, 2026-10-07):
  - `@angular/forms@22.2.1`: `types/_structure-chunk.d.ts`, `types/signals.d.ts` (`@publicApi 22.0` and `@experimental` tags)
  - `@schematics/angular@22.2.2`: `utility/latest-versions/package.json`
  - `convex@1.46.0`: `dist/esm-types/browser/simple_client.d.ts`, `dist/esm-types/browser/sync/client.d.ts`, `dist/esm-types/browser/sync/authentication_manager.d.ts`, `dist/esm/cli/lib/deploy2.js`, `dist/esm/cli/lib/envvars.js`
- npm registry (2026-10-07):
  - [@angular/core](https://www.npmjs.com/package/@angular/core)
  - [@angular/ssr](https://www.npmjs.com/package/@angular/ssr)
  - [convex](https://www.npmjs.com/package/convex)
  - [convex-angular](https://www.npmjs.com/package/convex-angular), with download counts from api.npmjs.org
- Convex (docs.convex.dev):
  - [CLI: deploy, `--cmd`, `--cmd-url-env-var-name`, `--preview-create`](https://docs.convex.dev/cli)
  - [`ConvexClient`](https://docs.convex.dev/api/classes/browser.ConvexClient)
- convex-angular:
  - [Repository](https://github.com/azhukaudev/convex-angular): README, root `package.json` (Angular 21.2.17, `convex` 1.42.1), and GitHub API repo stats
- Node.js: [`util.parseEnv`](https://nodejs.org/docs/latest-v24.x/api/util.html#utilparseenvcontent) (no longer experimental since v24.10.0)
