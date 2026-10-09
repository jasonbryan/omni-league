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

This ADR decides the service worker, how offline pages get their data, how changes are refused offline, deploy and update behaviour, how Convex sends Web Push, where the VAPID keys live, and how push subscriptions are stored. Who receives which notification is open for the owner (#85) and does not change these choices.

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

- **3A, recommended: the adapter refuses them.** While the connection is down, `run()` on mutation and action helpers rejects at once with `ConvexOfflineError` and does not call the Convex client, so nothing is queued. The UI shows the offline note and disables submit buttons.
- 3B: let the Convex client queue them. Rejected: a registration or score sent minutes or hours later is offline change entry, which the owner did not choose, and the user has no feedback.
- 3C: only disable buttons. Rejected as the only guard: any programmatic call would still be queued.

### Decision 4: Web Push sending from Convex

#### Option 4A: `@block65/webcrypto-web-push` in the default runtime (recommended)

- **Version and licence:** 2.0.0 (2026-09-03), MIT, published with npm provenance. One dependency, `uint8array-extras` 1.6.0 (MIT). No install script. About 110,000 downloads a week (2026-10-01 to 10-07).
- **What it does:** RFC 8291 `aes128gcm` encryption with every message padded to 4,096 bytes (maximum payload 3,993 bytes), and RFC 8292 VAPID. It exports `encryptNotification` and `vapidHeaders` separately, so the VAPID token can be cached and reused, as Apple asks.
- **Verified** in a default-runtime Convex action on the local backend: the body decrypted with the reference implementation `http_ece` to the exact payload, and the VAPID signature verified (Test evidence).
- **Cons:** one maintainer (44 GitHub stars). Mitigation: pinned exactly; the project's sending code wraps it behind one internal function, so Option 4D can replace it without touching callers.

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

- **Build check** `scripts/sw-config-check.mjs`, run by `npm run build` after the edge-safety check (ADR 0010, hosting), fails the build when the built `ngsw.json` has any data group, an index other than `/index.csr.html`, a navigation strategy other than `performance`, or an asset URL that is not a same-origin path or contains `/api/`, `convex.cloud`, or `convex.site`. This is the enforced form of "never cache Convex or auth".
- `@angular/pwa` is **not** added or run. Its schematic is `ng-add` `save: false` and would prefetch the prerendered `/index.html` and write placeholder icons; #80 and #81 write the files by hand.

### 2. Interaction with SSR, hydration, Convex, auth, and previews

| Concern                    | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSR and hydration          | First visit: server render and hydration as in ADR 0006. Later visits in a browser with the worker: the client shell, rendered in the browser (no hydration, so no mismatch is possible). Every page that works through in-app navigation already works this way. Unknown paths are routed by the client `**` route (#23), so #81 waits for it.                                                                            |
| Crawlers and link previews | They fetch raw HTML and never run a worker: statuses, titles, `og:*` tags, and `Cache-Control` are unchanged. The scratch run showed `/does-not-exist` as 404 to a plain request while a worker-controlled tab got the shell.                                                                                                                                                                                              |
| Netlify Edge               | `ngsw-worker.js`, `ngsw.json`, `safety-worker.js`, and `manifest.webmanifest` are files in `browser/`, so the edge function excludes them and the CDN serves them with `max-age=0, must-revalidate`. ngsw fetches `ngsw.json` with a cache-busting query. No `netlify.toml` change. Navigations served by the worker cost no edge invocation.                                                                              |
| Convex WebSocket           | Cannot be intercepted (WebSockets standard). Data offline comes only from saved copies (item 3).                                                                                                                                                                                                                                                                                                                           |
| Auth (ADR 0008)            | Better Auth requests go to `*.convex.site`, a different origin; ngsw matches no group and passes them to the network unstored. Tokens stay in `localStorage` as ADR 0008 decided. The shell `index.csr.html` is identical for every user. The build check forbids any group that could match auth or Convex.                                                                                                               |
| Previews and staging       | Each preview origin has its own worker and caches, so previews never share state. The `_headers` `noindex` rule also covers the worker files, which is harmless. **Netlify's Drawer** script, injected into preview and staging HTML, changes `index.csr.html` after the build, so ngsw's hash check fails there and the worker falls back to the network: the app still works, but offline does not. See Owner questions. |
| Local verification         | `npm run build` then `npm run serve:ssr` serves the production build with the worker exactly as hashed, which is the reliable test target (Test evidence).                                                                                                                                                                                                                                                                 |

### 3. Saved copies (offline data)

- **Where:** `localStorage`, key `cvx-saved:<function>:<JSON args>`, value `{ v: convexToJson(result), savedAt }`. Synchronous reads let the first render show the saved copy with no loading flash. Values are public data, so script access to `localStorage` exposes nothing new.
- **What:** only functions on an allow-list (`OFFLINE_SAVED_QUERIES`) that are deliberately public and whose result does not depend on the caller. Signed-in data is never saved, so a shared device keeps nothing private.
- **Limits:** 50 entries, least recently used removed first; entries older than 14 days are ignored and removed. Storage errors are ignored.
- **Precedence:** a `TransferState` entry first (hydration unchanged), then a live result, then a saved copy, then loading. The server never reads saved copies.
- **Adapter additions** (ADR 0006's adapter, additive): `QueryRef.savedAt`, an `online` signal (false when `navigator.onLine` is false, or when the WebSocket has been disconnected for 5 seconds after having connected, from `subscribeToConnectionState`), and `ConvexOfflineError`.

### 4. Updates, stale shells, rollback, and the kill switch

- **Updates:** ngsw checks `ngsw.json` whenever the app opens and on navigations, downloads a new version in the background, and keeps the old one until the tab reloads. On `VERSION_READY` the app shows a "new version" prompt with Reload; on `unrecoverable` it asks the user to reload. It also calls `checkForUpdate()` when the page becomes visible, at most every 30 minutes, for installed apps left open.
- **Stale-shell risk:** an open tab or installed app can run the previous frontend until it reloads. ADR 0010 already requires each release's functions to accept the previous frontend's calls. This ADR extends that window: **public Convex functions keep accepting the previous release's arguments for at least 14 days** (expand/contract, as for schema changes). The PR reviewer checks it.
- **Rollback:** Netlify "Publish deploy" of an earlier build changes the `ngsw.json` hash, which ngsw treats as a new version, so clients get it through the same prompt.
- **Kill switch**, each shipped as a release through `gate:production`:
  1. Remove the `serviceWorker` build option (or `ngsw.json`). Every client that next opens the app online gets a 404, deletes its caches, and unregisters. Scratch run: 6 seconds after one navigation.
  2. If the worker script itself fails to start, serve the packaged `safety-worker.js` at the `ngsw-worker.js` URL until users have unregistered ([Service worker devops](https://angular.dev/ecosystem/service-workers/devops)).
  - #81 rehearses step 1 on a local production build.

### 5. Web Push

- **Client:** `SwPush.requestSubscription({ serverPublicKey })` called directly from the click on "Turn on notifications". **No permission request on load or on any other trigger**, on every browser (Safari requires it; elsewhere it is the UX rule). iPhone and iPad in Safari without install show how to add the app to the Home Screen first (iOS 16.4+).
- **Sending:** an internal action in the default runtime calls `encryptNotification` and `fetch`. No `"use node"`.
- **VAPID token cache:** `vapidHeaders` once per push-service origin, stored in an internal table and reused for at least 1 hour and until 1 hour before its 12-hour expiry.
- **Payload,** one JSON for ngsw and for Safari 18.4's declarative mode: `{ "web_push": 8030, "notification": { "title", "body", "navigate": <absolute URL>, "data": { "onActionClick": { "default": { "operation": "navigateLastFocusedOrOpen", "url": <path> } } } } }`. Every payload has a title, because Safari revokes permission after a push with no notification. Under 3,993 bytes. TTL per kind (24 hours for the test notification), urgency `normal`, and an optional `Topic` to collapse repeats.
- **Endpoint allow-list** (checked when a subscription is saved and again before every send, matching the host exactly or as a dot-bounded suffix, `https:` only): `fcm.googleapis.com` (Chrome and other Chromium browsers), `push.services.mozilla.com` (Firefox), `push.apple.com` (Safari), `notify.windows.com` (Edge on Windows). Anything else is refused, so the action cannot be pointed at an arbitrary URL. A browser whose push service is not listed shows "not available".
- **Responses:**

  | Push service answer             | Outcome                                                                                 |
  | ------------------------------- | --------------------------------------------------------------------------------------- |
  | 201, 202                        | `lastSuccessAt` set, `failureCount` reset                                               |
  | 404, 410                        | subscription row deleted (expired or unsubscribed)                                      |
  | 413                             | error logged; no retry (a payload bug)                                                  |
  | 429                             | one retry after `Retry-After`, at most 1 hour                                           |
  | 5xx, network error              | up to 3 retries with backoff                                                            |
  | other 4xx (`BadJwtToken`, etc.) | `failureCount` incremented and the reason logged; row deleted after 5 failures in a row |

- **Logs** contain the push-service host and status only, never an endpoint, key, or token.

### 6. VAPID keys

| Deployment           | Keys                                                       | Who sets them                                   |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Local e2e            | none; push shows "not available"                           | nobody                                          |
| Developer dev        | the developer's own pair                                   | the developer, `npx convex env set`             |
| Previews and staging | one preview-only pair, as Convex default preview variables | the owner, once                                 |
| Production           | the production pair, never used elsewhere                  | **owner only**, at the first production release |

- Variables: `VAPID_PUBLIC_KEY` (base64url, 65-byte uncompressed P-256 point), `VAPID_PRIVATE_KEY` (base64url, 32-byte private scalar), `VAPID_SUBJECT` (`mailto:` or `https:`; Apple rejects anything else). Production uses `mailto:support@<domain>`, ADR 0011's support contact.
- `scripts/vapid-keys.mjs` (Node Web Crypto, no package) prints a new pair. No key is in the repository, GitHub, or Netlify.
- The browser gets the public key from the public query `push.getConfig`, not from a build-time define, so the key has one source and can rotate without a rebuild.
- `scripts/check-deploy-env.mjs` production mode requires the three names (names only).
- **Rotation:** a new pair invalidates every subscription (Apple answers `VapidPkHashMismatch`, others 403). Clients compare their subscription's key with `getConfig` on start-up and subscribe again (#83); rows that then fail are deleted by the response rules.

### 7. Subscriptions and access rules

- **Table `pushSubscriptions`:** `userId`, `endpoint`, `p256dh`, `auth`, optional `expirationTime`, `createdAt`, optional `lastSuccessAt`, `failureCount`; indexes `by_endpoint` and `by_userId`. At most 10 per user, the oldest replaced.
- **Internal table `pushVapidTokens`:** push-service origin, `Authorization` value, expiry.
- **Public functions:**

  | Function                 | Kind     | Rule                                                                                                                          |
  | ------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
  | `push.getConfig`         | query    | deliberately public; returns the public key or `null` only                                                                    |
  | `push.subscribe`         | mutation | identity required; validates `https:`, the allow-list, and key lengths; upserts by endpoint and assigns the row to the caller |
  | `push.unsubscribe`       | mutation | identity required; deletes only the caller's own row; otherwise does nothing and reveals nothing                              |
  | `push.getMyDeviceStatus` | query    | identity required; `true` only for the caller's own row                                                                       |
  | `push.sendTest`          | mutation | identity required; 3 per user per 10 minutes; sends only to the caller's rows                                                 |

  Reassigning an endpoint to the caller is safe: an endpoint is an unguessable capability URL held only by the browser that created it, so presenting it proves control of that browser.

- **Lifecycle:** sign-out calls `push.unsubscribe` and `SwPush.unsubscribe()` first; the `users` `onDelete` trigger deletes the user's rows; expired subscriptions are deleted on 404 or 410; `pushSubscriptionChanges` and key rotation re-subscribe on the next start.
- Event notifications (reminders, schedule changes, scores) reuse this path; their recipients and timing wait for the owner (#85).

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

## Recommendation

`@angular/service-worker` gives the shell offline, safe updates, a tested kill switch, and push handling with no custom worker code and no new build tool. Its limits (no navigation timeout, 504 for uncached data) do not matter here, because Convex data never passes through a worker: the app keeps saved copies itself, which also covers in-app navigation offline. The `performance` strategy opens the shell instantly on poor field wifi, which is the owner's case; crawlers are unaffected. `@block65/webcrypto-web-push` is the only checked library that implements RFC 8291's `aes128gcm` on Web Crypto and ran in Convex's default runtime, so sending needs no Node runtime. It has one maintainer, so it is pinned and wrapped, with a hand-written fallback.

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

**CI minutes (ADR 0009):** unchanged. No new job, step, or browser project. `sw-config-check` runs inside the existing `build` step in under a second, and its script test inside `test:scripts`. `e2e/pwa.spec.ts` runs only with `E2E_BASE_URL` (a production build: the PR preview or a local `serve:ssr`), so `ci` skips it; the tester runs it locally. Push delivery is tested with `fetch` stubbed in Convex tests.

## Consequences

- **New dependencies:** `@angular/service-worker` (#81) and `@block65/webcrypto-web-push` (#84). No new service, build tool, or `allowScripts` entry.
- **Slices:** #80 (install: manifest, icons), #81 (service worker, offline note, update prompt, build check, kill-switch rehearsal), #82 (saved copies, organization page first), #83 (push on or off per device, subscription storage, VAPID setup), #84 (test notification and the sending path), #85 (event notifications, blocked on the owner).
- **ADR 0006** gains, additively, the adapter's `online` signal, `ConvexOfflineError`, saved copies, and `QueryRef.savedAt` (#81, #82). Its rendering rules are unchanged.
- **ADR 0010:** no `netlify.toml` change. The 14-day backward-compatibility window above extends its release rule. The cost estimate above replaces nothing and adds up to about 85 credits.
- **ADR 0005 and ADR 0009:** unchanged; `e2e/pwa.spec.ts` is a local-only spec like the preview smoke run.
- **`docs/process/hosting.md`** gains "Service worker" (kill switch, Drawer effect; #81) and the VAPID variables (#83). **`docs/conventions/angular.md`** gains: no data groups, no manual worker registration, and mutations go through the adapter's offline guard (#81).
- **Owner setup:** a preview-only VAPID pair as Convex default preview variables (#83), and the production pair at the first release (`gate:production`).
- **Harder later:**
  - Public pages have two render paths, server-rendered on a first visit and client-rendered from the worker afterwards; both must stay correct.
  - Old frontends live longer, hence the 14-day function compatibility rule.
  - Push failures are silent to the user; they surface in logs and `failureCount`.
- **What would reverse this:** ngsw being deprecated, or a need for server HTML offline (Workbox, Option 1B); `@block65/webcrypto-web-push` abandoned or failing on Convex cloud (Option 4D).

## Owner questions

1. **Netlify Drawer on previews and staging.** Its injected script breaks ngsw's file hashes there, so offline cannot be checked on previews or staging, only on a local production build. Options: turn the Drawer off for Deploy Previews and Branch deploys in the Netlify UI **(recommended: reviews happen on GitHub, and e2e already stubs the Drawer)**; or keep it and test offline only locally. #81 confirms the effect on its first preview.
2. **Push recipients and timing** are asked on #85; nothing in this ADR depends on the answer.

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

- **Not tested:** delivery through a real push service (no browser subscription in headless Chromium), Convex cloud's runtime (#84 sends from a cloud dev deployment), real iPhone and Android devices (owner checks in #80 and #84), and the worker on a Netlify preview (Owner question 1).

## Sources

- **Angular:** [Service workers overview](https://angular.dev/ecosystem/service-workers), [Service worker devops (fail-safe, safety worker, bypass)](https://angular.dev/ecosystem/service-workers/devops), [Configuration](https://angular.dev/ecosystem/service-workers/config), [Push notifications](https://angular.dev/ecosystem/service-workers/push-notifications). Package sources: `@angular/service-worker@22.2.2` (`ngsw-worker.js`, `types/service-worker.d.ts`), `@angular/build@22.2.2` (`src/utils/service-worker.js`, `src/builders/application/options.js`, `execute-post-bundle.js`), `@schematics/angular@22.2.2` (`service-worker/files/ngsw-config.json.template`), `@angular/pwa@22.2.2` (`package.json`, `pwa/index.js`).
- **Standards:** [WebSockets standard, establish a WebSocket connection](https://websockets.spec.whatwg.org/#concept-websocket-establish); RFC 8030 (Web Push), RFC 8291 (message encryption), RFC 8292 (VAPID), RFC 8188 (`aes128gcm`).
- **Apple and WebKit:** [Sending web push notifications in web apps and browsers](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [Web Push for web apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/), [News from WWDC25](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/).
- **Chrome:** [Install criteria](https://web.dev/articles/install-criteria).
- **Convex:** [Runtimes](https://docs.convex.dev/functions/runtimes); `convex@1.46.0` `dist/esm/browser/sync/request_manager.js` (`restart`), `dist/esm-types/browser/sync/client.d.ts` (`ConnectionState`).
- **Workbox:** [GoogleChrome/workbox](https://github.com/GoogleChrome/workbox) (release v7.4.1, 2026-05-05).
- **npm registry and download API (2026-10-09):** `@angular/service-worker`, `@angular/pwa`, `workbox-build`, `workbox-window`, `web-push`, `@block65/webcrypto-web-push`, `uint8array-extras`, `@pushforge/builder`, `@convex-dev/expo-push-notifications`; repositories `block65/webcrypto-web-push`, `draphy/pushforge`, `web-push-libs/web-push`.
