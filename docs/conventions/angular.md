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
- Mutations and actions go only through the adapter's `injectMutation()` and `injectAction()`, which carry the offline guard (ADR 0013, Decision 3A): `run()` refuses a change with `ConvexOfflineError` when there is no connection, so nothing is queued and sent later.
- Submit buttons that need the server look disabled while `injectOnline()` is false: `aria-disabled="true"` and 50% opacity, never the `disabled` attribute, so they stay focusable and the Tab order does not change. A press while offline, or a `ConvexOfflineError` from `run()`, shows the destructive form alert "You're offline. Nothing was sent." with one line saying what is unchanged, then "Try again when you're connected." (`design/mockups/88-offline-note.html`, states 2 and 3). When the site answered and the Convex socket is still down, the title and the offline note read "Can't reach Omni League right now." instead (ADR 0013, 2026-10-28 amendment). The title comes from the connection's cause through `offlineTitle()` in `src/app/core/data/convex/`, and `app-admin-alert` and `app-invite-alert` take it themselves for `kind="offline"`, so a form never writes the literal.
- Saved copies (ADR 0013 section 3, #82): a public page whose query is on `OFFLINE_SAVED_QUERIES` shows the saved-copy note (`SavedCopyNote`) under its `h1` while `injectOnline()` is false and `QueryRef.savedAt()` is set, and the not-saved view (`NotSavedView`) when it is offline with no value (`design/mockups/82-offline-pages.html`). Only deliberately public queries whose result does not depend on the caller join the list, each with the query's own `returns` validator, which every saved copy must match before it is shown ([adapter README](../../src/app/core/data/convex/README.md#saved-copies-adr-0013-section-3-82)).
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
| Sign-up and sign-in (`/sign-up`, `/sign-in`)                                      | `RenderMode.Client`                                       |
| Anything else (`**`)                                                              | `RenderMode.Server`: the not-found page with status 404   |

Client routes set `headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' }`, and nothing that lets a shared cache keep the client shell (`s-maxage`, `stale-while-revalidate`, `stale-if-error`, `CDN-Cache-Control`, `Netlify-CDN-Cache-Control`). The shell names the build's content-hashed bundles, which the next deploy deletes ([ADR 0010](../decisions/0010-hosting-and-deployment.md) item 4, amended; PR #102). `src/app/app.routes.server.spec.ts` checks every Client route.

Server routes:

- **Anonymous only.** Server renders never read cookies, the `Authorization` header, or any per-user state, and never call `setAuth`. Personalised content loads after hydration (`@defer` or a Client route).
- **Cacheable.** Public Server routes set `headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' }`.
- **Query strings and the CDN** (PR #90). Netlify's CDN stores these responses, and on PR #90's preview it ignored the query string when matching a stored one, so `/x?token=B` got the HTML rendered for `/x?token=A`. A query string can carry a one-time token (`?ott=`, ADR 0008), so:
  - Server HTML never contains the raw query string, and never a value read from it unless the page needs it to render (a filter or a page number, never a token). The skip link drops the query on the server and the browser adds it back (`skipLinkHref` in `src/app/shell/shell.ts`).
  - A server `href` therefore never has the query string, so a link to a row on the current page (`/path#row`) would drop it on a plain click. After hydration such a link calls `FollowLink.clicked($event)` (`src/app/shell/follow-link.ts`), which navigates through the router to the current path, the current query string, and the link's fragment, then scrolls to the row. The phone sheet follows every plain link click through `FollowLink.follow` once it has closed: a link to the current path as above, a link to another path through the router with its own query string, and a link to another site as a full page load. In the page, a link to another path or origin is left to the browser, and so is any modified click (Ctrl, Cmd, Shift, Alt, or the middle button).
  - Every edge-function response sends `Netlify-Vary: query` (`src/server-cache.ts`), which puts the whole query string in the cache key. A route may set a narrower `Netlify-Vary` (`query=season|page`) in its `headers`; its HTML then depends on no other parameter.
  - Every response with a `Location` is `Cache-Control: no-store`, because a `Location` can copy the query string: the `//` redirect, and every redirect the engine sends (a future `redirectTo`, or the router normalizing `/x//` to `/x/` and `/x/(y)` to `/x`). The handler sets it (`withSafeRedirect` in `src/server-redirect.ts`), and turns an engine response with a `Location` and a status other than 301, 302, 303, 307, or 308 into a 302.
  - Each new server route adds a sample path to `e2e/cache-key.spec.ts`, which checks that no response holds the request's query string and that a request never gets the body or `Location` of one with another query string. Run it against the PR's preview as well (`E2E_BASE_URL=… npm run e2e -- e2e/cache-key.spec.ts`).
- **Query args derive only from the route and URL** (params, query string), so server and browser compute the same args.
- **SSR-safe code.** No `window`, `document`, `localStorage`, or `navigator` outside `afterNextRender`/`afterEveryRender`; no `isPlatformBrowser` branches in templates; no direct DOM manipulation. `ngSkipHydration` only on a browser-only widget's host, with a one-line comment giving the why. The issue link goes in the PR, not the code.
- **Meta tags** are set with `Title` and `Meta` (`og:title`, `og:description`, `og:url`, `og:type`, `og:image` when one exists, `<link rel="canonical">`) from the same query results, during the server render. `bindPageMeta()` (`src/app/core/page-meta.ts`) does this: `og:url` and the canonical are the request origin plus a path built from the query result, never the request URL, so no query string reaches them.
- **Status codes.** A public page whose primary query returns `null` sets status 404 through `RESPONSE_INIT` with `setNotFoundStatus()` (`src/app/core/not-found-status.ts`) and renders the not-found view. The function leaves the status unset when the engine will redirect a URL the router normalized, so the engine sends a 302 and not a 404 with a `Location`. If the primary query fails or times out during the server render, the page renders the server-error view (`src/app/server-error/`), which sets status 503 and `Cache-Control: no-store` with `setServerErrorStatus()` (`src/app/core/server-error-status.ts`), so the CDN never stores it.

Prerender routes must not read Convex data: they render during `ng build`, which has no Convex URL in CI.

Hydration uses `provideClientHydration()` with the v22 defaults. Hydration mismatch checks run only in development builds; a production build logs nothing. Text differences and an `@if` that takes a different branch on server and browser are replaced silently in both modes, so a test that deliberately causes a mismatch must use a structural one (for example `<table><tr>` with no `<tbody>`).

## Service worker

ADR 0013 sections 1 and 4 (#81):

- **No manual registration.** The worker is registered only by `provideServiceWorker()` in `app.config.ts`, with `serviceWorkerRegistration(SERVICE_WORKER_BUILD, isDevMode())`, never by `navigator.serviceWorker.register()` or a second provider. Development builds, the e2e build, and a build without `angular.json`'s `serviceWorker` option (the kill switch) register none ([hosting, Service worker](../process/hosting.md#service-worker)).
- **No data groups** in `ngsw-config.json`, and no `resources.urls` in an asset group: the worker keeps only same-origin build files. Convex data, auth requests, and signed-in data never pass through it. `npm run build` fails otherwise (`scripts/sw-config-check.mjs`; [hosting, Service worker](../process/hosting.md#service-worker)). Offline page data comes from saved copies kept by the app (#82).
- **Updates go through `AppUpdates`** (`src/app/core/service-worker/app-updates.ts`): the automatic reload into a new version, the new-version prompt (shown only while unsaved input holds that reload), the unrecoverable message, and the visibility check. Components do not subscribe to `SwUpdate` themselves.

## Accessibility

Every screen passes automated axe checks and meets WCAG 2.2 AA: keyboard reachable, visible focus, labelled controls, sufficient contrast. Players use phones, so layouts work from 360px wide.

## Tests

Each component and service with logic has a unit test. User-facing flows from acceptance criteria have an e2e test. Test runners are chosen via `gate:technology`.
