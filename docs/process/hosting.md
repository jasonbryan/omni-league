# Hosting: previews and staging

How per-PR previews and staging are set up and checked on Netlify with Convex preview deployments. Decisions: [ADR 0010](../decisions/0010-hosting-and-deployment.md) (hosting), [ADR 0008](../decisions/0008-auth-provider.md) (auth), [ADR 0009](../decisions/0009-ci-pipeline.md) (no deploy workflow), [ADR 0011](../decisions/0011-transactional-email.md) (email). Issue: #15. The flow itself is in [dev cycle, Deploy](dev-cycle.md#8-deploy).

The Netlify project (site name, `<site>` below) is **`charming-longma-28c00d`**. The site name is not a secret.

| Deploy     | URL                                                                            | Convex deployment                   | Netlify context  |
| ---------- | ------------------------------------------------------------------------------ | ----------------------------------- | ---------------- |
| PR preview | `https://deploy-preview-<n>--charming-longma-28c00d.netlify.app`               | preview `pr-<n>`, new on every push | `deploy-preview` |
| Staging    | `https://main--charming-longma-28c00d.netlify.app`                             | preview `main`, new on every merge  | `branch-deploy`  |
| Production | `https://charming-longma-28c00d.netlify.app` (private until the first release) | production (US East)                | `production`     |

## Owner setup (one time)

1. Create the Netlify project on the Free plan and link this repository through the Netlify GitHub App, installed on this repository only.
2. Production branch `production` (created at the first release); branch deploys for `main` only; Deploy Previews on; preview visibility **public**; the production site stays private until the first release; the Deploy Request Policy keeps its default (builds only for recognized authors). Deploy logs stay **private**: agents have no Netlify access, so the owner pastes log excerpts.
3. Create a Convex **preview** deploy key. Set the Netlify variable `CONVEX_DEPLOY_KEY` for the **Deploy Previews** and **Branch deploys** contexts only. No Production value until the first release.
4. Set the Convex **default preview environment variables** (Convex dashboard, project settings), listed under [Preview variables](#preview-variables).
5. In the Netlify UI, try to name a project with `--` (for example `deploy-preview-1--charming-longma-28c00d`) and record whether it is refused.

## Where secrets live

- **Netlify context values only.** `CONVEX_DEPLOY_KEY` holds the preview key in the Deploy Previews and Branch deploys contexts. The production key goes in the Production context at the first release, and only the owner handles it.
- **Never in GitHub.** No workflow, deploy job, GitHub environment, repository secret, or Dependabot secret holds a deploy key or token. Netlify builds and posts the preview link; the smoke run is local.
- **Convex dashboard.** `BETTER_AUTH_SECRET` (preview-only value) is a Convex default preview variable.

## Preview variables

Every preview deployment (`pr-<n>` and staging `main`) gets these Convex default preview variables:

| Name                     | Value                                              | Secret |
| ------------------------ | -------------------------------------------------- | ------ |
| `SITE_URL`               | `https://main--charming-longma-28c00d.netlify.app` | no     |
| `PREVIEW_ORIGIN_PATTERN` | the string below                                   | no     |
| `BETTER_AUTH_SECRET`     | a preview-only value (never the production one)    | yes    |
| `AUTH_EMAIL_DISABLED`    | `true`                                             | no     |

`SITE_URL` cannot differ per preview (ADR 0008), so every preview shares the staging origin, and `PREVIEW_ORIGIN_PATTERN` admits each preview's own origin.

`PREVIEW_ORIGIN_PATTERN` comes from the exported constant in `convex/lib/previewOrigin.ts`, its single source; `convex/lib/previewOrigin.test.ts` tests it and checks that this page quotes it. Copy it exactly:

```text
^https://(deploy-preview-[1-9][0-9]*|main|[0-9a-f]{24})--charming-longma-28c00d\.netlify\.app$
```

**Deliberately not set on previews:** `IS_TEST` (it turns on test-only functions and turns off the breached-password check and per-IP limiter), `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and `RESEND_API_KEY` (previews send no email).

**Google sign-in is unavailable on previews.** Each preview's `*.convex.site` callback URL is new, and Google refuses wildcard redirect URIs. Previews offer email + password only.

## Demo data

Every build of a preview (`pr-<n>`) and of staging (`main`) runs the internal mutation `seed:demo` (`convex/seed.ts`, #97), so each merged feature is visible on staging with demo data. In `netlify.toml`'s `deploy-preview` and `branch-deploy` contexts it is the last step, `npx convex run seed:demo --preview-name <name>`, with the same name as `--preview-create` (`pr-$REVIEW_ID`, `$HEAD`). It runs after `npx convex deploy` and after the [deploy environment check](#deploy-environment-check), so a deployment that fails the check is not seeded. It replaces `--preview-run seed:demo` (#60), which runs only when the deploy creates a new deployment: after the #93 merge, staging had no demo data (#97). The build log shows the run and the rows it inserted per table: 5 organizations, 10 locations, and 15 leagues on a new deployment, and zeros on a deployment that already has them.

**What it creates.** Fictional organizations in US cities, covering every sport in at least two organizations, with one organization running more than one sport:

- `/organizations/gulf-coast-sport-social` and `/organizations/port-aransas-beach-volleyball-club`: the organizations of `design/mockups/60-organization-page.html` (#73), unchanged. The first has three locations and five leagues; the second has no locations and no leagues (the empty state).
- `/organizations/front-range-rec-sports` (soccer and softball), `/organizations/lakeshore-sand-league` (beach volleyball), and `/organizations/saguaro-valley-softball` (softball).

**Insert-only, per record.** It inserts each demo organization (by `slug`), location (by name within its organization), and league (by name within its organization, with its location links) only when it is missing. It never updates or deletes a row, so a second run inserts nothing, and rows that are not demo rows are never touched. Its return value is the number of rows inserted per table. Later features add their demo rows to `convex/seed.ts` under the same rule. A demo entry is never renamed or removed, because a renamed entry is inserted again next to the old one.

**Production guard.** `seed:demo` throws before reading or writing unless `PREVIEW_ORIGIN_PATTERN` is exactly the constant in `convex/lib/previewOrigin.ts`, which only preview and staging deployments have ([Preview variables](#preview-variables)). Production must not have it (`check-deploy-env.mjs production` fails when it is set), and `[context.production]` never runs a function or the seed (`scripts/netlify-toml.test.mjs`). So the seed cannot write on production, even when run from the dashboard or the CLI. It is deployed there only as an internal function, which no client can call. A preview whose `PREVIEW_ORIGIN_PATTERN` is missing or wrong fails its build at this step, and nothing is published.

**Demo accounts** (an organization admin of a demo organization and a plain player) are #98.

## Deploy environment check

`scripts/check-deploy-env.mjs` fails the Netlify build, so nothing is published, when a Convex deployment has the wrong variables. It reads variable names only (`npx convex env list --names-only`), plus the value of `AUTH_EMAIL_DISABLED` in preview mode, which it compares in memory. It never prints a value, and it prints the name of the deployment it checked.

| Mode         | Fails when                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `preview`    | `IS_TEST` is set; `AUTH_EMAIL_DISABLED` is not exactly `true`; `RESEND_API_KEY` is set                                              |
| `production` | `IS_TEST` is set; `AUTH_EMAIL_DISABLED` is set; `PREVIEW_ORIGIN_PATTERN` is set (the email slice adds the ADR 0011 presence checks) |

**Targeting.** `--preview-name <name>` selects the preview deployment with the preview deploy key; it is the same name `npx convex deploy --preview-create` used (`pr-$REVIEW_ID`, or `$HEAD` = `main` for staging). Convex 1.46's `env` commands accept `--preview-name` but hide it from `--help`. If a Convex upgrade drops it, the CLI call fails and so does the build; it never passes silently. Without `--preview-name`, the CLI acts on the deployment that `CONVEX_DEPLOY_KEY` names (a production key).

**Ordering.**

- **Preview mode runs after `npx convex deploy`** (`netlify.toml`, `deploy-preview` and `branch-deploy`), because `pr-<n>` does not exist before it.
- **Production mode must run before `npx convex deploy`:** `npm ci && node scripts/check-deploy-env.mjs production && npx convex deploy ...`. A failure after the deploy would leave the new functions already pushed to the production backend, with only the Netlify publish stopped. The production deploy issue wires this into `[context.production]`; it must not copy the preview ordering.

**Preview residual (accepted).** When the preview check fails, Netlify publishes nothing, but the `pr-<n>` backend with the forbidden variable stays live on its `*.convex.site` URL until the next push recreates it or it expires after 5 days.

**Running it locally (owner).** With the preview deploy key in `CONVEX_DEPLOY_KEY` (read it with `read -rs CONVEX_DEPLOY_KEY && export CONVEX_DEPLOY_KEY`, so it stays out of shell history), `node scripts/check-deploy-env.mjs production --preview-name pr-<n>` checks a preview against the production rules; it fails naming `AUTH_EMAIL_DISABLED` and `PREVIEW_ORIGIN_PATTERN`.

## `noindex`

Previews and staging send `X-Robots-Tag: noindex`; production does not. Netlify's own header on previews is undocumented, and `netlify.toml` `[[headers]]` cannot be limited to a context, so `npm run build` (`scripts/ng-convex.mjs`) decides from Netlify's `CONTEXT` (any value other than `production`):

- **Static files:** it writes `_headers` (`/*` → `X-Robots-Tag: noindex`) into `dist/omni-league/browser/` (`scripts/noindex.mjs`).
- **Edge-function responses** (server routes, 404, 400, 500): it sets the build-time define `__NOINDEX__`, and `netlifyAppEngineHandler` adds the header (`src/server-robots.ts`). The server entry reads no environment at runtime.

A local build (no `CONTEXT`) has neither.

## Edge-safe server bundle

Netlify Edge Functions refuse filesystem access, and Netlify counts `process.cwd()` as such access, so `path.resolve('.')` throws there. Neither Node nor local Deno reproduces it. On PR #54 every SSR request returned 500 because `convex/browser` resolved to its Node entry (the `node` export condition). That entry runs `createRequire(resolve('.'))` at module load ([log](https://github.com/jasonbryan/omni-league/pull/54#issuecomment-6073720764)).

- **`angular.json` builds the server bundle for `ssr.platform: "neutral"`**, Angular's option for edge runtimes. Packages then resolve to their non-Node entries (`convex/browser` to its `import` entry, with no `ws` client), and Angular adds no Node `require` banner. `externalDependencies: ["node:process"]` keeps the one Node built-in the server needs, the `@netlify/angular-runtime` helper's own import (ADR 0010 item 2), out of the bundle. A neutral build fails on any other unresolved Node built-in. On this platform Angular also leaves `@angular/platform-server`'s lazy `import("xhr2")` unbundled. It runs only for `HttpClient` requests over XHR during SSR, and the app has no `HttpClient`; server reads go through `ConvexHttpClient`, which uses `fetch`.
- **`npm run build` runs the edge-safety check after `ng build`** (`scripts/edge-bundle.mjs`, tests in `scripts/edge-bundle.test.mjs`). It fails the build when any `.mjs` file under `dist/omni-league/server/` contains `createRequire`, `process.cwd`, or an import or `require` of `fs`, `path`, or `module` (with or without `node:`). The check runs locally, in CI, and on Netlify, so such a bundle is never published. It prints `edge-bundle: PASS` or one `edge-bundle: FAIL <file>: <problem>` line per problem.

## Service worker

Production builds register Angular's service worker (`@angular/service-worker`, [ADR 0013](../decisions/0013-pwa-stack.md) sections 1 and 4, #81). It keeps the app shell and the build files listed in `ngsw.json`, so the app opens offline, and it answers every navigation with the client shell (`index.csr.html`). It never keeps Convex data, auth requests, or `/api/` URLs. Development builds, including the e2e build, register no worker. Crawlers never run it, so the server HTML, statuses, and headers they get are unchanged.

**Build check.** `npm run build` runs `scripts/sw-config-check.mjs` after the edge-safety check (tests in `scripts/sw-config-check.test.mjs`). It fails the build when the built `dist/omni-league/browser/ngsw.json` has any data group, an `index` other than `/index.csr.html`, a `navigationRequestStrategy` other than `performance`, or an asset URL that is not a same-origin path or contains `/api/`, `convex.cloud`, or `convex.site`. It also fails when a content-hashed `main-*`, `chunk-*`, or `polyfills-*` script or `styles-*` sheet in `browser/` is in no prefetch asset group: lazily loaded chunks, such as the phone sheet's, must open offline before their first use online (PR #107 testing). It prints `sw-config-check: PASS`, `sw-config-check: SKIP` (no `serviceWorker` option in `angular.json` and no `ngsw.json`: the kill switch), or one `sw-config-check: FAIL <problem>` line per problem. With the option set and no `ngsw.json`, it fails.

**Kill switch.** Each path ships through `gate:production`.

1. **Normal release.** A PR on `main` removes the `serviceWorker` build option from `angular.json`. The build then writes no `ngsw.json` and prints `sw-config-check: SKIP`. Every client that next opens the app online gets a 404 for `ngsw.json`, deletes its caches, and unregisters (about 6 seconds after one navigation in the ADR's scratch run). The release PR ships it as usual.
2. **Emergency release.** A release from `main` would also ship everything merged since the last release. Instead, the deployer opens a release PR from a branch cut from `production` whose only change is the step above, labelled `gate:production`; the owner's merge ships it. The same change then lands on `main` through a normal PR before the next release, or the next release turns the worker back on.
3. **If the worker script itself fails to start,** either release serves the packaged `safety-worker.js` at the `ngsw-worker.js` URL instead, until users have unregistered ([Service worker devops](https://angular.dev/ecosystem/service-workers/devops)).

**Netlify Drawer.** The Drawer script changes `index.csr.html` after the build, so ngsw's hash check fails where it is injected, and the worker falls back to the network there: the app works, but not offline. The owner turns the Drawer off for Deploy Previews and Branch deploys (Netlify UI; owner, 2026-10-09). With it off, offline and update evidence from a preview counts as well as from a local production build.

**Local production-build run.** `npm run e2e` cannot test the worker: it rebuilds `dist/` in development mode. Run `e2e/pwa.spec.ts` against a production build instead:

```sh
npm run build                 # prints sw-config-check: PASS
npm run serve:ssr             # http://localhost:4000; PORT=<port> for another port
E2E_BASE_URL=http://localhost:4000 npx playwright test e2e/pwa.spec.ts
```

The spec runs in `chromium-mobile` only and is skipped without `E2E_BASE_URL`, so `ci` skips it. Stop `serve:ssr` afterwards ([dev cycle, Local processes](dev-cycle.md#local-processes)).

**`CONVEX_URL` for this run.** `scripts/ng-convex.mjs` compiles in the Convex URL from the environment, or else from `.env.local`. A URL that names a backend that is not running keeps the adapter's `online` signal false, so the offline note never goes and the spec's "note disappears" check fails for a reason unrelated to the worker. So either build with no Convex URL (`CONVEX_URL` unset in the environment and absent from `.env.local`; `online` then follows `navigator.onLine`), or start #82's local backend sequence first and build against it.

**Release check.** No `ci` job proves offline behaviour, because `e2e/pwa.spec.ts` needs a production build. Every release request (`gate:production`) records a run of the commands above on the release commit, with the output in its Evidence block.

## Cleanup

No cleanup job. Convex deletes preview deployments 5 days after creation. Convex 1.46 documents `--preview-create` as deleting and recreating a preview deployment with the same name, so a build may start from an empty backend; `seed:demo` runs on every build, so the demo data is there either way. Netlify deletes non-published deploys after 30 days on Free, or 90 days on paid plans. Until then a closed PR's preview URL keeps serving test data. Staging stops working if `main` gets no merge for 5 days, until the next merge recreates its backend.

## Smoke runs (local)

Chromium only, both widths, no secrets (previews are public):

```sh
# Tester, Phase 5: the PR's preview
E2E_BASE_URL=https://deploy-preview-<n>--charming-longma-28c00d.netlify.app npm run e2e -- e2e/smoke.spec.ts e2e/cache-key.spec.ts

# Deployer, Phase 8: staging after a merge
E2E_BASE_URL=https://main--charming-longma-28c00d.netlify.app npm run e2e -- e2e/smoke.spec.ts
```

The hydration-log assertion and the `/%E0%A4%A` check are reported as skipped against a URL ([README](../../README.md#e2e-tests)). `E2E_WEBKIT` stays unset.

**Netlify Drawer.** Netlify injects `<script src="/.netlify/scripts/cdp">` into preview and staging HTML, and that script adds the Drawer review toolbar in an iframe. The iframe is not app markup, and it fails the axe helper's Tab walk (2.4.7, "iframe has the same outline and box-shadow focused as unfocused"). With `E2E_BASE_URL` set, the e2e fixtures answer that one path with an empty script (`e2e/support/netlify-drawer.ts`), so no Drawer loads and every other request reaches the preview unchanged. A local run (no `E2E_BASE_URL`) installs no stub. If the owner later turns the Drawer off for Deploy Previews and Branch deploys in the Netlify UI, the stub becomes a no-op.

## Observed results

Recorded by #15's testing, then by #23 on PR #90's preview (the not-found page, the first server route with `Cache-Control: ... s-maxage=60`). The cold-start render check stays **partial** until #23 records its third fresh deploy and the owner's edge-function log. The first production release waits for a full pass.

| Check                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold start (3 fresh deploys, tester and owner's phone) | pass, partial until #23 (plain 404): tester `curl` 1.57 s, then 0.13 s; owner's phone on mobile data about 2 s and about 1.5-2 s (owner's estimates); no edge-function log entries for any of the three deploys ([#54 comment](https://github.com/jasonbryan/omni-league/pull/54#issuecomment-6074231628))                                                                                                                                                                                                                                                |
| `Cache-Status` of a repeated `/does-not-exist`         | pass (#23, PR #90): the rendered 404 (`public,max-age=0,s-maxage=60,stale-while-revalidate=300`; Netlify drops the spaces) is stored. First request `"Netlify Edge"; fwd=miss; fwd-status=404; stored`; later ones either `hit; ttl=<n>` with a rising `age` (tester: `hit; ttl=6`, `age: 54`; implementer: `hit; ttl=60`, then `ttl=59`), or `fwd=miss; ... stored` or `fwd=stale; ...; stored` again: requests reach different edge nodes, each with its own copy ([tester](https://github.com/jasonbryan/omni-league/pull/90#issuecomment-6086672181)) |
| Query string in the cache key                          | pass after the PR #90 fix: before it, `?token=T6` got the HTML stored for `?token=T1`, and `//x` got a stored 301 to `/x?token=BBB`. Now every edge-function response sends `Netlify-Vary: query` (passed on to the client), server HTML holds no query string, and the `//` redirect is `no-store` (`fwd=miss` every time). `?token=A` (stored, then `hit`), then `?token=B` and no query: each `fwd=miss; stored`, none holds another's value. `e2e/cache-key.spec.ts` repeats this against a preview                                                   |
| Server-route `noindex` on the preview                  | pass (#23): `/does-not-exist` and `/app/x` (rendered 404) send `X-Robots-Tag: noindex`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `X-Forwarded-Host: evil.example`                       | pass: normal `404 Not found`, no foreign content; no `trustProxyHeaders` warning in the edge-function log, so the header was dropped before the handler or ignored silently ([#54 comment](https://github.com/jasonbryan/omni-league/pull/54#issuecomment-6073945181))                                                                                                                                                                                                                                                                                    |
| `check-deploy-env.mjs production` against `pr-54`      | pass (expected failure): `FAIL AUTH_EMAIL_DISABLED is set`, no value printed ([#54 comment](https://github.com/jasonbryan/omni-league/pull/54#issuecomment-6074076490))                                                                                                                                                                                                                                                                                                                                                                                   |
| Netlify UI refuses a project name with `--`            | not claimable (owner, setup 5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Project names: Netlify caps project names at 37 characters, so `deploy-preview-<n>--charming-longma-28c00d` (40 or more) and `<24 hex>--charming-longma-28c00d` (48) cannot be claimed by another project. `main--charming-longma-28c00d` is already this project's staging hostname, so Netlify cannot route it to another project (the UI's availability check for it never completed, and nothing was saved). `PREVIEW_ORIGIN_PATTERN` stays as is ([#15 comment](https://github.com/jasonbryan/omni-league/issues/15#issuecomment-6073378587)).
