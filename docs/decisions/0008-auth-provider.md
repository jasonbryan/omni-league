# 0008: Authentication provider

- **Status:** Proposed
- **Gate:** `gate:technology`
- **Issue:** #7
- **Date:** 2026-10-07 (revised the same day for the owner's email + password answer)

## Context

Every Convex function authorises its caller through `ctx.auth.getUserIdentity()` (`docs/conventions/convex.md`). The project therefore needs one identity provider whose JWTs Convex accepts through `convex/auth.config.ts`, and an Angular client that hands those JWTs to the Convex client. ADR 0001 leaves the provider open.

### Owner answers (fixed requirements, from #7)

1. **Sign-in methods at launch:** **email + password, plus Google.** Email one-time codes are dropped for now ([owner decision on #7](https://github.com/jasonbryan/omni-league/issues/7), replacing the earlier "email code or magic link" answer).
2. **Budget:** the provider's free tier at launch. This ADR states the monthly cost at 1,000 and 10,000 monthly active users (MAU).
3. **Ages:** adults only hold accounts at launch. Minors are roster entries managed by a guardian or organizer.
4. **E2E sign-in:** e2e tests sign in a seeded user against the anonymous local Convex backend, with no secrets and no real inbox.
5. **Public pages:** public pages are server-rendered or prerendered. Sign-in stays client-side and must not break server rendering of public routes. A visitor moves from a public registration page to sign-in and back.
6. **Email and domain:** email verification and password-reset emails are added **before the first production release**, when a domain is bought. The domain purchase is deferred until then. During development no project-owned sending domain is needed. The transactional-email decision (#26) therefore blocks the first production release, not sign-in features.

Other constraints:

- Convex local, dev, per-PR preview, and production deployments must all work.
- Google OAuth clients accept no wildcard redirect URIs.
- Production secrets are owner-held (AGENTS.md).
- Hosting plus Convex share a budget of about $25/month (`docs/product/requirements.md`).

### Assumptions taken from decisions that are still open

These come from PRs that are not merged yet. **If any of them changes before this ADR is accepted, this ADR is revised to match.**

| Source | Assumption used here | Where it matters |
| --- | --- | --- |
| ADR 0005, e2e (PR #17, #4) | Playwright runs against the **anonymous local backend** started by `CONVEX_AGENT_MODE=anonymous npx convex dev`, with no Convex login. Test-only functions live in `convex/testing.ts`. They are internal functions, each guarded by `process.env.IS_TEST === "true"`. `IS_TEST` is set only on the local e2e deployment, in Playwright `globalSetup`. `globalSetup` runs `testing:reset` and seeds each test tenant. The e2e app build is a development build. Session-timeout checks for WCAG 2.2.1 are deferred to this ADR. | E2E sign-in path, guard, reset, rate limits |
| ADR 0006, Angular baseline (PR #18, #5) | Hybrid rendering: Convex-backed public routes use `RenderMode.Server`, static pages use `RenderMode.Prerender`, and signed-in routes use `RenderMode.Client`. **Server renders are anonymous** and never call `setAuth`. The adapter exposes `provideConvexAuth(source: ConvexAuthSource)` with `fetchToken`, `signedIn: Signal<boolean>`, and an optional `onChange`. The browser client calls `setAuth` on creation and `clearAuth()` when `signedIn` goes from true to false. `CONVEX_URL` reaches both bundles through a build-time `define` set by `scripts/ng-convex.mjs`. | Angular wiring, SSR coexistence, URL configuration |
| ADR 0004, test runners (PR #19, #3) | `convex-test` 0.0.60 on `vitest` 5.0.3, with the `edge-runtime` environment and a root `vitest.config.mts`. `t.withIdentity({...})` fakes the caller, and `tokenIdentifier` is `${issuer}\|${subject}`. ADR 0004 left "how real identities map to users" to this ADR. | Identity key, Convex tests |
| ADR 0003, npm and Node (PR #21, #1) | npm 11 on Node 26.11, `strict-allow-scripts=true` with an `allowScripts` map, `min-release-age=1`. | Install-script check, `overrides` entry |
| #9, hosting (open issue), and owner answer 6 | Each PR gets a preview with its own Convex preview deployment, built by `npx convex deploy --preview-create`. The web app uses the host's default domain until the first production release. A project domain is bought before that release, for verification and password-reset email. No host is chosen yet, so preview hostnames are unknown. | Callback URLs, allowed origins, email sender domain |

## Options

#7 listed six candidates. Two are compared in full below. The other four are ruled out, each against a numbered owner answer.

### Ruled out

| Candidate | Reason (owner answer) |
| --- | --- |
| **Clerk** (`@clerk/clerk-js` 6.38.1, MIT; Hobby plan free to 50,000 monthly retained users) | **Answer 4.** Clerk's Playwright helpers need `CLERK_SECRET_KEY` to mint testing tokens through the Backend API ([Clerk testing docs](https://clerk.com/docs/guides/development/testing/playwright/overview)). Seeding a user also needs the Backend API, and every e2e sign-in runs against Clerk's cloud instead of the local backend. |
| **WorkOS AuthKit** (`@workos-inc/authkit-js` 0.20.4, MIT; free to 1M MAU) | **Answer 4.** Sign-in happens on WorkOS-hosted AuthKit pages. Creating or signing in a test user without the hosted UI needs the WorkOS API key. |
| **Auth0** (`@auth0/auth0-spa-js` 2.28.2, MIT; Free plan to 25,000 MAU) | **Answer 4.** Sign-in runs on Auth0's hosted Universal Login, and seeding users needs a Management API client secret. |
| **Custom OIDC/JWT provider** | **Answer 1.** Password hashing, breached-password checks, attempt throttling, Google OAuth, sessions, and key rotation would all be written and security-reviewed in this repository. The two libraries below already provide these, and a custom provider gains nothing on any other answer. |

The three hosted services also send verification and reset email themselves, and would cost $0 at both 1,000 and 10,000 MAU. They fail only answer 4. If the owner relaxes answer 4 (for example, by allowing a CI secret and accepting that fork PRs skip e2e sign-in), Clerk becomes the hosted candidate to compare.

### Option A: Convex Auth (`@convex-dev/auth`)

- **What it is:** Convex's own auth library. It runs inside the Convex deployment (tables in the app schema, HTTP actions for OAuth) and issues RS256 JWTs signed with a key held in the deployment's environment. It is built on Auth.js provider definitions (`@auth/core`).
- **Version and licence:** `@convex-dev/auth` 0.0.96 (2026-09-30, Apache-2.0), peer `@auth/core` ^0.41.1 (0.41.3, ISC), `convex` ^1.17.0. No install scripts in its tree.
- **Status:** **beta.** Convex's docs say it "is currently a beta feature" and "may change in backward-incompatible ways" ([docs.convex.dev/auth](https://docs.convex.dev/auth)). The repository README says v1 is the current stable line and points to a WIP v2 rewrite on the `reboot` branch, published as `2.0.0-alpha.2` (2026-09-16). v1 depends on `lucia` 3 and `@oslojs/crypto`, both marked deprecated on npm.
- **Sign-in methods:** the `Password` provider and Google (`@auth/core/providers/google`).
- **Password handling (from source, `dist/providers/Password.js`, `lucia/dist/crypto.js`):**
  - Hashing uses `Scrypt` from the deprecated `lucia` package (N=2^14, r=16, p=1), which can be replaced through `crypto.hashSecret`.
  - The default policy is length 8 or more only. There is no breached-password check.
  - It allows **10 failed sign-ins per hour per account** (`signIn.maxFailedAttempsPerHour`).
  - Reset and verification run through an `Email` provider (codes), whose sender the project supplies.
- **Who sends the email:** the project, through a separate sender (verification and reset only).
- **Angular:** the v1 client is React-only (`@convex-dev/auth/react`, 376 lines in `dist/react/client.js`). An Angular port would have to handle token and refresh-token storage, refresh, the OAuth `?code=` exchange, and cross-tab sync. The v2 alpha adds a framework-agnostic `./browser` export, but that cannot be used while it is alpha.
- **Identity shape:** `sub` is `<userId>|<sessionId>` and `iss` is `CONVEX_SITE_URL` (`dist/server/implementation/tokens.js`). **`subject` and `tokenIdentifier` change on every new session**, so helpers must use the library's `getAuthUserId(ctx)`, which splits the user id from `sub`.
- **Account linking (`dist/server/implementation/users.js`):** an OAuth sign-in links only to an existing user whose email is **verified**. A password user whose email is unverified is not found, so a Google sign-in with the same address creates a **second user with the same email**. That is not a takeover, but it leaves duplicate accounts. Google's default profile does not map `email_verified`, so the project would also need a custom `profile()`.
- **Defaults (from source):** JWT 1 hour; session 30 days in total and 30 days inactive.
- **Pros:** first-party, with no component boundary; a per-account failure limit is built in; low function-call count (1-hour JWT).
- **Cons and risks:**
  - It is beta with a rewrite in progress, so adopting v1 now means a migration to v2 later.
  - Its hashing and dependencies are deprecated.
  - The project writes and maintains the Angular client.
  - Linking with unverified password accounts produces duplicates.

### Option B: Better Auth through the Convex component (`@convex-dev/better-auth`)

- **What it is:** Better Auth, a framework-agnostic TypeScript auth library, running inside Convex as a Convex component maintained by Convex (`get-convex/better-auth`).
  - Its tables (user, session, account, verification, jwks, rateLimit) live in the component.
  - Its routes are HTTP actions under `/api/auth/*` on the deployment's `.convex.site` URL.
  - The `convex` plugin issues RS256 JWTs for Convex. `convex/auth.config.ts` lists one `customJwt` provider whose issuer is `CONVEX_SITE_URL`.
  - Docs: [labs.convex.dev/better-auth](https://labs.convex.dev/better-auth).
- **Versions and licences:** `@convex-dev/better-auth` 0.12.5 (Apache-2.0, still the latest on 2026-10-07), with peer `better-auth >=1.6.11 <1.7.0`. `better-auth` is therefore pinned to **1.6.33** (2026-09-14, MIT, the `release-1.6` tag), although upstream `latest` is 1.7.7. All 30 packages in its tree are MIT, Apache-2.0, ISC, or `(MIT OR CC0-1.0)` (`type-fest`), and none has an install script.
- **Sign-in methods:** core `emailAndPassword` and Google (`socialProviders.google`). Email + password is Better Auth core, not a plugin. The component's [supported plugins](https://labs.convex.dev/better-auth/supported-plugins) page says "any Better Auth plugin may be used". The `haveIBeenPwned` plugin used below is not on the supported list. It adds no tables and only wraps the hash function, and it worked in the scratch run.
- **Who sends the email:** the project, through a separate sender. It is used only for verification and reset, which are deferred to the first production release (answer 6).
- **Password handling (from source, `better-auth` 1.6.33 and `@better-auth/utils` 0.4.2):**
  - **Hashing:** scrypt, N=2^14, r=16, p=1, 64-byte key, 16-byte random salt, NFKC-normalised input. Stored as `salt:key` in hex on the `credential` account row. The hash can be replaced through `emailAndPassword.password.{hash,verify}`.
  - **Runtime:** in the Convex V8 runtime, `process.versions.node` is absent, so the pure-JS `@noble/hashes` scrypt runs instead of `node:crypto`. **Measured on the local backend: about 100 ms per hash.**
  - **Policy:** 8 to 128 characters by default (`minPasswordLength`, `maxPasswordLength`), with no composition rules. A breached-password check is available through the `haveIBeenPwned` plugin.
  - **Throttling:** per-IP only. `/sign-in/*` and `/sign-up/*` allow 3 requests per 10 s per IP, through the same IP-dependent limiter as before. **There is no per-account lockout.**
  - **Enumeration:** sign-in for an unknown address hashes a dummy password and returns the same `401 INVALID_EMAIL_OR_PASSWORD`. Sign-up for an existing address returns `422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, unless `requireEmailVerification` or `autoSignIn: false` is set.
- **Angular:** `better-auth/client` is a framework-agnostic client (nanostores), so no React is needed. Because the app and `.convex.site` are different sites, the component's `crossDomain` client plugin keeps the session in `localStorage`. **Verified in the scratch app** (Test evidence).
- **Identity shape (observed on the local backend):**
  - Claims: `sub`, `iss`, `aud` (`convex`), `iat`, `exp`, `email`, `emailVerified`, `name`, `sessionId`, `createdAt`, `updatedAt`.
  - **`sub` is the Better Auth user id, stable across sessions.** `iss` is `CONVEX_SITE_URL`.
  - A password user's `emailVerified` is `false` until verification exists (answer 6).
- **Defaults (from source):**
  - Convex JWT: 15 minutes.
  - Session: 7 days, extended once a day while used (`updateAge`).
  - Per-IP rate limit: 100 requests per 10 s, plus the special rules above.
  - Rate limiting is on only when `NODE_ENV` is production unless it is set explicitly. Its default store is in-memory, which does not persist between Convex function runs, so the store must be set to `storage: "database"`.
- **Account linking (`dist/oauth2/link-account.mjs`):** an OAuth sign-in links to an existing user only if both of these hold:
  - the provider reports the email as verified (Google's `email_verified`);
  - the existing user's email is verified (`requireLocalEmailVerified`, default true).

  Otherwise the sign-in is **refused** with `account not linked`. It is neither merged nor duplicated. See "Identity key and account linking" for what users see.
- **Pros:**
  - One library covers both methods, with a framework-agnostic client.
  - `sub` is a stable user id.
  - Linking is refused on unverified email by default.
  - A breached-password plugin is available.
  - Account deletion is built in (`deleteUser`).
  - The component is maintained by Convex, and Better Auth itself is widely used and MIT.
- **Cons and risks:**
  - **The component lags upstream.** It is pinned below `better-auth` 1.7 and its last release was 2026-06-27. Security fixes reach 1.6.x only while upstream patches that line (the last 1.6 patch was 2026-09-14).
  - **Default scrypt cost is below OWASP's minimum** (see "Passwords"). It is raised with a project hash function.
  - **No per-account throttle.** The project adds one (see "Rate limits and lockout").
  - **Peer conflict with ADR 0004's Vitest 5.** `better-auth` 1.6.33 declares an optional peer `vitest ^2 || ^3 || ^4`, so `npm install` fails with `ERESOLVE` next to `vitest` 5.0.3. An npm `overrides` entry fixes it (`"better-auth": { "vitest": "$vitest" }`, verified). `better-auth` 1.7 accepts Vitest 5, so the override goes away once the component supports 1.7.
  - **HTTP actions on the local backend get no client IP.** Better Auth logged "Rate limiting could not determine a client IP and is falling back to a single shared per-path bucket". A community report on Convex cloud ([get-convex/better-auth#247](https://github.com/get-convex/better-auth/issues/247)) shows a `cf-connecting-ip` header reaching HTTP actions, but Convex does not document it. The database rate-limit store has open issues: [#432](https://github.com/get-convex/better-auth/issues/432) (write contention on a hot bucket returns 500), [#446](https://github.com/get-convex/better-auth/issues/446), and [#312](https://github.com/get-convex/better-auth/issues/312).
  - **The session token is in `localStorage`** (the `crossDomain` plugin), where any script injected through XSS can read it. Option A stores its refresh token the same way.
  - The `crossDomain` plugin sets `skipStateCookieCheck: true`. An OAuth flow is therefore bound to its state record in the database, but not to the browser that started it.
  - **The JWKS private key is encrypted with `BETTER_AUTH_SECRET`.** Changing the secret without clearing the `jwks` table makes every token request fail with HTTP 500 ("Failed to decrypt private key").

### Summary

| | A: Convex Auth | B: Better Auth component |
| --- | --- | --- |
| Status | Beta; v2 rewrite in alpha | Component 0.12.x, pinned to `better-auth` 1.6 |
| Email + password and Google | Yes | Yes |
| Default password hash | scrypt N=2^14 r=16 (deprecated `lucia`) | scrypt N=2^14 r=16; replaceable, raised here |
| Breached-password check | None built in | `haveIBeenPwned` plugin (k-anonymity, no key) |
| Per-account failure limit | 10 per hour, built in | None; project hook (verified) |
| Sends its own email | No | No |
| Angular client | Project ports the React client | `better-auth/client`, verified |
| Stable user id in `sub` | No (`user\|session`) | Yes |
| Google sign-in, same email as an unverified password account | Creates a duplicate user | Refused (`account not linked`) |
| Account deletion API | None; the project deletes its auth tables | `deleteUser`, verified |
| E2E with no secrets | Feasible, not run | **Run locally, passes** |
| Main risk | v1 to v2 migration | Lag behind upstream; per-IP limiting needs a client IP |

## Cost

Both libraries are free (Apache-2.0 / MIT, which permit commercial use). Their cost is the Convex usage they add, plus the email sender once verification and reset exist. Convex prices are from [convex.dev/pricing](https://www.convex.dev/pricing) on 2026-10-07:

- Free and Starter include 1M function calls, 1 GB of database I/O, 0.5 GB of storage, and 20 GB-hours of action compute per month.
- Starter overage is $2.20 per 1M calls and $0.22 per GB.

Whether the Convex plan's terms allow commercial use is #9's check, because the plan is shared with the app.

**Convex usage measured for Option B.** These are scratch-app counts on the local backend, logging nested `runQuery`/`runMutation` calls per HTTP request, with rate limiting on. Each count includes the HTTP action itself.

| Request | Function calls |
| --- | --- |
| Sign up (email + password) | 8 |
| Sign in (email + password), including the per-address throttle | 8 |
| Get session | 5 |
| Convex token | 5 to 6 |
| Sign out | 4 |

**Usage assumptions per MAU per month:**

- 10 app visits, each with one session check, one token fetch, and one 15-minute token refresh: about 170 calls.
- 1.5 password sign-ins: about 12 calls. (Email-code sign-in took about 26.)
- That totals about 180 calls. The estimate stays at **250 calls per MAU** for headroom.

Other usage:

- **DB I/O:** estimated at 2 KB per call (session, user, rate-limit row, and JWKS on token calls). It was not measured.
- **Storage:** under 0.05 GB at 10,000 users.
- **Password hashing:** it runs inside the HTTP action. At about 0.4 s and at most 64 MB per sign-in or sign-up, 10,000 MAU use under 0.5 GB-hours of the 20 included.
- **Client setting:** the Angular client sets `sessionOptions.refetchOnWindowFocus: false`, because by default every tab focus fetches the session.
- **Option A** was not measured. Its 1-hour JWT means fewer refreshes, so it is estimated at 150 calls per MAU.

**Email: none until the first production release.** Sign-in sends no email. Verification and reset are deferred (answer 6), and dev and preview need no sender. From the first production release, email covers verification and password reset only:

- **Volume assumption: 0.5 emails per MAU per month.** That allows one verification email per new password account (up to about 30% of MAU in a registration-heavy month, with Google users needing none) and resets for about 10% to 20% of users.
- **Reference price:** Resend ([resend.com/pricing](https://resend.com/pricing)). Free gives 3,000 emails/month **and at most 100/day**; Pro costs $20/month for 50,000.
- #26 chooses the actual sender.

| Monthly cost | 1,000 MAU | 10,000 MAU |
| --- | --- | --- |
| **B: Better Auth.** Convex usage | 0.25M calls and about 0.5 GB I/O, within the included amounts: **$0**. That is a quarter of the included calls and half the included I/O, which the app also uses. | 2.5M calls and about 5 GB I/O: **about $4.20** on Starter ($3.30 calls + $0.88 I/O), **up to $6.60** if the app alone already uses the included amounts |
| **B.** Email, before the first production release | **$0** (none sent) | **$0** (none sent) |
| **B.** Email, from the first production release (500 / 5,000 emails) | **$0** (Resend Free, within 3,000/month; the 100/day cap allows about 100 new password accounts a day) | **$20** (Resend Pro; 5,000/month exceeds the free tier) |
| **B: total** | **$0** | **about $4 to $7** before release; **about $24 to $27** after |
| **A: Convex Auth.** Convex usage | 0.15M calls: **$0** | 1.5M calls: **about $1.10 to $3.30**, plus I/O |
| **A.** Email | Same as B | Same as B |
| **A: total** | **$0** | **about $2 to $4** before release; **about $22 to $24** after |

**Against the shared hosting-plus-Convex cap (about $25/month, #9):**

- At 1,000 MAU, auth adds $0. It does use part of the included Convex quota, which #9's estimate must count.
- At 10,000 MAU, auth adds about $4 to $7 of Convex usage to that cap.
- Email is a separate service outside the cap, and #26 decides it. At 0.5 emails per MAU, a 3,000/month free tier lasts to about 6,000 MAU, or until the first day with more than 100 new password accounts, whichever comes first.

## Recommendation

**Option B: Better Auth through the Convex component, with email + password and Google.**

- It is the only candidate whose whole e2e sign-in path ran locally with no secrets and no inbox.
- Its client works from Angular without a port, and its `sub` is a stable user id.
- It refuses to link Google to an unverified password account instead of creating a duplicate.
- It has a free breached-password check that needs no key.
- Its password hash and per-account throttle can be configured to the levels below, and both were verified.

Convex Auth would meet the same answers. It would mean porting a React client now and migrating it again when the v2 rewrite lands, and its default linking leaves duplicate accounts.

### Packages

| Package | Version | Type | Licence |
| --- | --- | --- | --- |
| `@convex-dev/better-auth` | 0.12.x | dependency | Apache-2.0 |
| `better-auth` | 1.6.x (pinned below 1.7 by the component's peer range) | dependency | MIT |
| `@noble/hashes` | 2.x (2.4.0 in the scratch run; already in `better-auth`'s tree, now imported directly for the scrypt settings) | dependency | MIT |

- `convex` is already accepted (ADR 0001).
- Transitive packages include `convex-helpers`, `jose`, `zod`, `kysely`, `nanostores`, `better-call`, `@noble/*`, and `@better-auth/*`. All have permissive licences and none has an install script, so ADR 0003's `allowScripts` map is unchanged.
- `package.json` gains `"overrides": { "better-auth": { "vitest": "$vitest" } }` until the component accepts `better-auth` 1.7.
- Moving to `better-auth` 1.7 or the component to 0.13 is a minor bump and needs no gate, but it must pass the e2e sign-in spec.

### Server configuration (summary for the sign-in feature)

- `convex/convex.config.ts` uses the component. `convex/auth.config.ts` contains **only** `getAuthConfigProvider()`.
- `convex/auth.ts` `createAuth(ctx)`:
  - `baseURL: CONVEX_SITE_URL`.
  - `trustedOrigins`: `SITE_URL`, plus on previews the request's `Origin` if it matches `PREVIEW_ORIGIN_PATTERN` (see Deployments).
  - `session: { expiresIn: 7 days, updateAge: 1 day }`.
  - `emailAndPassword: { enabled: true, minPasswordLength: 15, maxPasswordLength: 128, requireEmailVerification: false, password: { hash, verify } }`. `hash` and `verify` come from `convex/lib/password.ts` (see Passwords). `requireEmailVerification` turns on with #26 (see "Deferred until #26").
  - `account.accountLinking: { enabled: true, trustedProviders: [] }`. Google is **not** a trusted provider, so linking needs both emails verified.
  - `user.deleteUser.enabled: true`.
  - `rateLimit: { enabled: !IS_TEST, storage: "database" }`.
  - `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]` (to be verified; see "Rate limits and lockout").
  - `hooks.before` and `hooks.after` on `/sign-in/email`: the per-address throttle.
  - `socialProviders.google`, only when `GOOGLE_CLIENT_ID` is set.
  - Plugins: `haveIBeenPwned({ enabled: !IS_TEST })`, `crossDomain({ siteUrl })`, and `convex({ authConfig })`. No `emailOTP` plugin.
- `convex/http.ts`: `authComponent.registerRoutes(http, createAuth, { cors: true })`.

### Passwords

- **Hashing: scrypt N=2^15, r=8, p=3 (32 MiB),** one of the settings in [OWASP's Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). It is implemented in `convex/lib/password.ts` with `@noble/hashes`.
  - **Format:** the hash is stored as `scrypt$15$8$3$<salt>$<key>` (16-byte random salt, 32-byte key, NFKC-normalised input), so the parameters can be raised later without breaking stored hashes.
  - **Comparison:** keys are compared in constant time.
  - **Why not the default:** Better Auth's default (N=2^14, r=16, p=1) does about a quarter of the work OWASP's settings do.
  - **Why not stronger:** OWASP's 64 MiB and 128 MiB settings **run out of memory** in the Convex V8 runtime (64 MB limit, [Convex limits](https://docs.convex.dev/production/state/limits)), verified. The 32 MiB setting is the strongest one that fits.
  - **Measured:** about 385 ms per hash on the local backend, against about 100 ms for the default. A full sign-in request takes about 0.5 s.
  - **Alternatives rejected for launch:** argon2id and native scrypt need the Node runtime. HTTP actions cannot run there, so every hash would need an extra action call.
  - **Check for the sign-in feature:** it measures sign-in on a cloud dev deployment. If a request takes over 1.5 s there, the feature drops to N=2^14, r=8, p=5 (16 MiB, also on OWASP's list) and records the timing.
- **Policy** ([NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html), section on password verifiers):
  - **Minimum 15 characters.** NIST requires 15 when a password is the only factor, as it is here. It allows 8 only when the password is part of multi-factor authentication. Better Auth's default is 8.
  - **Maximum 128 characters.** NIST asks for at least 64.
  - **No composition rules.** NIST forbids them.
  - Paste and password managers are allowed: `autocomplete="email"`, `new-password`, and `current-password`. This also meets WCAG 2.2 3.3.8.
  - The sign-up screen says "at least 15 characters; a phrase of several words works".
- **Breached-password check:** the `haveIBeenPwned` plugin checks new passwords on sign-up, change, and reset against the [Pwned Passwords range API](https://haveibeenpwned.com/API/v3).
  - **Privacy:** it sends only the first 5 hex characters of the password's SHA-1 (k-anonymity) and uses `Add-Padding`.
  - **Terms:** the API is free, needs no API key, has no rate limit, and has "no licencing or attribution requirements".
  - **Measured:** `passwordpassword` (16 characters) returned `400 PASSWORD_COMPROMISED`.
  - **Failure mode:** it fails closed. If the API is unreachable, sign-up returns "Failed to check password. Please try again later." Existing users can still sign in, because only new passwords are checked.
  - **E2E:** disabled under `IS_TEST`, so e2e makes no outside network calls. A unit test with a mocked `fetch` covers it instead.
- **Changing a password** (signed-in settings, a later slice): `changePassword` requires the current password and is called with `revokeOtherSessions: true`. A Google-only user can add a password through the server-only `setPassword` API from a signed-in screen.

### Identity key and account linking

- **Helpers in `convex/lib/` key users on `identity.subject`** (the Better Auth user id), stored as `users.authUserId` with an index.
- **Why not `tokenIdentifier`:**
  - It is `${CONVEX_SITE_URL}|${subject}`. The issuer part is the deployment's HTTP-action URL. That URL changes if production later moves HTTP actions to a custom domain, and every stored key would then stop matching.
  - `auth.config.ts` has exactly one provider, so `subject` alone cannot collide across issuers.
  - If a second issuer is ever added, that ADR migrates the key to `tokenIdentifier`.
- **App user record:** created on the first sign-up through the component's user triggers (`triggers.user.onCreate`) and deleted through `onDelete`. The sign-in feature verifies that a trigger failure also fails the sign-up. Functions read the app's own `users` table by index and do not call the component on each request.
- **Email verification state:** password users have `emailVerified: false` until verification email exists (#26). Google users get Google's `email_verified` (true for Google accounts).
- **Exact behaviour when one address uses both methods:**

| Case | What happens | What the user sees |
| --- | --- | --- |
| Google sign-in; a **verified** account with that email exists (created by Google, or a password account after verification) | Linked to that account | Signed in |
| Google sign-in; an **unverified password account** with that email exists (**every password account before #26**) | **Refused** (`account not linked`). No link, no new account. Better Auth redirects to the error URL with `error=account_not_linked` | The sign-in page reads: "This email already has a password account. Sign in with your password." Google stays unusable for that address until the email is verified (after #26). |
| Password sign-up; an account with that email exists (Google or password) | `422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` | "An account with this email already exists. Sign in instead, or use Google if you signed up with Google." |
| Password sign-in for a Google-only account | `401 INVALID_EMAIL_OR_PASSWORD` (dummy hash, same timing) | The generic "Email or password is incorrect" message, with a hint that the address may use Google |
| Google sign-in for a new email | New account, email verified | Signed in |

No account is ever linked on an unverified email, so no account takeover through linking is possible.

**The consequence until #26: address squatting.** Anyone can create a password account for an address they do not own. The squatter gets nothing of the real owner's. It does block the real owner from using that address, both for password sign-up and for Google, until the squatted account is removed. Before #26 only dev and preview exist, with no real users, so this is accepted there. "Deferred until #26" lists the production fix.

### Tokens, sessions, rate limits, redirects

- **Convex JWT:** 15 minutes (component default), fetched from `/api/auth/convex/token`. The Convex client refetches before expiry through `fetchToken({ forceRefreshToken: true })`. Sign-out deletes the session at once. A JWT already issued stays valid for at most 15 minutes.
- **Session:** 7 days from last use, extended at most once a day while used (sliding). There is no absolute cap at launch. `freshAge` (1 day) means account deletion needs a session younger than a day, or the user signs in again.
- **WCAG 2.2.1 (Timing Adjustable), deferred here by ADR 0005:** the only time limit on a signed-in user is the 7-day idle expiry, which is beyond the criterion's 20-hour exception. No in-page timeout or warning is needed. The throttle delay below is a security limit, and the message states the wait. The sign-in feature's tester checks this under ADR 0005's manual 2.2.1 row.

### Rate limits and lockout

- **Per address (project code, no package; verified).**
  - **Mechanism:**
    - `hooks.before` on `/sign-in/email` reads a `signInFailures` row keyed on the normalised email.
    - `hooks.after` records the outcome: a `401` counts as a failure, and a success deletes the row.
  - **Schedule:** 5 failures are free. Then each further attempt waits 1 minute, doubling up to a 1-hour cap.
  - **While throttled:** the answer is `429 TOO_MANY_ATTEMPTS`, **even for the correct password**, so the throttle is not an oracle.
  - **Unknown addresses** get exactly the same responses, so the throttle reveals nothing about which addresses exist.
  - **Hard limit:** at **100 consecutive failures** (NIST SP 800-63B-4's ceiling), password sign-in for that address is disabled. Before #26 the owner clears it in the dashboard; after #26 a password reset clears it.
  - **Bound and trade-off:** this caps online guessing at about 35 tries per address on the first day and 24 a day after that, so the 100-failure limit is reached in about 4 days. An attacker can keep a victim's address throttled with about one attempt an hour. The victim sees "Too many attempts. Try again in N minutes" and can still use Google if it is linked. This trade-off is accepted instead of a hard lockout.
- **Per IP (Better Auth, `storage: "database"`):**
  - Limits: 3 requests per 10 s on `/sign-in/*` and `/sign-up/*`, and 100 per 10 s on all auth paths.
  - **Verified with a `cf-connecting-ip` header:** the fourth sign-in from one address got 429, and a different address was still allowed.
  - **This depends on a client IP reaching the HTTP action.** The first sign-in feature must log request headers on a cloud dev deployment and confirm that `cf-connecting-ip` carries the browser's address and cannot be set by the client.
  - If it does not, the per-IP limiter is turned off, because a single shared bucket would block every user after three sign-ins in 10 s. The per-address throttle stays.
- **Under `IS_TEST`:** the per-IP limiter is off, because local e2e has no client IP. The per-address throttle stays on, because it needs no IP. `convex-test` and unit tests cover the limiter configuration.

### Return-to-registration URL

- The sign-in route takes `returnTo` as a query parameter.
- `returnTo` is accepted only if all of these hold: it starts with `/`; it does not start with `//` or `/\`; and, when parsed against a placeholder origin, it keeps that origin. Anything else becomes `/`.
- For Google, `returnTo` is passed as a **relative** `callbackURL`. The `crossDomain` plugin resolves it against `SITE_URL`, and Better Auth's origin check rejects any other origin.
- The scratch e2e run shows `returnTo=//evil.example/steal` landing on `/`.

### Angular wiring (fits ADR 0006 with no adapter API change)

The `ConvexAuthSource` passed to `provideConvexAuth()` is a root service. This is abridged from the scratch app (`src/app/core/auth.ts`):

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
  signInWithPassword = (email: string, password: string) => this.client!.signIn.email({ email, password });
}
// app.config.ts: provideConvexAuth(...) with the AuthService instance
```

- **`fetchToken`, `signedIn`, and `onChange`** match ADR 0006's interface exactly. `onChange` is not needed.
- **Sign-out** calls `authClient.signOut()`. That deletes the session row and the stored cookie. The session store then emits no session, `signedIn` turns false, and the adapter's effect calls `clearAuth()`. Live queries rerun as anonymous (verified).
- **One addition outside the adapter API:** the client needs the deployment's HTTP-action URL. `scripts/ng-convex.mjs` (ADR 0006) also defines `__CONVEX_SITE_URL__`, derived from `CONVEX_URL`: `.convex.cloud` becomes `.convex.site` for cloud deployments, and port 3210 becomes 3211 for the local backend. Like `CONVEX_URL`, it is public.
- **Google redirect return:** after Google, the `crossDomain` plugin redirects to `SITE_URL + returnTo + ?ott=<one-time token>`. `AuthService` exchanges `ott` for a session on start-up and removes it from the URL, mirroring the component's React provider. This was **not exercised** in the scratch run, which had no Google client, so the Google slice verifies it on a dev deployment.

### Server-rendered public pages

- **No auth code runs during a server render.** `AUTH_CLIENT` is `null` on the server, `CONVEX_AUTH` is ignored there (ADR 0006), and public pages inject nothing from auth.
- **The SDK is in the server bundle.** `provideConvexAuth()` is registered in the shared `app.config.ts`, so the Better Auth client modules **are** in the server bundle. They **touch no browser globals at module evaluation**: the `crossDomain` client plugin checks `typeof window` only when the client is created. The scratch build prerendered `/` and server-rendered `/leagues/abc` in Node with no errors. The rule for features: the Better Auth client is created only in the `AUTH_CLIENT` factory.
- **Hand-off:**
  1. A public league page (`RenderMode.Server`, anonymous) links to `/sign-in?returnTo=/leagues/<slug>/register`.
  2. The sign-in route uses `RenderMode.Client`. A sign-up route works the same way.
  3. After a successful password sign-in or sign-up, the router navigates to the validated `returnTo`.
  4. If that target is a Server route, its personalised parts load after hydration (ADR 0006).

  The scratch e2e run covers this path end to end, and the raw server HTML of the public page contains no JWT.

### Deployments, callbacks, and secrets

The Google redirect URI for every deployment is `<CONVEX_SITE_URL>/api/auth/callback/google`. Google requires HTTPS except for loopback hosts, forbids wildcards, and requires the host's suffix to be on the Public Suffix List. `convex.site` is on that list ([Google redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server)).

Email + password needs **no email sender on any deployment** until #26.

| Deployment | Email + password | Verification and reset email | Google | Callback / allowed origins | Environment and secrets (where) |
| --- | --- | --- | --- | --- | --- |
| **Local e2e** (anonymous local backend, ADR 0005) | Yes | None | **No** (no Google variables set, button hidden) | `SITE_URL=http://localhost:4000`. No callback | Set by Playwright `globalSetup` with `npx convex env set`: `BETTER_AUTH_SECRET` (random, generated per run, never stored), `SITE_URL`, `IS_TEST=true`. **No stored secret**, so fork PRs work. |
| **Developer dev deployment** (`npx convex dev`, cloud, one per developer) | Yes | None until #26. After #26, as #26 decides (owner-only sandbox or none) | Optional: the owner adds `https://<dev-name>.convex.site/api/auth/callback/google` to a **non-production** Google OAuth client (consent screen in Testing mode, listed test users only) | `SITE_URL=http://localhost:4200` (or the local SSR port) | Set by the developer on their own dev deployment with `npx convex env set`: `BETTER_AUTH_SECRET`, `SITE_URL`, and optionally `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (dev client). No email key before #26. |
| **Per-PR preview** (#9, #15) | Yes | None until #26. After #26, as #26 decides | **No.** Every preview gets a new random `*.convex.site` callback that cannot be registered in advance, and wildcards are refused. A proxy through a fixed deployment (Better Auth's `oAuthProxy`) is rejected for launch: it is not on the component's supported list, and it shares an identity-asserting secret with previews. | `SITE_URL` cannot be set per preview through default env vars. `trustedOrigins` therefore also accepts a request `Origin` that matches `PREVIEW_ORIGIN_PATTERN`. That is the host's **project-specific** preview hostname pattern, fixed by #15 once #9 names the host (never a bare `*.<host-domain>`). | **Convex default preview environment variables** (dashboard, set once): `BETTER_AUTH_SECRET` (a preview-only value, never the production one), `SITE_URL`, `PREVIEW_ORIGIN_PATTERN`. **Not** `IS_TEST`, **not** Google, no email key before #26. |
| **Production** | Yes | **Required before the first production release**, through #26's sender on the project's verified sending domain | Yes. The owner registers `https://<prod-name>.convex.site/api/auth/callback/google` on the **production** Google OAuth client | `SITE_URL` is the production app URL: the host's default domain until the first release, then the custom domain | **Owner-held**, set by the owner in the production deployment's environment: `BETTER_AUTH_SECRET`, `SITE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and #26's email API key. The Angular host needs **no** auth secret, only the public `CONVEX_URL` and `CONVEX_SITE_URL` at build time. |

## Deferred until #26 (verification and password reset)

**What waits for #26.** These are a release-blocking feature slice, `Blocked by: #26` and #7:

- **Verification email:** `emailVerification: { sendVerificationEmail, sendOnSignUp: true }` and `emailAndPassword.requireEmailVerification: true`.
  - Unverified password accounts can then no longer sign in. Better Auth returns `403 EMAIL_NOT_VERIFIED`, and the screen offers to resend the email.
  - Sign-up for an existing address then gets Better Auth's generic response instead of `422`, which closes the sign-up enumeration above.
- **Password reset:** `emailAndPassword.sendResetPassword` and `revokeSessionsOnPasswordReset: true`. A reset also clears the per-address throttle's hard limit.
- **Squatted addresses:** a scheduled function deletes password accounts whose email is still unverified 7 days after sign-up. A squatted address is then freed for its real owner, including for Google sign-in.
- **Format choice:** links or codes. Better Auth sends a verification link to `CONVEX_SITE_URL/api/auth/verify-email`. The `emailOTP` plugin offers `email-verification` and `forget-password` codes instead. That slice chooses between them. A code avoids the "link opens in the mail app's browser" problem described in the earlier revision of this ADR.

**What users experience before then.** This applies to dev and preview only, because production is blocked:

- There is no "Forgot password?" link. `/request-password-reset` returns `400 RESET_PASSWORD_DISABLED`, and `/send-verification-email` returns `400 VERIFICATION_EMAIL_NOT_ENABLED` (both verified).
- **No self-serve reset:** a tester who forgets a password asks the owner to delete the account in the dev or preview dashboard, or signs up again with another address. E2E users are seeded fresh on every run.
- Emails stay unverified, so Google cannot link to a password account (see the linking table).
- No email is sent from any deployment, and no sender key exists anywhere.

**The first production release is blocked** until #26 is accepted and the verification and reset slice is merged. The production deploy request (`gate:production`) lists both as prerequisites.

## Testing

### E2E sign-in with no secrets and no inbox (answer 4)

- **Path:** the e2e test seeds a user, then signs in with **email + password through the real UI**. No email, code, or outbox is involved. **E2E covers the password path; Google sign-in is not exercised in e2e.**
- **Seeding:** `testing:seedLeague` is an `internalAction` behind the `IS_TEST` guard.
  - It calls Better Auth's own `auth.api.signUpEmail` with an email and a password that the test generates per run (random, never stored). That creates the user and a `credential` account with a real scrypt hash.
  - It then calls an internal mutation that writes the app's `users` row (keyed on the Better Auth id) and the tenant's leagues.
  - It is an action because the sign-up runs through the component's adapter (`ctx.runMutation`). ADR 0005's list of test-only function kinds gains `internalAction`.
- **Reset:** `testing:reset` (ADR 0005) also clears the component's tables, **including `jwks`**, and the `signInFailures` table. Otherwise a new per-run `BETTER_AUTH_SECRET` cannot decrypt the old key, and every token request returns HTTP 500.
- **Guard, and why the path cannot be used elsewhere:**
  - The only test-only piece is seeding. Sign-in itself is the production code path, so there is no test sign-in backdoor at all.
  - The seeding functions are internal, so no client can call them, and they throw unless `IS_TEST` is set.
  - `IS_TEST` is never set on dev, preview, or production deployments (ADR 0005). #15 adds a deploy step that fails if `npx convex env get IS_TEST` returns a value on a preview or production deployment.
  - `IS_TEST` also turns off the breached-password check and the per-IP limiter, so the #15 check protects those as well.
  - No test issuer is added to `auth.config.ts`, so no alternative token path exists.
- **Evidence (local runs, 2026-10-07; details in Test evidence):**
  - With `IS_TEST` set, Playwright signed the seeded user in with a password from the public page and returned to the registration route. A wrong password showed the generic message, and `returnTo=//evil.example/steal` landed on `/`: 3/3 passed, with no console errors.
  - With `IS_TEST` removed from the same deployment, `testing:seedLeague` failed with `testing functions are disabled: IS_TEST is not set`, and the e2e sign-in test failed at its seeding step.

### Convex function tests with faked identities (ADR 0004)

`withIdentity` fakes the claims that the real backend produced. The scratch run decoded a real token: `sub` is the Better Auth user id and `iss` is `CONVEX_SITE_URL`, plus `email`, `emailVerified`, `name`, and `sessionId`. Convex exposed it as `subject`, `issuer`, and `tokenIdentifier` (`http://127.0.0.1:3211|<id>`), with the other claims as custom fields.

```ts
const asUser = (authUserId: string, email: string, emailVerified = false) => ({
  subject: authUserId, issuer: "http://127.0.0.1:3211", email, emailVerified, name: email, sessionId: "s1",
});
await t.withIdentity(asUser("auth-alice", "alice@example.test")).query(api.leagues.getForMember, { leagueId: leagueA }); // seeded member: ok
await expect(t.query(api.leagues.getForMember, { leagueId: leagueA })).rejects.toThrow(/UNAUTHENTICATED/);           // unauthenticated
await expect(t.withIdentity(asUser("auth-bob", "bob@example.test"))                                                  // other league
  .query(api.leagues.getForMember, { leagueId: leagueA })).rejects.toThrow(/FORBIDDEN/);
```

- Seeding inserts `users` rows with `authUserId` equal to the faked `subject`.
- A fourth test asserts that the faked identity's `subject`, `issuer`, `tokenIdentifier` format, `email`, and `emailVerified` match the real token's shape.
- Password users carry `emailVerified: false` until #26, so tests fake both values wherever a function's behaviour depends on it.
- The suite passed 4/4 on `convex-test` 0.0.60 and `vitest` 5.0.3.
- Functions that call the component directly (for example `authComponent.getAuthUser`) would need the component registered in `convex-test` (`@convex-dev/better-auth/test`). The helper design above avoids that.

## Data, ages, and deletion

| | A: Convex Auth | B: Better Auth component |
| --- | --- | --- |
| Where identity data is stored | The project's Convex deployment (app-schema tables), including password hashes | The project's Convex deployment (component tables), including password hashes on the `account` row |
| Region | The deployment's region: US East (N. Virginia) or EU West (Ireland), chosen when the deployment is created and not changeable afterwards ([Convex regions](https://docs.convex.dev/production/regions)). #9 picks it. #26 covers the email sender's region. Google holds the Google account. | Same |
| Deleting an account at the provider | No API. A project mutation deletes the user's `authAccounts`, `authSessions`, `authRefreshTokens`, and `authVerificationCodes` rows and the user. | `deleteUser`: from the client it needs a session younger than `freshAge` (or the current password); on the server it is `auth.api.deleteUser`. Verified: afterwards the user row and its sessions were gone. |
| Deleting in Convex app data | Same mutation | The component's `onDelete` user trigger deletes or anonymises the app's `users` row and dependent records (feature work). Convex backups keep data until they rotate out. The user revokes Google access in their Google account. The app stores no Google refresh token beyond the deleted account row. |

**Ages:** accounts are **adults only** at launch.

- Minors are roster entries (for example a `players` record with a `guardianUserId`) managed by a guardian or organizer. They never have an auth identity, so the auth design does not change when guardian-managed profiles arrive.
- Neither library has terms on user age.
- Google accounts are open to users from 13 (older in some countries), so Google sign-in does not prove adulthood.
- The adults-only rule is a product rule, enforced by the sign-up and registration flow (for example an 18+ confirmation), not by the provider.

## Transactional email: a separate decision is needed

**Yes, but it blocks the first production release, not sign-in features.** Option B, like every library option, sends no email. Sign-in at launch is email + password and Google, and neither sends email. Verification and reset are needed before the first production release (answer 6). #26 (`decision: transactional email`, `gate:technology`) covers:

- **The sender** (for example Resend, Postmark, or Amazon SES) and how Convex calls it: plain `fetch` from an action, or a Convex component such as `@convex-dev/resend` 0.2.8 (Apache-2.0), which has retries and status webhooks.
  - Better Auth runs `sendVerificationEmail` and `sendResetPassword` as background tasks. The HTTP response therefore reports success even when the send throws, so failures surface only in logs.
  - #26 states how failures are noticed.
- **A sending domain the project controls, with SPF, DKIM, and DMARC records.** It is bought before the first production release (answer 6). Neither the host's default domain nor `*.convex.site` can carry the project's DNS records.
- **Dev and preview before that domain exists:** no sending at all, or an owner-only sandbox. For example, Resend's `resend.dev` sender returns 403 for any other recipient ([Resend docs](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)). Any approach that exposes a verification or reset token outside email needs a guard as strict as `IS_TEST`.
- **Free-tier fit:** at 0.5 emails per MAU, 1,000 MAU is about 500 emails a month and 10,000 MAU is about 5,000. A 100/day cap limits a busy registration day to about 100 new password accounts.
- **Email template visuals.** They are user-visible, so `gate:ui-design` applies to them. Later product notifications beyond sign-in are also out of this ADR's scope.

Sign-in feature issues carry `Blocked by: #7` only. The verification and reset slice carries `Blocked by: #26` and blocks the first production release.

## Consequences

- **New dependencies:** `@convex-dev/better-auth` 0.12.x, `better-auth` 1.6.x, and `@noble/hashes` 2.x (already transitive), plus one `overrides` entry. None has an install script, so ADR 0003's `allowScripts` map is unchanged. No paid service before the first production release.
- **External call:** the Pwned Passwords API (`api.pwnedpasswords.com`) is called from Convex on sign-up and on password change. It is free, keyless, and sends only a 5-character hash prefix.
- **No prebuilt or hosted sign-in UI.** Better Auth is headless.
  - The sign-in and sign-up screens are built in Angular with the #6 components and design tokens, and they go through **`gate:ui-design`** in the sign-in feature issue. That includes the password rules text, error states (wrong password, throttled, breached password, existing account, `account not linked`), and the show-password control.
  - The one hosted screen is **Google's account chooser and consent page**, which cannot be styled. It shows the app name from the Google consent configuration, and the redirect domain `<prod-name>.convex.site` until production moves HTTP actions to a custom domain.
  - Convex custom domains need the Convex Pro plan ($25 per developer per month), which is beyond the #9 budget at launch. The other route is a host-level rewrite of `/api/auth/*`, which would be #9's decision or a later ADR's.
- **Sign-in feature slices:**
  1. **Email + password sign-up and sign-in (first slice).**
     - The server configuration above, `convex/lib/password.ts` with its timing check on a cloud dev deployment, and the `haveIBeenPwned` plugin.
     - The per-address throttle and its 100-failure limit.
     - `AuthService` and `AUTH_CLIENT`; sign-in and sign-up routes as `RenderMode.Client`; `returnTo` validation with tests.
     - The `user.onCreate` and `onDelete` triggers.
     - Verifying the client-IP header on a cloud dev deployment.
     - The e2e seeding (`internalAction`) and reset additions.
     - `Blocked by: #7`.
  2. **Google.** After the owner creates the dev and production Google OAuth clients. Includes the `account not linked` message. `Blocked by: #7`.
  3. **Email verification and password reset**, with the unverified-account cleanup (see "Deferred until #26"). `Blocked by: #26`. It blocks the first production release.
- **`convex/` code is type-checked by the Angular app's compiler** through `convex/_generated/api.d.ts`. The app's `noPropertyAccessFromIndexSignature` therefore applies to it, and `process.env["NAME"]` must use bracket access. Under TypeScript 6, `convex/tsconfig.json` needs `"types": ["node"]` for `process`. Both were found in the scratch build, and #10 and #11 apply them.
- **Secrets runbook:** changing `BETTER_AUTH_SECRET` on any deployment requires rotating the JWKS. Delete the `jwks` rows, and a new key is created on the next token request. The rotation signs everyone out, because existing session tokens are tied to the old secret. Password hashes do not depend on the secret. Production rotation is an owner step under `gate:production`.
- **Ongoing risk:** the component lags `better-auth` releases.
  - Upstream security fixes on 1.7 that are not back-ported to 1.6 would force waiting for the component, or a local install of the component's code.
  - The weekly dependency update (#8) surfaces component releases. Any `better-auth` advisory is checked against 1.6.x.
- **What would reverse this:**
  - The per-IP limiter cannot get a trustworthy client IP, and the per-address throttle proves insufficient.
  - The 32 MiB scrypt setting is too slow on Convex cloud, and the 16 MiB fallback is too.
  - The component stays pinned to an unpatched `better-auth` line.

  If any of these happens, revisit Convex Auth v2 once it leaves alpha (it then offers a framework-agnostic client), or a hosted provider if the owner relaxes answer 4.
- **Acceptance:** when the owner merges this PR, the status becomes `Accepted`.

## Test evidence

**Environment:** run on 2026-10-07 on macOS arm64 with Node 26.11.0 and npm 11.20.0, in a scratch directory outside the repository.

**Versions:** `@angular/core` 22.2.1 (CLI 22.2.2, `ng new web --ssr`), `convex` 1.46.0, `@convex-dev/better-auth` 0.12.5, `better-auth` 1.6.33, `@noble/hashes` 2.4.0, `convex-test` 0.0.60, `vitest` 5.0.3, `@playwright/test` 1.64.0 (Chromium headless shell), local backend `precompiled-2026-10-06-a3538c6`.

**History:** the first revision of this ADR ran the same scratch app with email codes. This revision changed it to email + password and re-ran the steps that depend on the sign-in method.

1. **Install:** `npm install @convex-dev/better-auth@0.12.5 better-auth@1.6.33` next to the CLI's `vitest` 5 failed with `ERESOLVE` (`peerOptional vitest@"^2.0.0 || ^3.0.0 || ^4.0.0" from better-auth@1.6.33`). With the `overrides` entry it installed, and `npm ls` showed a single `vitest@5.0.3`. The lockfile marks `hasInstallScript` only on `esbuild`, which ADR 0003 already lists.
2. **Anonymous local backend, no login:** `CONVEX_AGENT_MODE=anonymous npx convex dev` ran with an empty `HOME` and stdin from `/dev/null`. It printed `[Local] Port 3210 • No Convex account`, installed the `betterAuth` component, and pushed the functions.
3. **Password hashing in the Convex V8 runtime** (internal action; times are per call, three calls each):
   - Better Auth's default `hashPassword`: about 95 to 110 ms. The hash had the shape `<32 hex>:<128 hex>`, and `process.versions.node` was undefined.
   - `@noble/hashes` `scryptAsync` at N=2^15, r=8, p=3: 383 to 386 ms.
   - N=2^16, r=8, p=2 and N=2^17, r=8, p=1: both `JavaScript execution ran out of memory (maximum memory usage: 64MB)`.
   - With `convex/lib/password.ts` wired in, the stored hash had the shape `scrypt$15$8$3$<32 hex>$<64 hex>`. Sign-in with the right password took 495 ms, sign-in with an unknown address 442 ms, and sign-up 500 ms.
4. **Policy, over HTTP:**
   - 14 characters: `400 PASSWORD_TOO_SHORT`.
   - 129 characters: `400 PASSWORD_TOO_LONG`.
   - `passwordpassword`: `400 PASSWORD_COMPROMISED`, with the Pwned Passwords API called from the local backend.
   - A random 24-character password: `200`.
   - The same email again: `422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`.
   - `/request-password-reset`: `400 RESET_PASSWORD_DISABLED`.
   - `/send-verification-email`: `400 VERIFICATION_EMAIL_NOT_ENABLED`.
5. **Per-address throttle:**
   - Known address: wrong passwords 1 to 5 returned `401 INVALID_EMAIL_OR_PASSWORD`. The 6th wrong password, and then the **correct** password, returned `429 TOO_MANY_ATTEMPTS`.
   - Unknown address: the identical sequence (401 ×5, then 429).
6. **Per-IP limiter** (enabled for this check, with `cf-connecting-ip` set): from `203.0.113.1`, sign-ins 1 to 3 returned 401 and the 4th returned 429. From `203.0.113.2`, the next sign-in returned 401.
7. **Rejection without `IS_TEST`:** `testing:seedLeague` failed with `testing functions are disabled: IS_TEST is not set`, and the Playwright sign-in test failed at its seeding step.
8. **Scratch `ng new --ssr` app:**
   - Wiring: the ADR 0006 surface (`CONVEX_CLIENT` browser-only, `CONVEX_AUTH`, `provideConvexAuth`), with `AuthService` as the `ConvexAuthSource`.
   - Routes: `''` Prerender, `leagues/:id` Server, `sign-in` and `leagues/:id/register` Client.
   - Build: `ng build` (development configuration) printed `Prerendered 1 static route.`. The production configuration was built in the first revision, and the sign-in method does not affect it.
   - Server: `node dist/web/server/server.mjs` returned 200 for `/leagues/abc`.
9. **Playwright against that server and the local backend** (development build, so hydration checks were active), 3/3 passed. This was run before and after the scrypt change.
   - (a) The raw server HTML was checked (no JWT). Then: public page → Register → sign-in with `returnTo` → email + seeded password → back on the registration route showing "signed in as \<seeded email\>" → sign-out shows "anonymous". No console errors.
   - (b) A wrong password showed "Invalid email or password" and stayed on `/sign-in`.
   - (c) `returnTo=//evil.example/steal` ended on `/`.
10. **Function calls** (Cost section): an instrumented `ctx` logged nested calls per request. Sign-in made 7 nested calls (8 with the HTTP action), and so did sign-up.
11. **`convex-test`:** 4/4 passed (Testing section).
12. **From the first revision, unchanged by the sign-in method:**
    - Token TTL is 900 s with `aud` `convex`.
    - `ConvexHttpClient` with that token: the user's own league returned data, the other league threw `FORBIDDEN`, and no token threw `UNAUTHENTICATED`.
    - After sign-out, the token endpoint returned 401.
    - `deleteUser` removed the user and its sessions.
    - Regenerating `BETTER_AUTH_SECRET` without clearing `jwks` made `/api/auth/convex/token` return 500 (`Failed to decrypt private key`). Clearing `jwks` fixed it.
13. **Not run:** Google sign-in and the `account not linked` refusal, because there was no Google OAuth client. The behaviour is taken from `dist/oauth2/link-account.mjs` in `better-auth` 1.6.33, and the Google slice verifies it on a dev deployment.

## Sources

- **Convex:** [Authentication overview](https://docs.convex.dev/auth), [Convex Auth (labs)](https://labs.convex.dev/auth), [Better Auth component](https://labs.convex.dev/better-auth), [React framework guide](https://labs.convex.dev/better-auth/framework-guides/react), [supported plugins](https://labs.convex.dev/better-auth/supported-plugins), [local install](https://labs.convex.dev/better-auth/features/local-install), [limits](https://docs.convex.dev/production/state/limits), [pricing](https://www.convex.dev/pricing), [regions](https://docs.convex.dev/production/regions), [custom domains](https://docs.convex.dev/production/custom-domains).
- **Better Auth:** [email and password](https://www.better-auth.com/docs/authentication/email-password), [OAuth proxy plugin](https://www.better-auth.com/docs/plugins/oauth-proxy).
  - Source of `better-auth` 1.6.33: `dist/context/create-context.mjs`, `dist/crypto/password.mjs`, `dist/api/routes/{sign-in,sign-up,password,update-user}.mjs`, `dist/api/rate-limiter/index.mjs`, `dist/api/dispatch.mjs`, `dist/plugins/haveibeenpwned/index.mjs`, `dist/oauth2/link-account.mjs`, `dist/auth/trusted-origins.mjs`, `dist/client/session-refresh.mjs`.
  - Source of `@better-auth/utils` 0.4.2: `dist/password.mjs`, `dist/password.node.mjs`.
  - Source of `@convex-dev/better-auth` 0.12.5: `dist/plugins/convex/index.js`, `dist/plugins/cross-domain/*`, `dist/client/create-client.js`, `dist/component/schema.js`.
- **Convex Auth:** source of `@convex-dev/auth` 0.0.96 (`dist/providers/Password.js`, `dist/server/implementation/{tokens,sessions,refreshTokens,rateLimit,redirects,signIn,users}.js`, `dist/react/client.js`), `lucia` 3 (`dist/crypto.js`), and the [repository README](https://github.com/get-convex/convex-auth).
- **Password guidance:** [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html), [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Have I Been Pwned API v3 (Pwned Passwords)](https://haveibeenpwned.com/API/v3).
- **GitHub issues:** [get-convex/better-auth#247](https://github.com/get-convex/better-auth/issues/247), [#312](https://github.com/get-convex/better-auth/issues/312), [#432](https://github.com/get-convex/better-auth/issues/432), [#446](https://github.com/get-convex/better-auth/issues/446).
- **Hosted providers:** [Clerk pricing](https://clerk.com/pricing), [Clerk testing](https://clerk.com/docs/guides/development/testing/overview), [Clerk Playwright](https://clerk.com/docs/guides/development/testing/playwright/overview), [WorkOS pricing](https://workos.com/pricing), [Auth0 pricing](https://auth0.com/pricing).
- **Google:** [OAuth 2.0 for web server apps, redirect URI validation](https://developers.google.com/identity/protocols/oauth2/web-server); [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat) (`convex.site`).
- **Email:** [Resend pricing](https://resend.com/pricing), [Resend 403 on resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).
- **npm registry** (versions, licences, peers, dist-tags, publish dates), checked 2026-10-07: `@convex-dev/auth`, `@auth/core`, `@convex-dev/better-auth`, `better-auth`, `@noble/hashes`, `@clerk/clerk-js`, `@workos-inc/authkit-js`, `@auth0/auth0-spa-js`, `@convex-dev/resend`, `convex`, `convex-test`.
