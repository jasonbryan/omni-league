# 0013: PWA stack: service worker, offline data, and Web Push

- **Status:** Accepted
- **Gate:** `gate:technology`
- **Issue:** #79
- **Date:** 2026-10-09 (npm registry, vendor docs, and package sources checked 2026-10-09)

## Context

The owner asked on 2026-10-09 (chat): "I would like to add that the app should be a PWA as well, so i don't have to create a separate mobile application". The owner chose this launch scope ([requirements, Installable app (PWA)](../product/requirements.md), PR #86):

1. **Installable:** home screen on iPhone, Android, and desktop; own icon; standalone display.
2. **Works on a weak signal:** the app shell and recently viewed public pages (schedules, standings) load offline or on poor field wifi, with a clear offline note. Changes need a connection.
3. **Push notifications:** game reminders, schedule changes, score updates; on iPhone only after install.
4. **Not chosen:** offline score entry.

This ADR decides the service worker, how offline pages get their data, how changes are refused offline, deploy and update behaviour, how Convex sends Web Push, where the VAPID keys live, and how push subscriptions are stored. Who receives which notification was answered by the owner on #85 (2026-10-09) and does not change these choices; the per-device switches it adds are covered in Decision section 7.

**Revision 2 (2026-10-09)** applies the plan review on PR #87 ([ADR review](https://github.com/jasonbryan/omni-league/pull/87#issuecomment-6086196446)): the connection rule (section 3), the shared-device lifecycle (section 7), the supply-chain control for `@block65/webcrypto-web-push` (Packages), and optional items 4 to 10.

### Constraints from accepted ADRs

| Source                       | Constraint used here                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR 0003 (npm, Node)         | `strict-allow-scripts=true`, so a package with an install script needs an `allowScripts` entry. `.npmrc` `min-release-age=3` (amended by #47), so a version younger than 3 days cannot be installed. `"use node"` code needs `node.nodeVersion: "24"` and `@types/node` 24.                                                                                                                                                       |
| ADR 0005, ADR 0009 (e2e, CI) | E2E runs a **development** build, Chromium only in `ci`; WebKit only on release PRs. The owner asked to minimise CI minutes. Preview smoke runs are local runs by the tester with `E2E_BASE_URL`.                                                                                                                                                                                                                                 |
| ADR 0006 (Angular)           | Public pages are Server routes, hydrated with `TransferState`; `/app/**` is client-only. Server renders are anonymous and cacheable. Every Convex read goes through the in-repo adapter (`injectQuery`, `injectMutation`, `injectAction`).                                                                                                                                                                                        |
| ADR 0008 (auth)              | Better Auth runs as HTTP actions on `*.convex.site`, a different origin from the app. The session token is kept in `localStorage` by the `crossDomain` plugin. The Convex JWT is fetched from `/api/auth/convex/token`. Nothing from auth may be stored by a cache.                                                                                                                                                               |
| ADR 0010 (hosting)           | Netlify Edge runs SSR for every path that is not a file in `dist/<app>/browser/`. Unhashed files are served `public, max-age=0, must-revalidate`; content-hashed files `immutable` for a year. Previews are per-PR origins (`deploy-preview-<n>--<site>.netlify.app`), `noindex`, and Netlify injects its Drawer script into preview and staging HTML (`docs/process/hosting.md`). Budget about $25/month for hosting and Convex. |
| AGENTS.md, Secrets           | Production secrets are owner-held. Agents use dev and preview deployments only.                                                                                                                                                                                                                                                                                                                                                   |

### Facts that shaped the decision (checked 2026-10-09)

- **Convex data never passes through a service worker.** The Convex browser client reads and writes over a WebSocket, and the WebSocket standard opens its connection with a request whose "service-workers mode is "none"" ([WebSockets standard, establish a connection](https://websockets.spec.whatwg.org/#concept-websocket-establish)). A service worker can therefore keep the app's files, but never the data on a page. Offline data has to be kept by the app.
- **The Convex client sends unsent mutations when it reconnects.** In `convex` 1.46.0, `RequestManager.restart()` re-sends every mutation that is `NotSent` or in flight when the socket reconnects, and fails in-flight actions (`dist/esm/browser/sync/request_manager.js`). A change started offline would run later, which is offline change entry, which the owner did not choose.
- **The Angular build already supports SSR plus a service worker.** In `@angular/build` 22.2.2, `augmentAppWithServiceWorkerEsbuild` sets the worker's `index` to the client shell `index.csr.html` whenever SSR or prerendering is on, so the worker never serves a prerendered page for another URL (`src/utils/service-worker.js`, `src/builders/application/options.js`).
- **`@angular/service-worker` 22.2.2 behaviour** (`ngsw-worker.js` source):
  - Requests that match no asset or data group, including every cross-origin request, are passed to the network and not stored.
  - A `dataGroups` entry with the `freshness` strategy answers an uncached URL with an empty **504** when offline. The `freshness` navigation strategy has no timeout.
  - If `ngsw.json` answers 404, the worker deletes all its caches and unregisters (also documented under "Fail-safe" in [Service worker devops](https://angular.dev/ecosystem/service-workers/devops)).
  - On `push`, it shows a notification only if the payload has `notification.title`. On `notificationclick`, it runs `openWindow`, `focusLastFocusedOrOpen`, `navigateLastFocusedOrOpen`, or `sendRequest` from `notification.data.onActionClick`.
- **Chrome's install criteria** are HTTPS and a manifest with a name, 192px and 512px icons, `start_url`, and a standalone-type `display`; a service worker is not listed ([web.dev, install criteria](https://web.dev/articles/install-criteria)).
- **iPhone and iPad:**
  - Web Push needs iOS or iPadOS 16.4 and works only for web apps added to the Home Screen. Permission must be requested "in response to direct user interaction" ([WebKit, Web Push for web apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). No Apple Developer Program membership is needed.
  - "Safari doesn't support invisible push notifications. ... If you don't, Safari revokes the push notification permission for your site." Apple also asks: "Don't refresh your JWT more frequently than once per hour", allows `https://*.push.apple.com`, limits payloads to 4 KB, and answers 410 for an expired subscription ([Apple, Sending web push notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)).
  - Declarative Web Push (iOS and iPadOS 18.4): a payload with `"web_push": 8030` and `notification.navigate` is shown by Safari itself; if a service worker is registered, it gets the push and Safari shows the declarative notification only if the worker shows none ([WebKit, Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)).
  - From iOS 26, every site added to the Home Screen opens as a web app by default ([WebKit, News from WWDC25](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)).
- **Convex's default runtime has the Web Crypto needed for Web Push.** On the anonymous local backend, ECDH P-256 key generation and `deriveBits`, HKDF, HMAC, AES-GCM, and ECDSA P-256 signing all worked in a default-runtime action (Test evidence). Convex lists `crypto`, `CryptoKey`, and `SubtleCrypto` among the default runtime's Web APIs, and `fetch` in actions ([Convex runtimes](https://docs.convex.dev/functions/runtimes)).
- **No Convex component sends Web Push.** The only Convex push component on npm is `@convex-dev/expo-push-notifications` 0.3.1, for Expo (React Native) apps.

## Options

### Decision 1: the service worker

#### Option 1A: `@angular/service-worker` (ngsw)

- **What it is:** Angular's own worker. The CLI generates `ngsw-worker.js` and a hashed manifest `ngsw.json` from `ngsw-config.json` at build time. `SwUpdate` reports new versions; `SwPush` subscribes to Web Push and receives notification clicks.
- **Version and licence:** 22.2.2 (published 2026-10-08), MIT. Peers `@angular/core` at the **same exact version** and `rxjs` (already installed). One dependency, `tslib`. No install script. It is released with Angular, so Dependabot moves it with the other `@angular/*` packages.
- **Pros:**
  - No custom worker code. Asset hashing, versioning, safe update, a degraded mode on hash mismatch, and a fail-safe (`ngsw.json` 404) are built in and documented.
  - Push display and click handling are built in, so the project writes no `push` or `notificationclick` handler.
  - Built by the existing CLI build; no new build tool. SSR builds get `index.csr.html` as the shell automatically.
- **Cons and risks:**
  - Config-driven: no custom fetch logic, no navigation timeout, and data groups answer 504 for uncached URLs offline. This ADR therefore keeps page data out of the worker (Decision 2).
  - Hash-checked files: anything that rewrites a cached file in transit (Netlify's Drawer script on previews and staging) makes the version invalid there (Decision 4).

#### Option 1B: a custom worker with Workbox

- **What it is:** `workbox-precaching`, `workbox-routing`, `workbox-strategies`, `workbox-expiration`, and `workbox-window` (7.4.1, MIT, released 2026-05-05; repository active, last push 2026-10-06), plus `workbox-build` or `workbox-cli` to inject the precache list.
- **Pros:** full control: a network-first navigation with a timeout, an offline fallback page, and caching of server HTML per build.
- **Cons:**
  - Several new packages. `workbox-build` 7.4.1 alone has 37 direct dependencies, including Babel and Rollup, all in Dependabot's view.
  - The worker must be bundled by a second build step that the Angular CLI does not run; using `esbuild` directly would add it as a devDependency with an install script (an `allowScripts` entry).
  - The project writes and owns the push and notification-click handlers, the update prompt protocol, and cache clean-up.
  - Caching server HTML has the stale-chunk problem: a cached page from an older build names hashed files that a newer Netlify deploy no longer serves, so every deploy must purge it.

#### Option 1C: a hand-written worker, no package

- About 200 to 300 lines: a precache list generated from `dist/`, versioned caches, clean-up, navigation fallback, push and click handlers, and an update protocol.
- No dependency, but it re-implements what ngsw already ships and tests, in security-relevant code that no one else reviews.

#### Option 1D: no service worker (manifest only)

- The app would still be installable on Chrome and on iPhone, but nothing would open offline, and Web Push needs a service worker everywhere except Safari 18.4's declarative mode. It fails owner choices 2 and 3.

### Decision 2: navigations and offline data

All options keep the first visit unchanged: the browser has no worker yet, so it gets the server render and hydrates (ADR 0006). The options differ for later visits by a browser that has the worker.

#### Option 2A: `performance` navigation strategy, plus saved copies kept by the app (recommended)

- Every navigation in the worker's scope is answered at once from the cached client shell (`index.csr.html`), online or offline. The page then renders in the browser and reads live data over the WebSocket.
- Public queries that are deliberately public and identity-free can be listed for **saved copies**: the adapter writes each live result to `localStorage`, and shows the saved copy when there is no transferred value and no live result yet, with the time it was saved.
- Pros: the shell opens instantly on any signal, including bad field wifi; recently viewed pages show their last content; it works for in-app navigation too, not only reloads; no server HTML is cached, so no stale-chunk problem.
- Cons: browsers with the worker no longer use the server render after the first visit (crawlers and link-preview bots never run a worker, so SEO and previews are unchanged). A page online shows its saved copy briefly until the live result arrives.

#### Option 2B: `freshness` navigation strategy, plus saved copies

- Navigations go to the server first (server render online), falling back to the shell when the network fails.
- Cons: ngsw's navigation fetch has no timeout, so on a connection that hangs rather than fails, which is typical of poor field wifi, the page waits on the server. Fails owner choice 2 in the case the owner named.

#### Option 2C: cache server HTML in an ngsw data group

- Cons: an uncached page offline gets an empty 504 (ngsw source), not the app; cached HTML names hashed files that a later deploy removes, and ngsw cannot purge a data group per deploy without a config change each build. The data on the page is still only as fresh as the HTML.

### Decision 3: changes while offline

- **3A, recommended: the adapter refuses them.** `run()` on mutation and action helpers checks the WebSocket at call time (`isWebSocketConnected`) and `navigator.onLine`. If the socket is not connected, or `navigator.onLine` is false, `run()` waits up to 3 seconds for both to hold, then rejects with `ConvexOfflineError` without calling the Convex client, so nothing is queued. This check is separate from the 5-second `online` signal that drives the offline note and disables submit buttons (section 3), so a change started in the first seconds of a disconnect, or on field wifi with no internet, is refused too.
- 3B: let the Convex client queue them. Rejected: a registration or score sent minutes or hours later is offline change entry, which the owner did not choose, and the user has no feedback.
- 3C: only disable buttons. Rejected as the only guard: any programmatic call would still be queued.

### Decision 4: Web Push sending from Convex

#### Option 4A: `@block65/webcrypto-web-push` in the default runtime (recommended)

- **Version and licence:** 2.0.0 (2026-09-03), MIT, published with npm provenance. One dependency, `uint8array-extras` 1.6.0 (MIT). No install script. About 110,000 downloads a week (2026-10-01 to 10-07).
- **What it does:** RFC 8291 `aes128gcm` encryption with every message padded to 4,096 bytes (maximum payload 3,993 bytes), and RFC 8292 VAPID. It exports `encryptNotification` and `vapidHeaders` separately, so the VAPID token can be cached and reused, as Apple asks.
- **Verified** in a default-runtime Convex action on the local backend: the body decrypted with the reference implementation `http_ece` to the exact payload, and the VAPID signature verified (Test evidence).
- **Cons:** one human contributor (44 GitHub stars) and a 21-month gap between 1.0.2 and 2.0.0. Its code runs inside Convex actions, which can read every deployment variable (`BETTER_AUTH_SECRET`, the Stripe key, `VAPID_PRIVATE_KEY`). Mitigation: pinned exactly, kept out of Dependabot's grouped updates, and every version change reviewed with `npm diff` and a provenance check (Packages, Supply-chain control); the project's sending code wraps it behind one internal function, so Option 4D can replace it without touching callers.

#### Option 4B: `web-push` in a `"use node"` action

- 3.6.7, **MPL-2.0**, last release 2024-01-16; dependencies `asn1.js`, `http_ece`, `https-proxy-agent`, `jws`, `minimist`. Very widely used (about 10.7 million downloads a week).
- Cons: uses Node's `crypto` and `https`, so it needs the Node runtime: ADR 0003's `node.nodeVersion: "24"` and `@types/node` 24 for that file, a Node cold start, and 512 MiB actions instead of 64 MiB. No release in almost three years.

#### Option 4C: `@pushforge/builder`

- 2.0.5 (2026-04-23), MIT, no dependencies, about 77,000 downloads a week.
- Rejected: it sends `Content-Encoding: aesgcm`, the pre-RFC draft encoding, with `Crypto-Key` and `Encryption` headers (verified in the scratch run: the body decrypted only as `aesgcm`). RFC 8291 standardises `aes128gcm`, and the system could not confirm Apple accepts the draft encoding. Its README also says Convex needs `"use node"`, which the scratch run contradicts.

#### Option 4D: hand-written `fetch` plus Web Crypto

- About 150 lines: ECDH, HKDF, AES-GCM, and an ES256 JWT, tested against RFC 8291's Appendix A example.
- No dependency, but security-relevant crypto owned by the project. Kept as the fallback for 4A.

#### Also considered

- **A hosted push service** (OneSignal, or Firebase Cloud Messaging's web SDK): a new external service, account, and SDK, and user data sent to a third party. Standard Web Push with VAPID needs no account; the browser vendors run the push services.

## Decision

**Adopt Option 1A (`@angular/service-worker`), Option 2A (`performance` navigations plus saved copies kept by the app), Option 3A (refuse changes offline), and Option 4A (`@block65/webcrypto-web-push` in the default runtime).**

### 1. Service worker configuration

- `provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' })` in `app.config.ts`. Development builds, including the e2e build, register no worker, so `ci` e2e is unchanged.
- `angular.json` build option `serviceWorker: "ngsw-config.json"`.
- `ngsw-config.json`:

  ```json
  {
    "index": "/index.csr.html",
    "navigationRequestStrategy": "performance",
    "assetGroups": [
      {
        "name": "shell",
        "installMode": "prefetch",
        "updateMode": "prefetch",
        "resources": {
          "files": [
            "/index.csr.html",
            "/manifest.webmanifest",
            "/favicon.ico",
            "/main-*.js",
            "/chunk-*.js",
            "/polyfills-*.js",
            "/styles-*.css"
          ]
        }
      },
      {
        "name": "assets",
        "installMode": "lazy",
        "updateMode": "prefetch",
        "resources": { "files": ["/media/**", "/icons/**"] }
      }
    ]
  }
  ```

  - The shell group lists the same content-hashed patterns as ADR 0010 item 3, plus the shell, manifest, and favicon. It does not use the schematic's `/*.js`, which would also match `ngsw-worker.js`, `safety-worker.js`, and `worker-basic.min.js`.
  - **No `dataGroups`.** The worker stores nothing but these same-origin build files.
  - The default `navigationUrls` (everything except paths with a file extension or `__`) stay.

- **Build check** `scripts/sw-config-check.mjs`, run by `npm run build` after the edge-safety check (ADR 0010, hosting), fails the build when the built `ngsw.json` has any data group, an index other than `/index.csr.html`, a navigation strategy other than `performance`, or an asset URL that is not a same-origin path or contains `/api/`, `convex.cloud`, or `convex.site`. This is the enforced form of "never cache Convex or auth". When `angular.json` has no `serviceWorker` option and no `ngsw.json` was built (the kill switch, section 4), it prints `sw-config-check: SKIP` and passes; with the option set and no `ngsw.json`, it fails.
- `@angular/pwa` is **not** added or run. Its schematic is `ng-add` `save: false` and would prefetch the prerendered `/index.html` and write placeholder icons; #80 and #81 write the files by hand.

### 2. Interaction with SSR, hydration, Convex, auth, and previews

| Concern                    | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSR and hydration          | First visit: server render and hydration as in ADR 0006. Later visits in a browser with the worker: the client shell, rendered in the browser (no hydration, so no mismatch is possible). Every page that works through in-app navigation already works this way. Unknown paths are routed by the client `**` route (#23), so #81 waits for it.                                                                                                                                                                                                                     |
| Crawlers and link previews | They fetch raw HTML and never run a worker: statuses, titles, `og:*` tags, and `Cache-Control` are unchanged. The scratch run showed `/does-not-exist` as 404 to a plain request while a worker-controlled tab got the shell.                                                                                                                                                                                                                                                                                                                                       |
| Netlify Edge               | `ngsw-worker.js`, `ngsw.json`, `safety-worker.js`, and `manifest.webmanifest` are files in `browser/`, so the edge function excludes them and the CDN serves them with `max-age=0, must-revalidate`. ngsw fetches `ngsw.json` with a cache-busting query. No `netlify.toml` change. Navigations served by the worker cost no edge invocation.                                                                                                                                                                                                                       |
| Convex WebSocket           | Cannot be intercepted (WebSockets standard). Data offline comes only from saved copies (item 3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Auth (ADR 0008)            | Better Auth requests go to `*.convex.site`, a different origin; ngsw matches no group and passes them to the network unstored. Tokens stay in `localStorage` as ADR 0008 decided. The shell `index.csr.html` is identical for every user. The build check forbids any group that could match auth or Convex.                                                                                                                                                                                                                                                        |
| Previews and staging       | Each preview origin has its own worker and caches, so previews never share state. The `_headers` `noindex` rule also covers the worker files, which is harmless. **Netlify's Drawer** script, injected into preview and staging HTML, changes `index.csr.html` after the build, so ngsw's hash check fails there and the worker falls back to the network: the app still works, but offline does not. The owner chose to turn the Drawer off for Deploy Previews and Branch deploys (Owner questions); preview evidence counts once the owner confirms the setting. |
| Local verification         | `npm run build` then `npm run serve:ssr` serves the production build with the worker exactly as hashed, which is the reliable test target (Test evidence). The spec runs with `E2E_BASE_URL=http://localhost:4000 npx playwright test e2e/pwa.spec.ts`, not `npm run e2e`, which would rebuild `dist/` in development mode under the running server.                                                                                                                                                                                                                |

### 3. Saved copies (offline data)

- **Where:** `localStorage`, key `cvx-saved:<function>:<JSON args with sorted keys>`, value `{ v: convexToJson(result), savedAt }`. Synchronous reads let the first render show the saved copy with no loading flash. Values are public data, so script access to `localStorage` exposes nothing new.
- **What:** only functions on an allow-list (`OFFLINE_SAVED_QUERIES`) that are deliberately public and whose result does not depend on the caller. Signed-in data is never saved, so a shared device keeps nothing private.
- **Limits:** 50 entries, least recently used removed first; entries older than 14 days are ignored and removed. Storage errors are ignored.
- **Precedence:** a `TransferState` entry first (hydration unchanged), then a live result, then a saved copy, then loading. The server never reads saved copies. A live result of `null` (the record was unpublished or deleted) removes the saved entry.
- **iPhone and iPad:** a Home Screen web app keeps its storage apart from Safari, so saved copies and the Better Auth token (ADR 0008, `localStorage`) do not carry over; users sign in again after install (#80, #83).
- **Adapter additions** (ADR 0006's adapter, additive): `QueryRef.savedAt`, `ConvexOfflineError`, and an `online` signal from `navigator.onLine` and `subscribeToConnectionState` (`convex` 1.46 `ConnectionState`):
  - false at once when `navigator.onLine` is false;
  - false when `hasEverConnected` is still false 5 seconds after start (a cold start on field wifi with no internet, where `navigator.onLine` stays true);
  - false when `isWebSocketConnected` has been false for 5 seconds after having connected;
  - true as soon as `isWebSocketConnected` is true and `navigator.onLine` is true; always true on the server; with no Convex URL, it follows `navigator.onLine` only.
  - `online` drives the note and disabled buttons only. The guard in `run()` reads `isWebSocketConnected` and `navigator.onLine` at call time (Decision 3A), so the 5-second debounce never lets a change through. `navigator.onLine` is part of the guard because `convex` 1.46 does not listen for the browser `offline` event.
- **Residual:** a mutation already sent when the socket drops is re-sent by the Convex client on reconnect (`RequestManager.restart()`); the user started it online and its button stays pending until then. A silent drop is also not seen by `convex` 1.46 until its `serverInactivityThreshold` (60 seconds, `web_socket_manager.js`) passes, so for up to 60 seconds after a real drop with `navigator.onLine` still true, `isWebSocketConnected` stays true and a change can be handed to the client and re-sent on reconnect. The `navigator.onLine` check narrows this to drops the browser reports; it does not close it.
- **Reconnect timing:** `convex` 1.46 reconnects at once on the browser `online` event and otherwise backs off up to 16 seconds (plus or minus half, `web_socket_manager.js`), so the note can stay up to about 24 seconds after a silent recovery.

### 4. Updates, stale shells, rollback, and the kill switch

- **Updates:** ngsw checks `ngsw.json` whenever the app opens and on navigations, downloads a new version in the background, and keeps the old one until the tab reloads. On `VERSION_READY` the app shows a "new version" prompt with Reload; on `unrecoverable` it asks the user to reload. It also calls `checkForUpdate()` when the page becomes visible, at most every 30 minutes, for installed apps left open.
- **Stale-shell risk:** an open tab or installed app can run the previous frontend until it reloads. ADR 0010 already requires each release's functions to accept the previous frontend's calls. This ADR extends that window: **public Convex functions keep accepting the previous release's arguments for at least 14 days** (expand/contract, as for schema changes). #81 writes the rule into `docs/conventions/convex.md`, where the PR reviewer checks it.
- **Forced reload past the window:** a dismissed prompt could keep a shell running longer than 14 days. The app records when it first ran each version (`localStorage`, keyed by the ngsw version hash). On `VERSION_READY`, if the running version was first run more than 14 days ago, the app activates the update and reloads without the prompt. A client installs the newest version available, so a version's first-run time is never earlier than its release, and the rule fires no later than the compatibility window ends.
- **Rollback:** Netlify "Publish deploy" of an earlier build changes the `ngsw.json` hash, which ngsw treats as a new version, so clients get it through the same prompt.
- **Kill switch**, each shipped through `gate:production`:
  1. Remove the `serviceWorker` build option, so no `ngsw.json` is built (`sw-config-check` prints `SKIP`). Every client that next opens the app online gets a 404 for `ngsw.json`, deletes its caches, and unregisters. Scratch run: 6 seconds after one navigation.
  2. If the worker script itself fails to start, serve the packaged `safety-worker.js` at the `ngsw-worker.js` URL until users have unregistered ([Service worker devops](https://angular.dev/ecosystem/service-workers/devops)).
  - **Emergency path:** a release from `main` would also ship everything merged since the last release. Instead, the deployer opens a release PR from a branch cut from `production` whose only change is step 1 (or step 2), labelled `gate:production`; the owner's merge ships it. The same change then lands on `main` through a normal PR before the next release, or the next release turns the worker back on.
  - #81 rehearses step 1 on a local production build and writes both paths into `docs/process/hosting.md`.
- **Release check:** after #81 no `ci` job proves offline behaviour (`e2e/pwa.spec.ts` needs a production build). Every release request (`gate:production`) records an `e2e/pwa.spec.ts` run against a local production build of the release commit; #81 adds the step to `docs/process/hosting.md`.

### 5. Web Push

- **Client:** the click on "Turn on notifications" first calls `Notification.requestPermission()` synchronously in the handler, so Safari's user-activation rule is met before any asynchronous step; only if permission is granted does it call `SwPush.requestSubscription({ serverPublicKey })`. **No permission request on load or on any other trigger**, on every browser (Safari requires it; elsewhere it is the UX rule).
- `SwPush.requestSubscription` waits for `navigator.serviceWorker.controller` and then `getRegistration()`, so it hangs until the worker controls the page (a first visit, up to `registerWhenStable:30000`). The button stays disabled until the page is controlled.
- iPhone and iPad in Safari without install show how to add the app to the Home Screen first (iOS 16.4+), and that the installed app needs a fresh sign-in (separate storage, section 3).
- **Sending:** an internal action in the default runtime calls `encryptNotification` and `fetch`. No `"use node"`. `internal.pushSend.deliver` takes each row id with the `userId` the send was scheduled for, and skips a row whose `userId` has since changed (`push.subscribe` reassigns an endpoint's row, and a 429 retry can run up to 1 hour later), so a reassigned row never gets another user's notification. Event notifications (#85) reuse this path.
- **VAPID token cache:** `vapidHeaders` once per push-service origin, stored in an internal table and reused for at least 1 hour and until 1 hour before its 12-hour expiry.
- **Payload,** one JSON for ngsw and for Safari 18.4's declarative mode: `{ "web_push": 8030, "notification": { "title", "body", "navigate": <absolute URL>, "data": { "onActionClick": { "default": { "operation": "navigateLastFocusedOrOpen", "url": <path> } } } } }`. Every payload has a title, because Safari revokes permission after a push with no notification. Under 3,993 bytes. TTL per kind (24 hours for the test notification), urgency `normal`, and an optional `Topic` to collapse repeats.
- **Endpoint allow-list** (checked when a subscription is saved and again before every send, matching the host exactly or as a dot-bounded suffix, `https:` only): `fcm.googleapis.com` (Chrome and other Chromium browsers), `push.services.mozilla.com` (Firefox), `push.apple.com` (Safari), `notify.windows.com` (Edge on Windows). Anything else is refused, so the action cannot be pointed at an arbitrary URL. A browser whose push service is not listed shows "not available".
- **Responses:**

  | Push service answer             | Outcome                                                                                     |
  | ------------------------------- | ------------------------------------------------------------------------------------------- |
  | 201, 202                        | `lastSuccessAt` set, `failureCount` reset                                                   |
  | 404, 410                        | subscription row deleted (expired or unsubscribed)                                          |
  | 413                             | error logged; no retry (a payload bug)                                                      |
  | 429                             | one retry after `Retry-After`, at most 1 hour; the retry skips a row whose `userId` changed |
  | 5xx, network error              | up to 3 retries with backoff                                                                |
  | other 4xx (`BadJwtToken`, etc.) | `failureCount` incremented and the reason logged; row deleted after 5 failures in a row     |

- **Logs** contain the push-service host and status only, never an endpoint, key, or token.

### 6. VAPID keys

| Deployment           | Keys                                                       | Who sets them                                   |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Local e2e            | none; push shows "not available"                           | nobody                                          |
| Developer dev        | the developer's own pair                                   | the developer, `npx convex env set`             |
| Previews and staging | one preview-only pair, as Convex default preview variables | the owner, once                                 |
| Production           | the production pair, never used elsewhere                  | **owner only**, at the first production release |

- Variables: `VAPID_PUBLIC_KEY` (base64url, 65-byte uncompressed P-256 point), `VAPID_PRIVATE_KEY` (base64url, 32-byte private scalar), `VAPID_SUBJECT` (`mailto:` or `https:`; Apple rejects anything else). Production uses `mailto:support@<domain>`, ADR 0011's support contact.
- `scripts/vapid-keys.mjs` (Node Web Crypto, no package) writes a new pair to a new file named by `--out`, created with mode 600; it refuses an existing file or a path inside the repository, and prints only the public key and the file path, so no private key reaches a terminal or an agent transcript (AGENTS.md, Secrets). The value is then set from the file (`npx convex env set` for a developer's dev deployment, the dashboard for the owner). No key is in the repository, GitHub, or Netlify.
- The browser gets the public key from the public query `push.getConfig`, not from a build-time define, so the key has one source and can rotate without a rebuild.
- `scripts/check-deploy-env.mjs` production mode requires the three names (names only).
- **Rotation:** a new pair invalidates every subscription (Apple answers `VapidPkHashMismatch`, others 403). Clients compare their subscription's key with `getConfig` on start-up and subscribe again (#89); rows that then fail are deleted by the response rules.

### 7. Subscriptions and access rules

- **Table `pushSubscriptions`:** `userId`, `endpoint`, `p256dh`, `auth`, optional `expirationTime`, `createdAt`, `lastSeenAt` (set by every `push.subscribe` upsert, including the start-up re-upsert), optional `lastSuccessAt`, `failureCount`; indexes `by_endpoint`, `by_userId`, and `by_lastSeenAt`. At most 10 per user, the least recently seen replaced. #85 adds the owner's three per-device switches (reminders, schedule changes, scores; all on by default, #85 comment of 2026-10-09) as fields on this row, because a row is one device.
- **Alternative considered:** an array of subscriptions on the `users` document. Rejected: no index by endpoint, so reassignment and `getMyDeviceStatus` scan every user; each send result rewrites the user document and conflicts with profile edits; the 10-row cap and the cleanup are harder to express.
- **Internal table `pushVapidTokens`:** push-service origin, `Authorization` value, expiry.
- **Internal table `pushTestSends`:** `userId`, `sentAt`; index `by_userId_and_sentAt`. Holds the `push.sendTest` rate limit (#84); `sendTest` deletes the caller's rows older than 10 minutes.
- **Public functions:**

  | Function                 | Kind     | Rule                                                                                                                          |
  | ------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
  | `push.getConfig`         | query    | deliberately public; returns the public key or `null` only                                                                    |
  | `push.subscribe`         | mutation | identity required; validates `https:`, the allow-list, and key lengths; upserts by endpoint and assigns the row to the caller |
  | `push.unsubscribe`       | mutation | identity required; deletes only the caller's own row; otherwise does nothing and reveals nothing                              |
  | `push.getMyDeviceStatus` | query    | identity required; `true` only for the caller's own row                                                                       |
  | `push.sendTest`          | mutation | identity required; 3 per user per 10 minutes; sends only to the caller's rows                                                 |

  Reassigning an endpoint to the caller is safe: an endpoint is an unguessable capability URL held only by the browser that created it, so presenting it proves control of that browser.

- **Lifecycle** (#89):
  - **Start-up and every sign-in:** when the browser has a subscription and a user is signed in, meaning the Convex client is authenticated (not only that a Better Auth session exists), the client calls `push.getMyDeviceStatus`. If the query throws (unauthenticated during the token fetch, or offline), nothing changes: no unsubscribe and no upsert, so a start-up race never unsubscribes the owner's own device. If it returns false (another user's row, or none), the client calls `SwPush.unsubscribe()` and shows "off"; the other user's row then gets 404 or 410 on its next send and is deleted. If it is true, the client upserts the row again. Only rows the caller already owns are re-upserted, so a session that ended without sign-out (expiry, cleared storage) never hands its device to the next user, and the next user never receives notifications without turning them on.
  - **Sign-out** calls `push.unsubscribe` and `SwPush.unsubscribe()` first; each failure (offline, no worker) is caught and sign-out completes.
  - **Rotation and changes:** a key that differs from `getConfig`, a past `expirationTime`, or `pushSubscriptionChanges` re-subscribes, for the owning user only.
  - **Deletion:** the `users` `onDelete` trigger deletes the user's rows; 404 or 410 on a send deletes the row; `deliver` skips and deletes a row past its `expirationTime`; a daily cron deletes rows not seen and not sent to successfully for 90 days (404 and 410 arrive only on a send, so rows for devices that never get one would otherwise stay).
- Event notifications (reminders, schedule changes, scores) reuse this path. The owner chose recipients, reminder timing, and per-kind switches on #85 (2026-10-09); none changes this design.

### Packages

| Package                       | Version                                                       | Type       | Licence | Install script |
| ----------------------------- | ------------------------------------------------------------- | ---------- | ------- | -------------- |
| `@angular/service-worker`     | the same version as `@angular/core` (`^22.2.0`; 22.2.1 today) | dependency | MIT     | none           |
| `@block65/webcrypto-web-push` | 2.0.0, pinned exactly                                         | dependency | MIT     | none           |
| `uint8array-extras`           | 1.6.0                                                         | transitive | MIT     | none           |
| `@angular/pwa`                | not added                                                     | n/a        | MIT     | n/a            |

- ADR 0003's `allowScripts` map is unchanged: the scratch install of `@angular/service-worker` under `strict-allow-scripts=true` passed, and neither push package declares an install script.
- `@angular/service-worker` 22.2.2 (2026-10-08) is inside the 3-day `min-release-age` until 2026-10-11, and its peer requires the identical `@angular/core`, so #81 installs the version matching the lockfile's `@angular/core`.
- No `overrides` entry.

### Supply-chain control for `@block65/webcrypto-web-push`

"Pinned exactly" alone does not stop Dependabot's monthly `npm-minor-patch` group from bumping the pin, and a grouped PR hides one package among many. #84, which installs the package, also makes these changes:

- **`.github/dependabot.yml`:** the `npm-minor-patch` group gains `exclude-patterns: ["@block65/webcrypto-web-push"]`. Dependabot then opens a separate PR for each of its version updates ("Any outdated dependencies that do not match a rule are updated in individual pull requests", [Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)). Cooldown and `min-release-age` still apply. A `test:scripts` text check confirms the exclusion stays.
- **`docs/process/ci.md`, Dependabot PRs:** any PR whose `package-lock.json` changes the resolved version of `@block65/webcrypto-web-push` or `uint8array-extras` (Dependabot version or security update, or a person) needs, before the PR reviewer's `APPROVE`, a PR comment with:
  1. `npm diff --diff=<package>@<old> --diff=<package>@<new>`, read in full by the reviewer (collapsed in Evidence);
  2. for `@block65/webcrypto-web-push`, the provenance of the new version from `https://registry.npmjs.org/-/npm/v1/attestations/<package>@<version>`: an SLSA provenance attestation built from `https://github.com/block65/webcrypto-web-push` at tag `v<version>` (2.0.0: workflow `.github/workflows/deploy.yml`, checked 2026-10-09). `npm audit signatures`, already a `ci` step, verifies the signatures but does not fail when a version simply has none. `uint8array-extras` 1.6.0 publishes no provenance, so it gets the diff only.
- A new version with no provenance, or provenance from another repository or workflow, is treated as a replacement of the package and goes through `gate:technology`.

**AGENTS.md.** Its rule "Bumping the minor or patch version of an already-accepted package does not need a gate" needs no exception for the normal path: these bumps still need no gate, only the review evidence above. The provenance escalation is the one case the sentence does not anticipate. Proposed wording for an owner-merged docs PR (not part of this ADR): "Bumping the minor or patch version of an already-accepted package does not need a gate, unless an Accepted ADR sets a stricter rule for that package (ADR 0013, `@block65/webcrypto-web-push`)."

## Recommendation

`@angular/service-worker` gives the shell offline, safe updates, a tested kill switch, and push handling with no custom worker code and no new build tool. Its limits (no navigation timeout, 504 for uncached data) do not matter here, because Convex data never passes through a worker: the app keeps saved copies itself, which also covers in-app navigation offline. The `performance` strategy opens the shell instantly on poor field wifi, which is the owner's case; crawlers are unaffected. `@block65/webcrypto-web-push` is the only checked library that implements RFC 8291's `aes128gcm` on Web Crypto and ran in Convex's default runtime, so sending needs no Node runtime. It has one maintainer, so it is pinned, wrapped, kept out of grouped updates, and reviewed with `npm diff` and provenance on every change, with a hand-written fallback.

## Cost

**Netlify** (ADR 0010's traffic assumption: 1,000 MAU, 20,000 app loads, 8 production deploys a month):

| Item                                                                                               | Credits a month                                                                |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ngsw.json` checks, about one per app open (50,000 requests, about 0.15 GB)                        | about 13                                                                       |
| Prefetch of changed hashed files after each deploy, worst case (8 × 1,000 users × 0.4 MB = 3.2 GB) | about 64                                                                       |
| First installs (1,000 × 0.4 MB)                                                                    | about 8                                                                        |
| Navigations answered by the worker instead of the edge function                                    | saves requests; not counted                                                    |
| **Change**                                                                                         | **up to about +85, from about 326 to about 410 of Personal's 1,000: still $9** |

**Convex:** push sends at an assumed 500 opted-in users and 10 notifications each a month are about 7,000 function calls (0.7% of the 1M included) and well under 0.1 GB-hour of action compute: $0. Saved copies cost nothing on the server. **Push services:** no account or fee. **Total monthly cost: unchanged** (about $9 after the first production release).

**CI minutes (ADR 0009):** about +10 seconds per app-PR run, for #88's two offline e2e tests (`chromium-mobile`, development build, `context.setOffline` and `page.routeWebSocket`). No new job, step, or browser project. `sw-config-check` runs inside the existing `build` step in under a second, and its script test inside `test:scripts`. `e2e/pwa.spec.ts` runs only with `E2E_BASE_URL` (a production build: a local `serve:ssr`, or the PR preview once the owner confirms the Drawer setting), so `ci` skips it; the tester runs it locally, and every release request records a run (Decision section 4). Push delivery is tested with `fetch` stubbed in Convex tests. The daily cleanup cron (#89) is one function call a day.

## Consequences

- **New dependencies:** `@angular/service-worker` (#81) and `@block65/webcrypto-web-push` (#84). No new service, build tool, or `allowScripts` entry.
- **Slices:** #80 (install: manifest, icons), #88 (connection state, changes refused offline, offline note; no worker), #81 (service worker, update prompt, build check, kill-switch rehearsal), #82 (saved copies, organization page first), #83 (push on or off per device, subscription storage, VAPID setup), #89 (subscription follows the signed-in user and the key; sign-out; cleanup cron), #84 (test notification, the sending path, and the supply-chain control), #85 (event notifications, waiting for the schedule and score issues).
- **ADR 0006** gains, additively, the adapter's `online` signal, `ConvexOfflineError` (#88), saved copies, and `QueryRef.savedAt` (#82). Its rendering rules are unchanged.
- **ADR 0010:** no `netlify.toml` change. The 14-day backward-compatibility window above extends its release rule. The cost estimate above replaces nothing and adds up to about 85 credits.
- **ADR 0005 and ADR 0009:** unchanged in structure; `e2e/pwa.spec.ts` is a local-only spec like the preview smoke run, and #88 adds two tests to the existing `ci` e2e run.
- **Docs:**
  - `docs/process/hosting.md` gains "Service worker" (both kill-switch paths, the Drawer setting, the local production-build run, the release check; #81) and the VAPID variables (#83).
  - `docs/conventions/angular.md` gains: mutations and actions only through the adapter's guarded helpers (#88); no data groups and no manual worker registration (#81).
  - `docs/conventions/convex.md` gains the 14-day function-compatibility rule (#81).
  - `docs/process/ci.md` and `.github/dependabot.yml` gain the `@block65/webcrypto-web-push` control (#84).
  - `AGENTS.md`: an optional owner-merged wording change (Packages, Supply-chain control).
- **Owner setup:** the Drawer off for Deploy Previews and Branch deploys (chosen 2026-10-09), a preview-only VAPID pair as Convex default preview variables (#83, before #84's preview check), and the production pair at the first release (`gate:production`).
- **Harder later:**
  - Public pages have two render paths, server-rendered on a first visit and client-rendered from the worker afterwards; both must stay correct.
  - Old frontends live longer, hence the 14-day function compatibility rule.
  - Push failures are silent to the user; they surface in logs and `failureCount`.
- **What would reverse this:** ngsw being deprecated, or a need for server HTML offline (Workbox, Option 1B); `@block65/webcrypto-web-push` abandoned or failing on Convex cloud (Option 4D).

## Owner questions

1. **Netlify Drawer on previews and staging. Answered 2026-10-09** ([PR #87 comment](https://github.com/jasonbryan/omni-league/pull/87#issuecomment-6086158597)): the owner turns the Drawer off for Deploy Previews and Branch deploys. Until the owner confirms the setting on PR #87 or in chat, offline and update evidence comes from local production builds; after that, preview evidence counts too.
2. **Push recipients and timing. Answered 2026-10-09** on #85: rostered players with an account plus guardians of minors; one reminder 24 hours before; score updates only when confirmed or corrected; three per-device switches, all on by default. Nothing else in this ADR changes.

## Test evidence (2026-10-09, scratch directories outside the repository)

### Service worker on the production SSR build

- **Setup:** a copy of `main` at 738a8d5, Node 26.11.0, npm 11.20.0. `npm ci`, then `npm install @angular/service-worker@22.2.1` under the repository's `.npmrc` (`strict-allow-scripts=true`, `min-release-age=3`): installed with no `allowScripts` change. The `ngsw-config.json` above, the `serviceWorker` option, `provideServiceWorker`, and a placeholder manifest.
- **Build:** `npm run build` passed in 4.9 s with `edge-bundle: PASS`. `ngsw.json`: `index` `/index.csr.html`, `navigationRequestStrategy` `performance`, `dataGroups` empty; the shell group held the two `chunk-*.js`, `main-*.js`, `styles-*.css`, `index.csr.html`, the manifest, and the favicon (zoneless: no polyfills file). The first config, without `/chunk-*.js` in the shell group, left an initial chunk out of the prefetch, which is why the shell lists it.
- **Served** by `npm run serve:ssr` (port 4000), driven by Playwright 1.64 Chromium headless shell:

  | Step                                            | Result                                                                                   |
  | ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
  | First visit `/`                                 | 200 from the network; worker active within 5 s                                           |
  | Online `/does-not-exist` with the worker        | 200 from the worker (client shell)                                                       |
  | Same URL by plain request (crawler view)        | 404 from the server                                                                      |
  | Offline `/o/never-visited`, then offline reload | 200 from the worker both times; no browser error page                                    |
  | Console                                         | `NG04002` for the unknown paths: the scratch router has no `**` route yet (#23 adds it)  |
  | `ngsw.json` renamed (404), one navigation       | 0 registrations and 0 caches after 6 s; the next navigation got the server's 404         |
  | Variant: `freshness` navigation strategy        | online `/does-not-exist` passed through as the server's 404; offline still got the shell |

### Web Push request building in Convex

- **Setup:** `convex` 1.46.0, anonymous local backend `precompiled-2026-10-06-a3538c6`, `@block65/webcrypto-web-push` 2.0.0, `@pushforge/builder` 2.0.5. One action in the default runtime and the same action in a `"use node"` file (`node.nodeVersion: "24"`). A Node script generated a subscription key pair and auth secret and a VAPID key pair, called each action, and checked the result with `http_ece` 1.2.0 (the RFC 8188 reference implementation, scratch only) and Web Crypto.
- **Web Crypto probe, both runtimes:** ECDH P-256 `generateKey`, `deriveBits`, and raw export; HKDF `deriveBits`; HMAC-SHA-256; AES-GCM `encrypt`; ECDSA P-256 sign: all `ok`.
- **Results:**

  | Library and runtime                    | Build time in action | Encoding                                                | Decrypts to the payload | VAPID                                                               |
  | -------------------------------------- | -------------------- | ------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------- |
  | `@block65/webcrypto-web-push`, default | 5 ms                 | `aes128gcm`, 4,096-byte body                            | yes, exact              | signature valid; `k` matches; `aud` the endpoint origin; `exp` 12 h |
  | `@block65/webcrypto-web-push`, Node    | 2 ms                 | same                                                    | yes, exact              | same                                                                |
  | `@pushforge/builder`, default and Node | 3 ms and 11 ms       | `aesgcm` (draft), `Crypto-Key` and `Encryption` headers | only as `aesgcm`        | signature valid; `exp` 1 h                                          |

- **Not tested:** delivery through a real push service (no browser subscription in headless Chromium), Convex cloud's runtime (#84's pre-merge check on its preview deployment), real iPhone and Android devices (owner checks in #80, #83, and #84), and the worker on a Netlify preview (Owner question 1).

## Sources

- **Angular:** [Service workers overview](https://angular.dev/ecosystem/service-workers), [Service worker devops (fail-safe, safety worker, bypass)](https://angular.dev/ecosystem/service-workers/devops), [Configuration](https://angular.dev/ecosystem/service-workers/config), [Push notifications](https://angular.dev/ecosystem/service-workers/push-notifications). Package sources: `@angular/service-worker@22.2.2` (`ngsw-worker.js`, `types/service-worker.d.ts`), `@angular/build@22.2.2` (`src/utils/service-worker.js`, `src/builders/application/options.js`, `execute-post-bundle.js`), `@schematics/angular@22.2.2` (`service-worker/files/ngsw-config.json.template`), `@angular/pwa@22.2.2` (`package.json`, `pwa/index.js`).
- **Standards:** [WebSockets standard, establish a WebSocket connection](https://websockets.spec.whatwg.org/#concept-websocket-establish); RFC 8030 (Web Push), RFC 8291 (message encryption), RFC 8292 (VAPID), RFC 8188 (`aes128gcm`).
- **Apple and WebKit:** [Sending web push notifications in web apps and browsers](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [Web Push for web apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/), [News from WWDC25](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/).
- **Chrome:** [Install criteria](https://web.dev/articles/install-criteria).
- **Convex:** [Runtimes](https://docs.convex.dev/functions/runtimes); `convex@1.46.0` `dist/esm/browser/sync/request_manager.js` (`restart`), `dist/esm-types/browser/sync/client.d.ts` (`ConnectionState`).
- **Supply chain:** [Dependabot options reference (`groups`, `exclude-patterns`)](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference); npm attestations for `@block65/webcrypto-web-push@2.0.0` (`https://registry.npmjs.org/-/npm/v1/attestations/@block65%2fwebcrypto-web-push@2.0.0`, checked 2026-10-09); `npm view uint8array-extras@1.6.0 dist.attestations` (none).
- **Workbox:** [GoogleChrome/workbox](https://github.com/GoogleChrome/workbox) (release v7.4.1, 2026-05-05).
- **npm registry and download API (2026-10-09):** `@angular/service-worker`, `@angular/pwa`, `workbox-build`, `workbox-window`, `web-push`, `@block65/webcrypto-web-push`, `uint8array-extras`, `@pushforge/builder`, `@convex-dev/expo-push-notifications`; repositories `block65/webcrypto-web-push`, `draphy/pushforge`, `web-push-libs/web-push`.
