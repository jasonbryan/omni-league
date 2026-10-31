# Convex adapter

Signal-based access to Convex for components and services. Code outside this folder imports only from `index.ts`. Only this folder may import `convex/browser`; the `no-restricted-imports` lint rule enforces that.

Function references come from this folder too: `api` (typed from `convex/_generated/api.d.ts`) and `getFunctionName`. A runtime import of `convex/_generated/api` or `convex/server` would put Convex's server code (its schema builder, about 4.5 kB) in the initial bundle, so outside specs both may be named only by `import type`, which `no-restricted-imports` also enforces. `api.spec.ts` checks that both give the names `convex/server` gives, so a Convex update that changes how references carry their name fails it.

## Setup

`provideConvex()` is registered once in `app.config.ts`. The deployment URL is compiled in at build time by `scripts/ng-convex.mjs` (`npm run build`, `npm start`), from `CONVEX_URL` in the environment or in `.env.local`.

## Queries

```ts
import { api, injectQuery, skipToken } from '../core/data/convex';

readonly teamId = input<Id<'teams'>>();
readonly roster = injectQuery(api.teams.roster, () => {
  const teamId = this.teamId();
  return teamId ? { teamId } : skipToken;
});
// roster.value(), roster.isLoading(), roster.error()
```

- Call it in an injection context (a field initializer), or pass `{ injector }`.
- Args may be a plain object or a function read as a signal computation. Args are compared by content, so a new object with equal content does not resubscribe.
- Updates arrive live on the same subscription. When the args change, `value()` returns to `undefined` and `isLoading()` to `true` until the new subscription's first result. Use `linkedSignal()` if a component must keep showing old content.
- `skipToken` args open no subscription: `isLoading()` is `false`.
- The subscription closes when the owning injector (usually the component) is destroyed.

## Mutations and actions

```ts
readonly addPlayer = injectMutation(api.teams.addPlayer);
// await this.addPlayer.run({ teamId, name }); this.addPlayer.pending(); this.addPlayer.error()
```

`injectAction` behaves the same. `run()` resolves with the result or rejects with the error that `error()` then holds. `pending()` stays `true` until every overlapping call settles. `error()` is cleared only by a later successful call.

## Connection and offline

`injectOnline()` returns the app's `online` signal, which drives the offline note in the shell and the disabled look of submit buttons:

- false at once when the browser reports offline (`navigator.onLine`, the `offline` event);
- false once the socket has been down for 5 seconds, including a client that has not connected 5 seconds after the app started (field wifi with no internet, where `navigator.onLine` stays true). When the service worker has detected a newer version by then, the note waits until 15 seconds after the socket went down, because the app is about to reload onto it;
- true again as soon as the socket is connected and the browser reports online;
- always true on the server; with no Convex URL it follows `navigator.onLine` only.

`injectOfflineCause()` says why: `unreachable` when the socket is down, the browser is online, and the service worker has answered since (`AppUpdates` calls `ConvexConnection.markSiteReached()` on `NO_NEW_VERSION_DETECTED`, `VERSION_DETECTED`, and `VERSION_READY`), otherwise `offline`. The note and every refused-change alert take their words from it (`offlineTitle()`, `injectOfflineTitle()`), so a screen gives one cause. `ConvexConnection` also exposes `socketDown`, `hasEverConnected()`, and `disconnectedWhileOnline` for `AppUpdates`.

`run()` does not use that 5-second signal. When called, it checks that the socket is connected and that `navigator.onLine` is true. If either fails, it waits up to 3 seconds for both (`pending()` is `true` meanwhile), then rejects with `ConvexOfflineError` (also in `error()`) without calling the client, so nothing is queued and sent later. `navigator.onLine` is checked because `convex` 1.46 does not listen for the `offline` event.

Known residual: a mutation already sent when the socket drops is re-sent by the Convex client on reconnect. `convex` 1.46 also notices a silent drop only after 60 seconds without server messages (`serverInactivityThreshold`), so in that window, with `navigator.onLine` still true, a change can be handed to the client and re-sent on reconnect.

## Saved copies

In the browser, each live result of a query on `OFFLINE_SAVED_QUERIES` (`offline-saved-queries.ts`) is written to `localStorage`, and shown when the page has nothing else yet, so a recently viewed public page opens offline.

- **Allow-list only.** A query is listed only if it is deliberately public and its result does not depend on the caller (Convex conventions, Functions). Nothing else is read or written, whatever the caller passes, so signed-in data is never saved.
- **Key and value.** `cvx-saved:<function>:<JSON args with sorted keys>` (`savedCopyKey`), so equal args always give one key; value `{ v: convexToJson(result), savedAt, usedAt, version }`, times in epoch milliseconds.
- **Checked before use.** Each allow-list entry carries the query's own `returns` validator, imported from where the Convex function takes it (`getPublicPageReturns`, `publicLeaguesValidator`, `publicLocationsValidator`, `getLeaguePublicPageReturns`, `publicSeasonsValidator`, `getSeasonPublicPageReturns`, `searchLeaguesValidator` in `convex/lib/publicPage.ts`), and a `version`. A copy is shown only if its value matches the validator (`matchesValidator`; extra fields are allowed, missing or mistyped ones are not) and its `version` is the entry's; anything else under the key is removed and the page behaves as if nothing were saved. So when a query's result changes, copies in the earlier shape stop matching on their own, also for a rolled-back build. Bump `version` only when the result keeps its shape but changes meaning. The type of `savedQuery` makes the build fail if the validator is not one of the query's result type.
- **Precedence.** A transferred value first (hydration is unchanged), then a live result, then a saved copy, then loading. The copy is read once per args, synchronously, so the first render of a page opened offline already shows it.
- **`savedAt`.** `QueryRef.savedAt()` is the time of the saved copy while one is shown, and `undefined` from the first live result on (a value or an error), and always on the server.
- **Removed records.** A live `null` (or `undefined`) removes the saved entry.
- **Limits.** At most 50 entries, the least recently used (written or shown) removed first; an entry older than 14 days, or saved more than a minute in the future (the clock was set back), is not used and is removed. Keys and values together stay under 1,000,000 UTF-16 code units, so they never crowd out the sign-in session; a larger result is not saved. Every storage error (no storage, quota exceeded, a value that is not a saved copy) is ignored.
- **Server.** A server render never reads or writes saved copies.
- **Pages.** A page shows the saved-copy note (`src/app/offline/saved-copy-note.ts`) under its `h1` only while `injectOnline()` is false, and the not-saved view (`src/app/offline/not-saved-view.ts`) when it is offline with no value. The organization page is the first: `organizations:getPublicPage`, page 1 of `organizations:listPublicLeagues` and `organizations:listPublicLocations`, and `seasons:listOpenForOrganization` (which reads no clock, so the page decides at view time which of its seasons are open), each its own saved copy; the page shows offline only when all four are saved, dated by the oldest. The public league page is the second: `leagues:getPublicPage` and `seasons:listPublic` (each page of seasons is its own saved copy, keyed by the slugs and the page asked for) beside the organization's `getPublicPage`; it shows offline only when all three are saved. The public season page is the third: `seasons:getPublicPage` alone. The find page is the fourth: `search:leagues` alone, each search being its own saved copy keyed by the parsed `q`. Later public pages add their queries to the allow-list in their own issue.
- **Specs.** A spec that renders a listed query in the browser clears `localStorage` before and after each test: spec files share one global, so a saved copy would otherwise seed a later test.

## No Convex URL

CI, the e2e build, and a fresh clone build with no URL (`Convex URL: none`). The app starts with no client, and nothing is thrown or logged. Helpers report it instead:

- query helpers: `value()` `undefined`, `isLoading()` `false`, `error()` a `ConvexNotConfiguredError`;
- `run()`: rejects with `ConvexNotConfiguredError` (also in `error()`); `pending()` stays `false`.

Its message points here: to configure a URL, copy `.env.example` to `.env.local` before the first `npx convex dev` (see the root README), then run `npm start` or `npm run build`. Feature pages can check `error() instanceof ConvexNotConfiguredError` to show a configuration message.

## Auth

`provideConvexAuth(AuthService)` in `app.config.ts` registers the auth source. It takes a `ConvexAuthSource` instance, or an injectable class whose root instance is used. In the browser, the client factory then calls `setAuth(fetchToken, onChange)` when it creates the client, `clearAuth()` when `signedIn` turns false, and `setAuth` again when it turns true; live queries keep their subscriptions and rerun with the new identity. On the server it is ignored, so server renders stay anonymous.

`AuthService` (`src/app/core/auth/`) is that source. Its `fetchToken` returns `null` without a request while signed out, so anonymous page views ask for no token, and `convexAuthenticated()` turns true once Convex has accepted the token (`onChange`). A page that reads the caller's own data asks only then, with `skipToken` before:

```ts
readonly me = injectQuery(api.users.me, () => (this.auth.convexAuthenticated() ? {} : skipToken));
```

## Server rendering

On `RenderMode.Server` routes, query helpers fetch once over HTTP during the render, and the browser picks up the result through `TransferState`. No `ConvexClient` is created on the server, so no WebSocket opens.

- **Anonymous only.** The server path uses a `ConvexHttpClient` per render and never calls `setAuth`; `CONVEX_AUTH` is ignored on the server. The HTML is public and CDN-cacheable, so no token or per-user data may reach it.
- **Args come only from the route and URL** (params, query string), so the server and the browser compute the same args, and so the same `TransferState` key, `cvx:<function>:<JSON args>`.
- **One fetch per function and args per render.** Helpers asking for the same pair share it. The render waits for every query (`PendingTasks`) before it serialises.
- **Timeout.** Each query is limited to `CONVEX_SERVER_QUERY_TIMEOUT_MS` (default 5000). On expiry (the loader's own timer, or the default client's fetch signal aborting with a `DOMException` named `TimeoutError`) `error()` is an `Error` named `TimeoutError` with the message `Convex query timed out after <n> ms`. Any other error keeps its real identity on the server, even if its name is `TimeoutError`.
- **Errors.** On the server, `error()` holds the real error. The transferred marker carries fixed text only: `{ e: { name: 'TimeoutError', message: 'Convex query timed out after <n> ms' } }` for a timeout, otherwise `{ e: { name: 'Error', message: 'Convex query failed during server render' } }`. In the browser a seeded failure is a `ConvexServerQueryError` with that fixed message, until the live subscription's first successful result clears it.
- **Never render `error().message` in a Server-route template.** On the server it is the real message (it can hold internal detail such as a hostname), and it differs from the browser's fixed message. Branch on the error (`instanceof ConvexNotConfiguredError`, or any error) and show the page's own wording.
- **Hydration seeding.** A helper whose args are first read before the application first becomes stable (in practice, one rendered during hydration) starts with the transferred result (`value()` set, or `undefined` for a query that returned `undefined`, or the error), with `isLoading()` `false`, so the first browser render matches the server HTML. The live subscription still opens, and its first result replaces the seed. The seed is decided once, on the first read of the helper's args (not at creation, so args from `input()` or `input.required()` work), and only if that read is before the app is stable and the args are ready. A first read after stable, a first read of `skipToken`, and every later args change (including `skipToken` args that become ready later, before or after stable) never use transferred entries.
- **Keep query-backed content on Server routes out of `@defer (hydrate …)` blocks.** With v22's default incremental hydration, a component inside such a block is rendered on the server but may be created in the browser only after the app is stable. Its helper then ignores the transferred entry and renders the loading state over server HTML that showed the value: a hydration mismatch that production builds hide. If such content must be deferred, it accepts that loading flash.
- **No URL:** helpers report `ConvexNotConfiguredError` on the server too, and nothing is fetched or transferred.
- `run()` rejects with `ConvexServerCallError`, with or without a URL: mutations and actions never run during a render.

## Testing

Provide a fake through `CONVEX_CLIENT` (helpers) or `CONVEX_CLIENT_FACTORY` (the provider). `testing/fake-convex-client.ts` implements only the `ConvexClientLike` surface. It starts connected; `setConnected(false)` drops the socket (`{ neverConnected: true }` for a client that never connected) and notifies `subscribeToConnectionState` callbacks. Stub `navigator.onLine` with `vi.spyOn(window.navigator, 'onLine', 'get')` and dispatch `offline` or `online` on `window`; the `online` signal reads the browser after the first render, so call `TestBed.tick()` first. Call `TestBed.tick()` before asserting on subscriptions: they open in an effect.

For the server path, set `PLATFORM_ID` to `'server'`, provide `CONVEX_URL`, and provide `CONVEX_HTTP_CLIENT_FACTORY` returning `testing/fake-convex-http-client.ts`. `server-render.spec.ts` shows a full `renderApplication` render. A spec that calls `renderApplication` must restore the global DOM classes after each test with `testing/dom-globals.ts`: the render swaps jsdom's `Event`, `Node` and the rest for domino's, and spec files share one global (`isolate: false`).
