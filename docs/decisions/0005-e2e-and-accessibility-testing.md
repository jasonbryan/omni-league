# 0005: E2E and accessibility testing

- **Status:** Accepted 2026-10-08 (owner merged PR #17)
- **Gate:** `gate:technology`
- **Issue:** #4
- **Date:** 2026-10-07 (revised 2026-10-07 for ADR 0006 hybrid rendering)
- **Amended:** by ADR 0009 (PR #31, CI pipeline): CI run conditions, the `webkit-mobile` trigger, and the Convex backend cache. See "Amendment: CI usage (ADR 0009)" at the end. Where the sections above disagree with the amendment, the amendment applies.

## Context

Dev cycle Phase 5 has the tester run e2e tests, capture screenshots at mobile and desktop widths for comparison with the approved mockup, and run an automated accessibility check. `docs/conventions/angular.md` requires every screen to pass axe and to meet WCAG 2.2 AA, with layouts working from 360px wide. No e2e runner, accessibility checker, or e2e backend is accepted yet (ADR 0001 leaves test tooling open).

Constraints from #4 and the issues that depend on it:

- Runs headless on GitHub-hosted runners, and later against preview URLs (#15 sets `E2E_BASE_URL`).
- Convex pushes query results over a WebSocket; tests must wait on reactive data, never on fixed sleeps.
- CI has no secrets (#8), and fork PRs never get secrets. The e2e backend must start with no Convex account or deploy key.
- The repository is private. GitHub Free includes 2,000 Linux minutes and 500 MB of artifact storage per month for private repos ([GitHub billing docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions)), so per-run minutes matter.
- #13 (harness) is `status:ready` and already assumes 360px and 1280px viewports, `E2E_BASE_URL`, a console-error fixture, an axe helper, and a screenshot command. It starts no Convex backend; the first feature that reads live data in e2e wires the backend this ADR chooses.
- E2E sign-in is decided by the auth ADR (#7), not here.
- **Public pages are server-rendered (ADR 0006, PR #18).**
  - Public pages that read Convex data use `RenderMode.Server` and static pages use `RenderMode.Prerender`. `/app/**` uses `RenderMode.Client`.
  - Crawlers and link-preview bots read the raw server HTML without running JavaScript. Tests must therefore check that HTML directly, not only the hydrated page.
  - The app under test is a Node server (`node dist/<app>/server/server.mjs`), not static files.

### Assumptions about undecided issues

| Issue | Assumption made here | If the assumption is wrong |
| --- | --- | --- |
| #1 package manager, Node | Commands are written with `npx`; the equivalent runner (`pnpm exec`, `yarn`) applies. Node 24 or 26 LTS. Single root package with `e2e/` and `playwright.config.ts` at the repo root. | Playwright needs Node >= 20 (`engines` in `playwright@1.64.0`), so any LTS choice works. In a workspace, the config moves beside the Angular app; nothing else changes. |
| #5 Angular baseline (PR #18, ADR 0006) | **Hybrid rendering** with `outputMode: "server"`. The build emits `dist/<app>/browser/` and `dist/<app>/server/server.mjs`, and the `serve:ssr` script runs the server (default `PORT` 4000). The Convex URL is a build-time `define` set by `scripts/ng-convex.mjs` from `CONVEX_URL`. It reaches both bundles, so the server needs no Convex variable at runtime. With no URL, neither platform creates a client (#11). | If #5 went back to CSR only, `webServer` would serve `dist/<app>/browser/` statically and the raw-HTML and hydration checks below would be dropped. Nothing else changes. |
| #6 UI library, fonts | Unknown library. The axe tags and zero-violation rule apply unchanged. | A library with known axe false positives gets rule exclusions only per rule, with a comment and an issue link (see Recommendation). A hosted font CDN makes screenshots depend on network timing; self-hosted fonts avoid that. |
| #8 CI | GitHub-hosted `ubuntu-latest` (24.04) 2-core runners; e2e is its own job; actions limited to `actions/checkout`, `actions/setup-node`, `actions/cache`, `actions/upload-artifact` (plus the package-manager setup from #1). No third-party e2e action is needed. | Self-hosted runners would remove the minute cost but not change the tooling. |

## Options

### Decision 1: e2e runner and accessibility checker

Versions and licences verified on the npm registry on 2026-10-07.

#### Option A: Playwright + `@axe-core/playwright`

- `@playwright/test` 1.64.0, Apache-2.0 (released 2026-10-07; 1.63.0 is the previous minor). `@axe-core/playwright` 4.13.0, MPL-2.0, which depends on `axe-core` ~4.13.0 (MPL-2.0) and has peer `playwright-core >= 1.0.0`. Browser binaries (Chromium, WebKit, Firefox) are downloaded by `npx playwright install`, not npm. No paid tier is required; Microsoft's hosted Playwright service and Deque's axe DevTools Pro exist and are not used.
- Pros:
  - Chromium, WebKit, and Firefox from one API. WebKit is the closest headless proxy for iOS Safari, which matters for a phone-first product.
  - Web-first assertions (`await expect(locator).toHaveText(...)`) retry until a timeout, which fits Convex's pushed updates without sleeps. Several browser contexts in one test can show a mutation in one client reaching another live.
  - Built-in `webServer` (supports several servers, skipped when `E2E_BASE_URL` is set), projects per viewport, traces, full-page screenshots, and `toHaveScreenshot` if visual snapshots are adopted later. All of this is in one package.
  - `@vitest/browser-playwright` 5.0.3 (peer `playwright: *`) lets #3 use the same browser install if it picks Vitest browser mode.
  - axe integration is maintained by Deque in the axe-core-npm repo and is versioned with axe-core.
- Cons and risks:
  - Mobile emulation in Chromium is not real Safari, and WebKit on Linux is not iOS. Only real devices close this gap (accepted gap below).
  - Browser download adds about 0.5 to 1 minute per CI run. Playwright's CI guide advises against caching browsers because restoring the cache takes about as long ([playwright.dev/docs/ci](https://playwright.dev/docs/ci)).
  - MPL-2.0 for axe is file-level copyleft. It applies only if axe's own files are modified and distributed, which a devDependency used unmodified does not do.

#### Option B: Cypress + `cypress-axe`

- `cypress` 16.1.1, MIT; engines `node ^22 || ^24 || >=26`. `cypress-axe` 1.7.0, MIT, peer `cypress ^10 || … || ^15` and `axe-core ^3 || ^4`. Cypress Cloud (recording, parallelisation, flake analytics) is a paid service with a free tier; not required.
- Pros: mature runner with an interactive time-travel debugger; retrying assertions also handle live data.
- Cons and risks:
  - `cypress-axe` 1.7.0's peer range stops at Cypress 15, so the current Cypress 16 is outside its declared support. Its last release was 2025-08-29.
  - Runs inside the browser, with one origin per test and one browser tab. Two-client live-update tests are awkward.
  - WebKit support is experimental. Parallelism across machines is a Cypress Cloud feature.
  - A second browser-automation stack if #3 picks Vitest browser mode, whose providers are Playwright and WebdriverIO.
  - Binary download is about the same size as Playwright's Chromium, so the CI cost is similar.

#### Option C: WebdriverIO + `@axe-core/webdriverio`

- `webdriverio` and `@wdio/cli` 10.0.1, MIT. `@axe-core/webdriverio` 4.13.0, MPL-2.0, peer `webdriverio ^5 || … || ^9`. Cloud device grids (BrowserStack, Sauce Labs) are paid and optional.
- Pros: WebDriver BiDi standard protocol; can drive real mobile devices through Appium; also a Vitest browser provider.
- Cons and risks:
  - `@axe-core/webdriverio`'s peer range stops at WebdriverIO 9, so the current 10.0.1 is outside it.
  - More configuration (services, reporters, runner packages) for the same result. Screenshot comparison and traces need extra services.
  - Real-device testing, its main advantage, needs a paid grid that this project does not plan to use.

#### Option D: no e2e runner (manual testing only)

Rejected. It does not meet the angular.md rule that every user-facing acceptance criterion has an e2e test, or the automated axe check in Phase 5.

### Decision 2: the Convex backend for e2e tests

#### Option 1: local Convex backend started by the `convex` CLI (no account)

- The `convex` CLI (1.46.0, Apache-2.0, already accepted under ADR 0001) downloads the open-source backend binary from `github.com/get-convex/convex-backend/releases` and runs it as a subprocess of `npx convex dev`. The binary is licensed FSL-1.1-Apache-2.0 (permits use other than offering a competing product; becomes Apache-2.0 two years after each release). Cost: none.
- **No-secrets evidence.** From the CLI source (`dist/cjs/cli/configure.js` in `convex@1.46.0`): when stdin is not a TTY, or `CONVEX_AGENT_MODE=anonymous` is set, the CLI skips the login prompt and creates an "anonymous" local deployment. The system ran this with an empty `HOME` (no Convex login), `CI=true`, and stdin from `/dev/null`, on macOS arm64:
  - `npx convex dev --once` printed `[Local] Port 3210 • No Convex account`, downloaded backend `precompiled-2026-10-06-a3538c6`, pushed functions, and wrote `CONVEX_DEPLOYMENT=anonymous:…`, `CONVEX_URL=http://127.0.0.1:3210` to `.env.local`. It took 5 s including the download.
  - With `npx convex dev` running, `npx convex env set IS_TEST true`, `npx convex run` on an internal mutation (seed), a query, and an internal reset mutation all worked without credentials. Each `convex run` took about 1 s.
  - Not yet run on a GitHub-hosted Linux runner. A `x86_64-unknown-linux-gnu` binary exists (63.7 MB zip). The first issue that wires the backend proves it in CI with a run link (see Consequences).
- Pros: real Convex runtime (same validators, limits, auth checks, and WebSocket push as production); no secrets, so fork PRs work; data fully controlled; the same setup works on a contributor's machine.
- Cons and risks:
  - Local deployments are documented as beta ([docs.convex.dev/cli/local-deployments](https://docs.convex.dev/cli/local-deployments)), and anonymous mode logs "in beta, functionality may change". The pinning flags `--local-backend-version` and `--local-cloud-port` are hidden CLI options. A CLI upgrade could change them; e2e CI would fail visibly rather than silently.
  - Without a pinned version, the CLI asks `version.convex.dev` for the latest backend on every fresh start. Pinning avoids that drift and lets CI cache the binary.
  - Cache size: binary plus local dashboard was 164 MB under `~/.cache/convex` in the experiment.
  - No control over time, and scheduled functions and crons run for real ([docs.convex.dev/testing/convex-backend](https://docs.convex.dev/testing/convex-backend)). Time-dependent logic is tested with the Convex test library from #3, not e2e.

#### Option 2: Convex preview deployment

- A cloud deployment created by `npx convex deploy` with a preview deploy key (`CONVEX_DEPLOY_KEY`), seeded with `--preview-run`, cleaned up after 5 days on Free and Starter ([docs.convex.dev preview deployments](https://docs.convex.dev/production/hosting/preview-deployments)).
- Pros: matches the hosted runtime exactly; already planned for #15.
- Cons: needs a secret, which conflicts with #8 and is unavailable to fork PRs. Every PR run creates or reuses a cloud deployment. Resetting data between tests still needs test-only functions, and network latency slows runs. Rejected for PR e2e; it remains the target of #15's post-deploy smoke spec, which reads no seeded data.

#### Option 3: fake client through the #11 injection token

- The Angular e2e build would swap the real `ConvexClient` for an in-memory fake through the #11 injection token.
- Pros: no backend at all; fastest.
- Cons: e2e would test the fake, not Convex. Authorisation, validators, indexes, and real push behaviour would go unchecked end to end, though those are where multi-tenant bugs live. The swap needs a separate Angular build configuration (`fileReplacements` or a distinct `app.config` entry for an `e2e` configuration). Keeping it out of preview and production builds then needs a build-output check (for example, CI fails if the fake's marker string is in a `production` build). Rejected. The fake stays a unit-test tool (#11).

### Decision 3: screenshot comparison with mockups

#### Option X: manual comparison (tester looks at app and mockup screenshots side by side)

- No baselines to maintain. Fits Phase 5, which compares with the mockup, a static HTML page that can never pixel-match the app with real data.

#### Option Y: automated visual snapshots (`toHaveScreenshot`)

- Built into `@playwright/test`, so no extra package. Baselines are screenshots of the app, not the mockup, so the mockup comparison would stay manual anyway. Snapshots catch regressions on later PRs, but baselines depend on OS font rendering, so they must be generated in one fixed image (`mcr.microsoft.com/playwright:v1.64.0-noble`, Linux Chromium) and committed. Every intentional UI change then also needs a baseline update commit.

## Recommendation

**Runner and a11y: Option A, Playwright with `@axe-core/playwright`.** It is the only option whose axe integration declares support for the current runner major. It covers WebKit, handles multi-client live-update tests, and shares one browser install with Vitest browser mode if #3 uses it.

- **Coordination with #3 (ADR 0004):** if #3 adopts Vitest browser mode, its provider is `@vitest/browser-playwright` at the same `playwright` version as `@playwright/test`, so CI downloads browsers once. If #3 uses jsdom or happy-dom, there is no interaction.
- **Browsers and viewports run in CI:**

  | Project | Browser | Viewport | Runs on |
  | --- | --- | --- | --- |
  | `chromium-mobile` | Chromium (Playwright bundled) | 360 x 800, `isMobile`, `hasTouch`, `deviceScaleFactor: 1` | every PR and push to `main` |
  | `chromium-desktop` | Chromium | 1280 x 720, `deviceScaleFactor: 1` | every PR and push to `main` |
  | `webkit-mobile` | WebKit | 360 x 800, `isMobile`, `hasTouch` | push to `main` only (iOS Safari proxy, kept off PRs to save minutes); a failure opens a `type:bug` issue |

  Screenshots (tester command from #13) use the two Chromium projects. The 360 and 1280 widths match #13, and the designer's mockups use the same two widths.
- **axe rule tags enforced:** `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` (axe runs rules carrying any of these tags). A scan passes only with zero violations. axe `incomplete` results ("needs review", for example contrast over a background image) are attached to the test report, and the tester reviews them in the manual checklist. `best-practice` rules are not enforced. A rule may be disabled only per rule and per selector, with a code comment linking an issue.
- **Live data:** only web-first assertions and `expect.poll`. `page.waitForTimeout` is not allowed in specs (enforced in PR review; `eslint-plugin-playwright` is not adopted, so no extra package).
- **CI settings:** `workers: 1` in CI, following Playwright's CI guidance; it also keeps tests that share one local backend predictable. `retries: 1` in CI, with `trace: 'on-first-retry'`; a test that passes only on retry is reported in the PR and fixed, not ignored. Install with `npx playwright install --with-deps chromium` (plus `webkit` on `main`), no browser cache.

**E2E backend: Option 1, the local Convex backend through `npx convex dev` in anonymous mode.** This is the only option that runs the real backend with no secrets.

- **Start in CI (no secrets):**
  1. `actions/cache` restores `~/.cache/convex`, keyed on the pinned backend version (on a miss the CLI downloads it from GitHub releases, 63.7 MB).
  2. `CONVEX_AGENT_MODE=anonymous npx convex dev --once --local-backend-version <pinned> --local-cloud-port 3210` pushes functions and runs codegen.
  3. The Angular app is built in the e2e build configuration (below) with `CONVEX_URL=http://127.0.0.1:3210` (ADR 0006 wrapper: `node scripts/ng-convex.mjs build --configuration development`). Server renders then fetch from the local backend over HTTP, and browsers subscribe to it over WebSocket.
  4. Playwright `webServer` starts two servers. The first is `npx convex dev --tail-logs disable` with the same flags, ready when `http://127.0.0.1:3210/version` responds. The second is the Node SSR server (below). When `E2E_BASE_URL` is set, neither server starts (#13, #15).
  The pinned backend version lives in one place (an npm script or the Playwright config), and bumping it is a patch-level change with no gate. Locally, contributors run the same script. The e2e script always selects the anonymous local deployment and never targets a cloud dev deployment.
- **Seeding and reset:**
  - Test-only functions live in `convex/testing.ts` as internal functions (`internalMutation`, `internalQuery`, or `internalAction` where a function must call the auth component's HTTP-level API, as seeding a password user does), so no client can call them. Each one starts with a shared guard that throws unless `process.env.IS_TEST === "true"`. `IS_TEST` is set only on the local e2e deployment (`npx convex env set IS_TEST true` in Playwright `globalSetup`) and never on cloud dev, preview, or production. Feature crons skip work when `IS_TEST` is set.
  - `globalSetup`: run `testing:reset` (deletes every schema table's documents, cancels scheduled functions, deletes stored files, and, once auth lands, clears the auth component's tables as below) and `testing:seedBase` (sport configuration and other reference data) with `npx convex run`.
  - Per test: a Playwright fixture creates the test's own tenant (league, teams, users) with unique names through `npx convex run testing:seedLeague`, and tests assert only on their own tenant's data. Tenancy is the isolation boundary, so no full reset runs between tests (measured cost about 1 s per CLI call). This also exercises the cross-league authorisation rules in convex.md.
  - **Sign-in (ADR 0008, PR #25):** a seeded user signs in with **email + password** through the real UI.
    - **Seeding:** `testing:seedLeague` is an `internalAction` behind the same guard. It calls Better Auth's own sign-up (`auth.api.signUpEmail`) with the test's email and a password the fixture generates per run (random, never stored). That gives the user a real password hash and `credential` account. It then writes the app's `users` row, keyed on the Better Auth id, and the tenant.
    - **No email:** the test types the email and password into the sign-in form. No email, code, or outbox is involved, and no test-only sign-in path exists. Sign-in is the production code path, and only seeding is test-only.
    - **Environment:** `globalSetup` also sets `BETTER_AUTH_SECRET` (random, generated per run, never stored) and `SITE_URL` with `npx convex env set`. No stored secret is needed, so fork PRs work.
    - **Not covered:** Google sign-in is not exercised in e2e.
    - **Breached-password check:** off under `IS_TEST` (ADR 0008), so e2e makes no outside network call.
  - **`testing:reset` also clears the Better Auth component's tables, including `jwks`.** The component stores its JWT signing key in `jwks`, encrypted with `BETTER_AUTH_SECRET`. Each run generates a new secret, so a key left from an earlier run cannot be decrypted and every token request returns HTTP 500 (`Failed to decrypt private key`; reproduced in ADR 0008's scratch run). A new key is created on the next token request after the table is cleared. The component's tables are not in `convex/schema.ts`, so "every schema table" alone does not reach them; the reset deletes them through the component's adapter.
  - **Per-IP rate limiting is off under `IS_TEST`** (`rateLimit.enabled: !IS_TEST`, ADR 0008). The local backend gives HTTP actions no client IP, so Better Auth would fall back to one shared per-path bucket, and the fourth sign-in in 10 s from any test would return HTTP 429. Better Auth's per-IP limits are tested with `convex-test` and unit tests instead. The project's per-address sign-in throttle needs no IP and stays on in e2e; tests use their own addresses, so it does not interfere. `testing:reset` also clears its `signInFailures` table.
  - **`IS_TEST` must never reach a cloud deployment.** Besides the rule above, #15 adds a deploy step that fails if `npx convex env get IS_TEST` returns a value on a preview or production deployment.
- **Fake client:** not used in e2e (reasons under Option 3).

### Server-rendered pages (ADR 0006)

**App server: the Node SSR server, built in development mode.**

```ts
// playwright.config.ts (app entry; the Convex entry is unchanged)
webServer: {
  name: 'app',
  command: 'npm run serve:ssr',          // node dist/<app>/server/server.mjs
  url: 'http://localhost:4000/',         // a Prerender route; must not read Convex data
  env: { PORT: '4000', NG_ALLOWED_HOSTS: 'localhost,127.0.0.1' },
  reuseExistingServer: !process.env.CI,
  stdout: 'pipe',                        // server render errors appear in the job log
  gracefulShutdown: { signal: 'SIGTERM', timeout: 2_000 },
},
use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4000' },
```

- **The build happens before Playwright, not in `webServer.command`.** `webServer` starts an already-built `dist/` (the e2e script runs the build first), so a build failure shows as a build step, not a server-start timeout.
- **Readiness accepts HTTP 400.** Playwright treats the `url` as ready on "a 2xx, 3xx, 400, 401, 402, or 403 status code" ([playwright.dev/docs/test-webserver](https://playwright.dev/docs/test-webserver)). The SSR engine answers **400** to a `Host` that is not allowed. A missing or wrong `NG_ALLOWED_HOSTS` therefore does not fail at startup: every test fails with 400, and the server log (`stdout: 'pipe'`) names the rejected host. Tested in the scratch run below.
- **Why a development build.** Angular's hydration mismatch checks are dev-mode only. In `@angular/core` 22.2.1 the element and text node checks are written as `ngDevMode && validateMatchingNode(...)` (`fesm2022/_debug_node-chunk.mjs`). The sibling check (`validateSiblingNodeExists`) and the NG0505 and NG0506 warnings are also guarded by `ngDevMode`.
  - Scratch run: the same deliberate mismatch, a `<table><tr>` with no `<tbody>`, logged `ERROR RuntimeError: NG0500: During hydration Angular expected <tr> but found <tbody>` in a development build and **nothing** in a production build.
  - A fixture listening to a production build would therefore pass a page with a hydration mismatch.
  - The e2e build uses `--configuration development`, which keeps `outputMode: "server"`, prerendering, and the same server entry. It also enables dev-mode change-detection checks such as NG0100.
  - The shipped production build is still checked twice. #12's CI build job builds it, with budgets. #15 runs the smoke spec against each production preview.
- **Raw server HTML.** Every public-page spec (Server or Prerender route) checks the HTML that crawlers and link-preview bots see, without running JavaScript, as well as the hydrated page:
  - `request.get(url)` for the HTTP status (200, or 404 for an unknown slug through `RESPONSE_INIT`) and headers (`Cache-Control` with `s-maxage` on Server routes).
  - A JavaScript-disabled page (`test.use({ javaScriptEnabled: false })`) for DOM assertions on that same HTML: `toHaveTitle`, `meta[property="og:title"]`/`og:description`/`og:url` `content`, `link[rel="canonical"]`, and the key content (for example the league name and "registration open"). This uses Playwright locators, so no HTML parser package is needed. Tested below.
  - `/app/**` (Client routes) gets no raw-HTML assertions. Its server HTML is the empty shell by design.
- **Console fixture (extends #13's).** A test fails on any of the following:
  - any `pageerror`;
  - any `console` message of type `error`, which includes NG0500 to NG0504 (thrown during hydration and logged by Angular's `ErrorHandler` as `ERROR RuntimeError: NG05…`);
  - any `console` message of type `warning` matching `/\bNG05\d\d\b/`. NG0505 (no hydration data in the server response), NG0506 (app not stable within 10 s, so hydration never completes), and NG0508 are `console.warn`, not errors.
  - It ignores `log` and `info`, which in dev mode include "Angular is running in development mode." and the hydration stats line.
- **Hydration actually happened.** On public pages, the fixture also asserts that the dev-mode stats log `Angular hydrated <n> component(s)` appears. Without it, a page could silently fall back to a full client render, for example if `provideClientHydration()` were dropped from the server config.
- **What these checks cannot catch.** Angular does not compare text or control-flow branches during hydration.
  - In the scratch run, a binding that rendered `server text` on the server and `browser text` in the browser, and an `@if` that took a different branch on each platform, both hydrated with **no** error or warning, even in dev mode. Angular replaces the content after hydration.
  - These cases show up only as content that changes after load, which the raw-HTML assertions catch: the raw HTML must already contain the content the hydrated page shows.
  - A deliberate mismatch used to prove the fixture must therefore be **structural**, for example a `<table>` with `<tr>` and no `<tbody>` in a template, not a text difference.
- **Scratch evidence (2026-10-07).** The scratch app is `ng new --ssr` on CLI 22.2 (`@angular/*` 22.2.1, `@angular/ssr` 22.2.1), with `@playwright/test` 1.64.0 and Chromium headless shell, on Node 26.11.0. Playwright started `node dist/spike/server/server.mjs` through `webServer` with the configuration above. These checks passed:
  - the raw-HTML `request.get()` check (status, `<title>`, `og:title`, content, `ng-state`, `Cache-Control`);
  - the JavaScript-disabled locator check;
  - the empty Client-route shell;
  - a clean hydration (only `log` messages);
  - the NG0500 capture in a development build.

  The production build produced no NG0500 for the same mismatch. The text and branch differences produced none in either mode. With `NG_ALLOWED_HOSTS=other.example`, `webServer` reported ready and the test failed with 400.

**Screenshots: Option X, manual comparison.** Automated snapshots are not adopted, so #13 needs no baseline setup. The tester attaches the #13 screenshot PNGs (360 and 1280) and the mockup at the same widths to the PASS comment. Revisit when several stable screens exist and a visual regression slips through. Adopting snapshots then is a change to this ADR: baselines committed under `e2e/**/*-snapshots/`, generated and compared only in `mcr.microsoft.com/playwright:v<version>-noble`, Chromium projects only.

### WCAG 2.2 AA coverage

WCAG 2.2 has 55 success criteria at levels A and AA (4.1.1 Parsing is obsolete). The axe 4.13 rules carrying the enforced tags map to 23 of them, and only partially: axe checks that alt text exists, not that it is accurate, for example. The table below shows how each criterion is checked. Legend: **axe** = automated scan; **spec** = in-repo Playwright assertions (no new package); **manual** = the tester's checklist in the PASS comment for any UI PR; **gap** = accepted gap.

| SC | Name | Level | Check |
| --- | --- | --- | --- |
| 1.1.1 | Non-text Content | A | axe (presence); manual (alt text is meaningful) |
| 1.2.1, 1.2.2, 1.2.3 | Audio/video alternatives, captions, audio description | A | axe (`audio-caption`, `video-caption`); gap, since the product has no media. Revisit if media is added |
| 1.2.4, 1.2.5 | Live captions, audio description | AA | gap: no media |
| 1.3.1 | Info and Relationships | A | axe (lists, tables, ARIA structure); manual (headings and grouping match the visual structure) |
| 1.3.2 | Meaningful Sequence | A | manual (DOM order matches reading order at 360px) |
| 1.3.3 | Sensory Characteristics | A | manual |
| 1.3.4 | Orientation | AA | axe (`css-orientation-lock`) |
| 1.3.5 | Identify Input Purpose | AA | axe (`autocomplete-valid`, validity only); manual (personal-data fields have `autocomplete`) |
| 1.4.1 | Use of Color | A | axe (`link-in-text-block`); manual (status, errors, and standings not by colour alone) |
| 1.4.2 | Audio Control | A | axe |
| 1.4.3 | Contrast (Minimum) | AA | axe (`color-contrast`); manual for `incomplete` results |
| 1.4.4 | Resize Text | AA | axe (`meta-viewport`); manual (200% zoom) |
| 1.4.5 | Images of Text | AA | manual |
| 1.4.10 | Reflow | AA | spec: the axe helper also loads the page at 320 CSS px and asserts no horizontal scroll (`scrollWidth <= clientWidth`) |
| 1.4.11 | Non-text Contrast | AA | manual (control borders, focus indicators, icons at 3:1); axe does not check this |
| 1.4.12 | Text Spacing | AA | axe (`avoid-inline-spacing`); manual |
| 1.4.13 | Content on Hover or Focus | AA | manual (tooltips and popovers dismissible, hoverable, persistent) |
| 2.1.1 | Keyboard | A | axe (`scrollable-region-focusable`, `frame-focusable-content`); spec: each feature's main flow has one keyboard-only e2e path |
| 2.1.2 | No Keyboard Trap | A | spec: Tab walk through the page returns to the start; manual for dialogs |
| 2.1.4 | Character Key Shortcuts | A | manual (only if single-key shortcuts exist) |
| 2.2.1 | Timing Adjustable | A | axe (`meta-refresh`); manual (session timeouts per ADR 0008: the 7-day idle session expiry is beyond the 20-hour exception, so no in-page warning; the per-address sign-in throttle is a security limit whose message states the wait) |
| 2.2.2 | Pause, Stop, Hide | A | axe (`blink`, `marquee`); manual (auto-updating content such as live scores) |
| 2.3.1 | Three Flashes | A | gap: no flashing content planned; manual if animation is added |
| 2.4.1 | Bypass Blocks | A | axe (`bypass`) |
| 2.4.2 | Page Titled | A | axe (`document-title`, presence); spec: `toHaveTitle` per route, and on public pages also in the raw server HTML (JavaScript disabled) |
| 2.4.3 | Focus Order | A | spec: Tab walk order; manual (logical order) |
| 2.4.4 | Link Purpose (In Context) | A | axe (`link-name`); manual |
| 2.4.5 | Multiple Ways | AA | manual (site-level, checked when navigation changes) |
| 2.4.6 | Headings and Labels | AA | manual (descriptive) |
| 2.4.7 | Focus Visible | AA | spec: Tab walk asserts each focused element's computed outline or box-shadow differs from its unfocused state; manual |
| 2.4.11 | Focus Not Obscured (Minimum) | AA | spec: Tab walk asserts the focused element is in the viewport and `elementFromPoint` at its centre is the element or a descendant (catches sticky headers and footers at 360px) |
| 2.5.1 | Pointer Gestures | A | manual |
| 2.5.2 | Pointer Cancellation | A | manual |
| 2.5.3 | Label in Name | A | axe (`label-content-name-mismatch`) |
| 2.5.4 | Motion Actuation | A | manual (only if device motion is used) |
| 2.5.7 | Dragging Movements | AA | manual (drag-to-reorder, for example lineups, needs a non-drag alternative) |
| 2.5.8 | Target Size (Minimum) | AA | axe (`target-size`) |
| 3.1.1 | Language of Page | A | axe |
| 3.1.2 | Language of Parts | AA | axe (`valid-lang`) |
| 3.2.1 | On Focus | A | manual |
| 3.2.2 | On Input | A | manual |
| 3.2.3 | Consistent Navigation | AA | manual |
| 3.2.4 | Consistent Identification | AA | manual |
| 3.2.6 | Consistent Help | A | manual |
| 3.3.1 | Error Identification | A | spec: form e2e tests assert `aria-invalid` and an error message linked by `aria-describedby` |
| 3.3.2 | Labels or Instructions | A | axe (`label`, `form-field-multiple-labels`); manual |
| 3.3.3 | Error Suggestion | AA | manual |
| 3.3.4 | Error Prevention (Legal, Financial, Data) | AA | spec + manual: payment and registration flows show a review or confirm step, asserted in their e2e tests |
| 3.3.7 | Redundant Entry | A | manual |
| 3.3.8 | Accessible Authentication (Minimum) | AA | manual, checked against the #7 sign-in screens (password managers and paste allowed through `autocomplete` `email`/`current-password`/`new-password`, no cognitive test) |
| 4.1.2 | Name, Role, Value | A | axe (ARIA and name rules) |
| 4.1.3 | Status Messages | AA | spec: tests assert confirmations and errors appear in `role="status"` or `role="alert"` regions |

Further accepted gaps: no screen-reader testing with real assistive technology (VoiceOver, TalkBack, NVDA) by agents, and no real-device testing. The owner may spot-check. The "spec" rows that apply to every page (reflow at 320px, Tab walk for focus order, visibility, and obscuring) live in the shared a11y helper, so a feature test gets them by calling one function. The other "spec" rows are a test-plan obligation for feature issues. The manual rows form a checklist the tester copies into each UI PR's PASS comment, marking each item pass, fail, or N/A.

## Consequences

- **New devDependencies:** `@playwright/test` and `@axe-core/playwright` (pulls in `axe-core`). Playwright downloads Chromium (and WebKit on `main`) at CI time. The `convex` CLI downloads the FSL-licensed local backend binary when the e2e backend is wired. No paid service.
- **#13 (harness):** widths (360, 1280) and the Chromium projects match its scope, and so does its Node SSR `webServer`. Additions it needs:
  - the `webkit-mobile` project (run only on `main`), `workers: 1` and `retries: 1` in CI, the five axe tags, and the 320px reflow check plus Tab walk in the axe helper;
  - the e2e build uses `--configuration development`, and the `webServer` entry above;
  - the console fixture's rules above (`error`, `pageerror`, and `NG05xx` warnings), plus the "hydrated" log assertion for public pages;
  - a raw-HTML helper with both halves: `request.get()` for status and headers, and a JavaScript-disabled page for title, meta, and content locators.

  **#13's hydration criterion must change.** Its example ("text that differs between server and browser render") produces no error in any build mode (scratch evidence above), so the criterion as written cannot be met. The deliberate mismatch should be a `<table><tr>` with no `<tbody>` in the root template, caught as `NG0500` in the development build. No visual snapshot baselines. The manual WCAG checklist goes in `docs/process/` (or the README section #13 already writes) so the tester can copy it.
- **First feature that reads Convex data in e2e:** its scope includes the local backend wiring above (pinned version, `actions/cache` of `~/.cache/convex`, two `webServer` entries, `globalSetup`, `convex/testing.ts` with the `IS_TEST` guard, the tenant fixture). Its criteria include a CI run link showing the anonymous local backend starting on `ubuntu-latest` with no secrets, and a Convex test that `testing:reset` throws without `IS_TEST`.
- **#7 (auth):** the chosen provider must let e2e sign in a seeded user against the anonymous local backend with no secrets and no real inbox. A provider that needs a secret for e2e sign-in conflicts with this ADR and #8. ADR 0008 (PR #25, Better Auth component, email + password) meets this with password sign-in through the real UI and `IS_TEST`-guarded seeding through Better Auth's own sign-up, verified locally (3/3 specs). It needs no outbox. The first sign-in feature adds these to `convex/testing.ts`: the password-user seeding in `testing:seedLeague` (an `internalAction`); clearing of `jwks`, the component tables, and `signInFailures` in `testing:reset`; and a Convex test that each of them throws without `IS_TEST`. If the later verification and password-reset slice (#26) needs the emailed link or code in e2e, it adds an `IS_TEST`-only outbox under the same guard.
- **#3 (unit runners, ADR 0004):** if Vitest browser mode is used, its provider is `@vitest/browser-playwright` at the matching `playwright` version.
- **#8 (CI) minute estimate, per e2e job run on a 2-core Linux runner:**

  | Stage | Minutes |
  | --- | --- |
  | Checkout, Node setup, dependency install with cache | ~1.0 |
  | Angular development build with SSR (browser and server bundles, prerender) | 0.5 to 1.0 |
  | `npx playwright install --with-deps chromium` | 0.5 to 1.0 |
  | Smoke spec, two projects (#13), including SSR server start and the raw-HTML check | < 0.5 |
  | **Total per PR run, harness only** | **~3 (range 2.5 to 3.5)** |
  | Local Convex backend: cache restore or 64 MB download, push, start | +0.5 |
  | Feature specs, growing; estimate at about 40 specs x 2 projects | +2 to +4 |
  | **Total per PR run once features exist** | **~5 to 8** |
  | `webkit-mobile` on push to `main`: WebKit install with deps and the mobile specs | +1.5 to +2.5 |

  **SSR effect on minutes: none measurable, so the totals are unchanged.**
  - The e2e job already ran its own build, because it bakes in the local backend URL. It still runs one build: a development build, which skips optimisation, plus the server bundle and prerender.
  - In the scratch app, the development SSR build took 2.1 s and the production SSR build 2.1 to 3.6 s. A full scaffold will be slower, but stays inside the existing row.
  - The SSR server started in under a second.
  - Raw-HTML checks are plain HTTP requests, or JavaScript-disabled loads, of a few milliseconds to a few hundred milliseconds each.

  GitHub bills each job rounded up to the whole minute. At 60 PRs a month with 3 pushes each, e2e alone is about 540 to 1,440 minutes, against the 2,000 included on GitHub Free for private repos. #8 should consider running e2e only on non-draft PRs, path filters that skip docs-only changes, or `concurrency` cancellation of superseded runs.
- **Artifact storage (500 MB on Free):** screenshots, traces, and reports upload with a short `retention-days` (7 suggested); traces only on retry or failure.
- **Ongoing risk:** anonymous local deployments and the hidden pinning flags are beta. A CLI upgrade that breaks them fails the e2e job visibly. The fallback is to download the pinned binary from GitHub releases in CI and point the CLI at it with `--url` and `--admin-key`, which would amend this ADR.
- **Harder:** time-dependent behaviour (deadlines, scheduled reminders) cannot be controlled in e2e and is covered by Convex function tests (#3). True iOS Safari and screen-reader behaviour remain manual or untested.

## Amendment: CI usage (ADR 0009, 2026-10-07)

The owner asked for minimal GitHub Actions usage (PR #31). ADR 0009 runs CI as one `ci` job, only for PRs that are ready for review, with no run on pushes to `main`; the ruleset requires an up-to-date branch instead. Three rules of this ADR change accordingly. Nothing else here changes: the runner, the axe tags, the local backend, the viewports, the fixtures, and the tester's local runs stay as accepted.

| Rule in this ADR | Was | Now |
| --- | --- | --- |
| Where `chromium-mobile` and `chromium-desktop` run | Every PR and every push to `main` | Every CI run of a PR that is ready for review (not drafts), in the `ci` job after the static checks, unit tests, and build have passed. Docs-only PRs skip e2e. Locally, unchanged. |
| Where `webkit-mobile` runs | Push to `main` only; a failure opens a `type:bug` issue | **Release PRs into `production`, and manual `workflow_dispatch` with `webkit: true`.** The workflow sets `E2E_WEBKIT=1` there, and the Playwright config includes the project only then. A failure fails the release PR's `ci` check, which blocks the release; the deployer opens the `type:bug` issue. Locally, anyone may run it (on macOS it is a closer Safari proxy than Linux WebKit). |
| Convex local backend in CI | `actions/cache` restores `~/.cache/convex` (164 MB), keyed on the pinned version | **No cache.** The CLI downloads the pinned binary (63.7 MB) on each run. With no CI run on `main`, a cache could only be saved per PR and never restored by another PR, and restoring 164 MB is not faster than downloading 63.7 MB. |

**Why moving WebKit off `main` is acceptable.** WebKit was chosen as the iOS Safari proxy for a phone-first product, and that reason stands. What changes is when it is paid for:

- On `main` it cost about 100 to 165 minutes a month (66 pushes at 1.5 to 2.5) and reported after the merge, with a bug issue for code that was not shipping yet.
- On release PRs it costs 0 before launch and about 15 to 25 minutes a month after. It checks exactly the tree that ships, and it blocks that release instead of reporting afterwards.
- The cost is that a Safari-only regression is found at the release, with a release's worth of changes to bisect, unless someone runs the project on demand.

**Effects on #13:** `webkit-mobile` is conditioned on `E2E_WEBKIT=1`, not on `push` to `main`. Its evidence is a `workflow_dispatch` run with `webkit: true` showing the project executing, and a normal PR run not running it. The e2e steps join #12's `ci` job instead of a separate `e2e` job. ADR 0009 "Effects on other issues" lists the reworded criteria.

**Effects on the first feature with live Convex data in e2e:** no `actions/cache` step; the rest of the backend wiring above stands.

**Minutes (replaces "#8 (CI) minute estimate" totals for monthly planning):** per run, the e2e part of `ci` costs about 2 minutes for the harness and 4 to 7 once feature specs exist, because it shares the install with the static checks. ADR 0009 "Minutes and cost" has the monthly totals: about 340 to 410 minutes now and 510 to 680 with feature e2e, against Pro's 3,000.
