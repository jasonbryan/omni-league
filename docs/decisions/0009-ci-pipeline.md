# 0009: CI pipeline on GitHub

- **Status:** Accepted
- **Gate:** `gate:technology`
- **Issue:** #8
- **Date:** 2026-10-07 (revised 2026-10-07 for the owner's "minimize CI usage" direction)
- **Amends:** ADR 0005 (WebKit trigger and the Convex backend cache; see "Amendment" at the end of ADR 0005)
- **Amended:** 2026-10-08, wording only: the `scope` step's rename handling and code-extension rule, as shipped in #12 (PR #39). See "Amendment: scope step (2026-10-08)" at the end.

## Context

The dev cycle merges a PR only when "CI is green", but no CI exists yet. ADR 0001 fixes GitHub as the CI host. This ADR decides the runner type, the pipeline shape (jobs, triggers, caching), the required checks and how they are enforced on this private repository, the policy for actions, how actions and npm dependencies get update PRs, and the workflow-security rules. Deployment (CD) belongs to #9.

### Owner direction: minimal Actions usage is a primary design goal

On PR #31 the owner wrote: "I upgraded to pro but I would like to minimize CI/CD usage time as much as possible. Don't have too much redundant process and try to minimize usage in general." This revision therefore judges every option first by billed minutes, then by whether it repeats work that something else already does:

- **The tester already runs the full suite locally** (dev cycle Phase 5), and the implementer runs every check before handing over (Phase 4). CI is the objective, final check of the exact tree that merges, not an iteration loop.
- **Netlify builds every preview and the `main` staging site on its own infrastructure** (ADR 0010, PR #33). Those builds cost no Actions minutes, so CI does not deploy anything.
- **A check that runs twice on the same tree is redundant.** CI runs once per tree that can merge, not once per push and again after the merge.

### Inputs from accepted ADRs

| ADR                             | What CI must do                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0002 lint and format            | Run `lint` (`eslint . --max-warnings=0`) and `format:check` (`prettier . --check`) as separate scripts. Prettier also formats Markdown, mockup HTML, and `.github/**/*.yml`, and CI is the only enforcement point (no git hooks). Workflow linting is left to this ADR.                                                                                                                                                                                                                 |
| 0003 package manager and Node   | npm 11 bundled with Node 26.11+, pinned in `package.json` `devEngines` (`onFail: "error"`) and `.nvmrc`. Install with `npm ci`. No Corepack and no package-manager setup action. `npm audit signatures` is a CI step. `.npmrc` sets `min-release-age=1`, so the update tool's cooldown must be at least 1 day. Advisories arrive through Dependabot alerts and security updates.                                                                                                        |
| 0004 unit and Convex tests      | Two scripts, `test` (`ng test --watch=false`) and `test:convex` (`vitest run --config vitest.config.mts`). No secrets, no browser, no deployment. `convex/_generated/` is committed; a drift check needs the local backend and is left to this ADR.                                                                                                                                                                                                                                     |
| 0005 e2e and accessibility      | Playwright plus `@axe-core/playwright`. `npx playwright install --with-deps chromium` on every run (no browser cache). `workers: 1`, `retries: 1` in CI. Artifacts use `retention-days: 7`. Minutes per e2e run: about 3 for the harness, 5 to 8 once features exist, plus 1.5 to 2.5 for WebKit. As accepted it ran `webkit-mobile` on every push to `main` and cached the Convex backend; **this ADR amends both** (see "WebKit" and "Caching" below, and the amendment in ADR 0005). |
| 0006 Angular baseline           | `build` produces the browser bundle, the SSR server bundle, and prerendered routes. CI has no Convex URL, and Prerender routes read no Convex data, so the build needs no secret.                                                                                                                                                                                                                                                                                                       |
| 0008 auth                       | E2E sign-in runs against the anonymous local backend with no stored secret, so fork PRs and Dependabot PRs work.                                                                                                                                                                                                                                                                                                                                                                        |
| 0010 hosting (PR #33, proposed) | Netlify builds deploy previews and the `main` branch deploy itself, with no Actions minutes. Release PRs go from `main` into a `production` branch, created at the first production release.                                                                                                                                                                                                                                                                                            |

### Repository state, checked on 2026-10-07

- **Visibility and plan.** `gh api repos/jasonbryan/omni-league` reports `"private": true`, owned by a user account. `gh api repos/jasonbryan/omni-league/branches/main/protection` and `.../rulesets` both returned HTTP 403 "Upgrade to GitHub Pro or make this repository public to enable this feature." So the owner was on **GitHub Free** for personal accounts when this ADR was first written. The owner has since upgraded to **GitHub Pro** (see "Owner decision"); ADR 0010 records that `.../rulesets` now answers 200.
- **Actions settings** (`gh api .../actions/permissions`, `.../actions/permissions/workflow`, `.../actions/permissions/fork-pr-workflows-private-repos`):
  - default `GITHUB_TOKEN` permission is already `read`, and workflows cannot approve PRs;
  - all actions are allowed, and `sha_pinning_required` is `false`;
  - workflows do not run on fork PRs, and no write token or secret goes to them.
- **Dependabot alerts and security updates are off** (`.../vulnerability-alerts` returns 404; `.../automated-security-fixes` returns `"enabled": false`).
- **Merge methods:** merge, squash, and rebase are all enabled, and `delete_branch_on_merge` is `false`. The dev cycle squash-merges and deletes the branch.

### GitHub plan facts (from the docs, 2026-10-07)

| Item                                                     | GitHub Free (plan when first written)                                                                                                                                                                    | GitHub Pro (current plan)                                 | Public repository                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------- |
| Protected branches and rulesets on this repo             | **No.** "Protected branches are available in public repositories with GitHub Free … also available in public and private repositories with GitHub Pro, GitHub Team …"; rulesets have the same wording    | Yes                                                       | Yes                                     |
| Hosted-runner minutes included per month (private repos) | 2,000                                                                                                                                                                                                    | 3,000                                                     | Standard runners are free and unlimited |
| Artifact storage included                                | 500 MB                                                                                                                                                                                                   | 1 GB                                                      | Free                                    |
| Cache storage per repository                             | 10 GB                                                                                                                                                                                                    | 10 GB                                                     | 10 GB                                   |
| Standard Linux x64 runner                                | 2 CPU, 8 GB RAM                                                                                                                                                                                          | same                                                      | 4 CPU, 16 GB RAM                        |
| Price beyond the included minutes                        | Linux 2-core x64: $0.006 per minute                                                                                                                                                                      | same                                                      | —                                       |
| When included minutes run out                            | "If your account does not have a valid payment method on file, usage is blocked once you use up your quota." With a payment method, spending is capped by any budgets. Minutes reset each billing cycle. | same                                                      | —                                       |
| Merge queue                                              | No                                                                                                                                                                                                       | No (merge queues are for organization-owned repositories) | Only if owned by an organization        |

Billing and check behaviour that drive this design:

- **Rounding.** "GitHub rounds the minutes and partial minutes each job uses up to the nearest whole minute." Every job costs at least 1 minute, so fewer jobs cost less.
- **Skipped jobs cost nothing and pass required checks.** "A job that is skipped will report its status as "Success". It will not prevent a pull request from merging, even if it is a required check." A job skipped by its `if:` is never assigned a runner, so it bills 0 minutes.
- **Path-filtered workflows do not.** A workflow that never starts because of `paths`/`paths-ignore` reports no check at all, so a required check stays "Expected" (pending) and blocks the merge. Workflow-level path filters are therefore unusable for a required check.
- **Cache scope.** "Workflow runs can restore caches created in either the current branch or the default branch." A cache created by a PR run "is created for the merge ref (`refs/pull/.../merge`)" and "cannot be restored by the base branch or other pull requests targeting that base branch." Caches unused for 7 days are removed. **So a cache is only shared across PRs if a run on `main` saves it.**
- **Draft PRs cannot be merged**, by anyone, until marked ready for review.
- GitHub's public pricing page no longer lists Pro. Third-party listings give $4 per month. The owner sees the exact price on the account's Compare plans page.
- A $0.002-per-minute platform charge for self-hosted runners, announced for 2026-03-01, was postponed with no new date.

### Volume assumptions (unchanged from the first version, so before and after compare)

- 60 PRs a month (the rate ADR 0005 used; this repository had 11 PRs in its first two days): **40 change app code**, **20 are docs-only** (gate ADRs, mockups, process docs).
- Each PR gets **3 pushes** while it is worked on.
- About **6 Dependabot PRs** a month on a weekly schedule.
- 60 merges a month into `main`.
- No production releases before launch. ADR 0010 assumes about 8 production deploys a month after launch.

## Options

### Runners

#### Option R1: GitHub-hosted standard Linux runner (`ubuntu-24.04`, x64)

- **What it is.** A fresh VM per job, 2 CPU and 8 GB RAM for private repos. It is billed against the plan's included minutes.
- **Pros.**
  - Clean, ephemeral machine on every run, so nothing persists between agent-written PRs.
  - No machine to maintain.
  - Has everything ADR 0005 assumed: `sudo` for `playwright install --with-deps`, `shellcheck` 0.9.0, `gh` 2.101, `jq`.
  - Playwright 1.64 supports Ubuntu 22.04, 24.04, and 26.04, x86-64 and arm64.
- **Cons and risks.**
  - Minutes are capped (see "Minutes and cost").
  - **`ubuntu-latest` moves to Ubuntu 26.04 between 2026-10-19 and 2026-11-19** (actions/runner-images#14748), which overlaps the #12 and #13 implementation. Pinning `ubuntu-24.04` avoids a silent image change mid-build.

#### Option R2: self-hosted runner (for example on the owner's Mac or a small VM)

- **What it is.** The GitHub runner agent on the owner's own hardware. No minute charge today.
- **Pros.** Unlimited minutes, faster warm caches.
- **Cons and risks.**
  - GitHub's secure-use guide warns that self-hosted runners "can be persistently compromised by untrusted code in a workflow". On a private repo it says to "be cautious … as anyone who can fork the repository and open a pull request … are able to compromise the self-hosted runner environment". Here every PR is code written by agents, run on the owner's machine.
  - The machine must be online, patched, and provisioned with Node 26, Playwright system libraries, and WebKit dependencies. A laptop that sleeps blocks merges.
  - The postponed per-minute platform charge may return.
- **Not recommended.** With the measures below, hosted usage is a small fraction of Pro's quota, so the minute saving no longer justifies the risk.

GitHub-hosted arm64 runners (`ubuntu-24.04-arm`) draw from the same included minutes, so they save nothing within the quota. No ADR has verified the local Convex backend binary on Linux arm64.

### When CI runs (triggers)

Billed runs per month at the volume above, before per-run cost:

| Option                                                                                                | What triggers a full run                                                       | App-PR runs | Docs-only runs | `main` runs                                                                    | Notes                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------- | -------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **T1: every push, plus every push to `main`** (first version)                                         | `pull_request` opened/synchronize/reopened; `push: main`                       | 120         | 60             | 60 merges + 6 Dependabot = 66                                                  | Runs on every draft iteration the tester already ran locally, and again on `main` for a tree that was just tested. |
| **T2: ready PRs only, plus `main`**                                                                   | `pull_request` incl. `ready_for_review`, job skipped while draft; `push: main` | ~50         | 60             | 66                                                                             | Removes the draft iterations; keeps the post-merge duplicate.                                                      |
| **T3: ready PRs only; nothing on `main`; ruleset requires the branch to be up to date** (recommended) | as T2, no full run on `main`                                                   | ~50         | 60             | 0 (plus a 1-to-2-minute cache warm only when the lockfile changes, ~6 a month) | Exactly one full run per mergeable tree.                                                                           |

- **"App-PR runs ~50"**: 40 app PRs, each marked ready once, plus an allowance of 25% for a second run (a CI failure fixed after ready, or another merge landing in the few minutes between "ready" and "merge").
- **Docs-only PRs stay at 3 runs each.** Gate PRs are opened ready because the owner reads and merges them, and each owner revision is a push. They are cheap (below).
- **Draft pushes are free.** The run is created, but its only full job has `if: !github.event.pull_request.draft`, so it is skipped and bills 0 minutes. A skipped job reports "Success", which is harmless here because GitHub refuses to merge a draft, and the merge check below requires a real `pass`.

#### Why nothing needs to run on `main` (T3)

The first version ran the whole suite on every push to `main` "to catch post-merge breakage". That breakage can only come from **the merged tree differing from the tested tree**. Three ways to close that gap:

| Option                                                                                                   | Extra minutes a month                                       | Merged tree equals tested tree?                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1: full run on every `main` push** (first version)                                                    | 594 now; 726 to 924 with feature e2e                        | No, checked after the fact; a failure is already on `main`.                                                                                                                                                         |
| **M2: ruleset "Require branches to be up to date before merging" (strict), no `main` run** (recommended) | ~0 to 50 (the 25% re-run allowance above already counts it) | **Yes.** The head must contain `main`'s tip, so the squash commit's tree is the head's tree, which is what the `pull_request` run tested (its merge ref equals the head tree). `--match-head-commit` pins the head. |
| **M3: no `main` run, no strict rule**                                                                    | 0                                                           | No. Two PRs that each passed against an older `main` can combine into a broken `main`. The next PR's run or Netlify's staging build finds it later.                                                                 |

The first version rejected the strict rule because it "would re-run CI on every open PR after each merge". **That was wrong:** the rule does not re-run anything by itself; it only refuses a merge until the head contains `main`. Under T3 the orchestrator updates a PR's branch **while it is still a draft** (free), then marks it ready, so one run covers both. A second run happens only if another PR merges in the minutes between "ready" and "merge", which the orchestrator avoids by finishing one merge at a time. GitHub's merge queue, which would automate this, is not available for repositories owned by a personal account.

What still runs on `main`: **no checks.** Netlify builds the `main` staging site on its own infrastructure (ADR 0010), which re-proves the production build at no Actions cost, and the deployer smoke-tests staging from its own machine. The only Actions job on `main` is the cache warm below.

### Pipeline shape

Minutes are per job, rounded up, and every job pays about 1 minute for checkout, Node setup, and `npm ci`.

| Option                                              | Jobs | Billed per app-PR run, harness / with feature e2e | Wall clock                     | Status checks                                                                              |
| --------------------------------------------------- | ---- | ------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| S1: one job per check, plus e2e                     | 8    | ~13 / ~15 to 18                                   | ~3 to 8 min                    | One per check                                                                              |
| S2: `checks` + `e2e` (first version)                | 2    | ~7 / ~9 to 12                                     | ~3 to 8 min (parallel)         | Two                                                                                        |
| **S4: one job `ci`, checks then e2e** (recommended) | 1    | **~5 / ~8 to 10**                                 | ~5 / ~8 to 10 min (sequential) | **One (`ci`)**; the failing step is named in the job log and in `gh run view --log-failed` |

- **S4 installs dependencies once instead of twice and rounds once instead of twice**, saving about 2 minutes per run against S2.
- **The extra wall clock does not matter here.** Under T3, CI runs once per PR, at merge time, after the tester's local run. A 3-to-5-minute longer wait on one run a PR is cheaper for the owner than paying twice for setup.
- **Step order gives most of S1's signal at S4's cost:**
  - every cheap check (format, audit, lint, typecheck, unit tests, Convex tests, build, actionlint) runs even after an earlier one fails, so one run reports all of them;
  - the e2e steps run only if every check passed. A run that is going to fail anyway does not also spend 2 to 6 minutes on browsers and specs.
- **One required check, `ci`.** The ruleset and the merge check name one check instead of two.

### Docs-only PRs

A third of PRs change only `docs/`, `design/`, `.claude/`, or root `*.md`. ADR 0002 makes CI the only formatting check, and Prettier formats Markdown and mockup HTML, so these PRs still need `format:check`, and nothing else.

| Option                                                                                           | Billed per docs-only run | Required check safe?                                                        |
| ------------------------------------------------------------------------------------------------ | ------------------------ | --------------------------------------------------------------------------- |
| Full run (first version's `checks`, plus a 1-minute `e2e` skip)                                  | 5                        | Yes                                                                         |
| Workflow-level `paths-ignore`                                                                    | 0                        | **No:** the required check never reports and blocks the merge forever.      |
| A second "stub" workflow with the same check name and inverse paths                              | 1                        | Yes, but two workflows must be kept in step.                                |
| Skip by label or title (`type:decision`) in the job `if:`                                        | 0                        | **No:** a mislabeled app PR would merge with a skipped, "successful" check. |
| **Scope step inside `ci`: on a docs-only PR, run only install and `format:check`** (recommended) | **1 to 2**               | Yes: the job runs and reports a real result.                                |

### Caching

| Item                                     | Options                                                                              | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm (`~/.npm`)                           | setup-node's automatic cache, keyed on `package-lock.json`; or none                  | **setup-node's cache, plus a warm job on `main`.** Without a `main` run, no PR could ever restore another's cache (see "Cache scope"), so every run would miss and also spend 10 to 20 seconds uploading a cache nobody reads. A warm job (`npm ci --ignore-scripts` on `main`, about 1 to 2 minutes) runs only when `package-lock.json` or `ci.yml` changes, about 6 times a month: 6 to 12 minutes. A warm cache saves about 20 to 35 seconds per run (~15 to 30 minutes a month), and, more importantly, keeps a docs-only run near the 1-minute rounding line instead of over it (up to 60 minutes a month). |
| Playwright browsers                      | `actions/cache` keyed on the Playwright version; or download each run                | **Download each run** (ADR 0005). Playwright's CI guide: "Caching browser binaries is not recommended", because restoring takes about as long as downloading, and the Linux system dependencies are not cacheable.                                                                                                                                                                                                                                                                                                                                                                                               |
| Convex local backend (`~/.cache/convex`) | `actions/cache` keyed on the pinned backend version (ADR 0005); or download each run | **Download each run (amends ADR 0005).** The cache is 164 MB, the download 63.7 MB, so restoring the cache is not faster. Under T3 there is no `main` run to save it, so each PR run would miss and then upload 164 MB.                                                                                                                                                                                                                                                                                                                                                                                          |

`actions/cache` is therefore no longer needed and leaves the inventory.

### WebKit e2e (`webkit-mobile`)

ADR 0005 runs `webkit-mobile` (WebKit at 360 x 800, a proxy for iOS Safari) on every push to `main`, at +1.5 to +2.5 minutes, and a failure there opens a `type:bug` issue. With no full run on `main` (T3), it needs a new trigger.

| Option                                                                                | Minutes a month                                                                   | What it protects                                                                                                      |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Every app-PR run                                                                      | ~75 to 125                                                                        | Every change, before merge. Most of the cost buys nothing before launch, when no user runs Safari against this app.   |
| Every `main` push (ADR 0005 as accepted)                                              | ~100 to 165 (66 runs)                                                             | Nothing before merge; a post-merge `type:bug` that nobody ships yet. Needs the full `main` run that T3 drops.         |
| **Release PRs into `production` only, plus manual `workflow_dispatch`** (recommended) | **0 before launch**; ~15 to 25 after (8 release PRs, 1.25 runs each, +1.5 to 2.5) | The exact tree that ships, and **it blocks the release**, which is stronger than ADR 0005's after-the-fact bug issue. |
| Not at all                                                                            | 0                                                                                 | Nothing. ADR 0005 chose WebKit because the product is phone-first.                                                    |

- Before launch, a Safari-only regression costs nothing, because nothing ships. At launch every release PR is checked, so no Safari regression reaches users unchecked.
- The cost of finding it late is bisecting a release's worth of changes instead of one. Anyone with write access can trigger `workflow_dispatch` with `webkit: true` on any branch (about 6 to 12 minutes) when a change is Safari-sensitive. The tester can also run `webkit-mobile` locally on macOS for free, which is a closer Safari proxy than Linux WebKit.
- This changes an Accepted ADR, so ADR 0005 gets an amendment section in this PR.

### Enforcing required checks on this private repo

| Option                                                    | What it takes                                                       | Pros                                                                                                                                                                                         | Cons                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **E1: upgrade to GitHub Pro, ruleset on `main` (chosen)** | Owner upgrades the personal account, then creates the ruleset below | Merges without a green `ci` on an up-to-date head are refused by GitHub for everyone, including agents acting with the owner's token, if the ruleset has no bypass list. Code stays private. | Monthly cost.                                          |
| E2: make the repository public, ruleset on `main`         | Owner changes visibility                                            | Free rulesets and unlimited standard-runner minutes.                                                                                                                                         | Source, ADRs, issues, and PR discussion become public. |
| E3: stay on Free; orchestrator check before merge         | A process rule                                                      | No cost and no visibility change.                                                                                                                                                            | Not enforced by GitHub.                                |

### Update tool for actions and npm dependencies

#### Option U1: Dependabot version updates and security updates (GitHub-native)

- **What it is.** Configured by `.github/dependabot.yml`, free for private repositories, and run by GitHub.
- **Pros.**
  - **No third-party app or extra repository permissions.**
  - **Supported for both ecosystems.**
    - npm v7 to v11 is on the supported list (ADR 0003).
    - GitHub Actions, including SHA pins: Dependabot "updates the version documentation … when the comment is on the same line, such as `actions/checkout@<commit> #<tag>`."
  - **Schedule** accepts `daily`, `weekly`, `monthly`, `quarterly`, `semiannually`, `yearly`, or `cron`. **Security updates do not wait for the schedule**, and cooldown "does not apply to security updates".
  - **`cooldown`.** `default-days` applies to both ecosystems, and npm also accepts per-semver days. If unset, Dependabot applies a 3-day default to version updates.
  - **`groups`** batch updates, which cuts PR count and CI minutes.
  - **ADR 0003's pins do not block it.**
    - Dependabot's npm updater image runs Node 24 and npm 11.17.0 (`npm_and_yarn/Dockerfile`), which is below `devEngines` (`^26.11.0`, `^11.20.0`).
    - Its lockfile updater runs `npm install --force --ignore-scripts --package-lock-only` (`npm_lockfile_updater.rb`).
    - The system checked that `--force` bypasses `devEngines`: on Node 24.16.0 with npm 11.13.0, a `package.json` with ADR 0003's `devEngines` fails `npm install --package-lock-only --ignore-scripts` with `EBADDEVENGINES`, and passes with `--force` added.
- **Cons and risks.**
  - **No Dependabot alerts for actions pinned to a SHA.** The secure-use docs say Dependabot "will not create alerts for actions pinned to SHA values". Monthly version updates and the GitHub-owned-only action policy (below) limit the exposure.
  - **Security updates skip cooldown.** A fix published less than a day earlier can fail under `.npmrc` `min-release-age=1` until a day has passed. The risk is a delay of at most one day.
  - **A new transitive install script makes the PR's `npm ci` fail** with `ESTRICTALLOWSCRIPTS` (ADR 0003). The PR then needs an `allowScripts` entry. This is intended.

**Schedule and grouping, by minutes:**

| Option                                           | PRs a month                                                                 | Runs (about 1.5 each)   | Minutes, harness / feature e2e |
| ------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------- | ------------------------------ |
| Weekly, grouped per ecosystem (first version)    | ~6                                                                          | ~12 (2 each, non-draft) | 84 / 108 to 144                |
| **Monthly, grouped per ecosystem** (recommended) | ~3 (one npm group, one actions group, occasionally a major or security fix) | ~5                      | **25 / 40 to 50**              |
| Monthly, one multi-ecosystem group               | ~2                                                                          | ~3                      | 15 / 25 to 30                  |

- **Multi-ecosystem groups** (generally available since 2025-07-01) would merge npm and actions bumps into one PR. They are not adopted: each ecosystem must list `patterns`, the documentation does not say how they treat semver-major updates, and an npm major must stay a separate PR because it needs `gate:technology` (AGENTS.md). The saving is about 10 to 20 minutes a month.
- Monthly is safe because security updates arrive whenever an advisory is published, regardless of the schedule.

#### Option U2: Renovate (Mend-hosted GitHub App)

- **What it is.** Renovate 44.145.1 (AGPL-3.0). The Mend app is "free to install for both public and private repositories."
- **Pros.** Richer configuration (`minimumReleaseAge`, `pinDigests`, monorepo presets, a dependency dashboard).
- **Cons and risks.**
  - **A third-party service gets write access** to this private repository's contents, PRs, and workflow files. That is a new external service under `gate:technology` and a wider trust boundary than GitHub itself.
  - A second update channel: security alerts would still come from Dependabot.
- **Not recommended.**

#### Option U3: manual updates

Nothing proposes SHA bumps, and the work is forgotten under load. Rejected.

### Workflow linting

| Option                                           | What it is                                                                                                                                                                                      | Assessment                                                                                                                                                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **actionlint 1.7.12** (MIT, released 2026-03-30) | Static checker for workflow syntax, `${{ }}` expressions and contexts, `needs`/`steps`/`inputs` references, runner labels, and shell scripts (through `shellcheck`, preinstalled on the runner) | A single Go binary from the GitHub release, checked by SHA-256, no action needed. It takes a few seconds inside the existing job, so it adds no billed minute. The release has a GitHub build attestation (`gh attestation verify` passed). |
| zizmor 1.30.1 (MIT)                              | Security linter for workflows                                                                                                                                                                   | Overlaps with the rules below, most of which GitHub settings or review already enforce. Not adopted; revisit if workflows multiply.                                                                                                         |
| None                                             | Review only                                                                                                                                                                                     | Expression and reference mistakes then show up as failed or silently skipped steps on GitHub.                                                                                                                                               |

## Recommendation

**One workflow, one job (`ci`) on GitHub-hosted `ubuntu-24.04`, run only for PRs that are ready for review, once per mergeable tree. Nothing re-runs on `main`: the ruleset requires an up-to-date branch instead. Docs-only PRs run only `format:check`. WebKit runs only on release PRs and on demand. Dependabot monthly and grouped. Only GitHub-owned actions, pinned by full SHA. Estimated usage: about 340 to 410 minutes a month now and 510 to 680 once feature e2e exists, down about 76 to 81% from the first version's 1,820 and 2,210 to 2,810, against Pro's 3,000.**

### Workflow, triggers, and jobs

One file, `.github/workflows/ci.yml`, named `CI`:

- **Triggers:**
  - `pull_request`, types `opened`, `reopened`, `synchronize`, `ready_for_review`, branches `main` and `production` (release PRs);
  - `push` to `main`, **only** with `paths: [package-lock.json, .github/workflows/ci.yml]`, for the cache warm (not a required check, so a path filter is safe there);
  - `workflow_dispatch` with a boolean input `webkit`.
  - No `pull_request_target`, no `workflow_run`, no `schedule`. No workflow-level path filter on `pull_request`.
- **Concurrency:** `group: ci-${{ github.event.pull_request.number || github.run_id }}`, `cancel-in-progress: true`. A new push to a ready PR cancels its previous run, and converting it back to draft and pushing cancels it too.
- **Timeouts:** `timeout-minutes: 25` on `ci` and `10` on `warm-cache`. The default is 360 minutes.

| Job (check name) | Runs when                                                                                                                                                 | Steps                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Billed                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ci`             | PR is not a draft (opened ready, marked ready, or a push to a ready PR), and `workflow_dispatch`. Skipped (0 minutes) for drafts and for the `main` push. | checkout (depth 2, `persist-credentials: false`); **scope**; setup-node (npm cache automatic); `npm ci`; `format:check`; then, on app changes only: `npm audit signatures`, `lint`, `typecheck`, `test`, `test:convex`, `build`, actionlint (each runs even if an earlier one failed); then, only if all of those passed: Playwright browser install (`chromium`, plus `webkit` when `E2E_WEBKIT=1`), `npm run e2e`, artifact upload (`retention-days: 7`) | docs-only 1 to 2; app ~5 (harness), ~8 to 10 (feature e2e); +1.5 to 2.5 with WebKit |
| `warm-cache`     | push to `main` that changes `package-lock.json` or `ci.yml` (about 6 a month)                                                                             | checkout; setup-node; `npm ci --ignore-scripts` (fills `~/.npm`, which setup-node saves under `main`)                                                                                                                                                                                                                                                                                                                                                      | 1 to 2                                                                              |

- **Scope step:** on `pull_request`, if every changed file is under `docs/`, `design/`, `.claude/`, or is a root `*.md`, and none is a `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, or `.cts` file, the output is `app=false`. A file with one of those extensions (the ones ESLint lints) is app code wherever it lives. An empty diff, `workflow_dispatch`, and anything else (including `.github/` and `package-lock.json`) give `app=true`. It reads `git diff --no-renames --name-only HEAD^1 HEAD` on the `refs/pull/<n>/merge` commit, whose first parent is the base branch; `--no-renames` lists both paths of a rename, so moving an app file into `docs/` is an app change. It avoids `grep -q` in a pipe (SIGPIPE under `pipefail`). See "Amendment: scope step (2026-10-08)" at the end.
- **`E2E_WEBKIT`** is `1` when `github.base_ref == 'production'` (a release PR) or the dispatch input `webkit` is true, else `0`. The Playwright config (#13) includes the `webkit-mobile` project only when it is `1`.
- **Convex `_generated/` drift check (ADR 0004):** added by the first feature that wires the local backend into e2e. Right after `npx convex dev --once`, a step runs `git diff --exit-code convex/_generated`. It costs no extra job.
- **No production `build` duplication is removed yet.** Netlify's deploy-preview build also builds production, but only after #15, and making a third-party status a required check couples merges to Netlify's availability. The `build` step costs about 0.5 to 1 minute; revisit once #15 has run for a month.

### Required checks and enforcement

**Required check: `ci`** (the job `name:`). `docs/process/ci.md` (#12) lists it.

**Ruleset on `main` (E1, GitHub Pro), created by the owner once #12 has produced a `ci` check run:**

- target: the default branch; enforcement: active; **bypass list: empty**, so admins, and agents using the owner's token, are bound too;
- require a pull request before merging, with 0 required approvals (agents cannot approve a PR opened with the owner's identity, and the tester and reviewer record their verdicts as comments);
- require status check `ci`, source "GitHub Actions", **with "Require branches to be up to date before merging" on** (M2). This is what lets `main` run no checks;
- block force pushes and deletion of `main`.

ADR 0010's `production` ruleset requires the same `ci` check.

**Orchestrator merge procedure (dev cycle Phase 7), one PR at a time:**

1. If the PR branch is behind `main`, update it while it is still a draft: `gh pr update-branch <n>`. No CI runs. A clean update does not reset the tester's `PASS` or the reviewer's `APPROVE`, because the CI run in step 2 checks the combined tree. A conflict sends the PR back to the implementer.
2. Mark it ready: `gh pr ready <n>`. This starts the one `ci` run.
3. Read the head SHA (`gh pr view <n> --json headRefOid`), then wait until `gh pr checks <n> --json name,bucket,workflow` shows `ci` from workflow `CI` with `bucket` `pass`. **`skipping` is not a pass:** it is the draft-time skip.
4. Merge: `gh pr merge <n> --squash --delete-branch --match-head-commit <sha>`. If another PR merged meanwhile, GitHub refuses the merge (strict rule); go back to step 1.
5. If `ci` fails, convert the PR back to draft (`gh pr ready <n> --undo`) and return it to the implementer, so the fix iterations cost nothing.

Gate PRs (ADRs, mockups) are opened ready, because the owner reads and merges them. They are docs-only, so each push costs 1 to 2 minutes. If one is behind `main`, the owner presses "Update branch" (or the orchestrator runs step 1) before merging. Dependabot PRs are opened ready by Dependabot and follow steps 1, 3, and 4. Agents never push to `main` directly.

**Repository settings (owner):**

- allow squash merging only, and turn on automatic branch deletion;
- Actions permissions: "Allow jasonbryan, and select non-jasonbryan, actions and reusable workflows", with **"Allow actions created by GitHub"** checked, no other patterns, and **"Require actions to be pinned to a full-length commit SHA"** checked;
- Workflow permissions stay "Read repository contents and packages permissions", with PR approval by Actions off (already so);
- fork PR workflows stay disabled (already so);
- turn on Dependabot alerts and Dependabot security updates.

### Minutes and cost

**Per run (billed minutes, after rounding):**

| Run                                                                                                                                                                                                                                                                                          | Harness phase (#12, #13) | Once feature e2e exists |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------- |
| Draft push                                                                                                                                                                                                                                                                                   | 0 (job skipped)          | 0                       |
| Docs-only PR (install, `format:check`)                                                                                                                                                                                                                                                       | 1 to 2                   | 1 to 2                  |
| App PR: install ~1; format, audit, lint, typecheck 0.6 to 1.5; `test` + `test:convex` 0.4 to 0.7; production build 0.5 to 1; actionlint under 0.1; e2e development build 0.5 to 1; Chromium install 0.5 to 1; specs under 0.5 (harness) or 2 to 4 plus 0.5 for the Convex backend (features) | ~5 (range 4 to 7)        | ~8 to 10                |
| Release PR (app run plus WebKit)                                                                                                                                                                                                                                                             | —                        | ~10 to 12               |
| `warm-cache` on `main`                                                                                                                                                                                                                                                                       | 1 to 2                   | 1 to 2                  |

**Per month, before and after:**

| Category                 | First version: runs | First version: minutes, harness / features | This version: runs | This version: minutes, harness / features                                         | Main lever                                   |
| ------------------------ | ------------------- | ------------------------------------------ | ------------------ | --------------------------------------------------------------------------------- | -------------------------------------------- |
| App-code PRs (40)        | 120 (3 pushes)      | 840 / 1,080 to 1,440                       | ~50 (ready only)   | 250 / 400 to 500                                                                  | Ready-only trigger; one job                  |
| Docs-only PRs (20)       | 60                  | 300 / 300                                  | 60                 | 60 to 120 / 60 to 120                                                             | `format:check` only; one job                 |
| Pushes to `main`         | 66                  | 594 / 726 to 924                           | ~6 `warm-cache`    | 6 to 12 / 6 to 12                                                                 | Strict up-to-date rule instead of re-running |
| Dependabot PRs           | ~12 (weekly)        | 84 / 108 to 144                            | ~5 (monthly)       | 25 / 40 to 50                                                                     | Monthly schedule                             |
| **Total**                |                     | **~1,820 / ~2,210 to 2,810**               |                    | **~340 to 410 / ~510 to 680**                                                     |                                              |
| **Share of Pro's 3,000** |                     | 61% / 74 to 94%                            |                    | **11 to 14% / 17 to 23%**                                                         |                                              |
| **Reduction**            |                     |                                            |                    | **~77 to 81% / ~76 to 77%** (about 1,410 to 1,480 / 1,700 to 2,130 fewer minutes) |                                              |

- **After launch,** about 8 release PRs a month add about 100 to 120 minutes (10 runs at 10 to 12, WebKit included): about 610 to 800 in total, 20 to 27% of Pro.
- **Sensitivity:** if every app PR needed two ready runs instead of 1.25, app PRs would cost 400 / 640 to 800 and the total about 490 to 560 / 750 to 980, still under a third of the quota.
- **Previews cost 0 Actions minutes.** Netlify builds every preview and the staging site (ADR 0010). #15's preview smoke test runs from the tester's machine (below), so it adds nothing here.
- **Concurrency cancellation** lowers these numbers further. It is not counted.
- **Measured numbers replace estimates.** #12 and #13 record the billed duration of their green runs. If a month passes 50% of the quota (1,500 minutes), well above this estimate, the orchestrator reports it to the owner with the top workflows from the usage report. GitHub's "included usage alerts" also notify the owner by email.

**Artifacts:** e2e artifacts (screenshots, plus the Playwright report and traces on failure) at `retention-days: 7`, uploaded only by runs that reached the e2e step, stay well inside Pro's 1 GB.

### Actions inventory and pinning policy

**Policy:**

1. **Only GitHub-owned actions** (`actions/*`, `github/*`), enforced by the repository's allowed-actions setting.
2. **Every `uses:` is pinned to a full 40-character commit SHA, followed on the same line by `# vX.Y.Z`**, enforced by the repository's SHA-pinning setting. Dependabot updates the comment with the SHA.
   - Tags are mutable: the GitHub releases listed below report `"immutable": false`. GitHub's guide says a full SHA "is currently the only way to use an action as an immutable release".
   - SHAs are resolved from the action's own repository (`git ls-remote https://github.com/actions/<name>`), never from a fork.
3. **Version age:** a pinned version must have been published at least 1 day earlier, matching ADR 0003's `min-release-age`. Dependabot's cooldown applies this from now on.
4. **Adding actions later.** A new GitHub-owned action may be added by the issue that needs it, without a gate, if it is pinned and listed in `docs/process/ci.md`, and the issue states its minute cost. **Any action from another owner needs a `gate:technology` amendment to this ADR.** Prefer an npm CLI that an accepted ADR already covers (for example `npx convex`) or a checksum-verified binary (as for actionlint).
5. **Major versions of actions** arrive as separate Dependabot PRs. The PR reviewer reads the release notes. GitHub-owned action majors need no gate.
6. **New workflows or jobs** must state their trigger and monthly minutes in the PR and follow this ADR's rules: no full runs on draft PRs, no duplicate run on `main`, no job that a step in `ci` could do.

**Inventory for #12 and #13** (SHAs resolved on 2026-10-07; all run on `node24`):

| Action                    | Version | Commit SHA                                 | Released   | Used by | Purpose                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------- | ------------------------------------------ | ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actions/checkout`        | v7.0.1  | `3d3c42e5aac5ba805825da76410c181273ba90b1` | 2026-07-20 | #12     | Checkout. Always `persist-credentials: false`; `fetch-depth: 2` in `ci` for the scope step.                                                                                                                                                                                                                     |
| `actions/setup-node`      | v7.0.0  | `820762786026740c76f36085b0efc47a31fe5020` | 2026-07-14 | #12     | Node from `node-version-file: package.json`, which reads `devEngines.runtime`. npm caching is automatic because `devEngines.packageManager` names npm. `actions/node-versions` lists 26.10.0 as its newest 26.x, so for `^26.11.0` the action falls back to downloading from nodejs.org, as its code documents. |
| `actions/upload-artifact` | v7.0.1  | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | 2026-04-10 | #13     | e2e screenshots and reports, `retention-days: 7`. **Not v7.0.2**: it was released 2026-10-07, less than a day before this ADR; Dependabot proposes it after the cooldown.                                                                                                                                       |

- `actions/cache` is **removed** from the first version's inventory (see "Caching").
- **No package-manager setup action** (ADR 0003: npm comes with Node).
- **No Playwright action:** `npx playwright install --with-deps`.
- **No actionlint action:** the workflow downloads `actionlint_1.7.12_linux_amd64.tar.gz` from the GitHub release and checks it with `sha256sum --check` against `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8` (equal to the release's `checksums.txt` and to a local download, whose attestation verified).
  - The version and hash are bumped by hand, because Dependabot does not track a binary downloaded with `curl`. The PR reviewer checks the actionlint release about quarterly. That is a patch or minor bump of an accepted tool and needs no gate.

### Workflow-security rules

1. **No `pull_request_target`.** No `workflow_run` that checks out or executes PR code, or that uses artifacts from a PR run.
2. **Top-level `permissions: contents: read`** in every workflow. Any elevation is granted per job, in the issue that needs it, never at the top level. The repository default is already read-only, and that stays.
3. **No secrets in `ci` or `warm-cache`.** No `secrets.` reference appears in them. ADR 0010 keeps deploy keys in Netlify, so GitHub holds no deploy secret.
4. **`persist-credentials: false`** on every checkout, so the token is not left in `.git/config` for npm scripts or test code to read.
5. **Untrusted input in `run:`.** Event fields such as PR titles, branch names, and commit messages are passed through `env:` and quoted, never interpolated with `${{ }}` inside a script.
6. **Pinned, GitHub-owned actions only** (policy above).
7. **Fork PRs:** workflows stay disabled for forks of this private repo. If the repo becomes public, set "Require approval for all external contributors". The jobs need no secrets, so a fork run can read nothing sensitive.
8. **Caches:** only `warm-cache` on `main` writes the cache that PRs read, and it runs trusted `main` code with `npm ci --ignore-scripts`, a read-only token, and no secrets. A PR's own cache writes are scoped to its merge ref and cannot reach `main` or other PRs. A job that ever holds deploy secrets sets `package-manager-cache: false`, as setup-node's README recommends.
9. **`timeout-minutes`** is set on every job.
10. **`workflow_dispatch`** can only be started by users with write access, and runs the same read-only, secret-free job.

### Dependabot configuration

`.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: monthly
    cooldown:
      default-days: 3 # >= ADR 0003 min-release-age (1 day)
      semver-major-days: 7
    groups:
      npm-minor-patch:
        applies-to: version-updates
        update-types: [minor, patch]
    labels: [type:chore, area:infra]
    commit-message:
      prefix: chore
      include: scope
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
    cooldown:
      default-days: 3
    groups:
      actions-minor-patch:
        applies-to: version-updates
        update-types: [minor, patch]
    labels: [type:chore, area:infra]
    commit-message:
      prefix: ci
      include: scope
```

- **Majors are not grouped and not ignored.** `ignore` also suppresses security updates, so ignoring majors could hide a fix that exists only in a new major.
  - An **npm major** PR gets `gate:technology` from the orchestrator and waits for the owner (AGENTS.md exempts only minor and patch bumps).
  - An **action major** follows rule 5 above.
- **Minor and patch PRs** follow the merge procedure above: `ci` green on an up-to-date head, then PR reviewer `APPROVE` (release notes read, `allowScripts` changes justified), then the orchestrator merges. There is no linked issue and no tester phase.

### Illustrative `ci.yml`

#12 implements the `ci` job up to actionlint and the `warm-cache` job; #13 adds the e2e steps. This file passes actionlint 1.7.12.

```yaml
name: CI

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]
    branches: [main, production]
  push:
    branches: [main]
    paths: [package-lock.json, .github/workflows/ci.yml]
  workflow_dispatch:
    inputs:
      webkit:
        description: Also run the webkit-mobile e2e project
        type: boolean
        default: false

permissions:
  contents: read

concurrency:
  group: ci-${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: true

env:
  ACTIONLINT_VERSION: 1.7.12
  ACTIONLINT_SHA256: 8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8

jobs:
  ci:
    name: ci
    # Draft PRs and the cache-warming push get a skipped job: 0 billed minutes.
    if: ${{ github.event_name != 'push' && !github.event.pull_request.draft }}
    runs-on: ubuntu-24.04
    timeout-minutes: 25
    env:
      E2E_WEBKIT: ${{ (github.base_ref == 'production' || inputs.webkit == true) && '1' || '0' }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
          fetch-depth: 2
      - name: scope
        id: scope
        run: |
          changed="$(git diff --no-renames --name-only HEAD^1 HEAD)"
          app_files="$(printf '%s\n' "$changed" | grep -vE '^(docs/|design/|\.claude/|[^/]+\.md$)' || true)"
          code_files="$(printf '%s\n' "$changed" | grep -E '\.[cm]?[jt]s$' || true)"
          if [ "$GITHUB_EVENT_NAME" = "pull_request" ] && [ -n "$changed" ] && [ -z "$app_files" ] && [ -z "$code_files" ]; then
            echo "app=false" >> "$GITHUB_OUTPUT"
          else
            echo "app=true" >> "$GITHUB_OUTPUT"
          fi
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: package.json
      - name: install
        id: install
        run: npm ci
      - name: format:check
        if: ${{ !cancelled() && steps.install.outcome == 'success' }}
        run: npm run format:check
      - name: audit signatures
        if: ${{ !cancelled() && steps.install.outcome == 'success' && steps.scope.outputs.app == 'true' }}
        run: npm audit signatures
      - name: lint
        if: ${{ !cancelled() && steps.install.outcome == 'success' && steps.scope.outputs.app == 'true' }}
        run: npm run lint
      - name: typecheck
        if: ${{ !cancelled() && steps.install.outcome == 'success' && steps.scope.outputs.app == 'true' }}
        run: npm run typecheck
      - name: test
        if: ${{ !cancelled() && steps.install.outcome == 'success' && steps.scope.outputs.app == 'true' }}
        run: npm test
      - name: test:convex
        if: ${{ !cancelled() && steps.install.outcome == 'success' && steps.scope.outputs.app == 'true' }}
        run: npm run test:convex
      - name: build
        if: ${{ !cancelled() && steps.install.outcome == 'success' && steps.scope.outputs.app == 'true' }}
        run: npm run build
      - name: actionlint
        if: ${{ !cancelled() && steps.scope.outputs.app == 'true' }}
        run: |
          curl -fsSL -o actionlint.tar.gz \
            "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"
          echo "${ACTIONLINT_SHA256}  actionlint.tar.gz" | sha256sum --check --strict
          tar -xzf actionlint.tar.gz actionlint
          ./actionlint -color
      # e2e steps (#13) run only when every check above passed.
      - name: e2e browsers
        if: ${{ success() && steps.scope.outputs.app == 'true' }}
        run: |
          if [ "$E2E_WEBKIT" = "1" ]; then
            npx playwright install --with-deps chromium webkit
          else
            npx playwright install --with-deps chromium
          fi
      - name: e2e
        id: e2e
        if: ${{ success() && steps.scope.outputs.app == 'true' }}
        run: npm run e2e
      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        if: ${{ !cancelled() && (steps.e2e.outcome == 'success' || steps.e2e.outcome == 'failure') }}
        with:
          name: e2e-report
          path: |
            playwright-report/
            test-results/
            e2e/screenshots/
          retention-days: 7
          if-no-files-found: ignore

  warm-cache:
    name: warm-cache
    # Runs on main only when the lockfile or this workflow changes, so that PR
    # runs restore main's npm cache (a PR run cannot restore another PR's cache).
    if: ${{ github.event_name == 'push' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: package.json
      - name: install (fills the npm cache that setup-node saves)
        run: npm ci --ignore-scripts
```

### Runner image upgrades

Moving from `ubuntu-24.04` to `ubuntu-26.04` is a one-line PR whose own green run is the evidence. It needs no gate. Make the move after #13 is green on 24.04, and before GitHub announces 24.04's retirement.

## Owner decision

**Question:** how should required checks be enforced on this private repository?

| Option                                 | Cost                                                                  | Enforcement                                                                  | Minutes                                         |
| -------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| **(a) Upgrade to GitHub Pro (chosen)** | Pro price as shown on the upgrade page (listed elsewhere at $4/month) | GitHub refuses non-green or out-of-date merges for everyone, agents included | 3,000 a month; this design uses about 11 to 23% |
| (b) Make the repository public         | $0                                                                    | Same as (a)                                                                  | Unlimited on standard runners                   |
| (c) Stay on Free                       | $0                                                                    | Orchestrator check only                                                      | 2,000 a month                                   |

**Decision (owner, 2026-10-07): (a), upgrade to GitHub Pro.** The owner has upgraded.

- **The owner applies the `main` ruleset** described under "Required checks and enforcement", once #12 has produced the `ci` check run.
- **The orchestrator merge procedure stays** as defence in depth, before and after the ruleset exists.

**Direction (owner, 2026-10-07, PR #31):** "I upgraded to pro but I would like to minimize CI/CD usage time as much as possible. Don't have too much redundant process and try to minimize usage in general." Applied throughout this revision: ready-only runs, no re-run on `main`, one job, docs-only runs reduced to `format:check`, WebKit only on releases, monthly Dependabot, no Actions-based preview smoke.

## Consequences

- **New tools and services:** GitHub Actions on GitHub-hosted `ubuntu-24.04` runners; the actions in the inventory above; Dependabot version and security updates; actionlint 1.7.12 (MIT), downloaded and verified at run time. No third-party app. Cost: the GitHub Pro subscription; Actions minutes well within Pro's 3,000.
- **Owner setup (one time):**
  - create the `main` ruleset above after #12 has produced the `ci` check run (GitHub suggests check names it has recently seen; a typo in a name typed earlier would block every merge);
  - repository settings: squash merging only, auto-delete branches, Dependabot alerts and security updates on. Actions allowed-actions and SHA pinning, for example:
    - `gh api -X PUT repos/jasonbryan/omni-league/actions/permissions -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true`
    - `gh api -X PUT repos/jasonbryan/omni-league/actions/permissions/selected-actions -F github_owned_allowed=true -F verified_allowed=false`
  - set these **after** #12 merges, so the first workflow is already compliant;
  - optionally set an Actions budget of $0 beyond the included minutes, so usage can never be billed.
- **Process follow-up (a separate PR for the owner to merge; `docs/process/dev-cycle.md`):**
  - PRs stay **draft** through implement, test, and review (Phases 4 to 6). Phase 6 is done at `APPROVE`; "CI is green" moves to Phase 7.
  - Phase 7 becomes the five-step merge procedure above, one PR at a time, including "a clean update from `main` does not reset `PASS` or `APPROVE`" and "a failing `ci` sends the PR back to draft".
  - Phase 5: when #15 has landed, the tester also runs the smoke spec against the PR's Netlify preview (`E2E_BASE_URL=https://deploy-preview-<n>--<site>.netlify.app`); Phase 8: the deployer does the same against staging. Both are local runs.
  - Gate PRs open ready; the Dependabot route (minor and patch: reviewer `APPROVE` plus green `ci`; npm majors: `gate:technology`); agents never push to `main`.
- **Harder later:**
  - CI feedback arrives only at merge time. A problem the tester's local run missed (an environment difference) is found then, and costs one more implement/test loop. The tester's local run of the same scripts makes this rare.
  - One check line instead of several; the failing step is read from the job log.
  - A PR must be up to date with `main` to merge, so concurrent merges are serialized by the orchestrator.
  - Safari regressions are found at the release PR, not at merge, unless someone runs WebKit on demand or locally.
  - SHA pins make workflow diffs slightly harder to read; the `# vX.Y.Z` comments compensate.

### Effects on other issues

- **#12 (CI pipeline):** implements `ci.yml` with the `ci` job (through actionlint) and the `warm-cache` job, plus `.github/dependabot.yml`.
  - **Criteria that must be reworded:**
    - "every job passes" becomes "the `ci` check passes";
    - "triggers on `pull_request` and on `push` to `main`" becomes "triggers on `pull_request` (`opened`, `reopened`, `synchronize`, `ready_for_review`; branches `main` and `production`) with `ci` skipped for drafts, on `push` to `main` only for `package-lock.json` and `ci.yml` (`warm-cache`), and on `workflow_dispatch`";
    - "the first workflow run on `main` is green" becomes "the `warm-cache` run on `main` after merge is green (this PR changes `ci.yml`), and a following PR run restores the npm cache (`Cache restored from key` in its log)";
    - "the unit-test job fails" becomes "`ci` fails at its `test` step"; the same for lint;
    - "the format-check job is listed" becomes "`ci` is the only required check listed".
  - **New criteria:**
    - a push to a draft PR creates a run in which `ci` is skipped (0 billed minutes; run link);
    - marking the PR ready starts a `ci` run (run link);
    - a docs-only PR runs only install and `format:check`, and an unformatted Markdown file fails it (run links);
    - when lint and a unit test both fail, both steps are reported failed in one run.
  - **Scope additions:** the scope step (moved here from #13), `npm audit signatures` and actionlint steps, `timeout-minutes`, `persist-credentials: false`, runner `ubuntu-24.04`, the monthly `dependabot.yml`, and `docs/process/ci.md` with the required check `ci`, the ruleset (strict), and the five-step merge procedure; billed durations of its green runs recorded on the PR.
  - Its existing concurrency criterion stays.
- **#13 (e2e harness):** adds the e2e steps to the existing `ci` job (no separate job, no new check name).
  - The e2e steps run only when every earlier step passed, and are skipped on docs-only PRs.
  - **`webkit-mobile` is included only when `E2E_WEBKIT=1`** (release PRs into `production`, or `workflow_dispatch` with `webkit: true`), not on `push` to `main`. Its criterion "the first `main` run after merge shows the `webkit-mobile` project executing" becomes "a `workflow_dispatch` run with `webkit: true` shows `webkit-mobile` executing, and a normal PR run does not (run links)".
  - "When the main-only WebKit job fails, the orchestrator opens a `type:bug`" becomes "a WebKit failure fails the release PR's `ci`; the deployer opens the `type:bug` issue". Permissions stay read-only.
  - "The e2e job runs alongside the jobs from #12" becomes "the e2e steps run in the same `ci` job, after #12's checks".
  - `actions/upload-artifact` pinned at v7.0.1 by SHA, uploading only when the e2e step ran. It records the billed duration of a harness run.
- **#15 (previews) and #9 (hosting, ADR 0010):**
  - Netlify builds and deploys previews and staging, so there is **no Actions deploy job and no deploy secret in GitHub**.
  - **No Actions workflow for the preview smoke test.** A workflow triggered by Netlify's commit `status` would fire for every Netlify deploy, drafts included (about 150 a month at 2 to 3 minutes: 300 to 450 minutes, roughly as much as all of CI), and filtering out drafts needs an API call inside a billed job. Instead, the tester runs `E2E_BASE_URL=<preview URL> npm run e2e -- <smoke spec>` locally and pastes the output in the PR, and the deployer does the same for staging. #15's criterion "when the e2e smoke spec runs with `E2E_BASE_URL` set to its URL, then it passes" is met by that local run.
  - **The smoke spec stays minimal:** the #13 smoke spec only, Chromium only, both widths.
  - If an Actions smoke run is wanted later, it needs an amendment to this ADR with its minutes, and must skip drafts.
  - **ADR 0010 (PR #33) text to align:** its `production` ruleset should require `ci` (not `checks` and `e2e`), and its "#15 runs the smoke spec … triggered by the `status` event" should read "run locally by the tester and deployer".
- **First feature with live Convex data in e2e:** the CLI downloads the pinned backend binary on each run (no `actions/cache`), and the step `git diff --exit-code convex/_generated` follows `npx convex dev --once`.
- **ADR 0003:** confirmed. No package-manager setup action, `npm ci`, `npm audit signatures` in CI, and a Dependabot cooldown of 3 days, which is at least 1.
- **ADR 0005:** amended in this PR (WebKit trigger, no Convex backend cache, CI run conditions). See its "Amendment" section.

## Test evidence

Run on 2026-10-07, macOS arm64, in a scratch directory outside the repository.

1. **Plan and settings.**
   - `gh api` on `branches/main/protection` and `rulesets` returned 403 (before the owner's Pro upgrade) "Upgrade to GitHub Pro or make this repository public to enable this feature."
   - `actions/permissions` returned `{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}`.
   - `actions/permissions/workflow` returned `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}`.
   - Fork PR workflows for private repos: all four options `false`.
   - `vulnerability-alerts`: 404 (off). `automated-security-fixes`: `{"enabled":false}`.
2. **Action SHAs.**
   - `git ls-remote --tags` on each `actions/*` repository resolved the tags in the inventory to the listed commits.
   - `gh api repos/actions/<name>/commits/<sha>` confirmed each commit exists in the canonical repository.
   - Release `immutable` flags are `false`.
3. **actionlint.**
   - The SHA-256 of the downloaded `linux_amd64` tarball matched `actionlint_1.7.12_checksums.txt`; `gh attestation verify -R rhysd/actionlint` passed.
   - The darwin build (`actionlint -version`: 1.7.12) linted the revised illustrative `ci.yml` above with no findings (exit 0).
   - A copy with `inputs.webkt` and `steps.e2.outcome` produced two `[expression]` errors naming the defined `{webkit: bool}` input and the `e2e` step.
4. **Scope step** (same script as the workflow, run with the event name and a changed-file list):
   - `docs/a.md`, `design/mockups/x.html`, `README.md` on `pull_request`: `app=false`.
   - `docs/a.md` plus `src/app/x.ts`: `app=true`; empty list: `app=true`; `docs/a.md` on `workflow_dispatch`: `app=true`; `.github/workflows/ci.yml`: `app=true`; `package-lock.json`: `app=true`.
   - An earlier version written with `grep -q` in a pipe gave wrong results under `pipefail` and was replaced.
5. **Dependabot and `devEngines`.** On Node 24.16.0 with npm 11.13.0, a `package.json` with ADR 0003's `devEngines`: `npm install --package-lock-only --ignore-scripts` failed with `EBADDEVENGINES`; with `--force` added, the same command passed. Dependabot's lockfile updater passes `--force`. The first Dependabot npm PR after #12 confirms it end to end.
6. **Node 26.11 on runners.** nodejs.org `index.json` lists v26.11.0 and v26.11.1 (npm 11.20.0). `actions/node-versions` lists up to 26.10.0, so setup-node v7.0.0 takes its documented fallback to nodejs.org.
7. **gh CLI.** `gh pr checks --help`: the `bucket` field is one of `pass`, `fail`, `pending`, `skipping`, or `cancel`. `gh pr ready --undo` converts a PR back to draft. `gh pr update-branch` merges the base branch into the PR branch.

Not testable before #12 exists, and therefore #12's criteria: a draft push bills 0 minutes, `ready_for_review` starts the run, `warm-cache` saves a cache that a PR run restores, and the strict rule refuses an out-of-date merge.

## Sources

- GitHub plans and billing:
  - [About GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)
  - [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
  - [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
  - [Budgets and alerts](https://docs.github.com/en/billing/concepts/budgets-and-alerts)
  - [2026 pricing changes for GitHub Actions](https://github.com/resources/insights/2026-pricing-changes-for-github-actions)
- Workflow behaviour:
  - [Control jobs with conditions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions) ("A job that is skipped will report its status as "Success"")
  - [Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) (access restrictions, 7-day eviction)
  - [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) (`pull_request` activity types, `ready_for_review`)
  - [Path filters are not a CI gate (Mergify, 2026)](https://mergify.com/blog/path-filters-are-not-a-ci-gate) (path-filtered required checks stay pending)
  - [Merge queue general availability](https://github.blog/changelog/2023-07-12-pull-request-merge-queue-is-now-generally-available/) (organization-owned repositories only)
- Protection and rulesets:
  - [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
  - [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- Runners:
  - [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
  - [`ubuntu-latest` to 26.04 announcement (#14748)](https://github.com/actions/runner-images/issues/14748)
  - [Playwright system requirements](https://playwright.dev/docs/intro#system-requirements)
  - [Playwright CI guide, "Caching browsers"](https://playwright.dev/docs/ci)
- Security:
  - [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
  - [Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
  - [Preventing pwn requests (GitHub Security Lab)](https://securitylab.github.com/research/github-actions-preventing-pwn-requests/)
- Actions:
  - [actions/checkout releases](https://github.com/actions/checkout/releases)
  - [actions/setup-node](https://github.com/actions/setup-node) and its [advanced usage](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md)
  - [actions/node-versions manifest](https://github.com/actions/node-versions/blob/main/versions-manifest.json)
  - [actions/upload-artifact releases](https://github.com/actions/upload-artifact/releases)
- Dependabot:
  - [options reference (`schedule`, `cooldown`, `groups`, `ignore`)](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
  - [Configuring multi-ecosystem updates](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configuring-multi-ecosystem-updates) and [changelog, 2025-07-01](https://github.blog/changelog/2025-07-01-single-pull-request-for-dependabot-multi-ecosystem-support/)
  - [Keeping your actions up to date with Dependabot](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/auto-update-actions)
  - dependabot-core [`npm_and_yarn/Dockerfile`](https://github.com/dependabot/dependabot-core/blob/main/npm_and_yarn/Dockerfile) and [`npm_lockfile_updater.rb`](https://github.com/dependabot/dependabot-core/blob/main/npm_and_yarn/lib/dependabot/npm_and_yarn/file_updater/npm_lockfile_updater.rb)
- Renovate: [Renovate (AGPL-3.0)](https://github.com/renovatebot/renovate), [Mend Renovate app](https://github.com/apps/renovate)
- Workflow linting: [actionlint v1.7.12 release](https://github.com/rhysd/actionlint/releases/tag/v1.7.12), [zizmor](https://github.com/zizmorcore/zizmor)
- Node.js: [dist index](https://nodejs.org/dist/index.json)
- GitHub CLI: `gh pr checks --help`, `gh pr ready --help`, `gh pr update-branch --help`, `gh pr merge --help`

## Amendment: scope step (2026-10-08)

A wording clarification that matches the shipped workflow (#12, PR #39) and `docs/process/ci.md` ("What counts as docs-only"). The decision is unchanged: the scope step lives inside `ci`, a docs-only PR runs only install and `format:check`, and the job always reports a real result. Both changes only turn some `app=false` results into `app=true`, so more checks run, never fewer.

| Rule in this ADR        | Was                                                              | Now                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| How files are listed    | `git diff --name-only HEAD^1 HEAD`                               | `git diff --no-renames --name-only HEAD^1 HEAD`, so a rename lists both its old and its new path                                     |
| What counts as app code | Any file outside `docs/`, `design/`, `.claude/`, and root `*.md` | The same, plus any `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, or `.cts` file wherever it lives (the extensions `eslint.config.mjs` lints) |

**Why.** With rename detection on (git's default), moving an app file into `docs/` listed only the new path, so the PR was classified docs-only and lint, typecheck, test, and build were skipped while the app lost a file. The ADR's rule is "every changed file is under `docs/` ...", and a rename's old path is a changed file, so the literal command did not implement the rule. Separately, ESLint lints `.js`/`.ts`-family files everywhere, so a docs-only PR adding, for example, `.claude/skills/<x>/helper.mjs` with a lint error would pass `ci` and then fail `lint` on every later app PR.

**Sources.** [PR #39, Review](https://github.com/jasonbryan/omni-league/pull/39#issuecomment-6061926396) (findings 1 and 2), [PR #39, Test](https://github.com/jasonbryan/omni-league/pull/39#issuecomment-6061978925) (rename reproduction), [PR #39, Review (round 2)](https://github.com/jasonbryan/omni-league/pull/39#issuecomment-6062066945) ("ADR 0009 deviation: no amendment required", optional wording note for the owner).
