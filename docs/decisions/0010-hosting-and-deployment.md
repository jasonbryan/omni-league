# 0010: Hosting and deployment pipeline

- **Status:** Accepted
- **Gate:** `gate:technology`
- **Issue:** #9
- **Date:** 2026-10-07
- **Amended:** 2026-10-10, by #62 (PR #102): client-route shells are kept by no shared cache. See "Amendment: client shells and the shared cache (2026-10-10)" at the end. Where the sections above disagree with the amendment, the amendment applies.
- **Amended:** 2026-10-10, by #158: previews are cleaned up after their PR merges, by a workflow on `main` that holds one environment secret. See "Amendment: preview cleanup (2026-10-10)" at the end. Where the sections above disagree with the amendment, the amendment applies.
- **Amended:** 2026-10-13, by #222: staging reuses its Convex deployment, so its data survives a deploy. See "Amendment: staging keeps its Convex data (2026-10-13)" at the end. Where the sections above disagree with the amendment, the amendment applies.

## Context

ADR 0001 leaves hosting for the Angular app and the deployment pipeline (CD) undecided. This ADR decides both, because the host largely decides the CD mechanism (host-built versus GitHub Actions-built).

### Fixed requirements

**Owner answers on #9 and #5:**

1. **Budget:** up to about **$25/month for hosting and Convex combined**. The terms of both the host plan and the Convex plan must allow commercial use, because the app takes league fees through Stripe.
2. **Per-PR previews are required**, each with its **own Convex preview deployment**.
3. **Domain:** the host's default domain until the first production release.
4. **Public pages at launch**, search-indexed and with link previews.

**Owner answers on PR #33 (2026-10-07, relayed by the orchestrator from the chat session) to this ADR's four questions:**

5. **Netlify plan:** Personal ($9 per month) from the first production release.
6. **Previews:** public and `noindex`, removed by each platform's documented expiry, with no cleanup job (Decision, item 6). The owner first asked for previews to go offline when their PR is merged or closed, then withdrew that request (Owner decisions).
7. **Convex production region:** US East.
8. **Google consent page:** accept `<prod-deployment>.convex.site` for now, and revisit Convex Professional when revenue allows.

**From accepted ADRs:**

- **ADR 0006 (hybrid rendering).** Server routes render per request, static pages are prerendered, `/app/**` is client-only, and unknown URLs are server-rendered with status 404. The host must therefore run Angular SSR server routes; static-only hosting does not qualify. Issue #9 lists ten requirements that follow from this. Each one is answered under "Decision" below.
- **ADR 0003 (Node and npm).**
  - Any image that **builds** the app needs Node 26.11 or later, because of `devEngines`.
  - The built server bundle imports only Node built-ins.
  - If the server runtime's Node major is below 26, `@types/node` follows that runtime major.
- **ADR 0005 (e2e).** Playwright starts the built app with `npm run serve:ssr`.
- **ADR 0008 (auth).**
  - Google's consent page shows `<prod-deployment>.convex.site`.
  - The Convex region is chosen here.
  - #15 sets `PREVIEW_ORIGIN_PATTERN` from this ADR's preview hostname format.
- **AGENTS.md "Secrets".** Agents use preview deployments only. Production keys and production dashboards are the owner's.

### Facts that shaped the decision (checked 2026-10-07)

- **GitHub plan: Pro.** The repository is private on a personal account. The owner chose to upgrade to GitHub Pro (owner answer on #8, recorded in ADR 0009). `gh api repos/jasonbryan/omni-league/rulesets` now answers 200 (it answered 403 "Upgrade to GitHub Pro or make this repository public" on Free). For a private personal repository on Pro, GitHub documents ([deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)):

  | Feature                                                                                 | Private repo on Pro                                                                                    |
  | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
  | Environments, **environment secrets**, environment variables                            | **Yes** ("you must use GitHub Pro, GitHub Team, or GitHub Enterprise")                                 |
  | **Deployment branches and tags** (limit an environment to e.g. the `production` branch) | **Yes** ("For users on GitHub Pro or GitHub Team plans ... also available for private repositories")   |
  | **Required reviewers** on an environment                                                | **No.** "On GitHub Free, Pro, or Team, required reviewers are only available for public repositories." |
  | Wait timers, custom deployment protection rules, the admin-bypass setting               | **No** (public repositories only on Free, Pro, and Team)                                               |
  | Protected branches and branch/tag rulesets                                              | **Yes** (plans page; the rulesets API now answers 200 on this repository)                              |
  | Actions minutes                                                                         | 3,000 per month                                                                                        |
  - **What this changes:** a GitHub Actions-built pipeline can now keep a **production** deploy credential in a `production` environment limited to the `production` branch. A workflow run from a PR branch or `main` cannot read it.
  - **What it does not change:**
    - A **preview** deploy credential must be readable by workflows that run PR code, and agents write those workflows.
    - No environment can require an approval, because required reviewers are not available on Pro for private repositories.
    - Agents act through the owner's account, which is the repository admin. Neither rulesets nor environment branch policies can tell an agent from the owner. A ruleset requiring an approving review would block the owner's own merges as well, because GitHub does not let a PR author approve their own PR.

- **Build image Node versions.**
  - Netlify installs "any version that `nvm` can install", in order of precedence from `.nvmrc`.
  - Vercel builds and runs functions on **Node 24.x (default), 22.x, or 20.x only** ([Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), rechecked 2026-10-07). The only Node 26 entry in Vercel's changelog is for Vercel Sandbox, not Builds or Functions. A Vercel-hosted build therefore fails `devEngines` (`^26.11.0`), and on Vercel the build would have to run in GitHub Actions.
- **Vercel token scope.** Since 2026-07-30 a Vercel access token can be **project-scoped**. It "can only read and write resources belonging to that one project" ([access tokens](https://vercel.com/docs/accounts/access-tokens), [changelog](https://vercel.com/changelog/project-scoped-tokens)). No narrower scope is documented: a project token can still create production deployments, promote deployments, and read and change the project's environment variables for every environment.
- **Convex plans** ([pricing](https://www.convex.dev/pricing), [limits](https://docs.convex.dev/production/state/limits)):
  - **Free & Starter** cost $0 per month. Starter is pay-as-you-go above the included amounts, and Free has hard caps. Both include 1M function calls, 1 GB database I/O, 0.5 GB storage, and 20 GB-hours of action compute. Overage on Starter is $2.20 per 1M calls and $0.22 per GB of I/O.
  - Free & Starter have a 40-deployment team limit, **include preview deployments**, and **do not include custom domains**.
  - **Professional** costs $25 per developer per month and includes custom domains.
  - Preview deployments are deleted automatically after **5 days** on Free and Starter ([multiple deployments](https://docs.convex.dev/production/multiple-deployments)).
  - `--preview-create` "can only be used with a preview deploy key" ([deploy CLI](https://docs.convex.dev/cli/reference/deploy)).

## Options

Every candidate must run SSR server routes, give each PR a preview with its own Convex backend, build on Node 26.11+, cache server responses by `Cache-Control` at a CDN, keep the production key away from PR builds, and fit the budget.

### Option A: Netlify, with Angular SSR on Netlify Edge Functions (`@netlify/angular-runtime`)

- **What it is.**
  - Netlify builds the app from Git on its own build image.
  - Its Angular build plugin `@netlify/angular-runtime` (4.0.0, MIT, maintained by Netlify) turns `dist/<app>/server/` into one edge function. The function serves every path that is not a static file or a prerendered route.
  - Static files are served from Netlify's CDN.
  - Deploy previews, branch deploys, and environment variables with a different value per deploy context are built in.
- **Cost.**
  - **Free:** $0, 300 credits per month, hard limit. The site is paused when the credits run out.
  - **Personal:** $9 per month, 1,000 credits, auto-recharge available.
  - **Pro:** $20 per month, 3,000 credits.
  - **Metering:** production deploys cost 15 credits each; web requests (static and edge) cost 2 credits per 10k; bandwidth costs 20 credits per GB. Deploy previews, branch deploys, and failed deploys are **not metered** ([credit-based pricing](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)).
- **Commercial use: allowed.** Netlify's [Self-Serve Subscription Agreement](https://www.netlify.com/legal/self-serve-subscription-agreement/) grants use of the Services with no personal or non-commercial restriction. The Free Usage Tier "is made available ... to allow users to experience Netlify's Services" and may be changed or discontinued (§6).
- **Pros.**
  - **Deploy keys never enter GitHub.** The preview `CONVEX_DEPLOY_KEY` and the production key are Netlify environment variables, set per deploy context. Netlify injects the production value only into production-context builds.
  - **The build runs on Node 26.** The build image reads `.nvmrc` (`26`).
  - **The SSR adapter is first-party and covers Angular 22.** Its test fixtures include `angular-22`.
  - **Allowed hosts are computed per deploy, as exact hostnames.** No wildcard is needed (Decision, item 5).
  - **The CDN honours `s-maxage` and `stale-while-revalidate`** on edge-function responses.
  - **Previews and branch deploys cost nothing**, and **instant rollback** is built in.
  - **Cheapest qualifying option:** $0 until the first production release, then about $9.
- **Cons and risks.**
  - **The SSR runtime is Deno, not Node.**
    - Netlify Edge Functions run "in a secure runtime based on Deno" and support Node built-ins through `node:` imports.
    - `src/server.ts` changes to the `AngularAppEngine` entry. Express and `NG_ALLOWED_HOSTS` go away.
    - `node dist/<app>/server/server.mjs` no longer starts a server, so a small local runner replaces it for e2e (Decision, item 2).
  - **50 ms CPU limit per request** ([edge function limits](https://docs.netlify.com/build/edge-functions/limits/)). The limit "tracks all time spent running your scripts. Execution time does not include time spent waiting for resources or responses."
    - The spike measured 2.8 ms (median) and 10 ms (p95) of CPU for a warm render of a 60-row page.
    - The first render in a fresh process took 78 ms on Node 26.11 and 86 ms on Node 24.16, because it lazily loads and compiles `main.server.mjs`.
    - "All time spent running your scripts" reads as including that first-render work. Netlify does not say whether a single over-limit request on a cold isolate is terminated or tolerated. If it is terminated, the first request on each cold edge isolate fails, and at low traffic a large share of requests reach a cold isolate.
    - This is the main risk of this option. Waiting on Convex does not count, but render CPU does.
    - **Mitigation:** #15 checks it on a real deploy before any production traffic exists (Consequences). If the check fails, the fallback stays on Netlify and moves SSR to Netlify Functions on Node (Decision, item 1). That keeps the secrets model, the builds, and the cost, and needs no move to Option B.
  - **Environment-variable scopes are Pro-only.** On Free and Personal, a variable has every scope, including Functions, so the production deploy key is also readable through `Netlify.env` inside the production edge function. Server code never reads it (rule in Consequences). The Pro plan ($20) can limit it to Builds.
  - **The Free plan pauses all sites at 300 credits.** Production traffic needs Personal or higher.

### Option B: Vercel Pro, built in GitHub Actions and deployed with `vercel deploy --prebuilt`

- **What it is.**
  - Vercel Functions on Node 24 (Fluid compute), behind Vercel's CDN.
  - Vercel's Angular preset is static-only: its `defaultRoutes` fall back to `/index.html` (`vercel/vercel` `packages/frameworks/src/frameworks.ts`). SSR therefore needs a repository script that writes a Build Output API directory (a Node function wrapping the Express `reqHandler`).
  - Vercel builds on Node 24 at most, so the build must run in GitHub Actions on Node 26 and upload with the Vercel CLI (`vercel` 62.7.0, Apache-2.0).
- **Cost.**
  - **Pro:** $20 per month per developer seat, with $20 of included usage. Beyond that: function invocations $0.60 per 1M, active CPU $0.128 per hour, 10M CDN requests and 1 TB of transfer included.
  - **Hobby is excluded:** "Our Hobby plan is for personal, non-commercial use" ([pricing](https://vercel.com/pricing), [Hobby plan](https://vercel.com/docs/plans/hobby)).
- **Pros.**
  - **Node runtime:** the CLI's Express `src/server.ts` (including PR #30's error handler), `NG_ALLOWED_HOSTS`, and the local `serve:ssr` stay unchanged. Functions have no 50 ms CPU cap, so the edge cold-start risk of Option A does not exist here.
  - **The CDN honours `s-maxage` and `stale-while-revalidate`** ([CDN cache](https://vercel.com/docs/caching/cdn-cache)).
  - **GitHub Pro now fixes the production half of the secrets problem.** The production Convex key and a production Vercel token can be environment secrets in a `production` environment limited to the `production` branch, so PR and `main` workflows cannot read them.
- **Cons and risks, re-checked under GitHub Pro.**
  - **The preview half of the secrets problem remains.**
    - Previews must be built in GitHub Actions from PR code, because Vercel cannot build on Node 26. The preview job therefore needs a Vercel token in an environment open to PR branches, and agents write those workflows.
    - Even the new project-scoped token "can only read and write resources belonging to that one project". In that project it can create a production deployment, promote any deployment, and read or change production environment variables. Vercel documents no token limited to previews.
    - An agent-written workflow could therefore act on production with that token. This still conflicts with AGENTS.md "Secrets".
    - The usual workaround builds the PR without secrets and deploys from a trusted `workflow_run` job. ADR 0009 forbids `workflow_run` on PR code.
  - **No Node 26 build on Vercel.** The Git integration builds on Node 24 at most, so `npm ci` fails `devEngines`. Downloading a Node 26 toolchain inside Vercel's install command would work around it, but Vercel does not support that, and it would add an unverified binary download to every build. It is not adopted.
  - **GitHub Actions minutes (ADR 0009).** About 128 builds a month (90 previews, about 30 staging, 8 production), at about 3 to 4 minutes each with no package cache (ADR 0009 requires `package-manager-cache: false` in a job that holds deploy secrets), add about **400 to 500 minutes**. ADR 0009, revised for the owner's "minimize CI usage" direction, estimates about 340 to 410 minutes now and 510 to 680 once feature e2e grows. Builds in Actions would roughly double or more than double that, which contradicts the owner's direction. Netlify builds on its own image, which costs no Actions minutes.
  - **Previews are protected by default.** Vercel Authentication is on for previews, so #15's smoke test would need a "Protection Bypass for Automation" secret in GitHub.
  - **Custom code:** Vercel's Angular preset is still static-only (`defaultRoutes` fall back to `/index.html`, rechecked 2026-10-07), so the repository would own a Build Output API script. No first-party adapter exists.
  - **Cost:** $20 of the $25 budget, which leaves $5 for Convex.
- **Verdict under GitHub Pro.** Pro removes one of this option's three blockers: the production key can now be kept from PR workflows. The preview token scope, the Node 26 build, and the minutes remain. Option B's real advantage, a Node runtime with no CPU cap, is also available on Netlify itself (Netlify Functions, Decision item 1). It does not need a move to Vercel.

### Option C: Cloudflare Workers (Workers Paid, with Workers Builds)

- **What it is.**
  - Workers run a Web `Request`/`Response` handler (`AngularAppEngine`) on workerd, and Workers Static Assets serve `browser/`.
  - The cost is $5 per month on Workers Paid. The Free plan's limit of 10 ms CPU per invocation is below the measured first render.
  - Workers Cache now honours `Cache-Control` on Worker responses, including on `workers.dev`.
- **Rejected.**
  - **Build secrets.** Workers Builds has one set of "Build variables and secrets", and the documentation shows no per-branch values ([builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)). Preview builds, which run PR code, would therefore see the production Convex deploy key. Preview-specific settings exist only for runtime variables.
  - **No first-party Angular SSR adapter.** Cloudflare's Angular guide covers static assets only.
  - **Not Node.** The runtime is workerd.
  - **GitHub Pro does not rescue it.** Building in GitHub Actions instead of Workers Builds would put a Cloudflare API token in an environment that PR workflows can read. A token with Workers edit permission can also deploy the production Worker, which is the same preview-token problem as Option B. It would also spend Actions minutes.

### Option D (baseline): a plain Node service, Google Cloud Run

- **What it is.**
  - A container that runs the CLI's Express `server.mjs` unchanged, on Node 24 or 26.
  - Previews are revision tags deployed with `--no-traffic`, at `https://<tag>---<service>-<hash>.a.run.app` ([rollouts](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)).
- **Rejected.**
  - **No CDN on `run.app`.** Cloud CDN needs a global external Application Load Balancer ([Cloud CDN overview](https://docs.cloud.google.com/cdn/docs/overview)). Its forwarding rule is billed hourly (about $18 per month at list price), which takes most of the budget, so requirement 4 is not met.
  - **Keys in GitHub.** Previews would deploy from GitHub Actions. Under GitHub Pro, Workload Identity Federation can bind a production deployer to the `production` environment's OIDC claim, so no long-lived key is stored. The preview deployer is still usable by PR workflows, though, and Cloud Run IAM has no permission that allows only `--no-traffic` revisions. Previews would also need their own service or project, and every build would spend Actions minutes.
  - The CDN cost alone still rules this option out.

### Also considered

- **Render.** It is a Node web service, edge caching now honours `Cache-Control` on paid services, and Starter costs $7. Rejected for two reasons:
  - Service previews "copy all of their settings over from their base service ... This includes environment variables", so a PR's first build would run with the production key ([service previews](https://render.com/docs/service-previews)).
  - Per-preview overrides (`previewValue`) need preview environments on a Professional workspace, which goes over budget.
- **Firebase App Hosting.** No per-PR preview deployments are documented. Firebase Hosting preview channels are a different product.
- **Netlify keeping the CLI's Express `server.ts`.** The plugin replaces a byte-identical default `server.ts` at build time: the CLI 22.2.2 file's SHA-256 is on its known list. Rejected:
  - Prettier (ADR 0002) reformats that file, and an unknown signature fails the build.
  - Local e2e would then test a different server entry from the one production runs.

## Decision

**Adopt Option A: Netlify with the Angular runtime on Edge Functions, built by Netlify from Git; Convex Free & Starter.** The items below follow the numbering of "Required by ADR 0006" in #9.

### 1. Server runtime and Node versions

- **SSR runs as one Netlify Edge Function**, generated at build time by `@netlify/angular-runtime`.
  - The function wraps `netlifyAppEngineHandler` from `dist/<app>/server/server.mjs`.
  - That handler is a Web `Request`/`Response` handler built on `AngularAppEngine`, exported with `createRequestHandler` ([runtime README](https://github.com/netlify/angular-runtime#request-handling)).
  - The edge functions documentation says they run "in a secure runtime based on Deno", with Node built-in modules supported ([edge functions overview](https://docs.netlify.com/build/edge-functions/overview/), [API](https://docs.netlify.com/build/edge-functions/api/)).
- **Runtime Node major: none.**
  - The deployed runtime is Deno, managed by Netlify, so Angular's Node range `^22.22.3 || ^24.15.0 || ^26.0.0` does not apply to it.
  - The local runner (item 2) runs the same handler on the developer's Node, which is 26 under `devEngines`. That is within the range.
- **Build Node: 26.**
  - The build runs on Netlify's build image (Ubuntu 24.04). It installs the Node version named in `.nvmrc` ("any version that `nvm` can install").
  - ADR 0003's `.nvmrc` holds `26`, which resolves to the latest 26.x, 26.11 or later ([available software](https://docs.netlify.com/build/configure-builds/available-software-at-build-time/), [dependency management](https://docs.netlify.com/build/configure-builds/manage-dependencies/)).
  - `devEngines` fails the install if Node is older than that.
- **`@types/node` stays at 26** (ADR 0003's default). The rule "follow the runtime major if below 26" has no Node major to follow.
  - `src/server.ts` is Web-API-only code with no `node:` imports. The runtime helper's own `node:process` import is the one exception, because it lives inside the package.
- **Fallback if the 50 ms CPU limit bites: Netlify Functions on Node.** #15 checks the first request after a fresh deploy, before any production traffic (Consequences). If edge cold starts fail it, a superseding ADR moves SSR to a Netlify Function (AWS Lambda), and everything else stays the same:
  - **Handler:** the same `netlifyAppEngineHandler`. Netlify Functions take a Web `Request` and return a `Response`, so `src/server.ts` does not change. A function file (`netlify/functions/ssr.mts`) wraps the handler, and the plugin's edge function is turned off. `@netlify/angular-runtime` generates only an edge function, so this wiring is repository-owned.
  - **Runtime:** Node, with no per-request CPU cap. The synchronous limit is 60 s. The functions runtime follows the build's Node version only if that version is a valid AWS Lambda runtime. Otherwise it falls back to Node 24 ([functions configuration](https://docs.netlify.com/build/functions/optional-configuration/)), which is within Angular's range. In that case `@types/node` follows 24, as ADR 0003 requires.
  - **Region:** `cmh` (US East, Ohio) by default for new sites. Changing it needs Netlify Pro.
  - **Cost:** "Functions compute" is 10 credits per GB-hour. At the stated traffic, 80,000 uncached invocations at 1 GB and about 0.1 s each come to about 2.2 GB-hours, or about 22 credits. The plan stays Personal.
  - **Unchanged:** secrets, builds, previews, and Actions minutes.
  - **To verify in that ADR:** CDN caching of function responses by `Cache-Control`, and the static, prerendered, and 404 routing.
  - Option B is no longer the fallback. Under GitHub Pro it still loses on the preview token scope, the Node 26 build, and the minutes (Options).

### 2. Server entry and added packages

`src/server.ts` is **replaced** by the runtime's documented App Engine entry, for `@angular/ssr` 21.2.9 and later:

```ts
import { AngularAppEngine, createRequestHandler } from '@angular/ssr';
import {
  getAllowedHosts,
  getContext,
  getTrustProxyHeaders,
} from '@netlify/angular-runtime/app-engine.js';

const angularAppEngine = new AngularAppEngine({
  allowedHosts: getAllowedHosts(),
  trustProxyHeaders: getTrustProxyHeaders(),
});

export async function netlifyAppEngineHandler(request: Request): Promise<Response> {
  const result = await angularAppEngine.handle(request, getContext());
  return result || new Response('Not found', { status: 404 });
}

export const reqHandler = createRequestHandler(netlifyAppEngineHandler);
```

**What this changes:**

- **Express is removed:** `express` and `@types/express` are dropped from ADR 0006's package table.
- **`NG_ALLOWED_HOSTS` is no longer available**, because `AngularAppEngine` reads no environment. Allowed hosts come from build-time `security.allowedHosts` (local hosts) plus the per-deploy list in item 5.
- **The server bundle shrinks.** `server.mjs` went from 920 KB to 9.7 KB in the spike.
- **`ng serve` keeps working.** The CLI dev server uses the exported `reqHandler`.

**Local runner: `scripts/serve-ssr.mjs`** (about 60 lines, Node built-ins only). It replaces `node dist/<app>/server/server.mjs` as the `serve:ssr` script, so ADR 0005's Playwright `webServer` (`npm run serve:ssr`) does not change. It does three things:

- serves `dist/<app>/browser/` with the item 3 cache headers, rejecting paths that escape that directory and serving no directory index;
- converts every other request to a Web `Request` and calls `netlifyAppEngineHandler`;
- sets `NETLIFY_LOCAL=true` before importing, so the runtime adds no Netlify hostnames.

It must not import `@angular/ssr/node` from `node_modules`. In the spike that loaded a second, unlinked copy of Angular and failed with "JIT compilation failed for injectable PlatformLocation". The spike's version of the runner passed every check in "Test evidence".

**Packages, CLIs, Actions, and apps that this ADR adds:**

| Item                                     | Version                | Licence       | Type                               | Notes                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ---------------------- | ------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@netlify/angular-runtime`               | 4.0.0 (pinned exactly) | MIT           | devDependency                      | Netlify build plugin, and the `app-engine.js` helpers that `server.ts` imports. The README says it must be installed in the project for Angular 19+ SSR. Declared in `netlify.toml` `[[plugins]]` (the spike's `netlify serve` only loaded it once declared). No install scripts. |
| `@netlify/edge-functions`                | 3.0.8                  | MIT           | transitive                         | Types and helpers. No install scripts.                                                                                                                                                                                                                                            |
| `@netlify/types`                         | 2.8.0                  | MIT           | transitive                         | No install scripts.                                                                                                                                                                                                                                                               |
| Netlify GitHub App                       | n/a                    | Netlify terms | GitHub App on this repository only | Builds on push and PR, and posts commit statuses, checks, and the preview link comment.                                                                                                                                                                                           |
| Netlify CLI (`netlify-cli` 27.11.2, MIT) | n/a                    | n/a           | **Not added**                      | Used only in this ADR's scratch test. It has a `postinstall` script, and the pipeline does not need it.                                                                                                                                                                           |
| GitHub Actions                           | none                   | n/a           | n/a                                | Netlify builds and deploys, so no deploy Action is added. #15's smoke test runs locally (ADR 0009), so no smoke workflow is added either.                                                                                                                                         |

None of these needs an `allowScripts` entry (ADR 0003). `semver`, the runtime's other dependency, is already in the tree.

### 3. Static assets, the `/app/**` shell, and unknown paths

- **Static files are served from Netlify's CDN.**
  - Netlify caches them at the edge for up to a year and **invalidates them on every deploy** ("all new deploys invalidate the cache for the given deploy context").
  - By default it sends browsers `Cache-Control: public, max-age=0, must-revalidate`, as seen in the spike ([caching overview](https://docs.netlify.com/build/caching/caching-overview/)).
- **Long-lived browser caching, only for content-hashed files.** `netlify.toml` `[[headers]]` sets `Cache-Control: public, max-age=31536000, immutable` on these paths. Netlify header paths allow `*` "at any place inside of a path segment" ([custom headers](https://docs.netlify.com/manage/routing/headers/)).

  | Path                                                            | Contents                                                                                                         |
  | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
  | `/media/*`                                                      | `dist/<app>/browser/media/`, the content-hashed Inter `.woff2` files from ADR 0007 that the server HTML preloads |
  | `/main-*.js`, `/chunk-*.js`, `/polyfills-*.js`, `/styles-*.css` | the hashed bundles, named `<name>-<8-char hash>.<ext>`                                                           |

  **Rule:** nothing in `public/` may use those names. The PR reviewer checks this.

- **Unhashed files are revalidated on every use.** These are the prerendered `index.html` for `/`, `index.csr.html`, `favicon.ico`, and anything else copied from `public/`.
  - They keep Netlify's default `public, max-age=0, must-revalidate` for browsers.
  - Their CDN copy is replaced atomically on each deploy, so a deploy never leaves stale HTML or icons.
  - Prerendered routes with `headers` in `serverRoutes` get them as Netlify headers, because the plugin's `setUpHeaders` copies them.
- **`/app/**` Client routes go through the edge function, not a static rewrite.**
  - The function answers with the `index.csr.html` shell. In the spike, `/app/x` returned 200 with an empty `<app-root>`.
  - No host rewrite to `index.csr.html` is used. One would not work anyway, because edge functions run before redirects.
  - Before the first `/app` feature adds a client route, `/app/x` falls through to the `**` Server route: Express no longer exists, so the answer is #23's 404 page, or the engine's plain 404 before #23. That matches the plan-review note on #9.
- **Every non-asset path, including unknown paths, reaches the SSR function.**
  - The generated config is `path: "/*"`, with `excludedPath` listing only `/.netlify/*`, every file in `dist/<app>/browser/`, and the prerendered routes. This is the runtime's `setUpEdgeFunction.js`, and the spike's generated `.netlify/edge-functions/angular-ssr/angular-ssr.mjs` shows the same.
  - The function returns the engine's `Response` as is, so **Netlify passes the server's status through.** In the spike, `/does-not-exist` returned 404 with the not-found view and its `Cache-Control`, not a Netlify 404 page.
  - If the engine returns `null`, the handler answers a plain 404.

### 4. CDN caching of server responses

- **The runtime marks its edge function `cache: "manual"`.** Netlify then caches edge-function responses according to their `Cache-Control` ([runtime README](https://github.com/netlify/angular-runtime#caching-responses-from-ssr), [edge functions configuration](https://docs.netlify.com/build/edge-functions/optional-configuration/#response-caching)).
- **Netlify supports `s-maxage` (which takes precedence over `max-age` for its shared cache) and `stale-while-revalidate`** (caching overview, "Supported Cache-Control headers").
  - ADR 0006's `public, max-age=0, s-maxage=60, stale-while-revalidate=300` therefore caches public pages for 60 s at the edge and revalidates in the background.
  - The browser always revalidates.
- **Cached edge responses are not invocations:** "Cached responses from edge functions configured for caching do not count toward edge function invocations."
- **Netlify's `durable` cache directive has no effect on edge-function responses**, so caching is per edge node. The cost estimate assumes no cache hits.
- **404 responses with the same header:** Netlify's documentation names no status restriction on caching, and it does not say whether 404s are cached either.
  - The cost estimate counts **every 404 as uncached**.
  - #15 records the actual behaviour: request an unknown URL twice and read Netlify's `Cache-Status` header.
- **Client-route shells:** `app/**` sets `headers: { 'Cache-Control': 'public, max-age=0, s-maxage=86400' }` in `serverRoutes`.
  - The shell is identical for every user and changes only with a deploy, and Netlify purges the deploy context's cache on every deploy.
  - Without a header the shell is never cached, which costs one invocation per app load.

### 5. Allowed hosts and proxy headers

The engine merges three sources: `security.allowedHosts` from `angular.json`, the `allowedHosts` engine option, and nothing from the environment (`@angular/ssr` 22.2.2 `AngularAppEngine.getAllowedHosts`).

- **`angular.json`** keeps `["localhost", "127.0.0.1"]` (ADR 0006), for local e2e.
- **`getAllowedHosts()`** builds **exact hostnames** for the current deploy from build-time variables. The plugin embeds them into the edge function at build time. The list is:
  - the host of `DEPLOY_PRIME_URL` (`deploy-preview-<n>--<site>.netlify.app`, or `main--<site>.netlify.app`);
  - the host of `DEPLOY_URL` (`<deploy-id>--<site>.netlify.app`);
  - the host of `URL` (`<site>.netlify.app`, or the custom domain later);
  - `<site>.netlify.app`, `<site-id>.netlify.app`, and `<deploy-id>--<site-id>.netlify.app`.
- **Every production and per-PR preview hostname is therefore allowed without a wildcard**, and a custom domain added later is picked up from `URL` automatically.
- **`*` is never used.** No `*.netlify.app` is used either, because that would allow every Netlify customer.
- **A request with any other `Host` gets 400.** The spike showed this locally for both `Host: evil.example` and `X-Forwarded-Host: evil.example`.
- **`trustProxyHeaders` is not needed.**
  - The runtime passes `['x-forwarded-for']`. Angular uses only `Forwarded` and `X-Forwarded-Host`, `-Proto`, `-Port`, and `-Prefix` to build the request URL, so that value changes nothing.
  - The edge `Request` already carries the real `https://` URL, so no proxy header is trusted for routing.

### 6. Per-PR preview flow

- **Trigger.** A PR against `main` gets a Netlify Deploy Preview.
  - `main` is configured as a branch-deploy branch, and Netlify builds previews for PRs against the production branch or a branch-deploy branch.
  - For private repositories, Netlify's Deploy Request Policy builds only for **recognized authors**: team members and Git Contributors linked to the Netlify team ([deploy permissions](https://docs.netlify.com/deploy/deploy-overview/#deploy-permissions)).
- **Build.** These are `netlify.toml` per-context commands; values are fixed in #15.

  ```toml
  [build]
    publish = "dist/<app>/browser"

  [context.deploy-preview]
    command = "npm ci && npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name CONVEX_URL --preview-create \"pr-$REVIEW_ID\""

  [context.branch-deploy]   # main: staging
    command = "npm ci && npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name CONVEX_URL --preview-create \"$HEAD\""

  [context.production]
    command = "npm ci && npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name CONVEX_URL"

  [[plugins]]
    package = "@netlify/angular-runtime"
  ```

  - **`npm ci`.** Netlify itself runs `npm install`. The extra `npm ci` makes the installed tree exactly match the lockfile, as ADR 0003 requires.
  - **`npm run build`** is ADR 0006's `node scripts/ng-convex.mjs build`. It puts the preview's `CONVEX_URL` and its derived site URL into both bundles.

- **One Convex preview deployment per PR.**
  - It is named `pr-<number>` (`REVIEW_ID`: "for example, `deploy-preview-12` is for PR #12"), rather than the branch name.
  - That way a release PR (`main` into `production`) does not recreate the staging backend `main`, and a reused branch name cannot collide.
  - `--preview-create` deletes and recreates the backend on every push, so each PR preview starts with fresh data (staging reuses its backend; see the 2026-10-13 amendment).
- **It is a server deployment.** Each preview is an atomic Netlify deploy with its own copy of the edge function and the static files. It does not share a function with production.
- **URL reporting.** Netlify's GitHub App posts the preview link as a PR comment and as a commit status, both on by default ([deploy notifications](https://docs.netlify.com/deploy/deploy-notifications/)).
  - The URL is predictable: `https://deploy-preview-<n>--<site>.netlify.app`.
  - **The preview smoke test runs locally, not in GitHub Actions** (ADR 0009). In dev cycle Phase 5 the tester runs `E2E_BASE_URL=https://deploy-preview-<n>--<site>.netlify.app npm run e2e -- <smoke spec>` from its own machine and pastes the output in the PR.
  - The smoke run needs **no secrets**, because previews are public (owner answer 6).
  - No workflow is triggered by Netlify's commit `status`. ADR 0009 rejects one: it would fire for every Netlify deploy, drafts included, at roughly the cost of all of CI.
- **Staging.** Every merge to `main` builds the branch deploy `https://main--<site>.netlify.app` with the Convex preview deployment `main`. The deployer smoke-tests it with the same local run against that URL (dev cycle Phase 8, "Preview/staging").
  - If `main` gets no push for 5 days, Convex removes that backend and staging stops working until the next merge.
- **Cleanup is by documented expiry. No cleanup job is needed** (owner decision 2).
  - Convex deletes preview deployments 5 days after creation.
  - Netlify deletes non-published deploys after 30 days on Free, or 90 days on paid plans, Personal included ([manage deploys](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)). Until then, a closed PR's `deploy-preview-<n>--` URL and its deploy permalinks stay reachable.
  - Neither leaves a cost behind: previews are unmetered, and expired Convex previews free their deployment slot.
- **`noindex`.** Netlify adds `X-Robots-Tag: noindex` to deploy previews and deploy permalinks, but this is not in its documentation: a Netlify support answer (2021) says so, and a 2026 forum report says the header went missing. #15 therefore checks the header on a static file, a server-route response, and a 404 from the preview, and on staging. If any lacks it, #15 adds it for the non-production contexts in the repository.

### 7. Cost

#### Traffic assumption

This is the first months after the first production release.

| Traffic                                                                       | Per month                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| Public Server-route page views (organization, location, league, registration) | 30,000                                                 |
| `/app/**` Client-route loads (HTML shell)                                     | 20,000                                                 |
| Prerendered page views                                                        | 5,000                                                  |
| Crawler and bot requests to unknown URLs (404)                                | 30,000                                                 |
| Monthly active users                                                          | 1,000 (ADR 0008's basis)                               |
| Static asset requests                                                         | 165,000 (3 per human page load, after browser caching) |
| Production deploys                                                            | 8                                                      |
| PRs                                                                           | 30, at about 3 pushes each, so 90 preview builds       |

#### Uncached server invocations (worst case: no CDN hits)

- 30,000 public renders.
- 20,000 app shells. This is 0 once the shell's `s-maxage` is warm; the worst case is counted here.
- 30,000 bot 404s, all counted as uncached (item 4).
- **Total: 80,000 edge invocations.**
  - Netlify bills them only as web requests: 16 credits.
  - CPU is not billed. At the measured 3 ms warm median, this is about 4 CPU-minutes per month.

#### Netlify (credits)

| Item                                                                                                                                                                  | Credits       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Web requests: 85,000 HTML and 165,000 asset requests                                                                                                                  | 50            |
| Bandwidth: about 7.4 GB (20 KB per HTML page, about 40 KB per asset request, 5 KB per 404)                                                                            | 148           |
| Production deploys: 8 × 15                                                                                                                                            | 120           |
| Previews and staging: 90 preview builds and about 30 staging builds; builds are unmetered, and about 10,000 review and smoke requests plus 0.3 GB add about 8 credits | 8             |
| **Total**                                                                                                                                                             | **about 326** |

This is above Free's 300, so production needs **Personal ($9, 1,000 credits)**, which the owner chose (owner answer 5).

#### Convex (Starter)

| Source                                                            | Function calls                 |
| ----------------------------------------------------------------- | ------------------------------ |
| Server renders: 30,000 × 2 queries                                | 60,000                         |
| Bot 404s that hit slug routes: about 10,000 × 1                   | 10,000                         |
| Hydrated public pages: 30,000 × 3 (live subscription and updates) | 90,000                         |
| App: 20,000 loads × 20 calls                                      | 400,000                        |
| Auth: 250 × 1,000 MAU (ADR 0008)                                  | 250,000                        |
| Previews: 90 × 300                                                | 27,000                         |
| Staging: 30 × 300                                                 | 9,000                          |
| **Total**                                                         | **about 0.85M** (included: 1M) |

- Database I/O is about 1 GB, at roughly 1 KB per call, against 1 GB included, so at most about $0.22.
- Storage stays well under 0.5 GB.
- Previews and staging use at most about 15 live preview deployments against the 40-deployment limit.

#### Monthly total

| Period                                                                            | Netlify      | Convex               | Total        |
| --------------------------------------------------------------------------------- | ------------ | -------------------- | ------------ |
| Before the first production release (previews and staging only; about 20 credits) | Free, $0     | Free, $0             | **$0**       |
| At the assumed traffic                                                            | Personal, $9 | Starter, about $0.20 | **about $9** |

**Per-PR preview cost at 30 PRs per month:**

| Item                              | Cost                                                                                                                                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host build minutes                | $0: deploy previews are non-metered, and builds are not credit-metered                                                                                                                                                                    |
| GitHub Actions minutes for builds | 0: Netlify builds on its own image, and #15's smoke run is a local run by the tester and deployer (ADR 0009). A host built in Actions (Options B to D) would add about 400 to 500 minutes a month against ADR 0009's Pro budget of 3,000. |
| Preview invocations and requests  | about 8 credits, about $0.05                                                                                                                                                                                                              |
| Convex preview usage              | 27,000 calls, within the included amount: $0                                                                                                                                                                                              |

#### When the total passes about $25 per month

Scale the traffic by a factor _k_. Previews and production deploys stay fixed.

| _k_ | Netlify                       | Convex | Total    |
| --- | ----------------------------- | ------ | -------- |
| 1   | $9                            | ~$0.2  | ~$9      |
| 2   | $9 (about 524 credits)        | ~$1.7  | ~$11     |
| 4   | $9 (about 920 credits)        | ~$5.7  | ~$15     |
| 5   | $14 (one 500-credit pack, $5) | ~$7.7  | ~$22     |
| 6.5 | $14                           | ~$10.7 | **~$25** |
| 7   | $19 (two packs)               | ~$11.7 | ~$31     |

- **The total passes about $25 per month at about 6.5× the assumption.** That is roughly 195,000 public page views, 130,000 app loads, and 195,000 bot 404s per month, or about 6,500 MAU.
- Convex calls are the first cost to grow: they pass the included 1M at about 1.2×.
- For comparison, Option B costs about $20 at 1× and passes $25 at about 3.5×. Option C would cost about $5 at 1×.

#### Commercial use

- **Netlify:** the Self-Serve Subscription Agreement has no non-commercial clause (above).
- **Convex:** the [Terms of Service](https://www.convex.dev/legal/tos) (effective February 27, 2026) govern every plan, including Free & Starter, and contain no personal or non-commercial restriction.
  - §2.1 grants use "solely for Customer's internal business purposes".
  - §4.4 states that "application builders may embed the Software as part of their customer-facing products solely on serverless instance types". Free & Starter are serverless.
- **Excluded for this reason:** Vercel Hobby ("personal, non-commercial use only").

### 8. Secrets, fork PRs, and preview access

| Secret                                                                          | Where it is stored                                                                               | What can read it                                                                                                                                                                             | Who handles it                                                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview `CONVEX_DEPLOY_KEY` (Convex **preview** deploy key)                     | Netlify environment variable, values for the **Deploy Previews** and **Branch deploys** contexts | Deploy-preview and branch-deploy builds, which run code from PRs and `main`                                                                                                                  | The owner creates it once. Agents' code may see it in preview builds, which AGENTS.md allows, because it can only create and modify preview deployments. |
| Production `CONVEX_DEPLOY_KEY` (Convex production key with `deployment:deploy`) | The same Netlify variable, **Production** context value                                          | Production-context builds only, meaning builds of the `production` branch. On Free and Personal it is also readable by the production edge function at runtime, because scopes are Pro-only. | **Owner only:** creates, rotates, and enters it in the Netlify UI.                                                                                       |
| `VERCEL_TOKEN`, Netlify tokens, or any deploy token in GitHub                   | **None**                                                                                         | n/a                                                                                                                                                                                          | n/a                                                                                                                                                      |

- **No deploy secret exists in GitHub.** #15's smoke test runs locally and needs none, and no cleanup job exists (item 6).
- **Netlify only builds for recognized authors.**
  - The repository is private.
  - Netlify's Deploy Request Policy builds only for recognized authors, so a fork or an outside contributor's PR gets no build, no key, and no preview until the owner approves a deploy request.
  - If the repository is ever made public, Netlify's sensitive variable policy applies, and its default, **Require approval**, holds every untrusted deploy for approval. The owner keeps that default and confirms that `CONVEX_DEPLOY_KEY` is detected as sensitive ([sensitive variable policy](https://docs.netlify.com/build/environment-variables/get-started/#sensitive-variable-policy)).
- **A PR cannot read the production key.**
  - Netlify supplies variable values per context, so a PR that edits `netlify.toml` still gets the preview value.
  - A changed production command takes effect only after the owner merges a release PR into `production`.
- **No deploy credential lives in a GitHub environment.** GitHub Pro's environment secrets and deployment branch policies are not needed for deploys. The one environment, `preview-cleanup`, holds the cleanup token (see the amendment table below, which takes precedence).
- **Residual risk: agents act through the owner's GitHub account.** A push or merge to `production` by that account builds production.
  - **GitHub Pro narrows this.** The owner adds a `production` ruleset that blocks deletion and force-push, requires a pull request, and requires ADR 0009's single status check `ci` (source "GitHub Actions"), with "Require branches to be up to date before merging" on, as on `main`. On a release PR into `production`, `ci` also runs the `webkit-mobile` e2e project (ADR 0009), so a WebKit failure blocks the release. A stray direct push then fails.
  - **It does not close it.** The ruleset cannot tell an agent from the owner, and required approvals would block the owner too (Context, GitHub plan).
  - **Process rule:** only the owner merges into `production` (AGENTS.md gates).
  - **Optional hardening:** set `[context.production] ignore = "exit 0"` and deploy through an owner-held Netlify build hook. "The `ignore` command won't cancel a build triggered by a build hook." This makes a production deploy need a credential that is not in GitHub, at the cost of a second owner step per release.
- **Preview access.**
  - On credit-based plans, new projects and their previews can start private, depending on the team's default visibility setting. Private projects are enforced by Netlify login, and on Free and Personal only the Team Owner can see them ([project visibility](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)).
  - Password protection is a Pro feature.
  - **Previews are public** (owner answer 6), so #15's `E2E_BASE_URL` smoke run needs no bypass secret.
  - Previews hold only seeded test data and have no production keys. They are `noindex` (item 6, which #15 verifies), and they expire on the platforms' schedules (item 6).
  - The production site is made public at the first production release.

### 9. Production flow and rollback

- **Branches.**
  - The Netlify production branch is **`production`**. It is created at the first production release, so no production deploy, credit use, or production key use happens before then.
  - Branch deploys are limited to `main`.
- **Release** (dev cycle Phase 8, `gate:production`):
  1. The deployer opens a release PR from `main` into `production`. It lists the merged changes, the Convex schema changes (with the expand/contract step each one belongs to), and any Stripe configuration changes.
  2. The release PR gets its own deploy preview (`pr-<n>`), a final check of exactly what ships.
  3. **The owner's merge is the approval.** Netlify then builds the `production` context: `npx convex deploy` with the production key pushes the functions to the production Convex deployment, and the site is published atomically.
  4. The deployer smoke-tests `https://<site>.netlify.app`.
- **Rollback when the smoke tests fail.** The deployer has no Netlify or production access, so it opens a `type:bug` issue with the steps below, and the owner runs them.
  1. **Host, instant:** Netlify UI, previous production deploy, **Publish deploy**. "This doesn't trigger a new deploy but instead publishes a previous atomic deploy ... Rollbacks are instantaneous." That restores the previous HTML, assets, and edge function.
  2. **Convex functions:** the owner merges a revert of the release on `production` (a PR the deployer prepares). Netlify rebuilds, and `npx convex deploy` redeploys the previous commit's functions. Until then the restored frontend talks to the new functions, so every release must keep the previous frontend working against the new functions (backward-compatible function signatures).
- **Schema changes a redeploy cannot revert.**
  - `npx convex deploy` validates the schema against existing data. A redeploy of the old schema fails if documents written under the new schema do not match it, for example a widened union or a new required field that has since been filled.
  - Data rewritten or deleted by a migration is not restored by any redeploy.
  - Such changes ship as expand/contract: additive and optional first, with the destructive step in a later release.
  - Before merging a release that contains a migration, the owner presses **Backup Now** on the production deployment. Manual backups are kept for 7 days on all plans, and periodic backups need Professional ([backup and restore](https://docs.convex.dev/database/backup-restore)). Restoring is a destructive, owner-only dashboard action.
- **Rollback window.** Netlify keeps old deploys for 90 days on paid plans, and never deletes the published deploy.

### 10. Candidates and domain

- **Static-only hosts are not candidates.** Every option above was evaluated with its server runtime.
- **Previews, staging, and production use Netlify's default `netlify.app` domain until the first production release**, as `<site>.netlify.app`.
  - A custom domain (owner answer 6 on #7, bought before that release) is added in a later issue.
  - `URL`, and with it the allowed hosts, follows the custom domain automatically.

### Auth items from ADR 0008

- **Google consent page.**
  - Until production serves Convex HTTP actions from a custom domain, Google's account chooser and consent page show **`<prod-deployment>.convex.site`**.
  - Convex custom domains need **Convex Professional, $25 per developer per month** ([custom domains](https://docs.convex.dev/production/custom-domains): "Custom domains require a Convex Pro plan"; [pricing](https://www.convex.dev/pricing)). With Netlify Personal that makes $34, which is over the budget.
  - The alternative is a first-party rewrite of `/api/auth/*`. On Netlify it would have to live inside the SSR edge function, because edge functions run before `_redirects` proxies. It would change:
    - the Google callback, to `https://<custom-domain>/api/auth/callback/google`;
    - `SITE_URL`;
    - Better Auth's cross-domain `localStorage` session model;
    - client-IP handling. Convex would see Netlify's egress address, and the browser's address, from `context.ip` or `x-nf-client-connection-ip`, would have to travel in a header. A client could forge that header by calling `*.convex.site` directly unless the edge function also signs it with a secret that Convex verifies.
  - **Applies after the first production release: accept `<prod-deployment>.convex.site` on the consent page** (owner answer 8). Professional with a custom domain is the owner's later call, once revenue covers it.
  - No rewrite or proxy is adopted, so browser auth requests go straight to `*.convex.site`. ADR 0008's `cf-connecting-ip` check on a cloud dev deployment stays as planned.
- **Preview hostname pattern for #15's `PREVIEW_ORIGIN_PATTERN`.**
  - Preview hostnames are `deploy-preview-<PR number>--<site>.netlify.app`.
  - Staging is `main--<site>.netlify.app`, and deploy permalinks are `<24-hex deploy id>--<site>.netlify.app`.
  - All of them route only to this project. `<site>` is this project's unique `netlify.app` subdomain, and `netlify.app` is on the Public Suffix List.
  - The anchored pattern, with `<site>` escaped, is:

    ```text
    ^https://(deploy-preview-[1-9][0-9]*|main|[0-9a-f]{24})--<site>\.netlify\.app$
    ```

  - It never matches the bare `netlify.app`, another project's `--<other>.netlify.app`, `http:`, or a lookalike suffix such as `...netlify.app.evil.example`.
  - Netlify does not document whether a project name may contain `--`. #15's pattern test adds the hostname `deploy-preview-1--<site>.netlify.app` claimed by a project literally named `deploy-preview-1--<site>`, and checks in the Netlify UI that such a name is refused.
- **Convex region** (ADR 0008 left it to this ADR): **US East (N. Virginia)** for the production deployment (owner answer 7). The region cannot be changed after the deployment is created. Edge SSR runs near the visitor, so the query round trip to Convex is the latency that matters.

## Recommendation

**Netlify still wins after the move to GitHub Pro; the recommendation is unchanged.**

Pro lets a GitHub Actions pipeline keep the production key in a branch-limited environment. That removes Option B's production-key objection. It does not help with previews: Vercel cannot build on Node 26, so previews would be built in Actions from PR code with a Vercel token that can also deploy and configure production. Previews are where agents' code runs.

Netlify keeps every deploy credential out of GitHub, preview and production alike. It builds on Node 26 as ADR 0003 requires, spends no Actions minutes on builds, maintains its own Angular 22 SSR adapter, honours ADR 0006's `Cache-Control`, and costs $0 until the first production release and about $9 after, against Vercel's $20.

The trade-off is a Deno edge runtime with a 50 ms CPU limit per request. Netlify's documentation counts "all time spent running your scripts", and a cold first render measured 78 to 86 ms. This is a real risk, but it does not justify Vercel. #15 tests it before any production traffic, and the fallback, Netlify Functions on Node with the same handler (Decision, item 1), removes the CPU limit without changing host, secrets, or cost.

## Consequences

- **New service:** Netlify, on the Free plan until the first production release and Personal ($9 per month) from then. The Netlify GitHub App is installed on this repository.
- **New dependency:** `@netlify/angular-runtime` 4.0.0 (devDependency).
- **Removed:** `express` and `@types/express`.
- **Convex plan:** Free until the first production release, then Starter (pay-as-you-go, needs a card) so that overage is billed instead of the deployment hitting a hard cap.
- **Owner one-time setup** (documented by #15, without values):
  - Create the Netlify project (the site name decides `<site>`) and link the repository.
  - Production branch `production`; branch deploys for `main` only; Deploy Previews on.
  - Preview visibility public; the production site stays private until the first release.
  - Create the Convex preview deploy key and set `CONVEX_DEPLOY_KEY` for the Deploy Previews and Branch deploys contexts.
  - At the first release, create the production deploy key and set the Production context value.
  - Set Convex's default preview environment variables (ADR 0008).
  - Create the production Convex deployment in US East (owner answer 7).
- **#10 (scaffold) is not changed by this ADR.** PR #30 keeps Express, as ADR 0006 requires, and adds an Express error handler. It merges as planned.
- **Follow-up issue, created after #30 merges** (`type:chore`, `area:` hosting and SSR; it needs no new gate, because this ADR approves the packages). It:
  - Replaces `src/server.ts` with the entry in Decision, item 2, and adds `@netlify/angular-runtime` 4.0.0 pinned exactly.
  - Drops `express` and `@types/express`.
  - Carries over the behaviour of #30's Express error handler. `netlifyAppEngineHandler` catches render errors and returns a plain 500 with no stack trace. An acceptance criterion forces a render error and checks the body.
  - Adds `scripts/serve-ssr.mjs`, and sets `serve:ssr` to `node scripts/serve-ssr.mjs`.
  - Keeps `@types/node` at 26.
  - `src/server.ts` must not read `Netlify.env` or `process.env`. ESLint core `no-restricted-globals` and `no-restricted-properties` on `src/server.ts` enforce this, with no new package; it guards the production key exposure noted under Option A.
  - Changes the scaffold's "`/app/x` and unknown URLs return Express's 404" to "the engine's plain 404" (#23's page once it lands).
  - Adds `netlify.toml` (build contexts, plugin, and the item 3 headers) and the `app/**` `Cache-Control` from item 4.
  - It blocks #15, which needs the Netlify entry before its first real deploy.
- **GitHub (Pro):**
  - No GitHub environment or deploy secret is created for hosting.
  - The owner adds the `production` ruleset described in Decision, item 8, when the `production` branch is created. It is applied together with ADR 0009's `main` ruleset.
- **#13 / ADR 0005 (e2e):** `webServer` still runs `npm run serve:ssr`. `NG_ALLOWED_HOSTS` is no longer read; `angular.json`'s `localhost` and `127.0.0.1` cover e2e.
- **#12 (CI):** unchanged. CI builds with no Convex URL and deploys nothing.
- **#15 (previews):** re-planned against this ADR. Its checks include:
  - no deploy job or deploy secret in GitHub, since Netlify builds and comments;
  - the smoke run against `deploy-preview-<n>--<site>.netlify.app` through `E2E_BASE_URL`, **run locally** by the tester (and against staging by the deployer), with the output pasted in the PR. It is the #13 smoke spec only, Chromium only, at both widths. #15 adds **no GitHub Actions workflow** for it, `status`-triggered or otherwise (ADR 0009); an Actions smoke run would need an amendment to ADR 0009 with its minutes;
  - the Convex preview name `pr-<n>` instead of the branch name;
  - cleanup by documented expiry (item 6), with no cleanup job;
  - **`noindex`.** A static file, a server-route response, and a 404 on the preview and on staging each carry `X-Robots-Tag: noindex`. Netlify's automatic header is undocumented (item 6), so if any response lacks it, #15 adds it for the non-production contexts;
  - the `PREVIEW_ORIGIN_PATTERN` above;
  - the 404 `Cache-Status` observation;
  - a **cold-start check**: right after a fresh deploy, the first request to a Server route and to an unknown URL return 200 and 404, not 5xx, and Netlify's function log shows no CPU-limit error. It is repeated on at least three fresh deploys and from at least two edge locations (for example, the tester's machine and the owner's phone on mobile data).
  - **If the cold-start check fails**, #15 stops and the orchestrator opens a `gate:technology` issue for the Netlify Functions fallback in Decision, item 1. Production is not released on edge SSR.
- **#8 / ADR 0009 (CI):** no deploy Action, no deploy secret, and no build minutes for hosting. ADR 0009's `pull_request_target` ban is unaffected. The `production` ruleset requires the same single check `ci` as `main` (item 8). No workflow runs after a merge to `main` or on Netlify's commit `status`; preview and staging smoke tests are local runs (item 6).
- **ADR 0006** is amended by this ADR, taking effect with the follow-up issue above: Express is no longer the server entry, `NG_ALLOWED_HOSTS` is no longer used, and `serve:ssr` runs the local runner.
- **ADR 0008:** the preview origin pattern and the region (US East) are fixed above; the consent-page domain stays `*.convex.site` (owner answer 8).
- **Dev cycle Phase 8:** describes this flow. Previews are public and `noindex`, and expire on the platforms' schedules.
- **Ongoing cost:** $0 now, about $9 per month from the first production release at the stated traffic, and about $25 at roughly 6.5 times that traffic.
- **Harder later:**
  - Moving off Netlify means rewriting `src/server.ts`, `netlify.toml`, and the secrets setup.
  - Server code must stay Web-API-only.
  - Authenticated SSR would also have to fit the edge limits.

## Owner decisions (PR #33, 2026-10-07)

The owner answered this ADR's four questions (Context, owner answers 5 to 8), relayed by the orchestrator from the chat session:

1. **Netlify plan from the first production release: Personal, $9.** The production key is therefore also visible to the SSR runtime, and the lint rule on `src/server.ts` stays (Consequences). Pro's Builds-only scope, team members, and password protection are not bought.
2. **Previews: public and `noindex`, cleaned up by documented expiry.**
   - The owner first added: "as the pr previews are reviewed, approved, denied i don't want them live anymore". A teardown workflow on merge or close was drafted in commit 83597e4.
   - The owner then withdrew it: "Don't worry about the teardown. Just have whatever process you originally planned for post preview approval." That draft is removed. No Netlify token, cleanup job, GitHub environment, or ADR 0009 exception is added.
   - **Known consequence:** a merged or closed PR's preview URLs keep serving test-data pages until Netlify deletes the deploys (30 days on Free, 90 on Personal), and its Convex-backed pages fail once Convex deletes the preview backend (5 days).
3. **Convex production region: US East (N. Virginia).** This also suits the Functions fallback, whose default region is US East (Ohio).
4. **Google consent page: accept `<prod-deployment>.convex.site` for now.** Convex Professional with a custom domain is revisited when revenue allows.

No owner questions remain open.

## Test evidence (2026-10-07)

**Setup.** A scratch app was generated with `ng new hostspike --ssr` on Angular CLI 22.2.2 (`@angular/*` 22.2.x, `@angular/ssr` 22.2.2), on Node 26.11.0 and npm 11.20.0.

- **Routes:**
  - `''` is Prerender.
  - `o/:slug` is Server, with ADR 0006's `Cache-Control`, `Title`, `og:title`, and a 60-row list.
  - `app/**` is Client, with a client `app` > `**` route.
  - `**` is Server, with a not-found view that sets `RESPONSE_INIT` status 404.
- **Font:** a 2 KB file referenced from `styles.css`, which was emitted as `browser/media/inter-TF7PRQ4B.woff2`.

**Results:**

1. **Baseline (Express entry).** `ng build` passed: "Prerendered 1 static route". `server.mjs` was 920.52 kB.
2. **Netlify entry.**
   - After the `server.ts` swap and `npm install -D --save-exact @netlify/angular-runtime@4.0.0`, `ng build` passed and `server.mjs` was 9.68 kB.
   - The runtime added three packages (`@netlify/angular-runtime` 4.0.0, `@netlify/edge-functions` 3.0.8, `@netlify/types` 2.8.0), all MIT, with no install scripts.
   - The CLI 22.2.2 default `server.ts` has SHA-256 `f69b5803…c2e6`, which is on the runtime's known-signature list. `prettier --check` with the scaffold's `.prettierrc` flags it.
3. **`netlify build --offline`** (netlify-cli 27.11.2, run with npx, not added to the project).
   - It passed: "Writing Angular SSR Edge Function", then "Packaging Edge Functions ... angular-ssr".
   - The generated config was `path: "/*"`, with `excludedPath: ["/.netlify/*","/favicon.ico","/index.csr.html","/index.html","/main-X7YJTBTG.js","/media/inter-TF7PRQ4B.woff2","/styles-DPDXGSLM.css","/"]` and `cache: "manual"`.
4. **`netlify serve --offline`, with the edge function running on Deno.** With the plugin declared in `netlify.toml`, the log showed "Loaded edge function angular-ssr".

   | Request                             | Result                                                                                                                            |
   | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
   | `GET /`                             | 200, the prerendered page, served static                                                                                          |
   | `GET /o/acme`                       | 200, `cache-control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`, `<title>Org page</title>`, `og:title`, the list |
   | `GET /app/x`                        | 200, empty `<app-root>` shell                                                                                                     |
   | `GET /does-not-exist`               | **404** with the not-found view and the same `cache-control`                                                                      |
   | `/media/*.woff2` and `/favicon.ico` | 200, served static                                                                                                                |
   | `Host: evil.example`                | 400, logged "Header "host" with value "evil.example" is not allowed"                                                              |
   | `X-Forwarded-Host: evil.example`    | 400                                                                                                                               |
   | Five warm Server-route requests     | 7.6 to 17.5 ms wall time, through the local proxy                                                                                 |

   `netlify serve` did not apply the `[[headers]]` rule for `/media/*` to static files. #15 checks the item 3 headers on a real deploy.

5. **CPU per render.** The script imported `server.mjs` and called `netlifyAppEngineHandler` directly.

   | Node    | Module load | First render | Warm median (50 renders) | Warm p95 |
   | ------- | ----------- | ------------ | ------------------------ | -------- |
   | 26.11.0 | 5.2 ms      | **78.1 ms**  | 2.8 ms                   | 10.2 ms  |
   | 24.16.0 | 7.2 ms      | **86.3 ms**  | 3.1 ms                   | 8.1 ms   |

6. **Local runner `scripts/serve-ssr.mjs` on Node 24.16.0.**

   | Request                                       | Result                                                   |
   | --------------------------------------------- | -------------------------------------------------------- |
   | `/`                                           | 200                                                      |
   | `/o/acme`                                     | 200 with `Cache-Control` and SSR content                 |
   | `/app/x`                                      | 200                                                      |
   | `/does-not-exist`                             | 404                                                      |
   | `/media/inter-*.woff2` and `/main-*.js`       | `public, max-age=31536000, immutable`                    |
   | `/favicon.ico` and `/index.csr.html`          | `public, max-age=0, must-revalidate`                     |
   | `/../package.json` and `/%2e%2e/package.json` | 404 from the engine; nothing was read outside `browser/` |
   | `Host: evil.example`                          | 400                                                      |

   A first version that imported `@angular/ssr/node` from `node_modules` failed with "JIT compilation failed for injectable [class PlatformLocation]". The final version uses Node built-ins only.

**Not tested (no accounts or secrets):** real Netlify deploys, deploy-context variables, CDN cache hits and 404 caching, the CPU limit on real edge isolates, and `npx convex deploy` against a real preview key. #15 covers these.

## Sources

- **Netlify:**
  - Pricing and terms: [pricing](https://www.netlify.com/pricing/), [credit-based pricing](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/), [billing FAQ](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/), [Self-Serve Subscription Agreement](https://www.netlify.com/legal/self-serve-subscription-agreement/), [Terms of Use](https://www.netlify.com/legal/terms-of-use/).
  - Angular and edge functions: [Angular on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/angular/), [angular-runtime README](https://github.com/netlify/angular-runtime), [edge functions overview](https://docs.netlify.com/build/edge-functions/overview/), [limits](https://docs.netlify.com/build/edge-functions/limits/), [configuration](https://docs.netlify.com/build/edge-functions/optional-configuration/), [API](https://docs.netlify.com/build/edge-functions/api/).
  - Caching and headers: [caching overview](https://docs.netlify.com/build/caching/caching-overview/), [custom headers](https://docs.netlify.com/manage/routing/headers/).
  - Functions (fallback): [functions configuration (Node runtime, region, limits)](https://docs.netlify.com/build/functions/optional-configuration/); the Angular runtime now lives in [netlify/framework-adapters](https://github.com/netlify/framework-adapters/tree/main/packages/angular-runtime) and generates an edge function only.
  - Build and environment: [build software](https://docs.netlify.com/build/configure-builds/available-software-at-build-time/), [dependency management](https://docs.netlify.com/build/configure-builds/manage-dependencies/), [build environment variables](https://docs.netlify.com/build/configure-builds/environment-variables/), [environment variables](https://docs.netlify.com/build/environment-variables/overview/), [get started / sensitive variable policy](https://docs.netlify.com/build/environment-variables/get-started/), [Secrets Controller](https://docs.netlify.com/build/environment-variables/secrets-controller/).
  - Preview `noindex`: [preview noindex override (support forum, 2021)](https://answers.netlify.com/t/override-x-robots-tag-noindex-header-in-deploy-preview/38980), [preview missing noindex (forum, 2026)](https://answers.netlify.com/t/preview-site-is-missing-x-robots-noindex-suddenly/163545).
  - Deploys and access: [deploy overview / contexts / permissions](https://docs.netlify.com/deploy/deploy-overview/), [deploy previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/), [manage deploys / rollbacks](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/), [ignore builds](https://docs.netlify.com/build/configure-builds/ignore-builds/), [deploy notifications](https://docs.netlify.com/deploy/deploy-notifications/), [project visibility](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/), [password protection](https://docs.netlify.com/manage/security/secure-access-to-sites/password-protection/), [proxies / signed proxy redirects](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/).
- **Convex:** [pricing](https://www.convex.dev/pricing), [Terms of Service](https://www.convex.dev/legal/tos), [limits](https://docs.convex.dev/production/state/limits), [multiple and preview deployments](https://docs.convex.dev/production/multiple-deployments), [deploy CLI](https://docs.convex.dev/cli/reference/deploy), [Netlify hosting](https://docs.convex.dev/production/hosting/netlify), [custom domains](https://docs.convex.dev/production/custom-domains), [backup and restore](https://docs.convex.dev/database/backup-restore).
- **Vercel:** [pricing](https://vercel.com/pricing), [Hobby plan](https://vercel.com/docs/plans/hobby), [Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [access tokens](https://vercel.com/docs/accounts/access-tokens), [project-scoped tokens changelog (2026-07-30)](https://vercel.com/changelog/project-scoped-tokens), [Node.js 26 on Sandbox changelog](https://vercel.com/changelog/node-js-26-x-now-available-on-vercel-sandboxes), [CDN cache](https://vercel.com/docs/caching/cdn-cache), [supported frameworks](https://vercel.com/docs/frameworks/more-frameworks), `vercel/vercel` `packages/frameworks/src/frameworks.ts` (Angular preset).
- **Cloudflare:** [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Workers Cache](https://developers.cloudflare.com/workers/cache/), [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/), [Version and preview URLs](https://developers.cloudflare.com/workers/configuration/previews/), [Previews configuration](https://developers.cloudflare.com/workers/previews/configuration/), [Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [Angular guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/angular/).
- **Google Cloud:** [Cloud Run rollouts and tags](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration), [Cloud CDN overview](https://docs.cloud.google.com/cdn/docs/overview), [network pricing](https://cloud.google.com/vpc/network-pricing).
- **Render:** [service previews](https://render.com/docs/service-previews), [web service edge caching](https://render.com/docs/web-service-caching), [Blueprint `previewValue`](https://render.com/docs/blueprint-spec).
- **Firebase:** [App Hosting docs index](https://firebase.google.com/docs/app-hosting), [Hosting GitHub integration](https://firebase.google.com/docs/hosting/github-integration).
- **GitHub:** [GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans), [about rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets), [deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [managing environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
- **Angular:** [SSR guide](https://angular.dev/guide/ssr), [security: allowed hosts](https://angular.dev/best-practices/security), [deployment](https://angular.dev/tools/cli/deployment), `@angular/ssr@22.2.2` `fesm2022/ssr.mjs` (`AngularAppEngine.getAllowedHosts`) and `fesm2022/_validation-chunk.mjs`.
- **npm registry (2026-10-07):** `@netlify/angular-runtime` 4.0.0, `@netlify/edge-functions` 3.0.8, `@netlify/types` 2.8.0, `netlify-cli` 27.11.2, `vercel` 62.7.0, `wrangler` 4.148.0, `firebase-tools` 15.32.1, `@angular/ssr` 22.2.2, `@angular/cli` 22.2.2, `express` 5.2.1.
- **[Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat):** `netlify.app`, `convex.site`, `vercel.app`, `workers.dev`, `onrender.com`.

## Amendment: client shells and the shared cache (2026-10-10)

PR #102's tester found that a deploy does not reliably purge the edge cache for a long-lived client shell. After a preview deploy, an edge copy of `/app` was stored 3 s after the new deploy went live but held the previous build's shell. That shell named a `main-*.js` the new deploy had deleted (404), so the page stayed blank and the guard never ran. 90 minutes later the copy had `age=5382` and `ttl=81018`; 1 in 25 fresh-browser loads of `/app` got it. With `s-maxage=86400`, the same race in production would show a blank sign-up landing for up to a day.

| Rule                                     | Was                                                                                                                     | Now                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client-route shells (item 4)             | `app/**` sends `public, max-age=0, s-maxage=86400`, because "Netlify purges the deploy context's cache on every deploy" | Every Client route (`sign-up`, `app`, `app/**`, and any later one) sends `public, max-age=0, must-revalidate`, and nothing that lets a shared cache keep it: no `s-maxage`, `stale-while-revalidate`, `stale-if-error`, `CDN-Cache-Control`, or `Netlify-CDN-Cache-Control`. `src/app/app.routes.server.spec.ts` fails on any of them |
| App shells in the cost estimate (item 7) | 20,000 shells, "0 once the shell's `s-maxage` is warm; the worst case is counted here"                                  | Every app load that the service worker (ADR 0013) does not answer is an edge invocation. That is the worst case already counted: 20,000 shells, about 4 credits. The totals do not change                                                                                                                                             |
| Server routes (item 4, ADR 0006)         | `public, max-age=0, s-maxage=60, stale-while-revalidate=300`                                                            | Unchanged. A copy that races a deploy can serve the previous build's HTML for up to 360 s at one edge node. The server-rendered content still shows; its scripts 404 until the copy is replaced                                                                                                                                       |

**Why.** A short lifetime still serves the old shell after a deploy. With `s-maxage=60, stale-while-revalidate=300`, an edge copy stored during the race is served fresh for 60 s, and then at least the request that triggers revalidation at each node gets it, for up to 300 s more: a blank page each time. With no shared cache, each load asks the edge function, which returns the current build's `index.csr.html` without rendering anything. The only cost is the invocations item 7 already counts. Installed clients make no such request, because the service worker answers navigations with its own shell. The browser revalidates on every load, as before.

**Sources.** [PR #102 test, round 4](https://github.com/jasonbryan/omni-league/pull/102#issuecomment-6097301569), [owner's choice of a fifth round](https://github.com/jasonbryan/omni-league/pull/102#issuecomment-6097957149), Netlify [caching overview](https://docs.netlify.com/build/caching/caching-overview/).

## Amendment: preview cleanup (2026-10-10)

The Convex team caps deployments at 40, and each PR adds a preview deployment `pr-<n>` that nothing removed before Convex's 5-day expiry, so new previews failed with `DeploymentQuotaReached` (#158). The owner asked for the cleanup to be automatic: "Do don't want to run in automate it" and "make it part of this development process". The owner chose a GitHub workflow over a Netlify build step.

| Rule in this ADR                                                        | Was                                 | Now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Previews are removed by documented expiry, with no cleanup job (item 6) | No cleanup job                      | `clean-previews.yml` deletes the Convex preview deployment `pr-<n>` for each PR named `(#<n>)` in a commit pushed to `main`, and sweeps every closed or merged PR's preview daily. Netlify's expiry for preview deploys is unchanged.                                                                                                                                                                                                                                                                                                                                     |
| No deploy secret exists in GitHub (item 8, Consequences)                | No secret, no token, no cleanup job | One environment secret, `CONVEX_TEAM_TOKEN` (a Convex team access token), in the GitHub environment `preview-cleanup`, whose deployment branches are limited to `main`. Only `clean-previews.yml` uses it. The token acts for the whole team: it can mint deploy keys for any deployment (production included) and so deploy code, delete projects, and change default environment variables. It is therefore held like a production credential, readable only by runs on `main`. No deploy key, Netlify token, or other secret is added; ADR 0009's rules for `ci` hold. |

The workflow has no `pull_request`, `pull_request_target`, or `workflow_run` trigger (only `push` to `main`, `schedule`, and `workflow_dispatch`), declares `environment: preview-cleanup`, uses `permissions: contents: read` and `pull-requests: read` only, pinned GitHub-owned actions, and skips with a notice when the secret is unset. Its engine, `scripts/clean-previews.mjs`, deletes only `preview`-type deployments of the `omni-league` project named `pr-<n>` whose PR `gh` reports as CLOSED or MERGED. Operating reference and the owner's setup: [hosting, Cleanup](../process/hosting.md#cleanup).

## Amendment: staging keeps its Convex data (2026-10-13)

Every merge to `main` ran `npx convex deploy --preview-create "$HEAD"`, which `convex deploy --help` (CLI 1.46) describes as "Like --preview-name, but deletes and recreates an existing preview deployment with the same name". Each merge therefore deleted staging's Convex deployment, and with it the owner's test accounts and organizations, and staging answered 503 until the new deployment was seeded (#222, observed 2026-10-13: `successful-viper-762` gone, `preview/main` recreated as `adorable-spaniel-118`).

| Rule in this ADR                                                              | Was                                                                            | Now                                                                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Staging deploy (`[context.branch-deploy]`, item 6)                            | `npx convex deploy ... --preview-create "$HEAD"`: deletes and recreates `main` | `npx convex deploy ... --preview-name "$HEAD"`: reuses the deployment `main` and its data, and creates it when none exists |
| PR previews (`[context.deploy-preview]`, item 6)                              | `--preview-create "pr-$REVIEW_ID"`                                             | Unchanged: a fresh backend per push is wanted for a PR                                                                     |
| "`--preview-create` deletes and recreates the backend on every push" (item 6) | Said of every preview                                                          | True of PR previews only                                                                                                   |

**Why staging differs.** A PR preview is disposable, and a clean backend per push keeps one push's data from leaking into the next test. Staging is the environment the owner reviews and keeps test accounts in, so it must outlive a deploy. `--preview-name` and `--preview-create` both call Convex's `claim_preview_deployment` endpoint with the same name; the CLI source (`convex/src/cli/deploy.ts`) differs only in a `reuse` flag, true for `--preview-name`. `--preview-name` is also what Convex's CI integrations default to (the Git branch name) on a branch's first push, when no deployment exists, so it creates when none exists, which a fresh staging needs. The documentation says only "Reuses the existing deployment if one exists" and the server side of the endpoint is not public, so this rests on the CLI source and that default. The first staging build after this change is the live confirmation; the build log shows the deployment name.

**Effects checked.**

- `seed:demo` is insert-only and backfills (it adds only missing demo rows and never deletes), so it runs unchanged on a reused deployment and inserts zero rows once the demo data is there.
- `scripts/check-deploy-env.mjs preview` still runs after the deploy and reads the reused deployment's variables.
- Convex applies its default preview variables (`BETTER_AUTH_SECRET`, `SITE_URL`, and the others in [hosting, Preview variables](../process/hosting.md#preview-variables)) only when it creates a deployment, and does not sync later changes ([environment variables](https://docs.convex.dev/production/environment-variables)). A reused `main` therefore keeps the `BETTER_AUTH_SECRET` it got at creation, so sessions stay valid across deploys. A default added or changed later does not reach it; the check fails the build for a missing required variable, and the owner sets the value on `main` by hand.

**Unchanged.** Convex deletes a preview deployment 5 days after creation on the Free plan, and reuse does not extend that. Staging still resets to an empty, re-seeded backend about every 5 days; whether to avoid that (a longer-retention plan, or a different staging deployment) is a separate owner decision.

**Sources.** `npx convex deploy --help` (CLI 1.46), [deploy CLI](https://docs.convex.dev/cli/reference/deploy), [preview deployments](https://docs.convex.dev/production/hosting/preview-deployments).
