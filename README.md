# Omni League

League management for recreational sports. Angular (hybrid rendering) on the frontend, Convex on the backend. Product requirements: [docs/product/requirements.md](docs/product/requirements.md). Contributor and agent rules: [AGENTS.md](AGENTS.md).

## Local development

### Prerequisites

- Node.js 26.11 or later, with the npm 11 it bundles (ADR 0003). `nvm install` in the repo root reads `.nvmrc`. Other Node or npm versions fail the install with `EBADDEVENGINES`.
- No Convex account is needed: development uses an anonymous local Convex backend.

### Install

```sh
npm ci
```

`.npmrc` enforces the install policy: dependency install scripts fail unless listed in `allowScripts`, and versions published less than 3 days ago are not resolved (ADR 0003).

### Run the Convex backend

Before the first run, copy the committed example so the CLI keeps the variable name `CONVEX_URL`. Without it, the CLI sees `vite` in `package.json` and writes `VITE_CONVEX_URL`, which the app does not read.

```sh
cp .env.example .env.local
CONVEX_AGENT_MODE=anonymous npx convex dev
```

The first run downloads the local backend binary, starts it on `http://127.0.0.1:3210`, and writes the deployment name and `CONVEX_URL` to `.env.local` (gitignored). Its state lives in `.convex/` (gitignored). It keeps watching `convex/` and pushes changes. Add `--once` to push once and exit. Anonymous mode is in beta in the Convex CLI.

### Run the app

```sh
npm start              # ng serve on http://localhost:4200
```

`npm start` and `npm run build` run through `scripts/ng-convex.mjs`. It takes the Convex URL from `CONVEX_URL` in the environment or else from `.env.local`, checks it, and compiles it in. It prints `Convex URL: <url> (from <source>), site: <site-url>`, or `Convex URL: none`, in which case the app runs with no Convex client (see [the adapter README](src/app/core/data/convex/README.md)). Extra arguments go to `ng`: `npm run build -- --configuration development`.

### Build and run the SSR server

```sh
npm run build          # browser bundle, server bundle, and prerendered routes in dist/omni-league/
npm run serve:ssr      # local SSR runner (scripts/serve-ssr.mjs) on http://localhost:4000 (set PORT to change)
```

The local SSR runner serves the build the way Netlify does (ADR 0010): static files from `dist/omni-league/browser/` with Netlify's cache headers, and every other request through `netlifyAppEngineHandler`, the same handler the Netlify edge function runs. It listens on loopback only (`127.0.0.1` and `::1`), so `http://localhost:<port>` works whichever address `localhost` resolves to first. Server-rendered responses (any request not answered by a file in `browser/`) need a `Host` of `localhost` or `127.0.0.1` (`security.allowedHosts` in `angular.json`); any other host gets HTTP 400. Static files from `browser/` are served whatever the `Host`, as on Netlify, where the CDN serves them without the server entry. A request with an empty or missing `Host` gets HTTP 400.

### Checks

All checks run without a Convex deployment, `.env.local`, or Convex credentials.

```sh
npm run lint           # ESLint
npm run format:check   # Prettier (npm run format to fix)
npm run typecheck      # tsc over the app, specs, tooling files, and convex/
npm test               # Angular unit tests (Vitest through ng test)
npm run test:serial    # the same specs in one worker, like the 2-vCPU CI runner
npm run test:convex    # Convex function tests (convex-test on Vitest)
npm run test:scripts   # tests of the Node scripts in scripts/ (node:test)
npm run build
npm run e2e            # e2e and accessibility tests (see "E2E tests")
```

### Mockup kit

`npm run design:css` builds the mockup kit (`ng build --configuration production,mockup-kit`, entry `design/mockup-kit/mockup-kit.css`) and writes it into every `design/mockups/**/*.html` as one `<style id="mockup-kit">` block, so each mockup stays a single offline file with the app's tokens, helm classes, and Inter (ADR 0007). Run it after changing a mockup's classes, `src/styles/tokens.css`, or `src/styles/base.css`. `-- --skip-build` reuses `dist/mockup-kit/`. The kit is not part of `npm run build`.

### E2E tests

Playwright with `@axe-core/playwright` ([ADR 0005](docs/decisions/0005-e2e-and-accessibility-testing.md)). Install the browser once (and again after a Playwright upgrade):

```sh
npx playwright install --only-shell chromium   # add: npx playwright install webkit, for E2E_WEBKIT=1
```

**Local run.** `npm run e2e` builds with `npm run build -- --configuration development` (so hydration mismatch checks run), starts `npm run serve:ssr` with `PORT=4000`, and runs every spec in `e2e/` in the `chromium-mobile` (360 x 800) and `chromium-desktop` (1280 x 720) projects. Port 4000 must be free: an already running server is never reused. Arguments go to `playwright test`, for example `npm run e2e -- e2e/smoke.spec.ts`. The HTML report is in `playwright-report/` (`npx playwright show-report`); failure screenshots and traces are in `test-results/`.

**Against a URL.** `E2E_BASE_URL=<url> npm run e2e -- e2e/smoke.spec.ts` targets an already running app (for example a Netlify preview) and starts no local server. A preview is a production build, so the hydration checks cannot run: the `Angular hydrated <n> component(s)` assertion and the `/%E0%A4%A` 400 check are reported as skipped, and the run prints so. The fixtures also stub the Netlify Drawer script `/.netlify/scripts/cdp` with an empty script in this mode ([hosting, Smoke runs](docs/process/hosting.md#smoke-runs-local)).

**WebKit.** `E2E_WEBKIT=1 npm run e2e` adds the `webkit-mobile` project (360 x 800, touch), the iOS Safari proxy. CI runs it only on release PRs into `production` and on `workflow_dispatch` with `webkit: true`; on macOS it is a closer Safari proxy than CI's Linux WebKit.

**Screenshots (tester).** `npm run e2e:screenshots` saves a full-page PNG of `/` at each Chromium width to `e2e/screenshots/<route-slug>-<width>.png` (gitignored), for example `home-360.png` and `home-1280.png`. Other routes: `E2E_SCREENSHOT_ROUTES=/,/some/route npm run e2e:screenshots` (`/some/route` is saved as `some-route-<width>.png`). A route may be a 404 document, such as the not-found page; each saved path is printed with the document's HTTP status. CI uploads the folder in the `e2e-report` artifact.

**Writing specs.** Import `test` and `expect` from `e2e/support/fixtures.ts`, not `@playwright/test`:

- The **console fixture** fails a test on any page error, any `console.error`, and any `console.warn` with an `NG05xx` code. Opt-ins, per test: `test.use({ expectedDocumentStatus: 404 })` for a page that is a 404 document, and `test.use({ expectedConvexErrors: ['module:function'] })` for an expected rejected Convex mutation or action (an unused entry fails the test).
- The **axe helper**, `expectAccessible(page)` in `e2e/support/a11y.ts`, runs axe with the ADR tags, the Tab walk (2.1.2, 2.4.3, 2.4.7, 2.4.11; pass `expectedOrder` when the focus order deliberately differs from DOM order), and the 320px reflow check.
- **Raw server HTML:** `fetchRawHtml(request, path)` in `e2e/support/raw-html.ts` for status, headers, and the HTML string, and `test.use({ javaScriptEnabled: false })` for locator assertions on the same HTML. Public pages assert their content both ways, and a non-empty `toHaveTitle` on the JavaScript-disabled page.
- Wait with web-first assertions and `expect.poll`, never `page.waitForTimeout`.

The tester's manual accessibility checks are in [docs/process/wcag-checklist.md](docs/process/wcag-checklist.md).

### Regenerating `convex/_generated/`

`convex/_generated/` is committed. After changing anything under `convex/`, regenerate it and commit the result:

```sh
CONVEX_AGENT_MODE=anonymous npx convex dev --once
```

`npx convex ai-files install` refreshes `convex/_generated/ai/guidelines.md`. It also writes Convex sections into `AGENTS.md` and `CLAUDE.md` and installs agent skills under `.claude/` and `.agents/`; those extra changes are not committed.
