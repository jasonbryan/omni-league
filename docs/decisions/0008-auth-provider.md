# 0008: Authentication provider

- **Status:** Proposed
- **Gate:** `gate:technology`
- **Issue:** #7
- **Date:** 2026-10-07

## Context

Every Convex function authorises its caller through `ctx.auth.getUserIdentity()` (`docs/conventions/convex.md`), so the project needs one identity provider whose JWTs Convex accepts through `convex/auth.config.ts`, and an Angular client that hands those JWTs to the Convex client. ADR 0001 leaves the provider open.

### Owner answers (fixed requirements, from #7)

1. **Sign-in methods at launch:** email one-time code **or** magic link, plus Google. No passwords.
2. **Budget:** the provider's free tier at launch. This ADR states the monthly cost at 1,000 and 10,000 monthly active users (MAU).
3. **Ages:** adults only hold accounts at launch. Minors are roster entries managed by a guardian or organizer.
4. **E2E sign-in:** e2e tests sign in a seeded user against the anonymous local Convex backend, with no secrets and no real inbox.
5. **Public pages:** public pages are server-rendered or prerendered. Sign-in stays client-side and must not break server rendering of public routes, and a visitor moves from a public registration page to sign-in and back.

Other constraints: Convex local, dev, per-PR preview, and production deployments must all work; Google OAuth clients accept no wildcard redirect URIs; production secrets are owner-held (AGENTS.md); hosting plus Convex share a budget of about $25/month (`docs/product/requirements.md`).

### Assumptions taken from decisions that are still open

These come from PRs that are not merged yet. **If any of them changes before this ADR is accepted, this ADR is revised to match.**

| Source | Assumption used here | Where it matters |
| --- | --- | --- |
| ADR 0005, e2e (PR #17, #4) | Playwright runs against the **anonymous local backend** started by `CONVEX_AGENT_MODE=anonymous npx convex dev` with no Convex login. Test-only functions are `internalMutation`/`internalQuery` in `convex/testing.ts`, each guarded by `process.env.IS_TEST === "true"`. `IS_TEST` is set only on the local e2e deployment, in Playwright `globalSetup`. `globalSetup` runs `testing:reset` and seeds per test tenant. The e2e app build is a development build. Session-timeout checks for WCAG 2.2.1 are deferred to this ADR. | E2E sign-in path, guard, reset, rate limits |
| ADR 0006, Angular baseline (PR #18, #5) | Hybrid rendering: Convex-backed public routes are `RenderMode.Server`, static pages `RenderMode.Prerender`, signed-in routes `RenderMode.Client`. **Server renders are anonymous** and never call `setAuth`. The adapter exposes `provideConvexAuth(source: ConvexAuthSource)` with `fetchToken`, `signedIn: Signal<boolean>`, and optional `onChange`. The browser client calls `setAuth` on creation and `clearAuth()` on a `signedIn` true-to-false transition. `CONVEX_URL` reaches both bundles through a build-time `define` set by `scripts/ng-convex.mjs`. | Angular wiring, SSR coexistence, URL configuration |
| ADR 0004, test runners (PR #19, #3) | `convex-test` 0.0.60 on `vitest` 5.0.3, `edge-runtime` environment, root `vitest.config.mts`. `t.withIdentity({...})` fakes the caller; `tokenIdentifier` is `${issuer}\|${subject}`. ADR 0004 left "how real identities map to users" to this ADR. | Identity key, Convex tests |
| ADR 0003, npm and Node (PR #21, #1) | npm 11 on Node 26.11, `strict-allow-scripts=true` with an `allowScripts` map, `min-release-age=1`. | Install-script check, `overrides` entry |
| #9, hosting (open issue) | Per-PR previews, each with its own Convex preview deployment built by `npx convex deploy --preview-create`. The host's default domain is used until the first production release. Host not chosen, so preview hostnames are not known yet. | Callback URLs, allowed origins, email sender domain |

## Options

Six candidates were listed in #7. Two are compared in full, and four are ruled out against a numbered owner answer.

### Ruled out

| Candidate | Reason (owner answer) |
| --- | --- |
| **Clerk** (`@clerk/clerk-js` 6.38.1, MIT; Hobby plan free to 50,000 monthly retained users) | **Answer 4.** Clerk's Playwright helpers need `CLERK_SECRET_KEY` to mint testing tokens through the Backend API ([Clerk testing docs](https://clerk.com/docs/guides/development/testing/playwright/overview)), seeding a user also needs the Backend API, and every e2e sign-in runs against Clerk's cloud instead of the local backend. |
| **WorkOS AuthKit** (`@workos-inc/authkit-js` 0.20.4, MIT; free to 1M MAU) | **Answer 4.** Sign-in happens on WorkOS-hosted AuthKit pages, and creating or signing in a test user without the hosted UI needs the WorkOS API key. |
| **Auth0** (`@auth0/auth0-spa-js` 2.28.2, MIT; Free plan to 25,000 MAU) | **Answer 4.** Sign-in runs on Auth0's hosted Universal Login, and seeding users needs a Management API client secret. |
| **Custom OIDC/JWT provider** | **Answer 1.** Passwordless email codes, Google OAuth, sessions, key rotation, and rate limits would all be written and security-reviewed in this repository. That is what the two libraries below already provide, and it gains nothing on any other answer. |

The three hosted services send the sign-in email themselves and would cost $0 at both 1,000 and 10,000 MAU. They fail only answer 4. If the owner relaxes answer 4 (for example, by allowing a CI secret and accepting that fork PRs skip e2e sign-in), Clerk becomes the hosted candidate to compare.

### Option A: Convex Auth (`@convex-dev/auth`)

- **What it is:** Convex's own auth library. It runs inside the Convex deployment (tables in the app schema, HTTP actions for OAuth) and issues RS256 JWTs signed with a key held in the deployment's environment. Built on Auth.js provider definitions (`@auth/core`).
- **Version and licence:** `@convex-dev/auth` 0.0.96 (2026-09-30, Apache-2.0), peer `@auth/core` ^0.41.1 (0.41.3, ISC), `convex` ^1.17.0. No install scripts in its tree.
- **Status:** **beta.** Convex's docs say it "is currently a beta feature" and "may change in backward-incompatible ways" ([docs.convex.dev/auth](https://docs.convex.dev/auth)). The repository README says v1 is the current stable line and points to a WIP v2 rewrite on the `reboot` branch, published as `2.0.0-alpha.2` (2026-09-16). v1 depends on `lucia` 3 and `@oslojs/crypto`, both marked deprecated on npm.
- **Sign-in methods:** email codes and magic links through an `Email` provider whose `sendVerificationRequest` the project writes, and Google through `@auth/core/providers/google`. No password provider is needed.
- **Who sends the email:** the project. A separate sender (for example Resend) is called from `sendVerificationRequest`.
- **Angular:** the v1 client is React-only (`@convex-dev/auth/react`, 376 lines in `dist/react/client.js`). An Angular port is needed: token and refresh-token storage, refresh, the OAuth `?code=` exchange, and cross-tab sync. The v2 alpha adds a framework-agnostic `./browser` export, which is not usable while it is alpha.
- **Identity shape:** `sub` is `<userId>|<sessionId>` and `iss` is `CONVEX_SITE_URL` (`dist/server/implementation/tokens.js`). **`subject` and `tokenIdentifier` change on every new session**, so helpers must use the library's `getAuthUserId(ctx)`, which splits the user id from `sub`.
- **Defaults (from source):** JWT 1 hour; session 30 days total and 30 days inactive; email code valid 24 hours unless `maxAge` is set; 10 failed sign-in attempts per hour per identifier. No limit on sends.
- **Account linking:** links an OAuth sign-in to an existing user with the same email **unless** the provider sets `allowDangerousEmailAccountLinking: false` or the profile returns `emailVerified: false` (`dist/server/implementation/users.js`). The Google provider's default profile does not map `email_verified`, so the project would need a custom `profile()` to link only on verified email.
- **Redirect validation:** the default `redirect` callback accepts only paths starting with `/` or `?`, or URLs starting with `SITE_URL` (`dist/server/implementation/redirects.js`).
- **Pros:** first-party, no component boundary, low function-call count (1-hour JWT), simpler server setup.
- **Cons and risks:** beta with a rewrite in progress, so adopting v1 now means a migration to v2 later; deprecated dependencies; the project writes and maintains the Angular client; OAuth email linking needs explicit configuration to be safe.

### Option B: Better Auth through the Convex component (`@convex-dev/better-auth`)

- **What it is:** Better Auth, a framework-agnostic TypeScript auth library, running inside Convex as a Convex component maintained by Convex (`get-convex/better-auth`). Its tables (user, session, account, verification, jwks, rateLimit) live in the component. Its routes are HTTP actions under `/api/auth/*` on the deployment's `.convex.site` URL. The `convex` plugin issues RS256 JWTs for Convex, and `convex/auth.config.ts` lists one `customJwt` provider whose issuer is `CONVEX_SITE_URL`. Docs: [labs.convex.dev/better-auth](https://labs.convex.dev/better-auth).
- **Versions and licences:** `@convex-dev/better-auth` 0.12.5 (2026-06-27, Apache-2.0), with peer `better-auth >=1.6.11 <1.7.0`. So `better-auth` is pinned to **1.6.33** (2026-09-14, MIT), although upstream is on 1.7.7. All 30 packages in its tree are MIT, Apache-2.0, ISC, or `(MIT OR CC0-1.0)` (`type-fest`). None has an install script.
- **Sign-in methods:** the `emailOTP` plugin (6-digit code) and Google (`socialProviders.google`). Both are on the component's supported list ([supported plugins](https://labs.convex.dev/better-auth/supported-plugins)). Magic links are supported too but not proposed (see Recommendation). No password flow is enabled.
- **Who sends the email:** the project, from the plugin's `sendVerificationOTP` callback, through a separate sender.
- **Angular:** `better-auth/client` is a framework-agnostic client (nanostores), so no React is needed. The component's `crossDomain` client plugin keeps the session in `localStorage` because the app and `.convex.site` are different sites. **Verified in the scratch app** (Test evidence).
- **Identity shape (observed on the local backend):** claims `sub`, `iss`, `aud` (`convex`), `iat`, `exp`, `email`, `emailVerified`, `name`, `sessionId`, `createdAt`, `updatedAt`. **`sub` is the Better Auth user id, stable across sessions.** `iss` is `CONVEX_SITE_URL`.
- **Defaults (from source):** Convex JWT 15 minutes; session 7 days, extended once a day while used (`updateAge`); email code 5 minutes, 3 attempts per code; rate limit 100 requests per 10 s per IP, and 3 per 60 s on the email-OTP paths. Rate limiting is on only when `NODE_ENV` is production unless set explicitly, and its default store is in-memory, which does not persist between Convex function runs, so it must be set to `storage: "database"`.
- **Account linking:** an OAuth sign-in links to an existing user only if the provider reports the email as verified (Google's `email_verified`) **and** the existing user's email is verified (`requireLocalEmailVerified`, default true) (`dist/oauth2/link-account.mjs`). Email-code sign-in marks the email verified. The safe behaviour is therefore the default.
- **Pros:** one library for both methods with a framework-agnostic client; stable user id in `sub`; safe linking by default; account deletion built in (`deleteUser`); maintained by Convex; Better Auth itself is widely used and MIT.
- **Cons and risks:**
  - **The component lags upstream.** It is pinned below `better-auth` 1.7 and its last release was 2026-06-27. Security fixes reach 1.6.x only while upstream patches it (last 1.6 patch 2026-09-14).
  - **Peer conflict with ADR 0004's Vitest 5.** `better-auth` 1.6.33 declares an optional peer `vitest ^2 || ^3 || ^4`, so `npm install` fails with `ERESOLVE` next to `vitest` 5.0.3. Fixed with an npm `overrides` entry (`"better-auth": { "vitest": "$vitest" }`), verified. 1.7 accepts Vitest 5, so the override goes away when the component supports 1.7.
  - **Client IP is not available to HTTP actions on the local backend.** Better Auth logged "Rate limiting could not determine a client IP and is falling back to a single shared per-path bucket", and the fourth OTP request **from any address** got HTTP 429. A community report on Convex cloud ([get-convex/better-auth#247](https://github.com/get-convex/better-auth/issues/247)) shows a `cf-connecting-ip` header reaching HTTP actions, but Convex does not document it. Open issues on the database rate-limit store: [#432](https://github.com/get-convex/better-auth/issues/432) (write contention on a hot bucket returns 500), [#446](https://github.com/get-convex/better-auth/issues/446), [#312](https://github.com/get-convex/better-auth/issues/312). See "Rate limits" for how this ADR handles it.
  - **Session token in `localStorage`** (the `crossDomain` plugin), readable by any script injected through XSS. Option A stores its refresh token the same way.
  - The `crossDomain` plugin sets `skipStateCookieCheck: true`, so an OAuth flow is bound to its state record in the database but not to the browser that started it.
  - **The JWKS private key is encrypted with `BETTER_AUTH_SECRET`.** Changing the secret without clearing the `jwks` table makes every token request fail with HTTP 500 ("Failed to decrypt private key"). This happened in the scratch run; see Consequences for e2e and production.

### Summary

| | A: Convex Auth | B: Better Auth component |
| --- | --- | --- |
| Status | Beta; v2 rewrite in alpha | Component 0.12.x, pinned to `better-auth` 1.6 |
| Email code + Google, no passwords | Yes | Yes |
| Sends its own email | No | No |
| Angular client | Project ports the React client | `better-auth/client`, verified |
| Stable user id in `sub` | No (`user\|session`) | Yes |
| Linking only on verified email | Needs a custom Google `profile()` | Default |
| Account deletion API | None; project deletes its auth tables | `deleteUser`, verified |
| E2E with no secrets | Feasible (same outbox design), not run | **Run locally, passes** |
| Main risk | v1 to v2 migration | Lag behind upstream; rate limiting needs a client IP |

## Cost

Both libraries are free (Apache-2.0 / MIT, which permit commercial use). Their cost is the Convex usage they add and the email sender. Convex prices are from [convex.dev/pricing](https://www.convex.dev/pricing) on 2026-10-07: Free and Starter include 1M function calls, 1 GB database I/O, 0.5 GB storage, and 20 GB-hours of action compute per month. Starter overage is $2.20 per 1M calls and $0.22 per GB. Whether the Convex plan's terms allow commercial use is #9's check, since the plan is shared with the app.

**Convex usage measured for Option B** (scratch app, local backend, nested `runQuery`/`runMutation` calls logged per HTTP request, rate limiting on). Every request adds 1 for the HTTP action itself.

| Request | Function calls |
| --- | --- |
| Send code | 5 |
| Verify code (sign in) | 12 |
| Get session | 5 |
| Convex token | 5 to 6 |
| Sign out | 4 |

**Usage assumptions per MAU per month:** 10 app visits, each with one session check, one token fetch, and one 15-minute token refresh (about 17 calls); 1.5 email sign-ins (about 26 calls). That is about 200 calls, rounded up to **250 calls per MAU** for headroom. DB I/O is estimated at 2 KB per call (session, user, rate-limit row, and JWKS on token calls); it was not measured. Storage is under 0.05 GB at 10,000 users. The Angular client is configured with `sessionOptions.refetchOnWindowFocus: false`, because by default every tab focus fetches the session. Option A was not measured. Its 1-hour JWT means fewer refreshes, so it is estimated at 150 calls per MAU.

**Email assumption:** **1.5 emails per MAU per month.** Sessions last 7 days from last use, so a weekly user rarely needs a new code, and Google users need none. The figure includes re-sends. Resend is used as the reference price ([resend.com/pricing](https://resend.com/pricing)): Free gives 3,000 emails/month **and at most 100/day**; Pro costs $20/month for 50,000. The email decision may choose another sender.

| Monthly cost | 1,000 MAU | 10,000 MAU |
| --- | --- | --- |
| **B: Better Auth.** Convex usage | 0.25M calls, about 0.5 GB I/O: within the included amounts, **$0** (but a quarter of the included calls and half the included I/O, which the app also uses) | 2.5M calls, about 5 GB I/O: **about $4.20** on Starter ($3.30 calls + $0.88 I/O), **up to $6.60** if the app alone already uses the included amounts |
| **B.** Email (1,500 / 15,000 emails) | **$0** (Resend Free; within 3,000/month, but the 100/day cap allows about 100 code sign-ins a day) | **$20** (Resend Pro) |
| **B: total** | **$0** | **about $24 to $27** |
| **A: Convex Auth.** Convex usage | 0.15M calls: **$0** | 1.5M calls: **about $1.10 to $3.30** plus I/O |
| **A.** Email | **$0** | **$20** |
| **A: total** | **$0** | **about $22 to $24** |

**Against the shared hosting-plus-Convex cap (about $25/month, #9):** at 1,000 MAU auth adds $0, but it consumes part of the included Convex quota that #9's estimate must count. At 10,000 MAU, auth adds about $4 to $7 of Convex usage to that cap. The $20 email cost is a separate service outside the cap, which the owner's "free tier at launch" answer covers only until about 2,000 MAU (the 3,000/month limit) or a 100-email day, whichever comes first.

## Recommendation

**Option B: Better Auth through the Convex component, with email one-time codes and Google.** It is the only candidate whose whole e2e sign-in path was run locally with no secrets and no inbox. Its client works from Angular without a port, and its `sub` is a stable user id. It links accounts only on verified email by default. Convex Auth would meet the same answers, but it means porting a React client now and migrating it again when the v2 rewrite lands.

**Email codes, not magic links.** A code can be read on a phone and typed on a laptop. A link opened in the mail app's browser would sign in the wrong browser. Mail scanners that pre-fetch links cannot consume a code. Magic links can be added later without a new gate (same plugin family, already supported).

### Packages

| Package | Version | Type | Licence |
| --- | --- | --- | --- |
| `@convex-dev/better-auth` | 0.12.x | dependency | Apache-2.0 |
| `better-auth` | 1.6.x (pinned below 1.7 by the component's peer range) | dependency | MIT |

`convex` is already accepted (ADR 0001). Transitive packages include `convex-helpers`, `jose`, `zod`, `kysely`, `nanostores`, `better-call`, `@noble/*`, and `@better-auth/*`, all with permissive licences and no install scripts, so ADR 0003's `allowScripts` map is unchanged. `package.json` gains `"overrides": { "better-auth": { "vitest": "$vitest" } }` until the component accepts `better-auth` 1.7. Moving to `better-auth` 1.7 or the component to 0.13 is a minor bump and needs no gate, but it must pass the e2e sign-in spec.

### Server configuration (summary for the sign-in feature)

- `convex/convex.config.ts` uses the component. `convex/auth.config.ts` contains **only** `getAuthConfigProvider()`.
- `convex/auth.ts` `createAuth(ctx)`:
  - `baseURL: CONVEX_SITE_URL`.
  - `trustedOrigins`: `SITE_URL`, plus on previews the request's `Origin` if it matches `PREVIEW_ORIGIN_PATTERN` (see Deployments).
  - `session: { expiresIn: 7 days, updateAge: 1 day }`.
  - `account.accountLinking: { enabled: true, trustedProviders: [] }`. Google is **not** a trusted provider, so linking relies on `email_verified`.
  - `user.deleteUser.enabled: true`.
  - `rateLimit: { enabled: !IS_TEST, storage: "database" }`.
  - `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]` (to be verified, see Rate limits).
  - `socialProviders.google`, only when `GOOGLE_CLIENT_ID` is set.
  - Plugins: `emailOTP({ otpLength: 6, expiresIn: 600, allowedAttempts: 3, storeOTP: "hashed", sendVerificationOTP })`, `crossDomain({ siteUrl })`, and `convex({ authConfig })`.
- `convex/http.ts`: `authComponent.registerRoutes(http, createAuth, { cors: true })`.
- `sendVerificationOTP`: under `IS_TEST`, it writes to the test outbox (E2E). Otherwise it applies the per-address send cap and calls the email sender.

### Identity key and account linking

- **Helpers in `convex/lib/` key users on `identity.subject`** (the Better Auth user id), stored as `users.authUserId` with an index.
- **Why not `tokenIdentifier`.** It is `${CONVEX_SITE_URL}|${subject}`. The issuer part is the deployment's HTTP-action URL, which changes if production later moves HTTP actions to a custom domain, and every stored key would then stop matching. `auth.config.ts` has exactly one provider, so `subject` alone cannot collide across issuers. If a second issuer is ever added, the key changes to `tokenIdentifier` through a migration in that ADR.
- **App user record.** It is created on the first sign-in through the component's user triggers (`triggers.user.onCreate`) and deleted through `onDelete`. The sign-in feature verifies that a trigger failure also fails the sign-in. Functions read the app's own `users` table by index and do not call the component on each request.
- **Same email by code and by Google:** **linked to one account** when Google reports `email_verified: true` and the existing account's email is verified (always true after a code sign-in). Otherwise the Google sign-in is refused with `account not linked`, not merged and not duplicated. A Google sign-in for a new email creates an account with the verified email. No linking on unverified email is possible with this configuration.

### Tokens, sessions, codes, rate limits, redirects

- **Convex JWT:** 15 minutes (component default), fetched from `/api/auth/convex/token`. The Convex client refetches before expiry through `fetchToken({ forceRefreshToken: true })`. Revocation: sign-out deletes the session at once, and a JWT already issued stays valid for at most 15 minutes.
- **Session:** 7 days from last use, extended at most once a day while used (sliding). No absolute cap at launch. `freshAge` (1 day) makes account deletion require a session younger than a day, or a new code.
- **WCAG 2.2.1 (Timing Adjustable), deferred here by ADR 0005:** the only time limit on a signed-in user is the 7-day idle expiry, which is beyond the criterion's 20-hour exception. No in-page timeout or warning is needed. The 10-minute code validity is a security limit: the sign-in screen keeps the typed email, offers "Send a new code" at any time, and its expiry message says so. The sign-in feature's tester checks this under ADR 0005's manual 2.2.1 row. For 3.3.8 the code field allows paste and uses `autocomplete="one-time-code"`.
- **Email code:** 6 digits, valid 10 minutes, 3 wrong attempts per code (then the code is void), stored hashed.
- **Rate limits:**
  - **Per address (project code, no package):** `sendVerificationOTP` sends at most 5 codes per address per hour, counted in a small Convex table. Better Auth answers success either way, so the response does not reveal whether an address exists. With 3 attempts per code, this bounds guessing at 15 tries per address per hour against 1,000,000 codes. It also protects the sender's daily quota.
  - **Per IP (Better Auth, `storage: "database"`):** 100 requests per 10 s on all auth paths, and 3 per 60 s on the email-OTP paths. **This depends on a client IP reaching the HTTP action.** The first sign-in feature must log request headers on a cloud dev deployment and confirm that `cf-connecting-ip` carries the browser's address and cannot be set by the client. If it does not, the per-IP limiter is turned off, because a single shared bucket would block every user after three code requests a minute, and the per-address cap stays.
  - Disabled under `IS_TEST`, because local e2e has no client IP. Rate-limit behaviour is covered by `convex-test` and unit tests instead.
- **Return-to-registration URL:** the sign-in route takes `returnTo` as a query parameter. It is accepted only if it starts with `/`, does not start with `//` or `/\`, and, when parsed against a placeholder origin, keeps that origin. Anything else becomes `/`. For Google it is passed as a **relative** `callbackURL`; the `crossDomain` plugin resolves it against `SITE_URL`, and Better Auth's origin check rejects any other origin. The scratch e2e run shows `returnTo=//evil.example/steal` landing on `/`.

### Angular wiring (fits ADR 0006 with no adapter API change)

The `ConvexAuthSource` passed to `provideConvexAuth()` is a root service. Abridged from the scratch app (`src/app/core/auth.ts`):

```ts
export const AUTH_CLIENT = new InjectionToken<AuthClient | null>('AUTH_CLIENT', {
  providedIn: 'root',
  // Browser only: no Better Auth client exists during a server render.
  factory: () => (isPlatformBrowser(inject(PLATFORM_ID)) && __CONVEX_SITE_URL__ ? makeClient() : null),
});

@Injectable({ providedIn: 'root' })
export class AuthService implements ConvexAuthSource {
  private readonly client = inject(AUTH_CLIENT);
  private readonly _signedIn = signal(false);
  readonly signedIn = this._signedIn.asReadonly();
  private cached: string | null = null;
  constructor() {
    this.client?.useSession.subscribe((s) => {          // Better Auth session store
      if (!s.data?.session) this.cached = null;
      this._signedIn.set(!!s.data?.session);
    });
    // also: exchange a one-time `ott` query parameter after a Google redirect
  }
  fetchToken = async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    if (!this.client) return null;
    if (this.cached && !forceRefreshToken) return this.cached;
    const { data } = await this.client.convex.token({ fetchOptions: { throw: false } });
    return (this.cached = data?.token ?? null);
  };
}
// app.config.ts: provideConvexAuth(...) with the AuthService instance
```

- **`fetchToken`, `signedIn`, `onChange`** match ADR 0006's interface exactly. `onChange` is not needed.
- **Sign-out** calls `authClient.signOut()`. That deletes the session row and the stored cookie, the session store emits no session, `signedIn` turns false, and the adapter's effect calls `clearAuth()`. Live queries then rerun as anonymous (verified: the scratch page switched from "signed in as …" to "anonymous").
- **One addition outside the adapter API:** the client needs the deployment's HTTP-action URL. `scripts/ng-convex.mjs` (ADR 0006) also defines `__CONVEX_SITE_URL__`, derived from `CONVEX_URL`: `.convex.cloud` becomes `.convex.site` for cloud deployments, and port 3210 becomes 3211 for the local backend. It is public, like `CONVEX_URL`.
- **Google redirect return:** after Google, the `crossDomain` plugin redirects to `SITE_URL + returnTo + ?ott=<one-time token>`. `AuthService` exchanges `ott` for a session on start-up and removes it from the URL. This mirrors the component's React provider. It was **not exercised** in the scratch run, which had no Google client, so the sign-in feature verifies it on a dev deployment.

### Server-rendered public pages

- **No auth code runs during a server render.** `AUTH_CLIENT` is `null` on the server, `CONVEX_AUTH` is ignored there (ADR 0006), and public pages inject nothing from auth.
- **SDK in the server bundle.** The Better Auth client modules **are** in the server bundle, because `provideConvexAuth()` is registered in the shared `app.config.ts`. They **touch no browser globals at module evaluation**. The `crossDomain` client plugin checks `typeof window` only when the client is created, and the scratch build prerendered `/` and server-rendered `/leagues/abc` in Node with no errors, in both development and production configurations. The rule for features: the Better Auth client is created only in the `AUTH_CLIENT` factory.
- **Hand-off:** a public league page (`RenderMode.Server`, anonymous) links to `/sign-in?returnTo=/leagues/<slug>/register`. The sign-in route is `RenderMode.Client`. After the code is verified, the router navigates to the validated `returnTo`. If that target is a Server route, its personalised parts load after hydration (ADR 0006). The scratch e2e run covers this path end to end, and the raw server HTML of the public page contains no JWT.

### Deployments, callbacks, and secrets

Google redirect URI for every deployment: `<CONVEX_SITE_URL>/api/auth/callback/google`. Google requires HTTPS except for loopback hosts, forbids wildcards, and requires the host's suffix to be on the Public Suffix List. `convex.site` is on that list ([Google redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server)).

| Deployment | Email codes | Google | Callback / allowed origins | Environment and secrets (where) |
| --- | --- | --- | --- | --- |
| **Local e2e** (anonymous local backend, ADR 0005) | Yes. Codes go to the test outbox under `IS_TEST`, not to email | **No** (no Google variables set, button hidden) | `SITE_URL=http://localhost:4000`. No callback | Set by Playwright `globalSetup` with `npx convex env set`: `BETTER_AUTH_SECRET` (random, generated per run, never stored), `SITE_URL`, `IS_TEST=true`. **No stored secret**, so fork PRs work. |
| **Developer dev deployment** (`npx convex dev`, cloud, one per developer) | Only once the email decision's sender is configured. Before a sender domain exists, the sender's sandbox delivers only to the sender account owner's address. Developers otherwise use the local e2e setup | Optional: the owner adds `https://<dev-name>.convex.site/api/auth/callback/google` to a **non-production** Google OAuth client (consent screen in Testing mode, listed test users only) | `SITE_URL=http://localhost:4200` (or the local SSR port) | Set by the developer on their own dev deployment with `npx convex env set`: `BETTER_AUTH_SECRET`, `SITE_URL`, optionally `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (dev client) and the email API key (dev or sandbox key). |
| **Per-PR preview** (#9, #15) | Same as dev: needs the sender; before a sender domain exists, only the owner's address receives codes | **No.** Every preview gets a new random `*.convex.site` callback that cannot be registered in advance, and wildcards are refused. A proxy through a fixed deployment (Better Auth's `oAuthProxy`) is rejected for launch: it is not on the component's supported list and it shares an identity-asserting secret with previews | `SITE_URL` cannot be set per preview through default env vars, so `trustedOrigins` also accepts a request `Origin` matching `PREVIEW_ORIGIN_PATTERN`, the host's **project-specific** preview hostname pattern, fixed by #15 once #9 names the host (never a bare `*.<host-domain>`) | **Convex default preview environment variables** (dashboard, set once): `BETTER_AUTH_SECRET` (a preview-only value, never the production one), `SITE_URL`, `PREVIEW_ORIGIN_PATTERN`, and the email key from the email decision (preview-scoped). **Not** `IS_TEST`, **not** Google. |
| **Production** | Yes, through the email decision's sender on the project's verified sending domain | Yes. The owner registers `https://<prod-name>.convex.site/api/auth/callback/google` on the **production** Google OAuth client | `SITE_URL` is the production app URL (host default domain until the first release, then the custom domain) | **Owner-held**, set by the owner in the production deployment's environment: `BETTER_AUTH_SECRET`, `SITE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, the email API key. The Angular host needs **no** auth secret, only the public `CONVEX_URL` and `CONVEX_SITE_URL` at build time. |

## Testing

### E2E sign-in with no secrets and no inbox (answer 4)

- **Path:** the e2e test seeds a user, then signs in by **email code through the real UI**. The `sendVerificationOTP` callback writes `{ email, otp }` to a `testOutbox` table **only when `IS_TEST === "true"`**. The test reads the code with `npx convex run testing:latestOtp`, an `internalQuery` behind ADR 0005's `IS_TEST` guard, and types it in. **E2E covers the email path; Google sign-in is not exercised in e2e.**
- **Seeding:** `testing:seedLeague`, an `internalMutation` behind the guard, creates the Better Auth user (email verified) through `components.betterAuth.adapter.create`, the app's `users` row keyed on its id, and the tenant's leagues. The code sign-in then signs in that same user (verified: same id).
- **Reset:** `testing:reset` (ADR 0005) also clears the component's tables, **including `jwks`**. Otherwise a new per-run `BETTER_AUTH_SECRET` cannot decrypt the old key and every token request returns HTTP 500.
- **Guard and why the path cannot be used elsewhere:**
  - Both test functions are internal, so no client can call them.
  - Both throw unless `IS_TEST` is set.
  - Without `IS_TEST`, `sendVerificationOTP` never writes to the outbox and sends through the real sender.
  - `IS_TEST` is never set on dev, preview, or production deployments (ADR 0005). #15 adds a deploy step that fails if `npx convex env get IS_TEST` returns a value on a preview or production deployment.
  - No test issuer is added to `auth.config.ts`, so no alternative token path exists.
- **Evidence (local runs, 2026-10-07, details in Test evidence):** with `IS_TEST` set, Playwright signed the seeded user in from the public page and returned to the registration route, 2/2 passed. With `IS_TEST` removed from the same deployment: `testing:seedLeague` and `testing:latestOtp` both failed with `testing functions are disabled: IS_TEST is not set`; the send request returned success but nothing was written to the outbox (the backend logged `No email sender configured`); and a guessed code was rejected with `400 INVALID_OTP`.

### Convex function tests with faked identities (ADR 0004)

`withIdentity` fakes the claims that the real backend produced. The scratch run decoded a real token: `sub` is the Better Auth user id, `iss` is `CONVEX_SITE_URL`, plus `email`, `emailVerified`, `name`, and `sessionId`. Convex exposed it as `subject`, `issuer`, and `tokenIdentifier` (`http://127.0.0.1:3211|<id>`), with the other claims as custom fields.

```ts
const asUser = (authUserId: string, email: string) => ({
  subject: authUserId, issuer: "http://127.0.0.1:3211", email, emailVerified: true, name: email, sessionId: "s1",
});
await t.withIdentity(asUser("auth-alice", "alice@example.test")).query(api.leagues.getForMember, { leagueId: leagueA }); // seeded member: ok
await expect(t.query(api.leagues.getForMember, { leagueId: leagueA })).rejects.toThrow(/UNAUTHENTICATED/);           // unauthenticated
await expect(t.withIdentity(asUser("auth-bob", "bob@example.test"))                                                  // other league
  .query(api.leagues.getForMember, { leagueId: leagueA })).rejects.toThrow(/FORBIDDEN/);
```

Seeding inserts `users` rows with `authUserId` equal to the faked `subject`. A fourth test asserts that the faked identity's `subject`, `issuer`, `tokenIdentifier` format, `email`, and `emailVerified` match the real token's shape. The suite passed 4/4 on `convex-test` 0.0.60 and `vitest` 5.0.3. Functions that call the component directly (for example `authComponent.getAuthUser`) would need the component registered in `convex-test` (`@convex-dev/better-auth/test`). The helper design above avoids that.

## Data, ages, and deletion

| | A: Convex Auth | B: Better Auth component |
| --- | --- | --- |
| Where identity data is stored | The project's Convex deployment (app-schema tables) | The project's Convex deployment (component tables) |
| Region | The deployment's region: US East (N. Virginia) or EU West (Ireland), chosen when the deployment is created and not changeable afterwards ([Convex regions](https://docs.convex.dev/production/regions)). #9 picks it. The email sender's region is part of the email decision. Google holds the Google account. | Same |
| Deleting an account at the provider | No API. A project mutation deletes the user's `authAccounts`, `authSessions`, `authRefreshTokens`, and `authVerificationCodes` rows and the user. | `deleteUser` (client, needs a session younger than `freshAge`, or server `auth.api.deleteUser`). Verified: the user row and its sessions were gone afterwards. |
| Deleting in Convex app data | Same mutation | The component's `onDelete` user trigger deletes or anonymises the app's `users` row and dependent records (feature work). Convex backups keep data until they rotate out. Google access is revoked by the user in their Google account; the app stores no Google refresh token beyond the deleted account row. |

**Ages:** accounts are **adults only** at launch. Minors are roster entries (for example a `players` record with a `guardianUserId`) managed by a guardian or organizer, and they never have an auth identity, so the auth design does not change when guardian-managed profiles arrive. Neither library has terms on user age. Google accounts are open to users from 13 (higher in some countries), so Google sign-in does not prove adulthood. The adults-only rule is a product rule, enforced by the registration flow (for example an 18+ confirmation), not by the provider.

## Transactional email: a separate decision is needed

**Yes.** Option B, like every library option, sends no email. The orchestrator opens `decision: transactional email` (`gate:technology`), and sign-in feature issues are `Blocked by:` both this ADR and that decision. That decision must cover:

- **The sender** (for example Resend, Postmark, Amazon SES) and how Convex calls it: plain `fetch` from an action, or a Convex component such as `@convex-dev/resend` 0.2.8 (Apache-2.0) with retries and status webhooks. The send runs in `sendVerificationOTP`, which Better Auth runs as a background task: the HTTP response reports success even when the send throws (observed in the scratch run), so failures surface only in logs. The decision states how failures are noticed.
- **A sending domain the project controls, with SPF and DKIM (and DMARC) records.** #9 keeps the web app on the host's default domain, and neither that domain nor `*.convex.site` can carry the project's DNS records. Sign-in by email to anyone other than the sender account owner therefore needs a project-owned domain, or a subdomain such as `mail.<domain>`, before the first production release, even though the web app does not use it yet. This is an owner purchase decision.
- **Dev and preview before that domain exists:** sandbox senders deliver only to the account owner. For example, Resend's `resend.dev` sender returns 403 for any other recipient ([Resend docs](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)). The decision states whether dev and previews wait for the domain, use the owner-only sandbox, or use another approach, and any approach that exposes codes outside email needs a guard as strict as `IS_TEST`.
- **Free-tier fit:** at 1.5 emails per MAU, 1,000 MAU is about 1,500 emails/month, which fits a 3,000/month free tier, but a 100/day cap limits a busy registration day to about 100 code sign-ins. 10,000 MAU is about 15,000/month, beyond common free tiers.
- **Email template visuals** (they are user-visible output, so `gate:ui-design` applies to them), and later product notifications beyond sign-in.

## Consequences

- **New dependencies:** `@convex-dev/better-auth` 0.12.x and `better-auth` 1.6.x, plus one `overrides` entry. No install scripts, so ADR 0003's `allowScripts` map is unchanged. No paid service.
- **No prebuilt or hosted sign-in UI.** Better Auth is headless, so the sign-in and code screens are built in Angular with the #6 components and design tokens, and they go through **`gate:ui-design`** in the sign-in feature issue. The one hosted screen is **Google's account chooser and consent page**, which cannot be styled. It shows the app name from the Google consent configuration and the redirect domain `<prod-name>.convex.site` until production moves HTTP actions to a custom domain. Convex custom domains need the Convex Pro plan ($25 per developer per month), which is beyond the #9 budget at launch. A host-level rewrite of `/api/auth/*` is the other route; it would be #9's or a later ADR's decision.
- **Sign-in feature issue scope** (first slice): server configuration above; `AuthService` and `AUTH_CLIENT`; the sign-in and code routes as `RenderMode.Client`; `returnTo` validation with tests; the `user.onCreate`/`onDelete` triggers; the per-address send cap; verifying the client-IP header on a cloud dev deployment; and the e2e outbox, seeding, and reset additions. Google is a second slice, after the owner creates the dev and production Google OAuth clients.
- **`convex/` code is type-checked by the Angular app's compiler** through `convex/_generated/api.d.ts`, so the app's `noPropertyAccessFromIndexSignature` applies to it, and `process.env["NAME"]` must use bracket access. `convex/tsconfig.json` needs `"types": ["node"]` under TypeScript 6 for `process`. Found in the scratch build; #10 and #11 apply both.
- **Secrets runbook:** changing `BETTER_AUTH_SECRET` on any deployment requires rotating the JWKS (delete the `jwks` rows; a new key is created on the next token request). The rotation signs everyone out, because existing session tokens are tied to the old secret. Production rotation is an owner step under `gate:production`.
- **Ongoing risk:** the component lags `better-auth` releases. Upstream security fixes on 1.7 that are not back-ported to 1.6 would force waiting for the component or a local install of the component's code. The weekly dependency update (#8) surfaces component releases, and any `better-auth` advisory is checked against 1.6.x.
- **What would reverse this:** if the per-IP limiter cannot get a trustworthy client IP and the per-address cap proves insufficient, or if the component stays pinned to an unpatched `better-auth` line, revisit Convex Auth v2 once it leaves alpha (it then offers a framework-agnostic client), or a hosted provider if the owner relaxes answer 4.
- **Acceptance:** when the owner merges this PR, the status becomes `Accepted`.

## Test evidence

Run on 2026-10-07 on macOS arm64, Node 26.11.0, npm 11.20.0, in a scratch directory outside the repository. Versions: `@angular/core` 22.2.1 (CLI 22.2.2, `ng new web --ssr`), `convex` 1.46.0, `@convex-dev/better-auth` 0.12.5, `better-auth` 1.6.33, `convex-test` 0.0.60, `vitest` 5.0.3, `@playwright/test` 1.64.0 (Chromium headless shell), local backend `precompiled-2026-10-06-a3538c6`.

1. **Install:** `npm install @convex-dev/better-auth@0.12.5 better-auth@1.6.33` next to the CLI's `vitest` 5 failed with `ERESOLVE` (`peerOptional vitest@"^2.0.0 || ^3.0.0 || ^4.0.0" from better-auth@1.6.33`). With the `overrides` entry it installed, and `npm ls` showed a single `vitest@5.0.3`. The lockfile marks `hasInstallScript` only on `esbuild`, which ADR 0003 already lists.
2. **Anonymous local backend, no login:** `CONVEX_AGENT_MODE=anonymous npx convex dev --once` ran with an empty `HOME` and stdin from `/dev/null`. It printed `[Local] Port 3210 • No Convex account`, installed the `betterAuth` component, and pushed the functions.
3. **Sign-in flow from Node** (`better-auth/client` with the `emailOTPClient`, `convexClient`, and `crossDomainClient` plugins):
   - The seeded user's code sign-in returned the seeded id.
   - The token had TTL 900 s and `aud` `convex`.
   - `ConvexHttpClient` with that token: own league returned data, the other league threw `FORBIDDEN`, and no token threw `UNAUTHENTICATED`.
   - After sign-out, the token endpoint returned 401.
4. **Rejection without `IS_TEST`:** see Testing.
5. **Rate limits:** with rate limiting on and no client IP, five code requests returned `200,429,429,429,429` and the backend logged the shared-bucket warning. With a `cf-connecting-ip` header, requests were counted per address.
6. **Scratch `ng new --ssr` app:**
   - Wiring: the ADR 0006 surface (`CONVEX_CLIENT` browser-only, `CONVEX_AUTH`, `provideConvexAuth`) with `AuthService` as the `ConvexAuthSource`.
   - Routes: `''` Prerender, `leagues/:id` Server, `sign-in` and `leagues/:id/register` Client.
   - Build: `ng build` in development and production configurations, `Prerendered 1 static route.` each.
   - Server: `node dist/web/server/server.mjs` returned 200 with `<h1>League abc</h1>` for `/leagues/abc`, and logged no server errors.
7. **Playwright against that server and the local backend** (development build, so hydration checks were active), 2/2 passed:
   - (a) Raw server HTML checked, then: public page → Register → sign-in with `returnTo` → code from the outbox → back on the registration route showing "signed in as \<seeded email\>" → sign-out shows "anonymous". No console errors.
   - (b) `returnTo=//evil.example/steal` ends on `/`.
   - Both tests passed again against the production build.
8. **Function calls** (Cost section): per-request counts of nested calls logged by an instrumented `ctx`.
9. **`convex-test`:** 4/4 passed (Testing section).
10. **Deletion:** `deleteUser` right after sign-in returned `User deleted`, and the component then held no user row and 0 sessions for that id.
11. **Secret change:** regenerating `BETTER_AUTH_SECRET` without clearing `jwks` made `/api/auth/convex/token` return 500 (`Failed to decrypt private key`). Clearing `jwks` fixed it.

## Sources

- Convex: [Authentication overview](https://docs.convex.dev/auth), [Convex Auth (labs)](https://labs.convex.dev/auth), [Convex Auth OTPs](https://labs.convex.dev/auth/config/otps), [Better Auth component](https://labs.convex.dev/better-auth), [React framework guide](https://labs.convex.dev/better-auth/framework-guides/react), [supported plugins](https://labs.convex.dev/better-auth/supported-plugins), [local install](https://labs.convex.dev/better-auth/features/local-install), [pricing](https://www.convex.dev/pricing), [regions](https://docs.convex.dev/production/regions), [custom domains](https://docs.convex.dev/production/custom-domains)
- Better Auth: [OAuth proxy plugin](https://www.better-auth.com/docs/plugins/oauth-proxy); source of `better-auth` 1.6.33 (`dist/context/create-context.mjs`, `dist/plugins/email-otp/*`, `dist/oauth2/link-account.mjs`, `dist/auth/trusted-origins.mjs`, `dist/client/session-refresh.mjs`) and `@convex-dev/better-auth` 0.12.5 (`dist/plugins/convex/index.js`, `dist/plugins/cross-domain/*`, `dist/client/create-client.js`, `dist/component/schema.js`)
- Convex Auth source, `@convex-dev/auth` 0.0.96 (`dist/server/implementation/{tokens,sessions,refreshTokens,rateLimit,redirects,signIn,users}.js`, `dist/react/client.js`); [repository README](https://github.com/get-convex/convex-auth)
- GitHub issues: [get-convex/better-auth#247](https://github.com/get-convex/better-auth/issues/247), [#312](https://github.com/get-convex/better-auth/issues/312), [#432](https://github.com/get-convex/better-auth/issues/432), [#446](https://github.com/get-convex/better-auth/issues/446)
- Hosted providers: [Clerk pricing](https://clerk.com/pricing), [Clerk testing](https://clerk.com/docs/guides/development/testing/overview), [Clerk Playwright](https://clerk.com/docs/guides/development/testing/playwright/overview), [WorkOS pricing](https://workos.com/pricing), [Auth0 pricing](https://auth0.com/pricing)
- Google: [OAuth 2.0 for web server apps, redirect URI validation](https://developers.google.com/identity/protocols/oauth2/web-server); [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat) (`convex.site`)
- Email: [Resend pricing](https://resend.com/pricing), [Resend 403 on resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
- npm registry (versions, licences, peers, publish dates), checked 2026-10-07: `@convex-dev/auth`, `@auth/core`, `@convex-dev/better-auth`, `better-auth`, `@clerk/clerk-js`, `@workos-inc/authkit-js`, `@auth0/auth0-spa-js`, `@convex-dev/resend`, `convex`, `convex-test`
