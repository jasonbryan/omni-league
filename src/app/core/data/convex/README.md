# Convex adapter

Signal-based access to Convex for components and services (ADR 0006 "Adapter specification"). Code outside this folder imports only from `index.ts`. Only this folder may import `convex/browser`; the `no-restricted-imports` lint rule enforces that.

## Setup

`provideConvex()` is registered once in `app.config.ts`. The deployment URL is compiled in at build time by `scripts/ng-convex.mjs` (`npm run build`, `npm start`), from `CONVEX_URL` in the environment or in `.env.local`.

## Queries

```ts
import { injectQuery, skipToken } from '../core/data/convex';
import { api } from '../../../convex/_generated/api';

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

## No Convex URL

CI, the e2e build, and a fresh clone build with no URL (`Convex URL: none`). The app starts with no client, and nothing is thrown or logged. Helpers report it instead:

- query helpers: `value()` `undefined`, `isLoading()` `false`, `error()` a `ConvexNotConfiguredError`;
- `run()`: rejects with `ConvexNotConfiguredError` (also in `error()`); `pending()` stays `false`.

Its message points here: to configure a URL, copy `.env.example` to `.env.local` before the first `npx convex dev` (see the root README), then run `npm start` or `npm run build`. Feature pages can check `error() instanceof ConvexNotConfiguredError` to show a configuration message.

## Auth

`provideConvexAuth(AuthService)` in `app.config.ts` registers the auth source (ADR 0006 "Auth extension point", ADR 0008, #62). It takes a `ConvexAuthSource` instance, or an injectable class whose root instance is used. In the browser, the client factory then calls `setAuth(fetchToken, onChange)` when it creates the client, `clearAuth()` when `signedIn` turns false, and `setAuth` again when it turns true; live queries keep their subscriptions and rerun with the new identity. On the server it is ignored, so server renders stay anonymous.

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

Provide a fake through `CONVEX_CLIENT` (helpers) or `CONVEX_CLIENT_FACTORY` (the provider). `testing/fake-convex-client.ts` implements only the `ConvexClientLike` surface. Call `TestBed.tick()` before asserting on subscriptions: they open in an effect.

For the server path, set `PLATFORM_ID` to `'server'`, provide `CONVEX_URL`, and provide `CONVEX_HTTP_CLIENT_FACTORY` returning `testing/fake-convex-http-client.ts`. `server-render.spec.ts` shows a full `renderApplication` render. A spec that calls `renderApplication` must restore the global DOM classes after each test with `testing/dom-globals.ts`: the render swaps jsdom's `Event`, `Node` and the rest for domino's, and spec files share one global (`isolate: false`).
