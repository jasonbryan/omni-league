# 0006: Angular app baseline

- **Status:** Proposed
- **Gate:** `gate:technology`
- **Issue:** #5
- **Date:** 2026-10-07 (revised 2026-10-07 after the owner's answer on public pages)

## Context

ADR 0001 fixes Angular (latest stable major) and Convex but leaves four baseline choices open. The scaffold (#10), the Convex adapter (#11), hosting (#9), and previews (#15) all depend on them:

1. **Rendering mode:** client-side only, server-side rendering, prerendering, or a per-route mix.
2. **Forms API:** `docs/conventions/angular.md` says to use signal-based forms when the installed version has them, and typed reactive forms otherwise.
3. **Convex adapter:** an in-repo, signal-based wrapper around `ConvexClient`, or a third-party package. Components never call the Convex client directly (angular.md).
4. **Convex URL configuration:** how the deployment URL reaches the app. This covers local dev (`npx convex dev`), CI with no URL, and previews built by `npx convex deploy --cmd ... --cmd-url-env-var-name <name>`.

### Owner answer on public pages (#5, PR #18)

Public pages are required at launch. Anonymous visitors must be able to find an organization's leagues and register for them from public pages, and an organization can hold leagues at several locations. This ADR treats those pages as **indexable by search engines and producing link previews** (Open Graph tags) when shared in messaging apps. Their data changes while the site is live: the list of leagues, whether registration is open or closed, and the number of spots left.

`docs/product/requirements.md` does not yet list public pages or locations. Recording them there is the owner's call and is outside this ADR.

### Verified platform facts (2026-10-07)

| Fact | Value | Source |
| --- | --- | --- |
| Current Angular major | v22, Active since 2026-06-03; `@angular/core` `latest` is 22.2.1 | angular.dev/reference/releases; npm |
| Zoneless | Default for new apps from v21. `provideZonelessChangeDetection` is stable since v20.2. | angular.dev/guide/zoneless; angular.dev/api/core/provideZonelessChangeDetection |
| Signal forms | **Stable since v22.0.** `form()` and `FormField` are tagged `@publicApi 22.0` in `@angular/forms` 22.2.1 types. Only the WebMCP integration (`provideExperimentalWebMcpForms`, `experimentalWebMcpTool`) is `@experimental`. | angular.dev/api/forms/signals/form; `@angular/forms@22.2.1` `types/_structure-chunk.d.ts`, `types/signals.d.ts` |
| `resource()` | Stable since v22.0 | angular.dev/api/core/resource |
| `@angular/ssr` | 22.2.2, MIT. Peers `@angular/core`, `@angular/common`, `@angular/router`, `@angular/platform-server` `^22.0.0`. Depends on `beasties` 0.5.4 (Apache-2.0, critical-CSS inlining). | npm registry |
| `@angular/platform-server` | 22.2.1, MIT | npm registry |
| Render modes | `RenderMode.Server` renders per request. `RenderMode.Prerender` renders at build time and "cannot include any data to the specific user loading the page". `RenderMode.Client` serves the CSR shell. Set per route in `app.routes.server.ts` through `provideServerRendering(withRoutes(serverRoutes))`. Each `ServerRoute` can set `headers`; Server and Client routes can also set `status`. | angular.dev/guide/ssr; `@angular/ssr@22.2.2` `types/ssr.d.ts` |
| Prerender with params | `getPrerenderParams()` runs **at build time**. Paths it did not return use `fallback`: `PrerenderFallback.Server` (default), `Client`, or `None`. There is no on-demand or time-based regeneration. | angular.dev/guide/ssr; `types/ssr.d.ts` |
| Output modes | `outputMode: "static"` emits no server file and needs no Node server. `outputMode: "server"` emits `dist/<app>/server/server.mjs` plus `dist/<app>/browser/`. | angular.dev/guide/ssr; `@schematics/angular@22.2.2` `ssr/index.js` |
| Server entry | `ng add @angular/ssr` / `ng new --ssr` generate `src/server.ts` using `AngularNodeAppEngine` with **Express** (`express` `^5.1.0`, latest 5.2.1, MIT; `@types/express` 5.0.6, MIT) and export `reqHandler`. Non-Node runtimes use `AngularAppEngine` (Web `Request`/`Response`) with `createRequestHandler`. The server schematic also adds `@types/node` (`^22.12.0`). | `@schematics/angular@22.2.2` `ssr/index.js`, `ssr/files/application-builder/server.ts.template`, `server/index.js`; angular.dev/guide/ssr |
| Host validation | The SSR engine rejects a request whose `Host` (or trusted `X-Forwarded-Host`) is not allowed, with **HTTP 400**. Allowed hosts come from `security.allowedHosts` in `angular.json` (wildcards like `*.example.com`), the engine options, or, for `AngularNodeAppEngine` only, `NG_ALLOWED_HOSTS`. `ng new --ssr` writes `allowedHosts: []`. Proxy headers are ignored unless `trustProxyHeaders` / `NG_TRUST_PROXY_HEADERS` is set. | angular.dev/best-practices/security; `@angular/ssr@22.2.2` `fesm2022/_validation-chunk.mjs`, `fesm2022/node.mjs` |
| Zoneless SSR stability | Without zone.js, serialization "will wait for the first moment that all pending tasks have been removed". Router navigations and `HttpClient` requests register themselves; other async work must use `PendingTasks`. | angular.dev/guide/zoneless |
| Hydration | `provideClientHydration()`; incremental hydration and event replay are on by default from v22 (`withIncrementalHydration()` is deprecated "Since v22.0.0"). Server and client DOM must match; direct DOM manipulation breaks hydration. `afterNextRender`/`afterEveryRender` do not run on the server. | angular.dev/guide/hydration; `@angular/platform-browser@22.2.1` `types/platform-browser.d.ts` |
| Request tokens | `REQUEST`, `RESPONSE_INIT`, `REQUEST_CONTEXT` are in `@angular/core`; `null` during build, prerender, and CSR. | angular.dev/guide/ssr; `@angular/core@22.2.1` `types/core.d.ts` |
| `convex` | 1.46.0, Apache-2.0 | npm |
| `ConvexClient` API | `onUpdate(query, args, cb, onError?)` returns `Unsubscribe` (callable, plus `unsubscribe()` and `getCurrentValue()`). Also `mutation()`, `action()`, `setAuth(fetchToken, onChange?)`, `close(): Promise<void>`, and a `disabled` option. `clearAuth()` exists on the underlying `BaseConvexClient` (`client.client`), not on `ConvexClient` itself. | docs.convex.dev/api/classes/browser.ConvexClient; `convex@1.46.0` `dist/esm-types/browser/simple_client.d.ts`, `sync/client.d.ts` |
| `ConvexClient` on Node | The constructor builds a `BaseConvexClient` unless `disabled: true`, using the global `WebSocket`. Node 22+ has a global `WebSocket`, so constructing it during a server render **opens a real socket**. | `convex@1.46.0` `dist/esm/browser/simple_client.js` (constructor), `dist/esm/browser/sync/client.js` |
| `ConvexHttpClient` | One-shot `query()`, `consistentQuery()`, `mutation()`, `action()` over `fetch`, plus `setAuth(token)`/`clearAuth()`. Options `logger` (`false` for no-op) and `fetch` (custom `fetch`). Opens no socket. | docs.convex.dev/api/classes/browser.ConvexHttpClient; `convex@1.46.0` `dist/esm-types/browser/http_client.d.ts` |
| Convex's own SSR pattern | `convex/nextjs` `preloadQuery` runs `ConvexHttpClient.query()` and serialises `{ _name, _argsJSON, _valueJSON }` with `convexToJson`. `convex/react` `usePreloadedQuery` subscribes live with the same args and returns the preloaded value until the live result arrives. | `convex@1.46.0` `dist/esm/nextjs/index.js`, `dist/esm/react/hydration.js` |
| `npx convex deploy --cmd` | Runs the command with `spawnSync(cmd, { shell: true })`. It sets the URL variable (named by `--cmd-url-env-var-name`, or a name inferred from `package.json`) and the site-URL variable. | docs.convex.dev/cli; `convex@1.46.0` `dist/esm/cli/lib/deploy2.js` (`runCommand`) |
| Inferred URL variable name | `CONVEX_URL` when no known framework is detected. `VITE_CONVEX_URL` if `vite` is a direct dependency, `NEXT_PUBLIC_CONVEX_URL` for Next.js, and so on. `npx convex dev` writes the same name to `.env.local`, or keeps an existing recognised name such as `CONVEX_URL`. | `convex@1.46.0` `dist/esm/cli/lib/envvars.js` (`suggestedEnvVarNames`, `resolveEnvVarName`) |
| Angular CLI 22 test deps | `ng new` adds `vitest` and `jsdom` but not `vite` directly, so Convex infers `CONVEX_URL` today. | `@schematics/angular@22.2.2` `utility/latest-versions/package.json` |
| Build-time `define` | Set in `angular.json` (`define`) or with `ng build --define KEY=VALUE`, and `ng serve` also accepts `--define`. The command line overrides `angular.json`. Values are inserted as code. **The value reaches both the browser and the server bundle** (scratch build below). | angular.dev/tools/cli/build-system-migration; angular.dev/cli/serve |

### Scratch-app evidence (2026-10-07)

The system generated `ng new spike --ssr` with CLI 22.2.2 on Node 26.11.0 (zoneless by default, no `zone.js`) and added three routes: `''` as `Prerender`, `o/:slug` as `Server` with a `Cache-Control` header, and `app/**` as `Client`. The `o/:slug` page loaded its data inside an `effect()` through an async stand-in for `ConvexHttpClient.query()`, wrapped in `PendingTasks.add()`, wrote it to `TransferState`, and set `Title` and an `og:title` `Meta` tag.

- `ng build` exited 0 and printed "Prerendered 1 static route". Output: `dist/spike/browser/` (`index.html`, `index.csr.html`, hashed JS; 264 KB) and `dist/spike/server/` (`server.mjs`, `main.server.mjs`, manifests; 1.7 MB). Initial browser JS: 243.80 kB raw, 68.06 kB estimated transfer.
- `node dist/spike/server/server.mjs` with `NG_ALLOWED_HOSTS=localhost`:
  - `GET /o/acme` returned 200 with `cache-control: public, max-age=0, s-maxage=30, stale-while-revalidate=60`, `<title>Org acme leagues</title>`, the `og:title` tag, the league list in the HTML, and `<script id="ng-state" type="application/json">` holding the fetched object. The zoneless server render waited for the pending task.
  - `GET /app/dashboard` returned the empty `<app-root></app-root>` shell (Client route).
  - `GET /` returned the prerendered page.
  - `GET /o/acme` with `Host: evil.example` returned 400 and logged `Header "host" with value "evil.example" is not allowed.`
- `ng build --define=__SPIKE_URL__='https://happy-otter-123.convex.cloud'` put the URL into both `browser/main-*.js` and `server/main.server.mjs`.
- Not exercised in the spike: the browser half (hydration seeding from `TransferState`), which needs a real browser. #11's unit tests cover it (see the adapter specification).

### Assumptions about decisions still open

| Open decision | What this ADR assumes | If it goes the other way |
| --- | --- | --- |
| #1 package manager, Node, layout (PR #21, ADR 0003) | ADR 0003 proposes npm 11 and **Node 26** for builds, single root package. | The URL wrapper uses `node:util` `parseEnv`, not experimental from Node 24.10.0; on Node 22 the script would use `process.loadEnvFile` or a 10-line parser. The **production server runtime** now exists, and its Node major is #9's choice within Angular 22's range `^22.22.3 \|\| ^24.15.0 \|\| ^26.0.0` (ADR 0003 already defers it to #9 "if #5 picks SSR"). |
| #2 lint (PR #16) | ESLint core `no-restricted-imports` blocks `convex/browser` outside `src/app/core/data/convex/**`. | **Folder confirmed:** `ConvexHttpClient` also comes from `convex/browser` and stays in the same folder, so ADR 0002's `ignores` glob is unchanged. `src/server.ts` must not import `convex/browser`. |
| #3 unit runner | Vitest through the Angular unit-test builder (CLI 22 default), `TestBed` with zoneless change detection. | Adapter specs are runner-agnostic. Server-platform specs provide `{ provide: PLATFORM_ID, useValue: 'server' }`; no extra package. |
| #4 e2e (PR #17, ADR 0005) | Playwright starts the built app with `webServer`. | The built app is now a Node server (`node dist/<app>/server/server.mjs`), not static files. See Consequences. |
| #6 UI library (PR #20, ADR 0007) | spartan brain + helm on Tailwind 4, ng-icons. Form controls bind with signal forms' `[formField]`. | spartan's changelog states it is "server-side-rendering compatible out of the box"; `@ng-icons/core` 36.1.0 has an explicit server path (`isPlatformServer` → `innerHTML`, reused on hydration). Still unverified in this repo: see Consequences. `FormField` also accepts a `ControlValueAccessor` "for backwards compatibility". |
| #7 auth | Undecided. The adapter exposes an auth extension point (`CONVEX_AUTH`), and #11 ships it unused. | **Server renders are anonymous** (below), so #7 needs no cookie or server-side token at launch. Authenticated SSR would need a new ADR. |
| #9 hosting | Must run a Node server for Server routes (below). | Static-only hosts (GitHub Pages, Firebase Hosting or Cloudflare Pages without functions/workers) no longer qualify on their own. |

## Options

### 1. Rendering mode

The public pages need real HTML at the first response: link-preview crawlers read the raw HTML and its `<meta property="og:*">` tags, and the title and description must be per organization, location, and league. Their content changes with every registration.

#### Option 1A: Client-side rendering only (previous baseline)

- **Pros:** No server runtime; any static host works. No hydration, no `TransferState`, no server path in the adapter.
- **Cons:** Crawlers and preview bots get an empty `<app-root>`, the same title for every page, and no per-page Open Graph tags. **Fails the owner's requirement.** Rejected.

#### Option 1B: Prerender only (`outputMode: "static"`, `RenderMode.Prerender` with `getPrerenderParams`)

- **What it is:** every public URL is rendered to HTML during `ng build`; `getPrerenderParams` lists organizations, locations, and leagues by querying Convex at build time. Static hosting still works.
- **Pros:** No server runtime, so the cheapest hosting. Fast, CDN-cacheable HTML.
- **Cons:**
  - **Content is frozen at build time.** Angular has no on-demand or time-based regeneration. "Registration open", "3 spots left", and new leagues are wrong until the next full build and deploy. The live Convex subscription corrects the numbers after hydration, but crawlers and link previews keep the stale or missing content.
  - **New pages do not exist until a rebuild.** With `outputMode: "static"` there is no server fallback, so a league or organization created after the build has no HTML. `PrerenderFallback.Client` gives it an empty shell with no meta tags, which is exactly the CSR failure above.
  - **Keeping it fresh means rebuilding on data changes:** a Convex action calling a deploy hook on every league or registration change. Each rebuild queries every organization at build time, its duration grows with the number of pages, and the deploy hook ties Convex to the host. It also needs the production Convex URL and read access at build time, and a failed build silently leaves stale public pages.
  - Not viable for the league and registration pages. It remains the right mode for pages with **no Convex data** (landing, about, pricing, help).

#### Option 1C: Hybrid rendering, per route (`@angular/ssr` 22.2.2, MIT, `outputMode: "server"`)

- **What it is:** one `serverRoutes` table assigns each route a mode. Public pages with Convex data are `RenderMode.Server`; static pages are `RenderMode.Prerender`; signed-in app routes are `RenderMode.Client`.
- **Pros:**
  - Public pages always reflect current Convex data at request time, including pages created minutes ago, so link previews and crawlers see current titles, descriptions, and registration status.
  - Per-route `headers` allow CDN caching of public HTML (`s-maxage`), which bounds both staleness and server invocations. After hydration, the live Convex subscription keeps the page current in the browser.
  - Signed-in routes stay CSR: no server cost, no auth on the server, and no hydration concerns for the bulk of the app.
  - Proper HTTP status for unknown organizations or leagues (404 through `RESPONSE_INIT`), which matters for indexing.
- **Cons:**
  - **Needs a server runtime (Node, or a Web `Request`/`Response` runtime) for every non-asset request**, including Client routes, which the engine serves as `index.csr.html` unless the host routes them statically. This removes the $0 static-only hosting path and constrains #9.
  - Adds packages: `@angular/ssr`, `@angular/platform-server`, and, for the CLI's default Node entry, `express` (+ `@types/express`, `@types/node`).
  - The adapter needs a server path (one-shot HTTP queries, pending-task registration, `TransferState`, hydration seeding). Estimated 150 to 200 more lines plus specs.
  - Code that runs on Server routes must be SSR-safe: no `window`/`document`/`localStorage` outside `afterNextRender`, and identical first render on server and browser (hydration).
  - Host allow-listing must be configured for every hostname, including per-PR preview hosts, or the server answers 400.

### 2. Forms API

#### Option 2A: Signal forms (`@angular/forms/signals`)

- **What it is:** `form(model, schema)`, the `[formField]` directive, schema validators (`required`, `email`, `validate`, `validateAsync`, `validateHttp`, Standard Schema), and `submit()`. Stable since v22.0. It ships in `@angular/forms`, so no new package is needed.
- **Pros:** Matches angular.md's rule ("when present") and ADR 0001's "current APIs". The model is a `WritableSignal`, so form state composes with `computed()`/`linkedSignal()` and needs no RxJS. Validation lives in one schema.
- **Cons:** The API is newer, with fewer community examples than reactive forms. Third-party controls that only implement `ControlValueAccessor` go through the compatibility path. The WebMCP parts are experimental and must not be used.

#### Option 2B: Typed reactive forms (`FormGroup`/`FormControl`)

- **Pros:** Mature, widely documented, and recommended by angular.dev/guide/forms for complex forms.
- **Cons:** Observable-based (`valueChanges`), which conflicts with the signals-first conventions. Choosing it would depart from angular.md's rule and require amending angular.md.

### 3. Convex adapter

SSR changes the comparison: the adapter must now fetch on the server without a WebSocket, hold the server render until data arrives, transfer the result, and hand over to a live subscription after hydration.

#### Option 3A: In-repo adapter around `ConvexClient` and `ConvexHttpClient` (`convex` 1.46.0, Apache-2.0, already covered by ADR 0001)

- **Pros:**
  - No new dependency. The API is exactly what #11 tests: `value()`/`isLoading()`/`error()`/`pending()`, the args-change semantics, and the no-URL behaviour.
  - The server path follows the pattern Convex itself ships for Next.js (`preloadQuery` + `usePreloadedQuery`: HTTP one-shot, `convexToJson` transfer, live takeover), translated to Angular's `PendingTasks` and `TransferState`. The spike above shows the Angular half works zoneless.
  - Keeps up with Convex and Angular releases without waiting on a third party.
- **Cons:**
  - The project owns maintenance, and the size grows from an estimated 250 to 350 lines to 400 to 550 lines plus specs.
  - Pagination (`onPaginatedUpdate_experimental` is experimental in `convex` 1.46.0), connection-state signals, and auth helpers are later work.

#### Option 3B: `convex-angular` 1.10.0 (MIT, npm)

- **What it is:** a community package (one maintainer, azhukaudev). It provides `provideConvex`, `injectQuery` (with `data()`, `isLoading()`, `error()`, `skipToken`), `injectMutation().mutate`, `injectAction().run`, pagination, auth integrations (Clerk, Auth0, Better Auth, custom), route guards and resolvers, and a `testing` entry point.
- **SSR support (README and `fesm2022/convex-angular.mjs`):** on the server it constructs `ConvexClient` with `disabled: true` (no socket), fetches each `injectQuery` once through `ConvexHttpClient` inside `PendingTasks.add()`, deduplicates fetches per query and args, writes results to `TransferState` (key `cva:<name>:<JSON args>`, values through `convexToJson`), and seeds browser helpers from it until `ApplicationRef.whenStable()`. Mutations and actions throw on the server. It also offers authenticated SSR (`ssr.authToken`) with a cache-safety warning and a `transferAuthenticatedResults: false` switch.
- **Health (2026-10-07):** last publish 1.10.0 on 2026-07-11, last repo push 2026-08-29, 36 GitHub stars, 0 open issues, 113 of 114 commits by the maintainer, about 1,200 downloads in the week of 2026-09-28. Releases carry npm provenance.
- **Pros:** SSR, pagination, and auth wiring are done and have their own tests. Its SSR design is the one this ADR specifies for Option 3A, which is evidence the design works.
- **Cons and risks:**
  - **Single maintainer.**
  - **Not tested on the current stack:** its repo still builds and tests against Angular 21.2.17 and `convex` 1.42.1 (checked on `main` 2026-10-07). Its peer range (`@angular/core >=21.2.17`, `convex >=1.42.1`) is open-ended, so Angular 22 and `convex` 1.46 are untested upstream, including SSR under Angular 22's default incremental hydration. The README says pagination relies on experimental Convex APIs and is "tested against `convex` 1.41.x".
  - **Extra peer dependencies:** `@angular/router` (already present) and `rxjs`.
  - **Different semantics from #11:** `data()` instead of `value()`, and stale data with `isRefetching()` during resubscribe. #11 would be rewritten.
  - **Lint exemption:** ADR 0002's restricted-imports rule would need an equivalent for `convex-angular`.
  - **A server-render error is not transferred** in the code reviewed (only successful results are written), so a page whose server fetch failed renders an error branch on the server and a loading branch on the client's first pass. That is a hydration mismatch risk this ADR's specification closes explicitly.

#### Option 3C: No adapter (services call `ConvexClient` directly)

Rejected. It repeats subscription and teardown code in every service, has no shared loading or error model, gives tests no single seam for a fake client, and would scatter `isPlatformServer` checks across services.

### 4. Convex URL configuration

#### Option 4A: Build-time `define`, set by a small wrapper script (no new package)

- **Pros:**
  - **No generated or rewritten tracked files,** so the working tree stays clean.
  - **Works for every entry point.** `npx convex deploy --cmd` sets the variable in the command's environment, `npx convex dev` writes it to `.env.local`, and CI simply has none.
  - **The URL is visible in the bundle,** so #15 can check it with `grep`.
  - **No extra request at startup.**
  - **Covers the server bundle too** (spike above), so the Node server needs no Convex environment variable at runtime.
- **Cons:** The URL is fixed per build, so one artifact cannot be promoted across environments. That costs nothing here, because `npx convex deploy --cmd` builds once per deployment anyway. It adds one script (`scripts/ng-convex.mjs`).

#### Option 4B: Environment file rewritten before the build

- **Cons:** Writes into `src/`. A committed `environment.ts` would leave the tree dirty after every build. An untracked generated file would have to exist before `typecheck`, `lint`, and `test`, so every script would need the generator first. It has no advantage over 4A.

#### Option 4C: Runtime config fetch (`config.json` served beside the app)

- **Pros:** One build can serve many environments.
- **Cons:**
  - **Delays the first render** by a round trip before bootstrap, and on the server it would be a self-request during every render.
  - **Needs a cache policy** for the config file.
  - **Breaks the CI console check.** In CI with no file, the browser logs a failed 404 fetch, which fails the console-error check in #13 unless a placeholder file is always deployed.
  - **Adds a host concern.** #9 would have to serve and invalidate the file.

## Recommendation

### Rendering: Option 1C, hybrid rendering with per-route modes

Adopt `@angular/ssr` with `outputMode: "server"` and this route policy:

| Route kind | Examples (paths are fixed by feature issues, not here) | Mode | Why |
| --- | --- | --- | --- |
| Public pages that read Convex data | organization page, location page, league page, league registration page | `RenderMode.Server` | Current data and per-page meta tags at request time; prerendering cannot keep registration status or new leagues current |
| Public pages with no Convex data | landing, about, pricing, help | `RenderMode.Prerender` (no `getPrerenderParams`) | Same for every visitor and changes only with a deploy |
| Signed-in app | everything under one prefix, `/app/**` | `RenderMode.Client` | Per-user data, no auth on the server, no SEO need |
| Anything else (`**`) | unknown URLs | `RenderMode.Server` | Renders the not-found page with status 404 through `RESPONSE_INIT`, so unknown URLs are not indexed as soft 200s |

**Rules for Server routes:**

- **Anonymous only.** Server renders never read cookies, the `Authorization` header, or any per-user state, and the server never calls `setAuth`. Public Convex queries used on these pages must not depend on the caller's identity. Personalised content (for example "you are registered") loads after hydration in a `@defer` block or a Client route.
- **Cacheable.** Because responses are anonymous, Server routes for public pages set `headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' }`. The browser always revalidates; a shared CDN may serve the page for up to 60 s and refresh in the background. The live subscription corrects counts within a second of hydration, and capacity is enforced by the registration mutation, never by the rendered number. #9 may tune the values.
- **Query args derive only from the route and URL** (params, query string), so server and browser compute the same args and the same `TransferState` keys.
- **SSR-safe code.** No `window`, `document`, `localStorage`, or `navigator` outside `afterNextRender`/`afterEveryRender`; no `isPlatformBrowser` branches in templates; no direct DOM manipulation. Browser-only widgets get `ngSkipHydration` on their host only with a code comment and an issue link.
- **Meta tags** are set with `Title` and `Meta` (`og:title`, `og:description`, `og:url`, `og:type`, `og:image` when one exists, `<link rel="canonical">`) from the same query results, during the server render.
- **Status codes:** a public page whose primary query returns `null` (unknown slug) sets `RESPONSE_INIT` status 404 and renders the not-found view.

**Rules for Prerender routes:** they must not read Convex data, because they render during `ng build`, which in CI has no Convex URL.

**Hydration:** `provideClientHydration()` with the v22 defaults (incremental hydration and event replay on). Event replay means a tap on "Register" before hydration finishes is replayed, not lost.

**Packages added** (all MIT, Angular release train unless noted):

| Package | Version | Type | Note |
| --- | --- | --- | --- |
| `@angular/ssr` | 22.2.x | dependency | Brings `beasties` 0.5.4 (Apache-2.0) |
| `@angular/platform-server` | 22.2.x | dependency | |
| `express` | 5.2.x | dependency | The CLI's default Node server entry (`src/server.ts`). #9 may replace the entry with its host's handler (`AngularAppEngine` + `createRequestHandler`) and drop Express in its own ADR. |
| `@types/express` | 5.0.x | devDependency | Only while `express` is used |
| `@types/node` | major matching the build Node (26 per ADR 0003) | devDependency | The schematic writes `^22.12.0`; #10 pins it to the Node major from #1 |

### Forms: Option 2A, signal forms

Use signal forms, because they are stable in Angular 22. This follows angular.md's rule unchanged, so angular.md is **not** amended for forms. Do not use the experimental WebMCP APIs. Custom form controls implement `FormValueControl`/`FormCheckboxControl`. A `ControlValueAccessor` is used only when a #6 library requires it. Signal forms have no browser-only dependency, so registration forms render on Server routes.

### Adapter: Option 3A, in-repo, with server rendering support

The in-repo adapter stays the recommendation, with the server path specified below. `convex-angular`'s SSR support narrows the gap: it would save the 150 to 200 server-path lines and already handles pagination and auth wiring. It does not change the outcome, because the deciding risks are unchanged: one maintainer, no upstream testing on Angular 22 or `convex` 1.46, and a different API that would rewrite #11. The SSR design here follows the same proven pattern (Convex's own `preloadQuery`/`usePreloadedQuery`, and `convex-angular`'s loader), and adds a transferred error state to keep the first browser render identical to the server's.

**Owner trade-off:** if the owner prefers to own less code, adopting `convex-angular` instead is a reasonable alternative. In that case #11 is rewritten to its API (`data()`, `isRefetching()`), ADR 0002 gains a lint exemption, and the package is pinned exactly until its upstream tests cover Angular 22.

### Convex URL: Option 4A, build-time `define`, variable `CONVEX_URL`

The variable name `CONVEX_URL` is the one Convex infers for this project today. It is still always passed explicitly (below), so a future direct `vite` dependency cannot silently change it to `VITE_CONVEX_URL`. The same `define` reaches the server bundle, so the server needs no Convex variable at runtime.

## Rendering specification (fixes #10)

- **Generation:** #10 scaffolds with `ng new <app> --ssr` (or runs `ng add @angular/ssr` immediately after `ng new`), which creates `src/main.server.ts`, `src/server.ts`, `src/app/app.config.server.ts`, `src/app/app.routes.server.ts`, and sets `outputMode: "server"`, `ssr.entry`, and `security.allowedHosts` in `angular.json`.
- **`app.routes.server.ts`** at scaffold time:

  ```ts
  export const serverRoutes: ServerRoute[] = [
    { path: '', renderMode: RenderMode.Prerender },     // placeholder home, no Convex data
    { path: 'app/**', renderMode: RenderMode.Client },  // signed-in app
    { path: '**', renderMode: RenderMode.Server },      // public pages and not-found
  ];
  ```

  Feature issues add explicit entries for their public routes (with the `Cache-Control` header above) ahead of `**`.
- **`app.config.ts`** includes `provideClientHydration()`. The server config merges `provideServerRendering(withRoutes(serverRoutes))`.
- **Allowed hosts:** `angular.json` `security.allowedHosts` lists `localhost` and `127.0.0.1`. Preview and production hostnames are added by #9, either at build time in `angular.json` or through `NG_ALLOWED_HOSTS` (Node engine only). `*` is not used.
- **Scripts:** `serve:ssr` = `node dist/<app>/server/server.mjs` (the CLI's `serve:ssr:<project>` renamed). `PORT` defaults to 4000.
- **`docs/conventions/angular.md`** gains a short "Rendering" section in #10 that restates the route policy and the Server-route rules above.

## Adapter specification (fixes #11)

### Location and public surface

The adapter lives in `src/app/core/data/convex/`. Code outside the folder imports only from `src/app/core/data/convex/index.ts`. Only this folder imports `convex/browser` (both `ConvexClient` and `ConvexHttpClient`), as ADR 0002's rule enforces. Types from `convex/server` (`FunctionReference`, `FunctionArgs`, `FunctionReturnType`, `getFunctionName`) and `convex/values` (`ConvexError`, `convexToJson`, `jsonToConvex`) may be used anywhere.

```ts
// src/app/core/data/convex/index.ts
export function provideConvex(): EnvironmentProviders;               // registered once in app.config.ts
export function provideConvexAuth(source: ConvexAuthSource): EnvironmentProviders; // used by the #7 follow-up

export const CONVEX_URL: InjectionToken<string | null>;               // default factory: build-time __CONVEX_URL__
export const CONVEX_CLIENT_FACTORY: InjectionToken<(url: string) => ConvexClientLike>; // default: wraps new ConvexClient(url)
export const CONVEX_CLIENT: InjectionToken<ConvexClientLike | null>;  // browser: client, or null when no URL; server: always null
export const CONVEX_HTTP_CLIENT_FACTORY: InjectionToken<(url: string) => ConvexHttpClientLike>; // default: new ConvexHttpClient(url, { logger: false, fetch: fetchWithTimeout })
export const CONVEX_SERVER_QUERY_TIMEOUT_MS: InjectionToken<number>;  // default 5000
export const CONVEX_AUTH: InjectionToken<ConvexAuthSource>;           // optional; absent until #7; ignored on the server

export interface ConvexClientLike {
  onUpdate: ConvexClient['onUpdate'];
  mutation: ConvexClient['mutation'];
  action: ConvexClient['action'];
  setAuth: ConvexClient['setAuth'];
  clearAuth(): void;                 // real client: client.client.clearAuth()
  close(): Promise<void>;
}

export interface ConvexHttpClientLike {
  query: ConvexHttpClient['query'];
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
export class ConvexServerCallError extends Error {}     // name: 'ConvexServerCallError'; run() during a server render
export class ConvexServerQueryError extends Error {}    // name: 'ConvexServerQueryError'; browser-side stand-in for a server fetch failure
```

### Provider and lifecycle

- **Registration.** `app.config.ts` lists `provideConvex()` once at the root, next to the other root providers. It is not registered in route or component providers, and not separately in `app.config.server.ts` (the server config merges `appConfig`).
- **Platform.** The provider reads `isPlatformServer(inject(PLATFORM_ID))` once. Angular SSR bootstraps a new application per request, so every root-level object below lives for exactly one server render.
- **`CONVEX_URL`** resolves through its default factory to the build-time constant (`typeof __CONVEX_URL__ === 'undefined' ? null : __CONVEX_URL__`). An empty string is treated as `null`. Tests override the token.
- **`CONVEX_CLIENT`** (browser) is created by a factory in the root environment injector:
  - On the **server platform** it returns `null` without calling `CONVEX_CLIENT_FACTORY`. **No `ConvexClient` is constructed on the server**, so no WebSocket opens (Node 22+ has a global `WebSocket`, so this is not automatic).
  - In the browser, if the URL is `null`, it returns `null`.
  - Otherwise it calls `CONVEX_CLIENT_FACTORY(url)`, applies auth (below), and registers `inject(DestroyRef).onDestroy(() => void client.close())`.
  - **Effect:** exactly one client per browser app, and `close()` is called exactly once when the application (root environment injector) is destroyed.
- **Server query loader** (internal, root-provided): on the server with a URL, it creates one `ConvexHttpClientLike` per render through `CONVEX_HTTP_CLIENT_FACTORY(url)`. The default factory passes `logger: false` and a `fetch` wrapper that adds `AbortSignal.timeout(CONVEX_SERVER_QUERY_TIMEOUT_MS)`. It never calls `setAuth`. In the browser, it is never created.
- **Test seams.** Provider specs override `CONVEX_CLIENT_FACTORY` and `CONVEX_HTTP_CLIENT_FACTORY` with fakes and set `PLATFORM_ID` to `'server'` or `'browser'`. Helper specs override `CONVEX_CLIENT` with a fake directly.

### Query helper (`injectQuery`)

- **Injection context.** It must run in an injection context unless `options.injector` is given. Otherwise Angular's injection-context error is thrown. The owning injector is `options.injector ?? inject(Injector)`.
- **Args.** Args may be a plain object (static) or a function, which is read reactively as a signal computation.
  - Changed args are compared structurally using `convexToJson` from `convex/values` and `JSON.stringify`. A new object with equal content does not resubscribe. The same string, prefixed with the function name from `getFunctionName`, is the `TransferState` key: `cvx:<functionName>:<JSON args>`.
- **Subscribing (browser).** The subscription is opened in an `effect()` owned by that injector, a side effect that leaves Angular, as angular.md allows.
  - The effect runs on the next change-detection pass, so specs call `TestBed.tick()` before asserting on subscriptions.
  - It calls `client.onUpdate(query, args, onValue, onError)`, always with `onError` supplied, and the effect's cleanup calls the returned `unsubscribe()`.
- **Fetching (server).** The same `effect()` instead calls the loader:
  - `PendingTasks.add()` before the request and the returned remover in `finally`, so the zoneless server render does not serialise until every query has settled.
  - One `query(fn, args)` per distinct function and args within a render; helpers asking for the same pair share the promise.
  - On success: `value()` is the result, `isLoading()` false, and the result is written to `TransferState` as `{ v: convexToJson(result) }` (`{ u: true }` for `undefined`). `convexToJson` keeps `bigint`, `ArrayBuffer`, and Convex IDs intact through the JSON transfer.
  - On failure or timeout: `error()` is the error, `value()` `undefined`, `isLoading()` false, and `{ e: { name, message } }` is written to `TransferState`. Nothing is logged by the adapter; the route decides whether to set a status.
  - No subscription, no WebSocket, no retries.
- **Hydration seeding (browser).** When a helper is created **before the application first becomes stable** (`ApplicationRef.whenStable()`), and `TransferState` holds its key:
  - `{ v }`: `value()` is `jsonToConvex(v)` and `isLoading()` false **synchronously at creation**, so the first browser render matches the server HTML.
  - `{ e }`: `error()` is a `ConvexServerQueryError` with the transferred message, `isLoading()` false.
  - The live subscription still opens on the first effect run. Its first emission replaces the seeded value (or clears the seeded error), as in the "Emission" row below.
  - After the application is stable, transferred entries are ignored, mirroring Angular's `HttpClient` transfer cache, so later navigations never show server-render data.
- **States:**

| Situation | `value()` | `isLoading()` | `error()` | Subscription or fetch |
| --- | --- | --- | --- | --- |
| Browser, created with ready args, no transferred entry, before the first emission | `undefined` | `true` (set synchronously at creation) | `undefined` | Subscription opened on the first effect run |
| Browser, created with ready args during hydration, transferred value `v` | `v` | `false` | `undefined` | Subscription opened on the first effect run; its first emission replaces `v` |
| Browser, created with ready args during hydration, transferred error | `undefined` | `false` | `ConvexServerQueryError` | Subscription opened; its first successful emission clears `error()` |
| Emission `v` | `v` | `false` | `undefined` | Same subscription; later emissions replace `value()` and open no new subscription |
| Error emission `e` | `undefined` | `false` | `e` | Same subscription; a later successful emission clears `error()` |
| Args change to new ready args, **until the new subscription's first emission** | **`undefined`** | **`true`** | `undefined` | Old one unsubscribed, new one opened (transferred entries are not used for args changes) |
| Args are `skipToken` (at creation or after a change) | `undefined` | `false` | `undefined` | None (any previous one is unsubscribed); nothing fetched on the server |
| Owning injector destroyed | unchanged | unchanged | unchanged | Unsubscribed (effect cleanup) |
| Server, ready args, before the fetch settles | `undefined` | `true` | `undefined` | One HTTP `query()`, pending task held |
| Server, fetch resolved with `v` | `v` | `false` | `undefined` | Pending task released; `{ v }` transferred |
| Server, fetch rejected or timed out | `undefined` | `false` | the error | Pending task released; `{ e }` transferred |
| No Convex URL (either platform) | `undefined` | `false` | `ConvexNotConfiguredError` | None; nothing is logged |

- **Why the value is cleared on args change.** The previous value belongs to different args, for example another team's roster under the new team's header, so `value()` returns to `undefined` with `isLoading()` true. A component that deliberately wants to keep showing old content can do so with `linkedSignal()`.
- **Cache hits.** If the client already holds the new args' result in memory, `onUpdate` delivers it soon after registration, per the Convex docs, so the gap is brief.

### Mutation and action helpers (`injectMutation`, `injectAction`)

- **Shared behaviour.** Two helpers share one internal implementation, so behaviour is identical. They call `client.mutation()` and `client.action()` respectively.
- **`run(args)`:**
  - Sets `pending()` to true while any call from this helper is in flight (counted, so overlapping calls keep it true until the last one settles).
  - Resolves with the result. On success, `error()` is set to `undefined`. This is how an earlier error is cleared: on the next successful call.
  - On rejection, it sets `error()` to the rejection (an `Error`, which is `ConvexError` for application errors from `convex/values`) and **rejects the returned promise with the same error.**
  - `error()` is not cleared when a call starts, only when a later call resolves (or is replaced when a later call rejects).
- **On the server platform.** `run()` returns a rejected promise with `ConvexServerCallError`, sets `error()` to it, never sets `pending()` to true, and makes no network call. Mutations and actions are user interactions and never happen during a render.
- **No Convex URL.** `run()` returns a rejected promise with `ConvexNotConfiguredError`, sets `error()` to it, and never sets `pending()` to true. Nothing is logged.
- **After destroy.** If the owning injector is destroyed mid-call, the promise still settles. Signal updates after destroy are harmless and are not suppressed.

### No URL configured (CI, e2e build, fresh clone)

- **Startup:** no `ConvexClient` and no `ConvexHttpClient` are created, and nothing is thrown or logged at startup, in the browser or the server. No `console.error`, `console.warn`, or `console.info`.
- **Helpers report the condition through their `error()` signal,** holding a `ConvexNotConfiguredError` with the message `"Convex URL not configured: set CONVEX_URL (see src/app/core/data/convex/README.md)"`. As specified above, query helpers have `isLoading()` false, and `run()` rejects with the same error. Server and browser render the same state, so hydration matches.
- **Feature pages decide how to show it.** Its distinct class lets them render a configuration message instead of a generic error.

### Auth extension point (for #7)

- **No auth in #11.** `CONVEX_AUTH` is declared in #11 and nothing provides it.
- **When `CONVEX_AUTH` is provided** (the #7 follow-up calls `provideConvexAuth(source)`), the browser `CONVEX_CLIENT` factory, right after creating the client:
  - calls `client.setAuth(source.fetchToken, source.onChange)`;
  - creates an `effect` on `source.signedIn`. A `true` → `false` transition calls `client.clearAuth()`, and `false` → `true` calls `client.setAuth(...)` again.
- **On the server, `CONVEX_AUTH` is ignored.** Server renders are anonymous by design (Rendering rules), so a token can never reach a cacheable response or the `TransferState` blob.
- **Live queries need no change.** They keep their subscriptions, and Convex reruns them with the new identity.
- **Why the API stays fixed.** Any provider that produces a JWT through an async function fits here, so the #7 outcome adds a provider function and changes no #11 API.

## URL configuration specification

- **`angular.json`.** The build target's `options` includes `"define": { "__CONVEX_URL__": "null" }`, so a bare `ng build`/`ng serve` produces the no-URL app. The define applies to both the browser and server bundles.
- **Global declaration.** `src/app/core/data/convex/convex-url.ts` declares `declare const __CONVEX_URL__: string | null;` and the `CONVEX_URL` token.
- **`scripts/ng-convex.mjs <build|serve> [extra ng args]`** (about 40 lines, Node built-ins only):
  1. Resolves the URL from `process.env.CONVEX_URL`. If that is unset or empty, it reads `CONVEX_URL` from `.env.local` with `node:util` `parseEnv`. If neither exists, the URL is none.
  2. If a URL is found, validates it with `new URL()`. It must be `https:`, or `http:` on `localhost`/`127.0.0.1` for a local Convex backend, with no quote characters. If the URL is invalid, the script exits 1 with a message, so a broken URL fails the build instead of shipping.
  3. Prints one line, `Convex URL: <url> (from <source>)` or `Convex URL: none`. The deployment URL is public, because it ships to every browser, so logging it is safe. It is not a secret.
  4. Spawns `ng <command> --define=__CONVEX_URL__='<url>'` (no shell, argv array, so quoting works the same on every OS). With no URL, it adds no flag and keeps the `null` default.
- **Scripts.** #11 changes the scaffold's (#10) scripts to `"build": "node scripts/ng-convex.mjs build"` and `"start": "node scripts/ng-convex.mjs serve"`. `typecheck`, `lint`, and `test` do not use the wrapper, because they need no URL. `serve:ssr` runs the already-built server and needs no URL.
- **`.env.example`** (committed, empty) contains `CONVEX_URL=`. The README says to copy it to `.env.local` before the first `npx convex dev`. `resolveEnvVarName` then keeps the existing `CONVEX_URL` name instead of inferring one.

**How each environment gets its URL:**

| Environment | How the URL arrives | Result |
| --- | --- | --- |
| Local dev | `npx convex dev` writes `CONVEX_URL` to `.env.local`, and `start` reads it | `ng serve` renders Server routes through the dev server and the browser connects to the developer's dev deployment |
| CI (#12) and e2e build (#13) | No env var and no `.env.local` | `Convex URL: none`, `__CONVEX_URL__` is `null` in both bundles, no client, clean console and clean server log |
| e2e with the local backend (ADR 0005) | `CONVEX_URL=http://127.0.0.1:3210` for the build | Server renders fetch from the local backend over HTTP; browsers subscribe to it |
| Preview (#15) | `npx convex deploy --cmd "<runner> run build" --cmd-url-env-var-name CONVEX_URL` (plus `--preview-create <branch>`) | Convex sets `CONVEX_URL` (the canonical cloud URL) in the command's environment. The wrapper uses it. The log line and a `grep` of `dist/<app>/browser/*.js` **and** `dist/<app>/server/*.mjs` show the same URL that `npx convex deploy` reported. |
| Production (later, `gate:production`) | Same command with the production deploy key | Same mechanism |

**Always pass `--cmd-url-env-var-name CONVEX_URL` explicitly.** Convex infers the name from `package.json`, and a future direct `vite` dependency would change the inferred name to `VITE_CONVEX_URL`.

## Consequences

- **New dependencies:** `@angular/ssr`, `@angular/platform-server`, `express` (dependencies); `@types/express`, `@types/node` (devDependencies). Versions and licences are in the Recommendation table; all MIT, with `beasties` (Apache-2.0) transitive. Signal forms are part of `@angular/forms`, and the adapter uses `convex` (ADR 0001).
- **Hosting (#9): a server runtime is now required.** Server routes render per request, so the host must run `dist/<app>/server/server.mjs` (Node, through `reqHandler` or the Express listener) or a Web `Request`/`Response` handler built on `AngularAppEngine`. Pure static hosting (GitHub Pages, or Firebase Hosting / Cloudflare Pages without functions or workers) no longer qualifies on its own. #9 must also satisfy the existing constraints: budget up to about $25/month **including Convex**, per-PR previews each with its own Convex backend, and commercial use allowed. The full list is in the PR description.
- **#10 (scaffold):** scaffolds with SSR (Rendering specification): the server files, `outputMode: "server"`, `provideClientHydration()`, the three-entry `serverRoutes`, `security.allowedHosts` for local hosts, the `serve:ssr` script, `@types/node` pinned to the Node major from #1, and the angular.md "Rendering" section. Zoneless stays the default. The `build` script stays `ng build` until #11 replaces it.
- **#11 (adapter):** implements the specification above, now including the server path, hydration seeding, the three error classes, and `CONVEX_HTTP_CLIENT_FACTORY`. Its server-side criteria are in the PR description.
- **#15 (previews):** deploys a server build, not static files; adds each preview hostname to the allowed hosts; checks the URL in both bundles.
- **#4 / ADR 0005 (e2e) and #13:** Playwright's `webServer` for the app runs `node dist/<app>/server/server.mjs` with `PORT` and `NG_ALLOWED_HOSTS=localhost,127.0.0.1`. Public-page tests add a raw-HTML check (`request.get()`, no JavaScript) for content, `<title>`, and `og:*` tags, and the existing console-error fixture now also catches hydration mismatch errors (NG05xx). No new tool.
- **#6 / ADR 0007 (UI library):** must state how its form controls bind to signal forms, and must show its components render on a Server route and hydrate without hydration errors.
- **#7 (auth):** plugs in through `provideConvexAuth()` and needs no adapter API change. Server renders are anonymous, so no cookie-based or server-side token is needed at launch. The anonymous-to-registered flow on public pages happens in the browser after hydration.
- **#1 / ADR 0003 (Node):** builds stay on Node 26. The production server's Node major is chosen by #9 within Angular 22's supported range.
- **Ongoing cost:** one server invocation per uncached page request (including Client routes, unless the host serves `index.csr.html` statically), offset by CDN caching of public pages.
- **Harder later:**
  - Every component that appears on a public page must be SSR-safe and render identically on both platforms.
  - Authenticated server rendering, if ever wanted, needs a new ADR (cookie transport, `Cache-Control: private`, no `TransferState` of private data).
  - Pagination, connection-state signals, and optimistic updates are not in the baseline API. They are added to the adapter as features need them, or replaced by a package through a new gate.
  - One build per environment, which is already the case with `npx convex deploy --cmd`.

## Sources

- Angular (angular.dev, checked 2026-10-07):
  - [Releases and support](https://angular.dev/reference/releases)
  - [Version compatibility](https://angular.dev/reference/versions)
  - [Zoneless](https://angular.dev/guide/zoneless) (PendingTasks and SSR serialization)
  - [`provideZonelessChangeDetection`](https://angular.dev/api/core/provideZonelessChangeDetection)
  - [Server and hybrid rendering](https://angular.dev/guide/ssr) (render modes, `outputMode`, `getPrerenderParams`, `PrerenderFallback`, `headers`/`status`, `REQUEST`/`RESPONSE_INIT`, `AngularAppEngine` vs `AngularNodeAppEngine`)
  - [Hydration](https://angular.dev/guide/hydration)
  - [Security: preventing SSRF](https://angular.dev/best-practices/security#preventing-server-side-request-forgery-ssrf) (`allowedHosts`, `NG_ALLOWED_HOSTS`, `trustProxyHeaders`)
  - [Signal forms overview](https://angular.dev/guide/forms/signals/overview)
  - [`form()` API (stable since v22.0)](https://angular.dev/api/forms/signals/form)
  - [Forms overview](https://angular.dev/guide/forms)
  - [`resource()` API (stable since v22.0)](https://angular.dev/api/core/resource)
  - [Build system: `define`](https://angular.dev/tools/cli/build-system-migration)
  - [`ng serve` options](https://angular.dev/cli/serve)
- Package contents (npm tarballs, 2026-10-07):
  - `@angular/ssr@22.2.2`: `types/ssr.d.ts`, `types/node.d.ts`, `fesm2022/ssr.mjs`, `fesm2022/node.mjs`, `fesm2022/_validation-chunk.mjs`
  - `@angular/core@22.2.1`: `types/core.d.ts` (`PendingTasks`, `TransferState`, `REQUEST`, `RESPONSE_INIT`)
  - `@angular/platform-browser@22.2.1`: `types/platform-browser.d.ts` (`provideClientHydration`, `withIncrementalHydration` deprecation)
  - `@angular/forms@22.2.1`: `types/_structure-chunk.d.ts`, `types/signals.d.ts` (`@publicApi 22.0` and `@experimental` tags)
  - `@schematics/angular@22.2.2`: `utility/latest-versions/package.json`, `ssr/index.js`, `ssr/files/application-builder/server.ts.template`, `server/index.js`, `server/files/application-builder/standalone-src/app/*.template`
  - `convex@1.46.0`: `dist/esm-types/browser/simple_client.d.ts`, `dist/esm-types/browser/http_client.d.ts`, `dist/esm-types/browser/sync/client.d.ts`, `dist/esm-types/browser/sync/authentication_manager.d.ts`, `dist/esm/browser/simple_client.js`, `dist/esm/browser/sync/client.js`, `dist/esm/nextjs/index.js`, `dist/esm/react/hydration.js`, `dist/esm/cli/lib/deploy2.js`, `dist/esm/cli/lib/envvars.js`
  - `convex-angular@1.10.0`: `README.md` (Server-side rendering section), `fesm2022/convex-angular.mjs`, `package.json`
  - `@ng-icons/core@36.1.0`: `fesm2022/ng-icons-core.mjs` (server path)
- npm registry (2026-10-07):
  - [@angular/core](https://www.npmjs.com/package/@angular/core), [@angular/ssr](https://www.npmjs.com/package/@angular/ssr), [@angular/platform-server](https://www.npmjs.com/package/@angular/platform-server)
  - [express](https://www.npmjs.com/package/express), [@types/express](https://www.npmjs.com/package/@types/express), [@types/node](https://www.npmjs.com/package/@types/node), [beasties](https://www.npmjs.com/package/beasties)
  - [convex](https://www.npmjs.com/package/convex)
  - [convex-angular](https://www.npmjs.com/package/convex-angular), with download counts from api.npmjs.org
- Convex (docs.convex.dev):
  - [CLI: deploy, `--cmd`, `--cmd-url-env-var-name`, `--preview-create`](https://docs.convex.dev/cli)
  - [`ConvexClient`](https://docs.convex.dev/api/classes/browser.ConvexClient)
  - [`ConvexHttpClient`](https://docs.convex.dev/api/classes/browser.ConvexHttpClient)
  - [Pricing](https://www.convex.dev/pricing) (preview deployments listed for Free & Starter; for #9)
- convex-angular:
  - [Repository](https://github.com/azhukaudev/convex-angular): README, root `package.json` on `main` (Angular 21.2.17, `convex` 1.42.1), and GitHub API repo and contributor stats
- spartan: [changelog source](https://github.com/spartan-ng/spartan/blob/main/apps/app/src/app/pages/(documentation)/documentation/changelog.page.ts) (SSR compatibility statement, as cited in ADR 0007)
- Node.js: [`util.parseEnv`](https://nodejs.org/docs/latest-v24.x/api/util.html#utilparseenvcontent) (no longer experimental since v24.10.0)
- Scratch app: `ng new spike --ssr` with CLI 22.2.2 on Node 26.11.0, build and `curl` results as recorded under "Scratch-app evidence".
