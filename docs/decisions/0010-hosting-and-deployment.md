# 0010: Hosting and deployment pipeline

- **Status:** Accepted
- **Gate:** `gate:technology`
- **Issue:** #9
- **Date:** 2026-10-07

## Context

ADR 0001 leaves hosting for the Angular app and the deployment pipeline (CD) undecided. This ADR decides both, because the host largely decides the CD mechanism (host-built versus GitHub Actions-built).

### Fixed requirements

**Owner answers on #9 and #5:**

1. **Budget:** up to about **$25/month for hosting and Convex combined**. The terms of both the host plan and the Convex plan must allow commercial use, because the app takes league fees through Stripe.
2. **Per-PR previews are required**, each with its **own Convex preview deployment**.
3. **Domain:** the host's default domain until the first production release.
4. **Public pages at launch**, search-indexed and with link previews.

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

- **GitHub plan.** This repository is private on a GitHub Free account.
  - `gh api repos/jasonbryan/omni-league/rulesets` answers 403, "Upgrade to GitHub Pro or make this repository public".
  - GitHub documents that on Free, environment secrets are only available in public repositories. Required reviewers and wait timers need a public repository on Free, Pro, and Team.
  - So a **GitHub Actions-built pipeline could keep deploy keys only in repository secrets.** Any workflow on any branch can read those, including workflows that agents write.
- **Build image Node versions.**
  - Netlify installs "any version that `nvm` can install", in order of precedence from `.nvmrc`.
  - Vercel builds and runs functions on Node 24.x, 22.x, or 20.x only. A Vercel-hosted build therefore fails `devEngines` (`^26.11.0`), and on Vercel the build would have to run in GitHub Actions.
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
  - **50 ms CPU limit per request** ([edge function limits](https://docs.netlify.com/build/edge-functions/limits/)).
    - The spike measured 2.8 ms (median) and 10 ms (p95) of CPU for a warm render of a 60-row page.
    - The first render in a fresh process took 78 ms on Node 26.11 and 86 ms on Node 24.16, because it lazily loads and compiles `main.server.mjs`.
    - Netlify does not document whether isolate start-up counts toward the 50 ms. If it does, the first request on a cold edge isolate could fail.
    - This is the main risk of this option. #15 checks it on a real deploy (Consequences), and a fallback is named.
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
  - **Node runtime:** the CLI's Express `src/server.ts`, `NG_ALLOWED_HOSTS`, and the local `serve:ssr` stay unchanged. Functions have no 50 ms CPU cap.
  - **The CDN honours `s-maxage` and `stale-while-revalidate`** ([CDN cache](https://vercel.com/docs/caching/cdn-cache)).
- **Cons and risks.**
  - **Secrets.** On this GitHub Free private repository, `VERCEL_TOKEN`, the preview Convex key, and the production Convex key could only be repository secrets.
    - Any workflow on any branch, including agent-written ones, could read them.
    - A Vercel token cannot be limited to previews: it can read production environment variables and promote deployments.
    - This conflicts with AGENTS.md "Secrets", and a GitHub Pro upgrade would not fix the token scope.
  - **Previews are protected by default.** Vercel Authentication is on for previews, so #15's smoke test would need a "Protection Bypass for Automation" secret in GitHub.
  - **Custom code:** the repository would own a Build Output API script, with no Vercel framework support for Angular SSR.
  - **Cost:** $20 of the $25 budget, which leaves $5 for Convex.

### Option C: Cloudflare Workers (Workers Paid, with Workers Builds)

- **What it is.**
  - Workers run a Web `Request`/`Response` handler (`AngularAppEngine`) on workerd, and Workers Static Assets serve `browser/`.
  - The cost is $5 per month on Workers Paid. The Free plan's limit of 10 ms CPU per invocation is below the measured first render.
  - Workers Cache now honours `Cache-Control` on Worker responses, including on `workers.dev`.
- **Rejected.**
  - **Build secrets.** Workers Builds has one set of "Build variables and secrets", and the documentation shows no per-branch values ([builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)). Preview builds, which run PR code, would therefore see the production Convex deploy key. Preview-specific settings exist only for runtime variables.
  - **No first-party Angular SSR adapter.** Cloudflare's Angular guide covers static assets only.
  - **Not Node.** The runtime is workerd.

### Option D (baseline): a plain Node service, Google Cloud Run

- **What it is.**
  - A container that runs the CLI's Express `server.mjs` unchanged, on Node 24 or 26.
  - Previews are revision tags deployed with `--no-traffic`, at `https://<tag>---<service>-<hash>.a.run.app` ([rollouts](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)).
- **Rejected.**
  - **No CDN on `run.app`.** Cloud CDN needs a global external Application Load Balancer ([Cloud CDN overview](https://docs.cloud.google.com/cdn/docs/overview)). Its forwarding rule is billed hourly (about $18 per month at list price), which takes most of the budget, so requirement 4 is not met.
  - **Keys in GitHub.** Previews would deploy from GitHub Actions, which needs Google credentials in GitHub, with the same repository-secret problem as Option B.

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
- **Fallback if the 50 ms CPU limit bites.** #15 checks the first request after a fresh deploy (Consequences). If edge cold starts fail it, a superseding ADR moves SSR to one of these:
  - Netlify Functions on Node, with the same handler and the same secrets model;
  - Option B, together with a GitHub plan or secret-storage change.

### 2. Server entry and added packages

`src/server.ts` is **replaced** by the runtime's documented App Engine entry, for `@angular/ssr` 21.2.9 and later:

```ts
import { AngularAppEngine, createRequestHandler } from '@angular/ssr';
import { getAllowedHosts, getContext, getTrustProxyHeaders } from '@netlify/angular-runtime/app-engine.js';

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

| Item | Version | Licence | Type | Notes |
| --- | --- | --- | --- | --- |
| `@netlify/angular-runtime` | 4.0.0 (pinned exactly) | MIT | devDependency | Netlify build plugin, and the `app-engine.js` helpers that `server.ts` imports. The README says it must be installed in the project for Angular 19+ SSR. Declared in `netlify.toml` `[[plugins]]` (the spike's `netlify serve` only loaded it once declared). No install scripts. |
| `@netlify/edge-functions` | 3.0.8 | MIT | transitive | Types and helpers. No install scripts. |
| `@netlify/types` | 2.8.0 | MIT | transitive | No install scripts. |
| Netlify GitHub App | n/a | Netlify terms | GitHub App on this repository only | Builds on push and PR, and posts commit statuses, checks, and the preview link comment. |
| Netlify CLI (`netlify-cli` 27.11.2, MIT) | n/a | n/a | **Not added** | Used only in this ADR's scratch test. It has a `postinstall` script, and the pipeline does not need it. |
| GitHub Actions | none | n/a | n/a | Netlify builds and deploys, so no deploy Action is added. #15's smoke workflow uses only Actions accepted under #8's pinning and permission rules. |

None of these needs an `allowScripts` entry (ADR 0003). `semver`, the runtime's other dependency, is already in the tree.

### 3. Static assets, the `/app/**` shell, and unknown paths

- **Static files are served from Netlify's CDN.**
  - Netlify caches them at the edge for up to a year and **invalidates them on every deploy** ("all new deploys invalidate the cache for the given deploy context").
  - By default it sends browsers `Cache-Control: public, max-age=0, must-revalidate`, as seen in the spike ([caching overview](https://docs.netlify.com/build/caching/caching-overview/)).
- **Long-lived browser caching, only for content-hashed files.** `netlify.toml` `[[headers]]` sets `Cache-Control: public, max-age=31536000, immutable` on these paths. Netlify header paths allow `*` "at any place inside of a path segment" ([custom headers](https://docs.netlify.com/manage/routing/headers/)).

  | Path | Contents |
  | --- | --- |
  | `/media/*` | `dist/<app>/browser/media/`, the content-hashed Inter `.woff2` files from ADR 0007 that the server HTML preloads |
  | `/main-*.js`, `/chunk-*.js`, `/polyfills-*.js`, `/styles-*.css` | the hashed bundles, named `<name>-<8-char hash>.<ext>` |

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
  - `--preview-create` deletes and recreates the backend on every push, so each preview starts with fresh data.
- **It is a server deployment.** Each preview is an atomic Netlify deploy with its own copy of the edge function and the static files. It does not share a function with production.
- **URL reporting.** Netlify's GitHub App posts the preview link as a PR comment and as a commit status, both on by default ([deploy notifications](https://docs.netlify.com/deploy/deploy-notifications/)).
  - The URL is predictable: `https://deploy-preview-<n>--<site>.netlify.app`.
  - #15 runs the smoke spec with `E2E_BASE_URL` set to it. The run is triggered by the `status` event from Netlify's commit status, or by polling that URL.
  - The smoke job needs **no secrets**.
  - A `status`-triggered workflow runs from the default branch's workflow file, with `GITHUB_SHA` set to the default branch, so it checks out `github.event.sha` with read-only permissions ([events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#status)).
- **Cleanup is by documented expiry. No cleanup job is needed.**
  - Convex deletes preview deployments 5 days after creation.
  - Netlify deletes non-published deploys after 30 days on Free, or 90 days on paid plans ([manage deploys](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)).
  - Neither leaves a cost behind: previews are unmetered, and expired Convex previews free their deployment slot.
- **Staging.** Every merge to `main` builds the branch deploy `https://main--<site>.netlify.app` with the Convex preview deployment `main`. The deployer smoke-tests it (dev cycle Phase 8, "Preview/staging").
  - If `main` gets no push for 5 days, Convex removes that backend and staging stops working until the next merge.

### 7. Cost

#### Traffic assumption

This is the first months after the first production release.

| Traffic | Per month |
| --- | --- |
| Public Server-route page views (organization, location, league, registration) | 30,000 |
| `/app/**` Client-route loads (HTML shell) | 20,000 |
| Prerendered page views | 5,000 |
| Crawler and bot requests to unknown URLs (404) | 30,000 |
| Monthly active users | 1,000 (ADR 0008's basis) |
| Static asset requests | 165,000 (3 per human page load, after browser caching) |
| Production deploys | 8 |
| PRs | 30, at about 3 pushes each, so 90 preview builds |

#### Uncached server invocations (worst case: no CDN hits)

- 30,000 public renders.
- 20,000 app shells. This is 0 once the shell's `s-maxage` is warm; the worst case is counted here.
- 30,000 bot 404s, all counted as uncached (item 4).
- **Total: 80,000 edge invocations.**
  - Netlify bills them only as web requests: 16 credits.
  - CPU is not billed. At the measured 3 ms warm median, this is about 4 CPU-minutes per month.

#### Netlify (credits)

| Item | Credits |
| --- | --- |
| Web requests: 85,000 HTML and 165,000 asset requests | 50 |
| Bandwidth: about 7.4 GB (20 KB per HTML page, about 40 KB per asset request, 5 KB per 404) | 148 |
| Production deploys: 8 × 15 | 120 |
| Previews and staging: 90 preview builds and about 30 staging builds; builds are unmetered, and about 10,000 review and smoke requests plus 0.3 GB add about 8 credits | 8 |
| **Total** | **about 326** |

This is above Free's 300, so production needs **Personal ($9, 1,000 credits)**.

#### Convex (Starter)

| Source | Function calls |
| --- | --- |
| Server renders: 30,000 × 2 queries | 60,000 |
| Bot 404s that hit slug routes: about 10,000 × 1 | 10,000 |
| Hydrated public pages: 30,000 × 3 (live subscription and updates) | 90,000 |
| App: 20,000 loads × 20 calls | 400,000 |
| Auth: 250 × 1,000 MAU (ADR 0008) | 250,000 |
| Previews: 90 × 300 | 27,000 |
| Staging: 30 × 300 | 9,000 |
| **Total** | **about 0.85M** (included: 1M) |

- Database I/O is about 1 GB, at roughly 1 KB per call, against 1 GB included, so at most about $0.22.
- Storage stays well under 0.5 GB.
- Previews and staging use at most about 15 live preview deployments against the 40-deployment limit.

#### Monthly total

| Period | Netlify | Convex | Total |
| --- | --- | --- | --- |
| Before the first production release (previews and staging only; about 20 credits) | Free, $0 | Free, $0 | **$0** |
| At the assumed traffic | Personal, $9 | Starter, about $0.20 | **about $9** |

**Per-PR preview cost at 30 PRs per month:**

| Item | Cost |
| --- | --- |
| Host build minutes | $0: deploy previews are non-metered, and builds are not credit-metered |
| Preview invocations and requests | about 8 credits, about $0.05 |
| Convex preview usage | 27,000 calls, within the included amount: $0 |

#### When the total passes about $25 per month

Scale the traffic by a factor *k*. Previews and production deploys stay fixed.

| *k* | Netlify | Convex | Total |
| --- | --- | --- | --- |
| 1 | $9 | ~$0.2 | ~$9 |
| 2 | $9 (about 524 credits) | ~$1.7 | ~$11 |
| 4 | $9 (about 920 credits) | ~$5.7 | ~$15 |
| 5 | $14 (one 500-credit pack, $5) | ~$7.7 | ~$22 |
| 6.5 | $14 | ~$10.7 | **~$25** |
| 7 | $19 (two packs) | ~$11.7 | ~$31 |

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

| Secret | Where it is stored | What can read it | Who handles it |
| --- | --- | --- | --- |
| Preview `CONVEX_DEPLOY_KEY` (Convex **preview** deploy key) | Netlify environment variable, values for the **Deploy Previews** and **Branch deploys** contexts | Deploy-preview and branch-deploy builds, which run code from PRs and `main` | The owner creates it once. Agents' code may see it in preview builds, which AGENTS.md allows, because it can only create and modify preview deployments. |
| Production `CONVEX_DEPLOY_KEY` (Convex production key with `deployment:deploy`) | The same Netlify variable, **Production** context value | Production-context builds only, meaning builds of the `production` branch. On Free and Personal it is also readable by the production edge function at runtime, because scopes are Pro-only. | **Owner only:** creates, rotates, and enters it in the Netlify UI. |
| `VERCEL_TOKEN`, Netlify tokens, or any deploy token in GitHub | **None** | n/a | n/a |

- **No deploy secret exists in GitHub.** #15's smoke workflow uses none.
- **Netlify only builds for recognized authors.**
  - The repository is private.
  - Netlify's Deploy Request Policy builds only for recognized authors, so a fork or an outside contributor's PR gets no build, no key, and no preview until the owner approves a deploy request.
  - If the repository is ever made public, Netlify's sensitive variable policy applies, and its default, **Require approval**, holds every untrusted deploy for approval. The owner keeps that default and confirms that `CONVEX_DEPLOY_KEY` is detected as sensitive ([sensitive variable policy](https://docs.netlify.com/build/environment-variables/get-started/#sensitive-variable-policy)).
- **A PR cannot read the production key.**
  - Netlify supplies variable values per context, so a PR that edits `netlify.toml` still gets the preview value.
  - A changed production command takes effect only after the owner merges a release PR into `production`.
- **Residual risk: agents act through the owner's GitHub account**, and GitHub Free gives no branch protection on this private repository. A push to `production` by anyone with write access therefore builds production.
  - **Process rule:** only the owner merges into `production` (AGENTS.md gates).
  - **Optional hardening:** set `[context.production] ignore = "exit 0"` and deploy through an owner-held Netlify build hook. "The `ignore` command won't cancel a build triggered by a build hook." The cost is a second owner step per release.
- **Preview access.**
  - On credit-based plans, new projects and their previews can start private, depending on the team's default visibility setting. Private projects are enforced by Netlify login, and on Free and Personal only the Team Owner can see them ([project visibility](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)).
  - Password protection is a Pro feature.
  - **Previews are set to public** (owner question 2) so that #15's `E2E_BASE_URL` smoke run needs no bypass secret.
  - Previews hold only seeded test data, have no production keys, and get `X-Robots-Tag: noindex` from Netlify.
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
  - **Applies after the first production release: accept `<prod-deployment>.convex.site` on the consent page** (owner question 4). Professional with a custom domain is the owner's later call, once revenue covers it.
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
- **Convex region** (ADR 0008 left it to this ADR): **US East (N. Virginia)** for the production deployment, unless the owner's leagues are outside North America (owner question 3). Edge SSR runs near the visitor, so the query round trip to Convex is the latency that matters.

## Recommendation

Netlify is the only qualifying host where the production Convex key never enters GitHub or a PR build. That matters on this private GitHub Free repository, where agents push through the owner's account. It builds on Node 26 as ADR 0003 requires, and Netlify maintains its Angular 22 SSR adapter. Its CDN honours ADR 0006's `Cache-Control`, and it costs $0 until the first production release and about $9 after.

The trade-off is a Deno edge runtime with a 50 ms CPU limit per request instead of Node. That replaces Express with the App Engine entry and a small local runner. #15 checks the edge cold-start risk on its first real deploy, and the fallback is named in Decision, item 1.

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
  - Create the production Convex deployment in US East.
- **#10 (scaffold):**
  - Replaces `src/server.ts` with the entry in Decision, item 2, and adds `@netlify/angular-runtime` 4.0.0 pinned exactly.
  - Drops `express` and `@types/express`.
  - Adds `scripts/serve-ssr.mjs`, and sets `serve:ssr` to `node scripts/serve-ssr.mjs`.
  - Keeps `@types/node` at 26.
  - `src/server.ts` must not read `Netlify.env` or `process.env`. ESLint core `no-restricted-globals` and `no-restricted-properties` on `src/server.ts` enforce this, with no new package; it guards the production key exposure noted under Option A.
  - #10's "`/app/x` and unknown URLs return Express's 404" becomes "the engine's plain 404".
  - Adds `netlify.toml` (build contexts, plugin, and the item 3 headers) and the `app/**` `Cache-Control` from item 4.
- **#13 / ADR 0005 (e2e):** `webServer` still runs `npm run serve:ssr`. `NG_ALLOWED_HOSTS` is no longer read; `angular.json`'s `localhost` and `127.0.0.1` cover e2e.
- **#12 (CI):** unchanged. CI builds with no Convex URL and deploys nothing.
- **#15 (previews):** re-planned against this ADR. Its checks include:
  - no deploy job or deploy secret in GitHub, since Netlify builds and comments;
  - the smoke run against `deploy-preview-<n>--<site>.netlify.app` through `E2E_BASE_URL`;
  - the Convex preview name `pr-<n>` instead of the branch name;
  - cleanup by documented expiry;
  - the `PREVIEW_ORIGIN_PATTERN` above;
  - the 404 `Cache-Status` observation;
  - a **cold-start check**: right after a fresh deploy, the first request to a Server route and to an unknown URL return 200 and 404, not 5xx, and Netlify's function log shows no CPU-limit error.
- **#8 (CI decision):** no deploy Action and no deploy secret. If #15 uses a `status`-triggered workflow, #8's rules should allow it: read-only token, no secrets, explicit checkout of `github.event.sha`.
- **ADR 0006** is amended by this ADR: Express is no longer the server entry, `NG_ALLOWED_HOSTS` is no longer used, and `serve:ssr` runs the local runner.
- **ADR 0008:** the preview origin pattern and the region are fixed above; the consent-page domain stays `*.convex.site`.
- **Ongoing cost:** $0 now, about $9 per month from the first production release at the stated traffic, and about $25 at roughly 6.5 times that traffic.
- **Harder later:**
  - Moving off Netlify means rewriting `src/server.ts`, `netlify.toml`, and the secrets setup.
  - Server code must stay Web-API-only.
  - Authenticated SSR would also have to fit the edge limits.

## Owner questions

1. **Netlify plan from the first production release.**
   - Options: (a) Personal, $9: 1,000 credits, auto-recharge, but the production key is also visible to the edge runtime; (b) Pro, $20: Builds-only scope for the key, team members, and password-protected previews.
   - **Recommendation: (a).** Server code never reads the environment (lint rule), and (b) leaves only about $5 for Convex.
2. **Preview visibility.**
   - Options: (a) public previews, holding test data only and marked `noindex`; (b) private previews, Netlify login and owner only, which blocks #15's automated smoke run unless it is dropped.
   - **Recommendation: (a).**
3. **Convex production region.**
   - Options: (a) US East (N. Virginia); (b) EU West (Ireland). The region cannot be changed after the deployment is created.
   - **Recommendation: (a)**, unless the leagues are mainly in Europe.
4. **Google consent page domain after the first production release.**
   - Options: (a) accept `<prod-deployment>.convex.site`; (b) Convex Professional with a custom domain, $25, making the total about $34 and over budget; (c) a first-party `/api/auth/*` proxy in the edge function, with the callback, session, and client-IP changes listed above.
   - **Recommendation: (a)**, and revisit (b) when revenue allows.

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

   | Request | Result |
   | --- | --- |
   | `GET /` | 200, the prerendered page, served static |
   | `GET /o/acme` | 200, `cache-control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`, `<title>Org page</title>`, `og:title`, the list |
   | `GET /app/x` | 200, empty `<app-root>` shell |
   | `GET /does-not-exist` | **404** with the not-found view and the same `cache-control` |
   | `/media/*.woff2` and `/favicon.ico` | 200, served static |
   | `Host: evil.example` | 400, logged "Header "host" with value "evil.example" is not allowed" |
   | `X-Forwarded-Host: evil.example` | 400 |
   | Five warm Server-route requests | 7.6 to 17.5 ms wall time, through the local proxy |

   `netlify serve` did not apply the `[[headers]]` rule for `/media/*` to static files. #15 checks the item 3 headers on a real deploy.
5. **CPU per render.** The script imported `server.mjs` and called `netlifyAppEngineHandler` directly.

   | Node | Module load | First render | Warm median (50 renders) | Warm p95 |
   | --- | --- | --- | --- | --- |
   | 26.11.0 | 5.2 ms | **78.1 ms** | 2.8 ms | 10.2 ms |
   | 24.16.0 | 7.2 ms | **86.3 ms** | 3.1 ms | 8.1 ms |

6. **Local runner `scripts/serve-ssr.mjs` on Node 24.16.0.**

   | Request | Result |
   | --- | --- |
   | `/` | 200 |
   | `/o/acme` | 200 with `Cache-Control` and SSR content |
   | `/app/x` | 200 |
   | `/does-not-exist` | 404 |
   | `/media/inter-*.woff2` and `/main-*.js` | `public, max-age=31536000, immutable` |
   | `/favicon.ico` and `/index.csr.html` | `public, max-age=0, must-revalidate` |
   | `/../package.json` and `/%2e%2e/package.json` | 404 from the engine; nothing was read outside `browser/` |
   | `Host: evil.example` | 400 |

   A first version that imported `@angular/ssr/node` from `node_modules` failed with "JIT compilation failed for injectable [class PlatformLocation]". The final version uses Node built-ins only.

**Not tested (no accounts or secrets):** real Netlify deploys, deploy-context variables, CDN cache hits and 404 caching, the CPU limit on real edge isolates, and `npx convex deploy` against a real preview key. #15 covers these.

## Sources

- **Netlify:**
  - Pricing and terms: [pricing](https://www.netlify.com/pricing/), [credit-based pricing](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/), [billing FAQ](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/), [Self-Serve Subscription Agreement](https://www.netlify.com/legal/self-serve-subscription-agreement/), [Terms of Use](https://www.netlify.com/legal/terms-of-use/).
  - Angular and edge functions: [Angular on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/angular/), [angular-runtime README](https://github.com/netlify/angular-runtime), [edge functions overview](https://docs.netlify.com/build/edge-functions/overview/), [limits](https://docs.netlify.com/build/edge-functions/limits/), [configuration](https://docs.netlify.com/build/edge-functions/optional-configuration/), [API](https://docs.netlify.com/build/edge-functions/api/).
  - Caching and headers: [caching overview](https://docs.netlify.com/build/caching/caching-overview/), [custom headers](https://docs.netlify.com/manage/routing/headers/).
  - Build and environment: [build software](https://docs.netlify.com/build/configure-builds/available-software-at-build-time/), [dependency management](https://docs.netlify.com/build/configure-builds/manage-dependencies/), [build environment variables](https://docs.netlify.com/build/configure-builds/environment-variables/), [environment variables](https://docs.netlify.com/build/environment-variables/overview/), [get started / sensitive variable policy](https://docs.netlify.com/build/environment-variables/get-started/), [Secrets Controller](https://docs.netlify.com/build/environment-variables/secrets-controller/).
  - Deploys and access: [deploy overview / contexts / permissions](https://docs.netlify.com/deploy/deploy-overview/), [deploy previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/), [manage deploys / rollbacks](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/), [ignore builds](https://docs.netlify.com/build/configure-builds/ignore-builds/), [deploy notifications](https://docs.netlify.com/deploy/deploy-notifications/), [project visibility](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/), [password protection](https://docs.netlify.com/manage/security/secure-access-to-sites/password-protection/), [proxies / signed proxy redirects](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/).
- **Convex:** [pricing](https://www.convex.dev/pricing), [Terms of Service](https://www.convex.dev/legal/tos), [limits](https://docs.convex.dev/production/state/limits), [multiple and preview deployments](https://docs.convex.dev/production/multiple-deployments), [deploy CLI](https://docs.convex.dev/cli/reference/deploy), [Netlify hosting](https://docs.convex.dev/production/hosting/netlify), [custom domains](https://docs.convex.dev/production/custom-domains), [backup and restore](https://docs.convex.dev/database/backup-restore).
- **Vercel:** [pricing](https://vercel.com/pricing), [Hobby plan](https://vercel.com/docs/plans/hobby), [Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [CDN cache](https://vercel.com/docs/caching/cdn-cache), [supported frameworks](https://vercel.com/docs/frameworks/more-frameworks), `vercel/vercel` `packages/frameworks/src/frameworks.ts` (Angular preset).
- **Cloudflare:** [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Workers Cache](https://developers.cloudflare.com/workers/cache/), [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/), [Version and preview URLs](https://developers.cloudflare.com/workers/configuration/previews/), [Previews configuration](https://developers.cloudflare.com/workers/previews/configuration/), [Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [Angular guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/angular/).
- **Google Cloud:** [Cloud Run rollouts and tags](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration), [Cloud CDN overview](https://docs.cloud.google.com/cdn/docs/overview), [network pricing](https://cloud.google.com/vpc/network-pricing).
- **Render:** [service previews](https://render.com/docs/service-previews), [web service edge caching](https://render.com/docs/web-service-caching), [Blueprint `previewValue`](https://render.com/docs/blueprint-spec).
- **Firebase:** [App Hosting docs index](https://firebase.google.com/docs/app-hosting), [Hosting GitHub integration](https://firebase.google.com/docs/hosting/github-integration).
- **GitHub:** [deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [managing environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments), [events that trigger workflows (`status`)](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#status).
- **Angular:** [SSR guide](https://angular.dev/guide/ssr), [security: allowed hosts](https://angular.dev/best-practices/security), [deployment](https://angular.dev/tools/cli/deployment), `@angular/ssr@22.2.2` `fesm2022/ssr.mjs` (`AngularAppEngine.getAllowedHosts`) and `fesm2022/_validation-chunk.mjs`.
- **npm registry (2026-10-07):** `@netlify/angular-runtime` 4.0.0, `@netlify/edge-functions` 3.0.8, `@netlify/types` 2.8.0, `netlify-cli` 27.11.2, `vercel` 62.7.0, `wrangler` 4.148.0, `firebase-tools` 15.32.1, `@angular/ssr` 22.2.2, `@angular/cli` 22.2.2, `express` 5.2.1.
- **[Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat):** `netlify.app`, `convex.site`, `vercel.app`, `workers.dev`, `onrender.com`.
