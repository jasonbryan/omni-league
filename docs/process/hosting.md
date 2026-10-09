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

## Deploy environment check

`scripts/check-deploy-env.mjs` fails the Netlify build, so nothing is published, when a Convex deployment has the wrong variables. It reads variable names only (`npx convex env list --names-only`), plus the value of `AUTH_EMAIL_DISABLED` in preview mode, which it compares in memory. It never prints a value, and it prints the name of the deployment it checked.

| Mode         | Fails when                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------- |
| `preview`    | `IS_TEST` is set; `AUTH_EMAIL_DISABLED` is not exactly `true`; `RESEND_API_KEY` is set             |
| `production` | `IS_TEST` is set; `AUTH_EMAIL_DISABLED` is set (the email slice adds the ADR 0011 presence checks) |

**Targeting.** `--preview-name <name>` selects the preview deployment with the preview deploy key; it is the same name `npx convex deploy --preview-create` used (`pr-$REVIEW_ID`, or `$HEAD` = `main` for staging). Convex 1.46's `env` commands accept `--preview-name` but hide it from `--help`. If a Convex upgrade drops it, the CLI call fails and so does the build; it never passes silently. Without `--preview-name`, the CLI acts on the deployment that `CONVEX_DEPLOY_KEY` names (a production key).

**Ordering.**

- **Preview mode runs after `npx convex deploy`** (`netlify.toml`, `deploy-preview` and `branch-deploy`), because `pr-<n>` does not exist before it.
- **Production mode must run before `npx convex deploy`:** `npm ci && node scripts/check-deploy-env.mjs production && npx convex deploy ...`. A failure after the deploy would leave the new functions already pushed to the production backend, with only the Netlify publish stopped. The production deploy issue wires this into `[context.production]`; it must not copy the preview ordering.

**Preview residual (accepted).** When the preview check fails, Netlify publishes nothing, but the `pr-<n>` backend with the forbidden variable stays live on its `*.convex.site` URL until the next push recreates it or it expires after 5 days.

**Running it locally (owner).** With the preview deploy key in `CONVEX_DEPLOY_KEY` (read it with `read -rs CONVEX_DEPLOY_KEY && export CONVEX_DEPLOY_KEY`, so it stays out of shell history), `node scripts/check-deploy-env.mjs production --preview-name pr-<n>` checks a preview against the production rules; it fails naming `AUTH_EMAIL_DISABLED`.

## `noindex`

Previews and staging send `X-Robots-Tag: noindex`; production does not. Netlify's own header on previews is undocumented, and `netlify.toml` `[[headers]]` cannot be limited to a context, so `npm run build` (`scripts/ng-convex.mjs`) decides from Netlify's `CONTEXT` (any value other than `production`):

- **Static files:** it writes `_headers` (`/*` → `X-Robots-Tag: noindex`) into `dist/omni-league/browser/` (`scripts/noindex.mjs`).
- **Edge-function responses** (server routes, 404, 400, 500): it sets the build-time define `__NOINDEX__`, and `netlifyAppEngineHandler` adds the header (`src/server-robots.ts`). The server entry reads no environment at runtime.

A local build (no `CONTEXT`) has neither.

## Cleanup

No cleanup job. Convex deletes preview deployments 5 days after creation. Netlify deletes non-published deploys after 30 days on Free, or 90 days on paid plans. Until then a closed PR's preview URL keeps serving test data. Staging stops working if `main` gets no merge for 5 days, until the next merge recreates its backend.

## Smoke runs (local)

Chromium only, both widths, no secrets (previews are public):

```sh
# Tester, Phase 5: the PR's preview
E2E_BASE_URL=https://deploy-preview-<n>--charming-longma-28c00d.netlify.app npm run e2e -- e2e/smoke.spec.ts

# Deployer, Phase 8: staging after a merge
E2E_BASE_URL=https://main--charming-longma-28c00d.netlify.app npm run e2e -- e2e/smoke.spec.ts
```

The hydration-log assertion and the `/%E0%A4%A` check are reported as skipped against a URL ([README](../../README.md#e2e-tests)). `E2E_WEBKIT` stays unset.

## Observed results

Recorded by #15's testing; until #23 (the not-found page with `Cache-Control: ... s-maxage=60`) merges, the `Cache-Status`, server-route `noindex`, and cold-start render checks are **partial**, and #23 repeats them on its own preview. The first production release waits for a full pass.

| Check                                                  | Result                          |
| ------------------------------------------------------ | ------------------------------- |
| Cold start (3 fresh deploys, tester and owner's phone) | pending (#15, Phase 5)          |
| `Cache-Status` of a repeated `/does-not-exist`         | pending (#15, Phase 5), partial |
| Netlify UI refuses a project name with `--`            | pending (owner, setup 5)        |
