# Angular conventions

Applies to everything under the Angular app. Use the latest stable major (ADR 0001). When unsure whether an API exists or is stable in the installed version, check `node_modules/@angular/*` types or angular.dev for that version rather than relying on memory.

## Components

- Standalone components only; no NgModules. `standalone: true` is the default, so the decorator leaves it out.
- `ChangeDetectionStrategy.OnPush` on every component; the app runs zoneless.
- `input()`, `input.required()`, `output()`, `model()` and signal queries (`viewChild()`, `contentChildren()`) in place of decorator-based equivalents.
- Host bindings and listeners go in the `host` object of the decorator.
- `inject()` for dependencies, not constructor injection.
- One responsibility per component; inline templates for small components, relative paths for external templates and styles.

## State and data

- Signals for state: `signal()`, `computed()`, `linkedSignal()`, `effect()` only for side effects that leave Angular (logging, storage, imperative DOM APIs).
- Update signals with `set()` and `update()`.
- Convex data reaches components through signal-based services wrapping the Convex client; components never call the Convex client directly.
- Async loading of non-Convex data uses `resource()` / `httpResource()`.

## Templates

- Built-in control flow: `@if`, `@for` (with `track`), `@switch`, `@defer`, `@let`.
- `class` and `style` bindings, not `ngClass`/`ngStyle`.
- No logic beyond simple expressions; derive values with `computed()`.
- `NgOptimizedImage` for static images.

## Forms

Use Angular's signal-based forms API when present in the installed version; fall back to typed reactive forms otherwise. Record which one the scaffold chose in its ADR.

## Routing

Lazy-load every feature route with `loadComponent` / `loadChildren`. Guards and resolvers are functions.

## Rendering

Hybrid rendering per ADR 0006: every route has a render mode in `src/app/app.routes.server.ts`.

| Route kind                                                                        | Mode                                                      |
| --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Public pages that read Convex data (organization, location, league, registration) | `RenderMode.Server`, with an explicit entry ahead of `**` |
| Public pages with no Convex data (landing, about, help)                           | `RenderMode.Prerender`                                    |
| Signed-in app, everything under `/app/**`                                         | `RenderMode.Client`                                       |
| Anything else (`**`)                                                              | `RenderMode.Server`: the not-found page with status 404   |

Server routes:

- **Anonymous only.** Server renders never read cookies, the `Authorization` header, or any per-user state, and never call `setAuth`. Personalised content loads after hydration (`@defer` or a Client route).
- **Cacheable.** Public Server routes set `headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' }`.
- **Query strings and the CDN** (PR #90). Netlify's CDN stores these responses, and on PR #90's preview it ignored the query string when matching a stored one, so `/x?token=B` got the HTML rendered for `/x?token=A`. A query string can carry a one-time token (`?ott=`, ADR 0008), so:
  - Server HTML never contains the raw query string, and never a value read from it unless the page needs it to render (a filter or a page number, never a token). The skip link drops the query on the server and the browser adds it back (`skipLinkHref` in `src/app/shell/shell.ts`).
  - Every edge-function response sends `Netlify-Vary: query` (`src/server-cache.ts`), which puts the whole query string in the cache key. A route may set a narrower `Netlify-Vary` (`query=season|page`) in its `headers`; its HTML then depends on no other parameter.
  - A redirect whose `Location` copies the query string is `Cache-Control: no-store` (`src/server-redirect.ts`).
  - Each new server route adds a sample path to `e2e/cache-key.spec.ts`, which checks that no response holds the request's query string and that a request never gets the body or `Location` of one with another query string. Run it against the PR's preview as well (`E2E_BASE_URL=… npm run e2e -- e2e/cache-key.spec.ts`).
- **Query args derive only from the route and URL** (params, query string), so server and browser compute the same args.
- **SSR-safe code.** No `window`, `document`, `localStorage`, or `navigator` outside `afterNextRender`/`afterEveryRender`; no `isPlatformBrowser` branches in templates; no direct DOM manipulation. `ngSkipHydration` only on a browser-only widget's host, with a code comment and an issue link.
- **Meta tags** are set with `Title` and `Meta` (`og:title`, `og:description`, `og:url`, `og:type`, `og:image` when one exists, `<link rel="canonical">`) from the same query results, during the server render.
- **Status codes.** A public page whose primary query returns `null` sets status 404 through `RESPONSE_INIT` and renders the not-found view.

Prerender routes must not read Convex data: they render during `ng build`, which has no Convex URL in CI.

Hydration uses `provideClientHydration()` with the v22 defaults. Hydration mismatch checks run only in development builds; a production build logs nothing. Text differences and an `@if` that takes a different branch on server and browser are replaced silently in both modes, so a test that deliberately causes a mismatch must use a structural one (for example `<table><tr>` with no `<tbody>`).

## Accessibility

Every screen passes automated axe checks and meets WCAG 2.2 AA: keyboard reachable, visible focus, labelled controls, sufficient contrast. Players use phones, so layouts work from 360px wide.

## Tests

Each component and service with logic has a unit test. User-facing flows from acceptance criteria have an e2e test. Test runners are chosen via `gate:technology`.
