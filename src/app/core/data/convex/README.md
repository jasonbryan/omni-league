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

## Server rendering (interim, until #24)

On the server platform no `ConvexClient` is created, so no WebSocket opens and nothing is fetched.

- A query helper with ready args reports `value()` `undefined`, `isLoading()` `true`, `error()` `undefined`: the browser's state before its first result, so hydration matches. With no URL it reports `ConvexNotConfiguredError`, as in the browser. #24 replaces this with a real server fetch.
- `run()` rejects with `ConvexServerCallError`, with or without a URL: mutations and actions never run during a render.

## Testing

Provide a fake through `CONVEX_CLIENT` (helpers) or `CONVEX_CLIENT_FACTORY` (the provider). `testing/fake-convex-client.ts` implements only the `ConvexClientLike` surface. Call `TestBed.tick()` before asserting on subscriptions: they open in an effect.
