# Hosting: previews and staging

How per-PR previews and staging are set up and checked on Netlify with Convex preview deployments. Decisions: [ADR 0010](../decisions/0010-hosting-and-deployment.md) (hosting), [ADR 0008](../decisions/0008-auth-provider.md) (auth), [ADR 0009](../decisions/0009-ci-pipeline.md) (no deploy workflow), [ADR 0011](../decisions/0011-transactional-email.md) (email). Issue: #15. The flow itself is in [dev cycle, Deploy](dev-cycle.md#8-deploy).

The Netlify project (site name, `<site>` below) is **`charming-longma-28c00d`**. The site name is not a secret.

| Deploy     | URL                                                                            | Convex deployment                                                                                       | Netlify context  |
| ---------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------- |
| PR preview | `https://deploy-preview-<n>--charming-longma-28c00d.netlify.app`               | preview `pr-<n>`, new on every push                                                                     | `deploy-preview` |
| Staging    | `https://main--charming-longma-28c00d.netlify.app`                             | preview `main`, kept between merges until Convex deletes it 5 days after creation ([Cleanup](#cleanup)) | `branch-deploy`  |
| Production | `https://charming-longma-28c00d.netlify.app` (private until the first release) | production (US East)                                                                                    | `production`     |

## Owner setup (one time)

1. Create the Netlify project on the Free plan and link this repository through the Netlify GitHub App, installed on this repository only.
2. Production branch `production` (created at the first release); branch deploys for `main` only; Deploy Previews on; preview visibility **public**; the production site stays private until the first release; the Deploy Request Policy keeps its default (builds only for recognized authors). Deploy logs stay **private**: agents have no Netlify access, so the owner pastes log excerpts.
3. Create a Convex **preview** deploy key. Set the Netlify variable `CONVEX_DEPLOY_KEY` for the **Deploy Previews** and **Branch deploys** contexts only. No Production value until the first release.
4. Set the Convex **default preview environment variables** (Convex dashboard, project settings), listed under [Preview variables](#preview-variables).
5. In the Netlify UI, try to name a project with `--` (for example `deploy-preview-1--charming-longma-28c00d`) and record whether it is refused.
6. Preview cleanup (#158), once, in this order:
   1. Delete the repository secret `CONVEX_TEAM_TOKEN` if one exists (**Settings**, **Secrets and variables**, **Actions**). While it was a repository secret, a workflow on any branch could read it.
   2. Create the environment: GitHub repository **Settings**, **Environments**, **New environment**, name `preview-cleanup`. Under **Deployment branches and tags** choose **Selected branches and tags** and add the branch `main`. If the cleanup workflow runs before the environment exists, GitHub creates it with no branch rule, so set the rule before adding the secret.
   3. Create a **new** Convex **team access token** (Convex dashboard, **Team Settings**, **Access Tokens**) and add it to that environment as the environment secret `CONVEX_TEAM_TOKEN` (**Add environment secret**).
   4. **Revoke the old token** in the Convex dashboard, since branch workflows could read it.

   Until the environment secret is set, the [cleanup workflow](#cleanup) skips with a notice and deletes nothing.

## Where secrets live

- **Netlify context values only.** `CONVEX_DEPLOY_KEY` holds the preview key in the Deploy Previews and Branch deploys contexts. The production key goes in the Production context at the first release, and only the owner handles it.
- **Never in GitHub, with one exception.** No workflow, deploy job, repository secret, or Dependabot secret holds a deploy key or token. Netlify builds and posts the preview link; the smoke run is local. **The exception is the environment secret `CONVEX_TEAM_TOKEN` of the GitHub environment `preview-cleanup`**, used only by `.github/workflows/clean-previews.yml` to delete the Convex preview deployments of closed PRs ([Cleanup](#cleanup)). Owner decision, 2026-10-10: "Do don't want to run in automate it" and "make it part of this development process", with a GitHub workflow chosen over a Netlify build step.
  - **What the token can do.** A Convex team access token acts for the whole team, not only for previews. Through Convex's Management API it can mint a deploy key for any deployment of the team, production included, and so deploy code. It can also delete projects (and every deployment in them) and change default environment variables. Treat it as a production credential.
  - **Where it can be read.** Only a run on `main`. The environment's deployment branch rule allows `main` and nothing else, the job declares `environment: preview-cleanup`, and the workflow has no `pull_request` trigger. A workflow a branch adds or edits cannot read the secret, because GitHub refuses the environment to any other branch. Changes to the workflow reach `main` only through a merged PR. GitHub refuses the environment to a branch run even when the owner's account starts it. The gap is the owner's GitHub token, which agents use: it has repository admin rights, so it can edit or remove the environment's branch rule ([ADR 0010](../decisions/0010-hosting-and-deployment.md), GitHub Pro limits). The owner checks the rule when setting it up.
  - **Other limits.** No other workflow may reference the secret. If it leaks, the owner revokes it in the Convex dashboard.
- **Convex dashboard.** `BETTER_AUTH_SECRET` (preview-only value) is a Convex default preview variable.

## Preview variables

Every preview deployment (`pr-<n>` and staging `main`) gets these Convex default preview variables:

| Name                     | Value                                              | Secret |
| ------------------------ | -------------------------------------------------- | ------ |
| `SITE_URL`               | `https://main--charming-longma-28c00d.netlify.app` | no     |
| `PREVIEW_ORIGIN_PATTERN` | the string below                                   | no     |
| `BETTER_AUTH_SECRET`     | a preview-only value (never the production one)    | yes    |
| `AUTH_EMAIL_DISABLED`    | `true`                                             | no     |

**Changing a default.** Convex applies the defaults only when it creates a deployment, so a changed default reaches staging's `main` only when `main` is recreated or the value is set on it by hand (`--preview-name` reuses it, [Cleanup](#cleanup)). The [deploy check](#deploy-environment-check) reads names only, so it catches a missing variable but not a changed `SITE_URL` or `PREVIEW_ORIGIN_PATTERN` value. The Convex dashboard flags deployments whose variables differ from the defaults.

`SITE_URL` cannot differ per preview (ADR 0008), so every preview shares the staging origin, and `PREVIEW_ORIGIN_PATTERN` admits each preview's own origin.

`PREVIEW_ORIGIN_PATTERN` comes from the exported constant in `convex/lib/previewOrigin.ts`, its single source; `convex/lib/previewOrigin.test.ts` tests it and checks that this page quotes it. Copy it exactly:

```text
^https://(deploy-preview-[1-9][0-9]*|main|[0-9a-f]{24})--charming-longma-28c00d\.netlify\.app$
```

**Deliberately not set on previews:** `IS_TEST` (it turns on test-only functions and turns off the breached-password check and per-IP limiter), `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and `RESEND_API_KEY` (previews send no email).

**Google sign-in is unavailable on previews.** Each preview's `*.convex.site` callback URL is new, and Google refuses wildcard redirect URIs. Previews offer email + password only.

## Demo data

Every build of a preview (`pr-<n>`) and of staging (`main`) runs the internal mutation `seed:demo` (`convex/seed.ts`, #97), so each merged feature is visible on staging with demo data. In `netlify.toml`'s `deploy-preview` and `branch-deploy` contexts it is the last step, `npx convex run seed:demo --preview-name <name>`, with the same name as the deploy's `--preview-create` (previews, `pr-$REVIEW_ID`) or `--preview-name` (staging, `$HEAD`). It runs after `npx convex deploy` and after the [deploy environment check](#deploy-environment-check), so a deployment that fails the check is not seeded. It replaces `--preview-run seed:demo` (#60), which runs only when the deploy creates a new deployment: after the #93 merge, staging had no demo data (#97). The build log shows the run and the rows it inserted per table: 5 organizations, 10 locations, 1 custom level, 16 leagues, and 4 seasons on a new deployment, and zeros on a deployment that already has them, followed by `backfilled` (see below).

**What it creates.** Fictional organizations in US cities, covering every sport in at least two organizations, with one organization running more than one sport:

- `/organizations/gulf-coast-sport-social` and `/organizations/port-aransas-beach-volleyball-club`: the organizations of `design/mockups/60-organization-page.html` (#73), unchanged. The first has three locations and five leagues; the second has no locations and no leagues (the empty state).
- `/organizations/front-range-rec-sports` (soccer and softball), `/organizations/lakeshore-sand-league` (beach volleyball), and `/organizations/saguaro-valley-softball` (softball).
- Every demo league has its division (gender, players per side, level, and age group), for example Coed · 4v4 · BB for `sunday-reverse-coed-4s`. Saguaro Valley Softball has the custom level "D" (mapped to Rec), which Men's D Division Slow-Pitch uses. Coed 6v6 Indoor (Front Range Rec Sports) has a raised minimum roster size of 8, and U10 Girls Fall Rec (Front Range Rec Sports, soccer) is a youth league that shows Girls and U10.
- Two draft seasons (#125) of Gulf Coast Sport & Social, `fall-2027` of `sunday-reverse-coed-4s` and of `coed-7v7-rec`, signed-in staff only (`/app/organizations/gulf-coast-sport-social/leagues/<league>`). Drafts are never on a public page. Two published seasons (#126), `summer-2027` of `sunday-reverse-coed-4s` and of `coed-7v7-rec`, are public once #127 and #128 add the public season pages, and later issues register into `sunday-reverse-coed-4s / summer-2027`. They have slugs #125 does not seed, so a reused staging that already holds the drafts is given them, and never holds a stale draft under a published slug.

**Insert-only, per record.** It inserts each demo organization (by `slug`), location (by name within its organization), custom level (by name within its organization and sport), league (by name within its organization, with its location links and division), and season (by slug within its league, whatever its status) only when it is missing, through the tenant writers (`convex/lib/tenantWrites.ts`), which also add 1 to the organization's league or location count. It never deletes a row, so a second run inserts nothing. Its return value is the number of rows inserted per table (organizations, locations, custom levels, leagues, seasons), plus `backfilled`.

**Backfill (#100, until #104).** Before inserting, it sets the fields #100 added on rows written before them, as on a reused staging deployment: `sortName` (the name lowercased) on each location and league without one, and `leagueCount` and `locationCount`, from a recount, on each organization missing either. #101 adds the per-sport counters: on each organization missing `sportLeagueCounts` or `sportLocationCounts`, the backfill recounts both and rebuilds the organization's `sportLocations` rows (the leagues of each sport at each location), counting the organization once in `backfilled`. #127 adds `publishedSeasonCount` on each league: the backfill sets it, on each league without one, from a recount of the league's published seasons, and counts the league in `backfilled.leagues` (a league inserted by the tenant writers starts at 0, so a second run changes none). #233 adds the divisions, after the demo custom levels of organizations that already exist are inserted: each season with a `format` and no `playersPerSide` gets `playersPerSide` ("4v4" gives 4) and loses its `format` (`backfilled.seasons`), and each league missing its players per side, gender, level, or age group gets them (`backfilled.leagueDivisions`). A demo league takes its row of the demo table (matched by organization slug and league name). Any other league takes its newest season's players per side (by start date, any status), else the number in its name, else the smallest of its sport's range; its gender and level from its name, else Coed and Rec; its age group Adult; and its minimum roster size from the newest season when that is above the players per side. The division pass selects only the seasons and leagues that still lack a field and changes at most 1,000 of each per run, so repeated runs reach every row. A league whose newest season waits for a later run still gets the right value, because the league reads `playersPerSide` or else the number in `format`. #239 makes the fields required and removes this step. These are its only updates, and they apply to demo and other rows alike. It reads at most 1,000 rows per table, and reports the changed rows per table as `backfilled: { organizations, locations, leagues, seasons, leagueDivisions }`, zeros on a deployment that has them. The public page reads a missing count as 0, which can show only between `npx convex deploy` and this step, before Netlify publishes. #104 makes the fields required and removes the backfill. Later features add their demo rows to `convex/seed.ts` under the same rule. A demo entry is never renamed or removed, because a renamed entry is inserted again next to the old one.

**Production guard.** `seed:demo` throws before reading or writing unless `PREVIEW_ORIGIN_PATTERN` is exactly the constant in `convex/lib/previewOrigin.ts`, which only preview and staging deployments have ([Preview variables](#preview-variables)). Production must not have it (`check-deploy-env.mjs production` fails when it is set), and `[context.production]` never runs a function or the seed (`scripts/netlify-toml.test.mjs`). So the seed cannot write on production, even when run from the dashboard or the CLI. It is deployed there only as an internal function, which no client can call. A preview whose `PREVIEW_ORIGIN_PATTERN` is missing or wrong fails its build at this step, and nothing is published.

**Demo accounts** (an organization admin of a demo organization and a plain player) are #98.

**Every change keeps the seed current (#230).** An issue that adds or changes a table, a field, or a user-visible feature has a Demo data criterion, and its PR updates `convex/seed.ts` to deliver it ([dev cycle](dev-cycle.md), Phases 1, 4, 5, and 6). `convex/seedCoverage.test.ts` runs `seed:demo` on an empty `convex-test` backend and fails when a schema table has no rows and is not in its `SEED_EXCEPTIONS` map (table name to reason), when an exception names no table, or when a second run changes any table's row count or `_id`s. An exception needs a reason the reviewer accepts. It runs in `test:convex`, so `ci` needs no extra step.

## Deploy environment check

`scripts/check-deploy-env.mjs` fails the Netlify build, so nothing is published, when a Convex deployment has the wrong variables. It reads variable names only (`npx convex env list --names-only`), plus the value of `AUTH_EMAIL_DISABLED` in preview mode, which it compares in memory. It never prints a value, and it prints the name of the deployment it checked.

| Mode         | Fails when                                                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview`    | `IS_TEST` is set; `AUTH_EMAIL_DISABLED` is not exactly `true`; `RESEND_API_KEY` is set; `BETTER_AUTH_SECRET` or `SITE_URL` is not set                                                                                                                            |
| `production` | `IS_TEST` is set; `AUTH_EMAIL_DISABLED` is set; `PREVIEW_ORIGIN_PATTERN` is set (it makes Better Auth trust preview origins, #62, and lets `seed:demo` write) (the email slice adds the ADR 0011 presence checks); `BETTER_AUTH_SECRET` or `SITE_URL` is not set |

**Required variables (#111).** Both modes also fail when `BETTER_AUTH_SECRET` or `SITE_URL` is not set, from the names alone. Production fails until the owner sets both on the production deployment (ADR 0008 already requires them before the first production release); previews and staging already have both. An empty value is invisible to `--names-only`, so `convex/auth.ts` refuses every auth request with 503 `AUTH_NOT_CONFIGURED` while the secret is unset or empty.

**Targeting.** `--preview-name <name>` selects the preview deployment with the preview deploy key; it is the same name `npx convex deploy` used with `--preview-create` for a preview (`pr-$REVIEW_ID`) or `--preview-name` for staging (`$HEAD` = `main`). Convex 1.46's `env` commands accept `--preview-name` but hide it from `--help`. If a Convex upgrade drops it, the CLI call fails and so does the build; it never passes silently. Without `--preview-name`, the CLI acts on the deployment that `CONVEX_DEPLOY_KEY` names (a production key).

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

## Client-route shells

`/sign-up` and everything under `/app` are `RenderMode.Client` routes (#62). The edge function answers them with the empty client shell (`index.csr.html`, an empty `<app-root>`) and status 200, with `Cache-Control: public, max-age=0, must-revalidate` (ADR 0010 item 4, amended) and `Netlify-Vary: query`. The shell names the build's content-hashed bundles, and a deploy deletes the previous build's, so no shared cache keeps it: an edge copy stored as a deploy went live outlived the purge and served a blank page (PR #102 testing, `s-maxage=86400`). `src/app/app.routes.server.spec.ts` fails if a Client route gets `s-maxage`, `stale-while-revalidate`, `stale-if-error`, or a CDN-only cache header. No guard, page, or auth code runs on the server: the browser checks the session, and an unknown `/app` path gets the not-found view in the browser (no 404 status).

Sign-up from a preview calls the preview's own `*.convex.site` URL. Better Auth trusts that request because the preview's origin matches `PREVIEW_ORIGIN_PATTERN` ([Preview variables](#preview-variables)); production sets no pattern and trusts `SITE_URL` only.

## Service worker

Production builds register Angular's service worker (`@angular/service-worker`, [ADR 0013](../decisions/0013-pwa-stack.md) sections 1 and 4, #81). It keeps the app shell and the build files listed in `ngsw.json`, so the app opens offline, and it answers every navigation with the client shell (`index.csr.html`). It never keeps Convex data, auth requests, or `/api/` URLs. Development builds, including the e2e build, register no worker. Crawlers never run it, so the server HTML, statuses, and headers they get are unchanged.

**Build check.** `npm run build` runs `scripts/sw-config-check.mjs` after the edge-safety check (tests in `scripts/sw-config-check.test.mjs`). It fails the build when the built `dist/omni-league/browser/ngsw.json` has any data group, an `index` other than `/index.csr.html`, a `navigationRequestStrategy` other than `performance`, or an asset URL that is not a same-origin path or contains `/api/`, `convex.cloud`, or `convex.site`. It also fails when a content-hashed `main-*`, `chunk-*`, or `polyfills-*` script or `styles-*` sheet in `browser/` is in no prefetch asset group: lazily loaded chunks, such as the phone sheet's, must open offline before their first use online (PR #107 testing). It prints `sw-config-check: PASS`, `sw-config-check: SKIP` (no `serviceWorker` option in `angular.json` and no `ngsw.json`: the kill switch), or one `sw-config-check: FAIL <problem>` line per problem. With the option set and no `ngsw.json`, it fails.

**One switch.** The `serviceWorker` option in `angular.json` decides both whether the build writes the worker and whether the app registers it. `npm run build` and `npm start` (`scripts/ng-convex.mjs`) pass it to the app as the build-time define `__SERVICE_WORKER__` and print `service worker: on` or `off`. `provideServiceWorker` registers only when that define is true in a production build (`src/app/core/service-worker/service-worker-build.ts`). A plain `ng build` gets the `angular.json` default, `false`, and registers nothing.

**Kill switch.** Each path ships through `gate:production`.

1. **Normal release.** A PR on `main` removes the `serviceWorker` build option from `angular.json`, and changes nothing else. The build then writes no `ngsw.json`, prints `service worker: off` and `sw-config-check: SKIP`, and the app registers no worker. Every client that next opens the app online gets a 404 for `ngsw.json`, deletes its caches, and unregisters (about 6 seconds after one navigation in the ADR's scratch run). The PR's Evidence block records a passing kill-switch rehearsal (below). The release PR ships it as usual.
2. **Emergency release.** A release from `main` would also ship everything merged since the last release. Instead, the deployer opens a release PR from a branch cut from `production` whose only change is the step above, labelled `gate:production`; the owner's merge ships it. The same change then lands on `main` through a normal PR before the next release, or the next release turns the worker back on.
3. **If the worker script itself fails to start,** either release serves the packaged `safety-worker.js` at the `ngsw-worker.js` URL instead, until users have unregistered ([Service worker devops](https://angular.dev/ecosystem/service-workers/devops)).

**Kill-switch rehearsal.** `e2e/pwa-kill-switch.spec.ts` rehearses step 1 on local production builds. It builds with the option, installs the worker in one client, rebuilds with the option removed from `angular.json` (restored afterwards), and serves that build on the same port. It then checks that the installed client deletes its caches and unregisters after one navigation, that a new client registers nothing within the 30-second registration window, and that neither page logs a console error or warning. It takes about a minute and is local only: `ci` and `npm run e2e` skip it. Run it with no Convex URL (as below) and a free port:

```sh
E2E_KILL_SWITCH=1 E2E_BASE_URL=http://localhost:4100 npx playwright test e2e/pwa-kill-switch.spec.ts
```

It starts and stops its own SSR server, and leaves the kill-switch build in `dist/`; run `npm run build` again before the production-build run below.

**Netlify Drawer.** The Drawer script changes `index.csr.html` after the build, so ngsw's hash check fails where it is injected, and the worker falls back to the network there: the app works, but not offline. The owner turns the Drawer off for Deploy Previews and Branch deploys (Netlify UI; owner, 2026-10-09). With it off, offline and update evidence from a preview counts as well as from a local production build.

**Local production-build run.** `npm run e2e` cannot test the worker: it rebuilds `dist/` in development mode. Run `e2e/pwa.spec.ts` against a production build instead:

```sh
npm run build                 # prints sw-config-check: PASS
npm run serve:ssr             # http://localhost:4000; PORT=<port> for another port
E2E_BASE_URL=http://localhost:4000 npx playwright test e2e/pwa.spec.ts
```

The spec runs in `chromium-mobile` only and is skipped without `E2E_BASE_URL`, so `ci` skips it. Stop `serve:ssr` afterwards ([dev cycle, Local processes](dev-cycle.md#local-processes)).

**`CONVEX_URL` for this run.** `scripts/ng-convex.mjs` compiles in the Convex URL from the environment, or else from `.env.local`. A URL that names a backend that is not running keeps the adapter's `online` signal false, so the offline note never goes and the spec's "note disappears" check fails for a reason unrelated to the worker. So either build with no Convex URL (`CONVEX_URL` unset in the environment and absent from `.env.local`; `online` then follows `navigator.onLine`), or run the sequence with data below.

**With data (saved copies, #82).** The saved-copy tests in `e2e/pwa.spec.ts` open the demo organizations of `seed:demo` (`DEMO` in `convex/seed.ts`), so they need a build against a seeded backend; without one they are skipped with that reason. Locally, with the e2e backend (#59) and its target check, ports 3210, 3211, and 4000 free:

```sh
node scripts/e2e-convex.mjs serve &           # the anonymous local backend; record its PID
node scripts/e2e-convex.mjs seed-demo         # sets PREVIEW_ORIGIN_PATTERN, runs seed:demo
CONVEX_URL=http://127.0.0.1:3210 npm run build
npm run serve:ssr &                           # record its PID
E2E_BASE_URL=http://localhost:4000 npx playwright test e2e/pwa.spec.ts --project=chromium-mobile
```

`seed-demo` sets `PREVIEW_ORIGIN_PATTERN` on the local backend because `seed:demo` refuses to write anywhere else (Demo data, Production guard); on that backend the pattern only admits this project's preview origins. Stop `serve:ssr` and the backend afterwards ([dev cycle, Local processes](dev-cycle.md#local-processes)). A preview seeded by `seed:demo` may replace the backend, the seed, and the build once the Drawer is off.

**Release check.** No `ci` job proves offline behaviour, because `e2e/pwa.spec.ts` needs a production build. Every release request (`gate:production`) records a run of the sequence with data above on the release commit, with the output in its Evidence block; the saved-copy tests must pass, not be skipped.

## Cleanup

A workflow deletes the Convex preview deployment of a PR after the PR merges, and a daily sweep deletes those of closed PRs (below). Without it, Convex deletes preview deployments 5 days after creation. Convex 1.46 documents `--preview-create` as deleting and recreating a preview deployment with the same name, so a PR preview build starts from an empty backend; `seed:demo` runs on every build, so the demo data is there either way. Staging uses `--preview-name` instead (#222, [ADR 0010 amendment](../decisions/0010-hosting-and-deployment.md#amendment-staging-keeps-its-convex-data-2026-10-13)): it reuses the deployment `main` and its data, and creates it when none exists, so the owner's test accounts and organizations survive a merge. Netlify deletes non-published deploys after 30 days on Free, or 90 days on paid plans. Until then a closed PR's preview URL keeps serving test data. Reusing the deployment does not extend its life: Convex deletes a preview deployment 5 days after it is created, whatever deploys it receives. Staging therefore stops working 5 days after `main` was created, merges or not, until the next merge creates it again with fresh data (re-seeded by that build), and the owner's test accounts go with it. Convex's preview deployments page says the expiration of an existing deployment can be changed in the dashboard deployment settings; whether that applies on the Free plan is unconfirmed, and the choice is the owner's.

**Schema changes meet staging's data.** Because `main` is reused, `npx convex deploy` validates `convex/schema.ts` against staging's stored rows, which a fresh PR preview never has. A PR that tightens the schema (a new required field, a narrowed union) without a backfill passes its own preview and `ci`, then fails the staging build after merge. `seed:demo`'s backfill runs after the deploy and cannot repair those rows. Staging then stays on the old build, and every later merge fails the same way. Each PR's Migration section therefore covers staging's stored data, and the deployer treats a schema-validation failure on staging as a missing migration.

### Freeing Convex preview slots (#158)

The Convex team caps deployments at 40, and a build that hits the cap fails with `DeploymentQuotaReached`. `.github/workflows/clean-previews.yml` ("Clean previews") runs `scripts/clean-previews.mjs` so a closed PR's slot is freed without anyone deleting it in the dashboard. It runs only on `main` and holds the token only there ([Where secrets live](#where-secrets-live)):

| Trigger                    | What it deletes                                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `push` to `main` (a merge) | Only `pr-<n>` for each PR number written as `(#<n>)` in a pushed commit subject, the form a squash merge writes (`--yes --pr <n>`). The script still requires that PR to be `CLOSED` or `MERGED`.         |
| Daily at 05:23 UTC         | Every `pr-<n>` whose PR is `CLOSED` or `MERGED` (`--yes`). This covers a PR closed without a merge, a commit with no `(#<n>)`, a backlog, and any push run that was skipped or failed.                    |
| `workflow_dispatch`        | The same sweep, but the `dry_run` input defaults to **true**: it lists what it would delete and deletes nothing. A manual run deletes only when `dry_run` is exactly `false`; any other value lists only. |

**First run.** The merge of the PR that adds this workflow is a push to `main`, so that run deletes only its own `pr-<n>`. Create the `preview-cleanup` environment before that merge ([Owner setup](#owner-setup-one-time), step 6); until its secret is set, the run skips with a notice. Before the first daily run, run the workflow by hand with `dry_run` ticked (`gh workflow run clean-previews.yml`), read the step log, and check that every `pr-<n>` listed belongs to a closed or merged PR and that nothing else is listed as deleted. Then untick `dry_run` (`gh workflow run clean-previews.yml -f dry_run=false`) or wait for the daily run.

- **Secret.** The job declares `environment: preview-cleanup` and reads the environment secret `CONVEX_TEAM_TOKEN` in the env of the one step that runs the script. `gh` reads the PR state with the built-in workflow token (`pull-requests: read`, `contents: read`; no other permission). If the secret is not set, the job skips with a notice and does not fail. Only a run on `main` can read it; what the token can do is under [Where secrets live](#where-secrets-live).
- **Setup.** [Owner setup](#owner-setup-one-time), step 6: create the environment `preview-cleanup` limited to the branch `main`, add a new token as its environment secret `CONVEX_TEAM_TOKEN`, delete the repository secret of the same name, and revoke the old token. Revoke the token in the dashboard if it leaks.
- **Events.** `push` to `main`, `schedule`, and `workflow_dispatch` only. There is no `pull_request`, `pull_request_target`, or `workflow_run` trigger, so no branch or PR run holds the token. There is no concurrency group, because a group lets GitHub replace a pending run and drop a delete. Runs may overlap, which is safe: every delete is idempotent, and a 404 (the preview already expired or was deleted) counts as already deleted. A run that still fails is caught by the next daily sweep.
- **Checking it.** The orchestrator reads the daily run's result (`gh run list --workflow clean-previews.yml`) and reports a failure to the owner ([dev cycle, Deploy](dev-cycle.md#8-deploy)). The step's log shows one line per deployment and a summary; it never shows the token.

**Manual fallback.** `npm run previews:clean` runs the same script from a terminal, with the same rules:

```sh
npm run previews:clean                 # list, ask for one y, delete
npm run previews:clean -- --dry-run    # list only
npm run previews:clean -- --yes        # delete without the prompt
```

It reads the token from `CONVEX_TEAM_TOKEN` in the environment, or prompts for it with nothing echoed, and needs `gh` installed and logged in. The script never prints, logs, or writes the token, and does not pass it to `gh`.

**What it deletes.** Only deployments that are all of: in the `omni-league` project of team `jason-bryan`, type `preview`, named exactly `pr-<n>` (`^pr-[1-9][0-9]*$`), and whose PR `gh pr view <n> --json state` reports as `CLOSED` or `MERGED`. It never touches `main` (staging), dev or production deployments, another project, an open PR's preview, or a PR whose `gh` lookup fails. The close event alone does not authorize a delete: the script still asks `gh` for the state, so a PR reopened before the run is kept.

**Output.** It lists the kept deployments with the reason, then the deployments to delete (deployment name, preview name, PR state), asks for `y`, and prints one line per deletion and a summary. It exits 1 if any delete failed. `--dry-run` never deletes, even with `--yes`.

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

**Service worker on remote runs.** A preview or staging build registers the service worker as soon as the app is stable, and once it controls the page it makes the page's fetches itself, so `page.route` and the page's `request` events miss them. With `E2E_BASE_URL` set, `e2e/auth-session.spec.ts` and `e2e/sign-up.spec.ts`, which intercept and count auth requests, hold the registration (`e2e/support/no-service-worker.ts`); other specs leave the worker on. A spec that adds such interception or counting does the same.

## Observed results

Recorded by #15's testing, then by #23 on PR #90's preview (the not-found page, the first server route with `Cache-Control: ... s-maxage=60`). The cold-start render check stays **partial** until #23 records its third fresh deploy and the owner's edge-function log. The first production release waits for a full pass.

| Check                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold start (3 fresh deploys, tester and owner's phone) | pass, partial until #23 (plain 404): tester `curl` 1.57 s, then 0.13 s; owner's phone on mobile data about 2 s and about 1.5-2 s (owner's estimates); no edge-function log entries for any of the three deploys ([#54 comment](https://github.com/jasonbryan/omni-league/pull/54#issuecomment-6074231628))                                                                                                                                                                                                                                                |
| `Cache-Status` of a repeated `/does-not-exist`         | pass (#23, PR #90): the rendered 404 (`public,max-age=0,s-maxage=60,stale-while-revalidate=300`; Netlify drops the spaces) is stored. First request `"Netlify Edge"; fwd=miss; fwd-status=404; stored`; later ones either `hit; ttl=<n>` with a rising `age` (tester: `hit; ttl=6`, `age: 54`; implementer: `hit; ttl=60`, then `ttl=59`), or `fwd=miss; ... stored` or `fwd=stale; ...; stored` again: requests reach different edge nodes, each with its own copy ([tester](https://github.com/jasonbryan/omni-league/pull/90#issuecomment-6086672181)) |
| Query string in the cache key                          | pass after the PR #90 fix: before it, `?token=T6` got the HTML stored for `?token=T1`, and `//x` got a stored 301 to `/x?token=BBB`. Now every edge-function response sends `Netlify-Vary: query` (passed on to the client), server HTML holds no query string, and the `//` redirect is `no-store` (`fwd=miss` every time). `?token=A` (stored, then `hit`), then `?token=B` and no query: each `fwd=miss; stored`, none holds another's value. `e2e/cache-key.spec.ts` repeats this against a preview                                                   |
| Server-route `noindex` on the preview                  | pass (#23): `/does-not-exist` and `/app/x` (rendered 404 then; the client shell since #62) send `X-Robots-Tag: noindex`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `X-Forwarded-Host: evil.example`                       | pass: normal `404 Not found`, no foreign content; no `trustProxyHeaders` warning in the edge-function log, so the header was dropped before the handler or ignored silently ([#54 comment](https://github.com/jasonbryan/omni-league/pull/54#issuecomment-6073945181))                                                                                                                                                                                                                                                                                    |
| `check-deploy-env.mjs production` against `pr-54`      | pass (expected failure): `FAIL AUTH_EMAIL_DISABLED is set`, no value printed ([#54 comment](https://github.com/jasonbryan/omni-league/pull/54#issuecomment-6074076490))                                                                                                                                                                                                                                                                                                                                                                                   |
| Netlify UI refuses a project name with `--`            | not claimable (owner, setup 5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Project names: Netlify caps project names at 37 characters, so `deploy-preview-<n>--charming-longma-28c00d` (40 or more) and `<24 hex>--charming-longma-28c00d` (48) cannot be claimed by another project. `main--charming-longma-28c00d` is already this project's staging hostname, so Netlify cannot route it to another project (the UI's availability check for it never completed, and nothing was saved). `PREVIEW_ORIGIN_PATTERN` stays as is ([#15 comment](https://github.com/jasonbryan/omni-league/issues/15#issuecomment-6073378587)).
