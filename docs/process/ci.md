# CI

How continuous integration works in this repository. The decision and its reasoning are in [ADR 0009](../decisions/0009-ci-pipeline.md); this page is the operating reference. The development cycle is in [dev-cycle.md](dev-cycle.md).

CI is one workflow, `.github/workflows/ci.yml` (name `CI`), with one job that matters for merging, `ci`. It runs once per tree that can merge: only on PRs that are ready for review, never on draft pushes, and never again on `main` after the merge.

## Required check

| Check name | Source         | Required |
| ---------- | -------------- | -------- |
| `ci`       | GitHub Actions | Yes      |

Nothing else is required. The workflow's second job, `warm-cache`, appears on every PR as a **skipped** check and is not required.

## What runs when

| Event                                                                                                                 | `ci`                                                                                                          | `warm-cache`                                                       | Billed minutes                               |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| Push to a **draft** PR (opened as draft, or a push while draft)                                                       | Skipped (the run exists; the job has no runner)                                                               | Skipped                                                            | 0                                            |
| PR **opened ready**, **marked ready** (`ready_for_review`), or a push to a ready PR                                   | One full run; a newer push cancels the older run (concurrency group per PR)                                   | Skipped                                                            | app ~3 (harness, measured); docs-only 1 to 2 |
| Ready PR that changes only `docs/`, `design/`, `.claude/`, or root `*.md`, and no `.js`/`.ts`-family file (see below) | `scope` gives `app=false`: `release age`, install, and `format:check` only; every other check step is skipped | Skipped                                                            | 1 to 2                                       |
| Push to `main` that changes `package-lock.json` or `.github/workflows/ci.yml`                                         | Skipped                                                                                                       | Runs (`npm ci --ignore-scripts`, saves the npm cache under `main`) | 1 to 2                                       |
| Any other push to `main`                                                                                              | No run                                                                                                        | No run                                                             | 0                                            |
| `workflow_dispatch` (anyone with write access, any branch)                                                            | Full run (`app=true`); the boolean input `webkit` (default `false`) adds the `webkit-mobile` e2e project      | Skipped                                                            | as an app run, plus 1.5 to 2.5 with WebKit   |

PRs run against base branches `main` and `production` (release PRs, ADR 0010).

**What counts as docs-only.** `scope` lists changed files with `git diff --no-renames`, so a rename counts both its old and new path: moving an app file into `docs/` is an app change. A file ESLint lints (`.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`) is an app file wherever it lives, so a helper script under `.claude/` gets the full checks.

**Steps of `ci`, in order:** checkout (depth 2, `persist-credentials: false`); `scope`; `release age` (every npm Dependabot cooldown window equals `.npmrc` `min-release-age`; runs on every change, needs no install); setup-node (Node from `package.json` `devEngines.runtime`, npm cache automatic); `install` (`npm ci`); `format:check`; then, on app changes only, `audit signatures`, `lint`, `typecheck`, `test`, `test:convex`, `build`, `actionlint`; then, only if every one of those passed, `e2e browsers`, `e2e`, and `e2e report` (see [E2E steps](#e2e-steps)). Each check runs even when an earlier one failed, so one run reports every failure; the failing step is named in the job log and in `gh run view <id> --log-failed`. If setup-node or `install` fails, every step that needs `node_modules` is skipped, `actionlint` still runs, and `ci` fails.

**A `workflow_dispatch` run on a PR head posts a `ci` check for that SHA.** It shows in `gh pr checks` like a PR run, so a dispatch made after the last PR run becomes the latest `ci` on that head.

## E2E steps

The e2e harness ([ADR 0005](../decisions/0005-e2e-and-accessibility-testing.md), amended by ADR 0009; usage in the [README](../../README.md#e2e-tests)) runs as the last steps of the `ci` job: no separate job and no new check name. `e2e browsers` and `e2e` have `if: ${{ success() && steps.scope.outputs.app == 'true' }}`, so any earlier failure, or a docs-only PR, skips them.

| Step           | What it does                                                                                                                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e browsers` | `npx playwright install --with-deps --only-shell chromium` (the Playwright config sets no `channel`, so headless runs use the headless shell); also `npx playwright install --with-deps webkit` when `E2E_WEBKIT` is `1`. No browser cache.                                                                      |
| `e2e`          | `npm run e2e`: `npm run build -- --configuration development`, then `playwright test` against `npm run serve:ssr` on port 4000, with `workers: 1`, `retries: 1`, `trace: 'on-first-retry'`. No Convex URL and no secrets.                                                                                        |
| `e2e report`   | `actions/upload-artifact` uploads `playwright-report/`, `test-results/` (failure screenshots, traces), and `e2e/screenshots/` as the artifact `e2e-report`, `retention-days: 7`, `if-no-files-found: ignore`. It runs only when the `e2e` step succeeded or failed, so it is skipped whenever `e2e` was skipped. |

**`E2E_WEBKIT`** is a job-level variable: `1` when `github.base_ref == 'production'` (a release PR) or the dispatch input `webkit` is true, else `0`. The Playwright config adds the `webkit-mobile` project only for `1`. A `webkit-mobile` failure fails the release PR's `ci` check and blocks the release; the **deployer** opens the `type:bug` issue. The workflow opens nothing and keeps read-only permissions.

Run WebKit on demand for a Safari-sensitive change: `gh workflow run CI --ref <branch> -f webkit=true`.

`vitest.serial.config.mts` is not used by `ci`: it backs the local `npm run test:serial` (one Vitest worker, [dev cycle, Implement](dev-cycle.md#4-implement)) and is passed through the accepted `@angular/build:unit-test` builder's `--runner-config` option, so it is not drift from the configs in [ADR 0004](../decisions/0004-unit-and-convex-test-runners.md).

## Owner settings checklist

Applied by the owner **after** the PR that adds `ci.yml` (#12) merges, so the first workflow is already compliant.

- [ ] **Ruleset on the default branch:** enforcement active; **bypass list empty**; require a pull request (0 approvals); require status check `ci` (source GitHub Actions) **with "Require branches to be up to date before merging" on**; block force pushes and deletion. Create it only after `ci` has produced a check run, so GitHub suggests the exact name.
- [ ] **Merge methods:** squash only; automatic branch deletion on.
- [ ] **Dependabot alerts** and **Dependabot security updates** on.
- [ ] **Actions permissions:** allowed actions "selected", **"Allow actions created by GitHub"** only, no other patterns, **"Require actions to be pinned to a full-length commit SHA"** on:
  - `gh api -X PUT repos/jasonbryan/omni-league/actions/permissions -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true`
  - `gh api -X PUT repos/jasonbryan/omni-league/actions/permissions/selected-actions -F github_owned_allowed=true -F verified_allowed=false`
- [ ] **Workflow permissions** stay read-only ("Read repository contents and packages permissions"), with PR approval by Actions off; **fork PR workflows** stay disabled. Both are already so; listed for completeness.
- [ ] **Merge only after a completed green `ci` run.** A ready PR must not be merged until the real `ci` run on its head has passed. A skipped `ci` (the draft-time skip) satisfies the ruleset but is not a pass.
- [ ] Optional: an Actions budget of $0 beyond the included minutes, so usage can never be billed.

Later: when the `production` branch is created (ADR 0010), add a `production` ruleset with the same required check `ci`, strict.

## Merge procedure

The orchestrator merges one PR at a time (dev cycle Phase 7):

1. If the PR branch is behind `main`, update it **while it is still a draft**: `gh pr update-branch <n>`. No CI runs. A clean update (no conflicts, none of the PR's own files changed) keeps the tester's `PASS` and the reviewer's `APPROVE`. A conflicted update sends the PR back to the implementer, and Phases 5 and 6 run again. If this page and [dev-cycle.md](dev-cycle.md) Phase 7 differ, dev-cycle.md governs.
2. Mark it ready: `gh pr ready <n>`. This starts the one `ci` run.
3. Read the head SHA (`gh pr view <n> --json headRefOid`), then wait until `gh pr checks <n> --json name,bucket,workflow` shows `ci` from workflow `CI` with `bucket` `pass`. **`skipping` is not a pass:** it is the draft-time skip.
4. Merge: `gh pr merge <n> --squash --delete-branch --match-head-commit <sha>`. If another PR merged meanwhile, GitHub refuses the merge (strict rule); go back to step 1.
5. If `ci` fails, convert the PR back to draft (`gh pr ready <n> --undo`) and return it to the implementer, so fix iterations cost nothing.

**Gate PRs** (ADRs, mockups) are opened ready, because the owner reads and merges them. They are docs-only, so each push costs 1 to 2 minutes. If one is behind `main`, the owner presses "Update branch" (or the orchestrator runs step 1) before merging.

**Dependabot PRs** are opened ready by Dependabot and follow steps 1, 3, and 4. Minor and patch PRs need `ci` green on an up-to-date head and a PR reviewer `APPROVE` (release notes read, `allowScripts` changes justified); there is no linked issue and no tester phase. An **npm major** gets `gate:technology` and waits for the owner. A GitHub-owned **action major** needs no gate; the reviewer reads its release notes. Every npm cooldown window in `.github/dependabot.yml` (`default-days`, `semver-patch-days`, `semver-minor-days`, `semver-major-days`) equals `.npmrc` `min-release-age` (3 days), so npm majors are proposed after 3 days, not 7, and Dependabot resolves the lockfile under the same release-age rule as local installs; the `release age` step in `ci` fails when any window differs or is missing ([ADR 0003](../decisions/0003-package-manager-and-node.md) and [ADR 0009](../decisions/0009-ci-pipeline.md) amendments, #47). TypeScript majors are ignored until the repository moves to the Angular major that supports TypeScript 7; the rule uses `update-types` only, so TypeScript security updates are unaffected.

Agents never push to `main` directly.

## Actions inventory and policy

| Action / tool             | Version | Pin                                                                        | Used for                                                                |
| ------------------------- | ------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `actions/checkout`        | v7.0.1  | `3d3c42e5aac5ba805825da76410c181273ba90b1`                                 | Checkout, always `persist-credentials: false`                           |
| `actions/setup-node`      | v7.0.0  | `820762786026740c76f36085b0efc47a31fe5020`                                 | Node from `package.json`, automatic npm cache                           |
| actionlint (binary)       | 1.7.12  | SHA-256 `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8` | Workflow lint, `linux_amd64` tarball from the GitHub release            |
| `actions/upload-artifact` | v7.0.1  | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`                                 | `e2e-report` artifact, `retention-days: 7` (#13); not v7.0.2 (ADR 0009) |

- **Only GitHub-owned actions** (`actions/*`, `github/*`), each pinned to a full 40-character commit SHA with `# vX.Y.Z` on the same line. Dependabot (`.github/dependabot.yml`, monthly, grouped minor and patch) updates the SHA and the comment.
- **actionlint** is not an action: the `ci` job downloads the tarball, checks it with `sha256sum --check --strict`, and runs it. Its version and hash live in the workflow's top-level `env:` and are bumped by hand, because Dependabot does not track it. The PR reviewer checks the actionlint release about quarterly; a patch or minor bump needs no gate.
- **Adding an action:** a new GitHub-owned action may be added by the issue that needs it, without a gate, if it is pinned as above, listed in this table, and the issue states its minute cost. **Any action from another owner needs a `gate:technology` amendment to ADR 0009.** Prefer an npm CLI an accepted ADR already covers, or a checksum-verified binary.
- **Workflow security:** top-level `permissions: contents: read` only (any elevation per job, in the issue that needs it); no `secrets.` in `ci` or `warm-cache`; no `pull_request_target`; event fields reach `run:` only through `env:`, quoted; `timeout-minutes` on every job.

## Minutes

| Figure                                                      | Value                                                                                                                                                                                                                                                          | Source                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| App-PR run, measured (#12's green run)                      | **2 minutes**: `ci` 69 s (rounded up to 2), `warm-cache` skipped (0); no npm cache yet on `main` ([run 37790626661](https://github.com/jasonbryan/omni-league/actions/runs/37790626661), PR #39)                                                               | summed job durations; `timing` returned `billable` 0 (not populated) |
| App-PR run with the e2e harness, measured (#13's green run) | **3 minutes**: `ci` 125 s (rounded up to 3), `warm-cache` skipped (0); the e2e steps (`e2e browsers`, `e2e`, `e2e report`) took 45 s of it; no `webkit-mobile` ([run 37843402858](https://github.com/jasonbryan/omni-league/actions/runs/37843402858), PR #52) | summed job durations; `timing` returned `billable` 0 (not populated) |
| `workflow_dispatch` with `webkit: true`, measured (#13)     | **4 minutes**: `ci` 182 s (rounded up to 4), WebKit installed and `webkit-mobile` run ([run 37842973800](https://github.com/jasonbryan/omni-league/actions/runs/37842973800))                                                                                  | summed job durations                                                 |
| Docs-only run                                               | 1 to 2 minutes (ADR 0009 estimate; replaced by a later docs PR with the measured value)                                                                                                                                                                        | ADR 0009 "Minutes and cost"                                          |
| Draft push                                                  | 0                                                                                                                                                                                                                                                              | job skipped, no runner                                               |
| Monthly estimate                                            | about 340 to 410 minutes now; 510 to 680 once feature e2e exists (Pro includes 3,000)                                                                                                                                                                          | ADR 0009 "Minutes and cost"                                          |

**How each figure is read:**

- **Per run:** sum, over the run's jobs, of `completedAt − startedAt` from `gh run view <id> --json jobs`, each job rounded up to a whole minute (always available). The `billable` value from `gh api repos/jasonbryan/omni-league/actions/runs/<id>/timing` is recorded next to it only when it is non-empty and non-zero. GitHub documents that endpoint as "in the process of closing down", so it is never the only source.
- **A skipped run:** `gh run view <id> --json jobs` shows the job with conclusion `skipped`, no steps, and no runner. That is the 0-minute proof.
- **The monthly total:** the account's Billing and plans usage page, <https://github.com/settings/billing/usage>, filtered to Actions for the current month. Per-run figures cannot give a monthly total.

**Budget rule:** if a month passes **1,500 minutes** (50% of Pro's 3,000), the orchestrator reports it to the owner with the top workflows from the usage page. GitHub's included-usage alerts also email the owner.

## Runner image

Both jobs run on `ubuntu-24.04`, not `ubuntu-latest` (which moves to 26.04 between 2026-10-19 and 2026-11-19). Moving to `ubuntu-26.04` is a one-line PR, made after #13 is green on 24.04; its own green run is the evidence.
