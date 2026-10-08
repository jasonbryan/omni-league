# 0009: CI pipeline on GitHub

- **Status:** Accepted
- **Gate:** `gate:technology`
- **Issue:** #8
- **Date:** 2026-10-07

## Context

The dev cycle merges a PR only when "CI is green", but no CI exists yet. ADR 0001 fixes GitHub as the CI host. This ADR decides the runner type, the pipeline shape (jobs, triggers, caching), the required checks and how they are enforced on this private repository, the policy for actions, how actions and npm dependencies get update PRs, and the workflow-security rules. Deployment (CD) belongs to #9.

### Inputs from accepted ADRs

| ADR | What CI must do |
| --- | --- |
| 0002 lint and format | Run `lint` (`eslint . --max-warnings=0`) and `format:check` (`prettier . --check`) as separate scripts. Prettier also formats `.github/**/*.yml`. Workflow linting is left to this ADR. |
| 0003 package manager and Node | npm 11 bundled with Node 26.11+, pinned in `package.json` `devEngines` (`onFail: "error"`) and `.nvmrc`. Install with `npm ci`. No Corepack and no package-manager setup action. `npm audit signatures` is a CI step. `.npmrc` sets `min-release-age=1`, so the update tool's cooldown must be at least 1 day. Advisories arrive through Dependabot alerts and security updates. |
| 0004 unit and Convex tests | Two scripts, `test` (`ng test --watch=false`) and `test:convex` (`vitest run --config vitest.config.mts`). No secrets, no browser, no deployment. `convex/_generated/` is committed; a drift check needs the local backend and is left to this ADR. |
| 0005 e2e and accessibility | Playwright plus `@axe-core/playwright`. `npx playwright install --with-deps chromium` on every run (no browser cache), plus `webkit` on push to `main` only. `workers: 1`, `retries: 1` in CI. The local Convex backend's cache (`~/.cache/convex`, 164 MB) is restored with `actions/cache` once the first data feature wires it. Artifacts use `retention-days: 7`. Minutes estimate per e2e run: about 3 for the harness, 5 to 8 once features exist, plus 1.5 to 2.5 for WebKit on `main`. |
| 0006 Angular baseline | `build` produces the browser bundle, the SSR server bundle, and prerendered routes. CI has no Convex URL, and Prerender routes read no Convex data, so the build needs no secret. |
| 0008 auth | E2E sign-in runs against the anonymous local backend with no stored secret, so fork PRs and Dependabot PRs work. |

### Repository state, checked on 2026-10-07

- **Visibility and plan.** `gh api repos/jasonbryan/omni-league` reports `"private": true`, owned by a user account. `gh api repos/jasonbryan/omni-league/branches/main/protection` and `.../rulesets` both return HTTP 403 "Upgrade to GitHub Pro or make this repository public to enable this feature." So the owner is on **GitHub Free** for personal accounts. (`gh api user` returns `"plan": null` because the CLI token lacks the `user` scope; the 403 message is the evidence.)
- **Actions settings** (`gh api .../actions/permissions`, `.../actions/permissions/workflow`, `.../actions/permissions/fork-pr-workflows-private-repos`):
  - default `GITHUB_TOKEN` permission is already `read`, and workflows cannot approve PRs;
  - all actions are allowed, and `sha_pinning_required` is `false`;
  - workflows do not run on fork PRs, and no write token or secret goes to them.
- **Dependabot alerts and security updates are off** (`.../vulnerability-alerts` returns 404; `.../automated-security-fixes` returns `"enabled": false`).
- **Merge methods:** merge, squash, and rebase are all enabled, and `delete_branch_on_merge` is `false`. The dev cycle squash-merges and deletes the branch.

### GitHub plan facts (from the docs, 2026-10-07)

| Item | GitHub Free (current) | GitHub Pro | Public repository |
| --- | --- | --- | --- |
| Protected branches and rulesets on this repo | **No.** "Protected branches are available in public repositories with GitHub Free … also available in public and private repositories with GitHub Pro, GitHub Team …"; rulesets have the same wording | Yes | Yes |
| Hosted-runner minutes included per month (private repos) | 2,000 | 3,000 | Standard runners are free and unlimited |
| Artifact storage included | 500 MB | 1 GB | Free |
| Cache storage per repository | 10 GB | 10 GB | 10 GB |
| Standard Linux x64 runner | 2 CPU, 8 GB RAM | same | 4 CPU, 16 GB RAM |
| Price beyond the included minutes | Linux 2-core x64: $0.006 per minute | same | — |
| When included minutes run out | "If your account does not have a valid payment method on file, usage is blocked once you use up your quota." With a payment method, spending is capped by any budgets. Minutes reset each billing cycle. | same | — |

- GitHub rounds each job up to the whole minute ("GitHub rounds the minutes and partial minutes each job uses up to the nearest whole minute").
- GitHub's public pricing page no longer lists Pro. Third-party listings give $4 per month. The owner sees the exact price on the account's Compare plans page (Settings, Billing and licensing, Licensing, Upgrade).
- A $0.002-per-minute platform charge for self-hosted runners, announced for 2026-03-01, was postponed with no new date ("We're postponing the announced billing change for self-hosted GitHub Actions to take time to re-evaluate our approach").

## Options

### Runners

#### Option R1: GitHub-hosted standard Linux runner (`ubuntu-24.04`, x64)

- **What it is.** A fresh VM per job, 2 CPU and 8 GB RAM for private repos. It is billed against the plan's included minutes.
- **Pros.**
  - Clean, ephemeral machine on every run, so nothing persists between agent-written PRs.
  - No machine to maintain.
  - Has everything ADR 0005 assumed: `sudo` for `playwright install --with-deps`, `shellcheck` 0.9.0, `gh` 2.101, `jq`.
  - Playwright 1.64 supports Ubuntu 22.04, 24.04, and 26.04, x86-64 and arm64 (Playwright system requirements).
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
- **Not recommended.**

GitHub-hosted arm64 runners (`ubuntu-24.04-arm`) were also considered. They draw from the same included minutes, so they save nothing within the quota. No ADR has verified the local Convex backend binary on Linux arm64.

### Pipeline shape

Minutes are per job, rounded up, and every job pays about 1 minute for checkout, Node setup, and `npm ci`.

| Option | Jobs | Billed per run (non-e2e checks) | Wall clock | Status checks |
| --- | --- | --- | --- | --- |
| **S1: one job per check** | 7 (`format:check`, `lint`, `typecheck`, `test`, `test:convex`, `build`, workflow lint) | ~10 (7 jobs, 1 to 2 each) | ~1.5 to 2 min | One per check |
| **S2: one `checks` job, one step per check** (plus `e2e` as its own job) | 1 | ~4 (range 3 to 5) | ~3 to 4.5 min | One (`checks`); the failing step is named in the job log and in `gh run view --log-failed` |
| **S3: three grouped jobs** (static, tests, build) | 3 | ~6 | ~2 to 2.5 min | Three |

- S1's checks alone cost about 2,580 minutes a month at the volume below, before any e2e minutes, which is more than Free's 2,000.
- **The wall-clock gain of S1 and S3 is not visible.** The `e2e` job runs in parallel and takes 3 to 8 minutes, longer than S2's `checks` job, so a PR's checks finish when e2e finishes under every shape.
- S2 loses the "stop at the first failure" behaviour of sequential steps unless each check step runs after earlier failures. The recommendation does this with `if: ${{ !cancelled() && steps.install.outcome == 'success' }}`, so one run reports every failing check, as separate jobs would.

### Enforcing required checks on this private repo

| Option | What it takes | Pros | Cons |
| --- | --- | --- | --- |
| **E1: upgrade to GitHub Pro, ruleset on `main`** | Owner upgrades the personal account (price on the upgrade page; listed elsewhere at $4/month), then creates the ruleset below | Merges without green `checks` and `e2e` are refused by GitHub for everyone, including agents acting with the owner's token, if the ruleset has no bypass list. 3,000 minutes and 1 GB of artifacts cover the estimate below. Code stays private. | Monthly cost. |
| **E2: make the repository public, ruleset on `main`** | Owner changes visibility | Free rulesets and unlimited standard-runner minutes on 4-CPU runners. | Source, ADRs, issues, and PR discussion become public. This is a business decision for the owner. The no-secrets CI design already makes fork PRs safe. |
| **E3: stay on Free; orchestrator check before merge** | A process rule in `docs/process/ci.md` and the dev cycle (below) | No cost and no visibility change. | **Not enforced by GitHub.** It relies on every merger (orchestrator and owner) running the check. Direct pushes to `main` are not blocked. Minutes run out once feature e2e grows (see the estimate), and CI then stops until the month resets unless a payment method and budget are set. |

### Update tool for actions and npm dependencies

#### Option U1: Dependabot version updates and security updates (GitHub-native)

- **What it is.** Configured by `.github/dependabot.yml`, free for private repositories, and run by GitHub.
- **Pros.**
  - **No third-party app or extra repository permissions.**
  - **Supported for both ecosystems.**
    - npm v7 to v11 is on the supported list (ADR 0003).
    - GitHub Actions, including SHA pins: Dependabot "updates the version documentation … when the comment is on the same line, such as `actions/checkout@<commit> #<tag>`."
  - **`cooldown`.**
    - `default-days` applies to both ecosystems, and npm also accepts per-semver days.
    - If `cooldown` is unset, Dependabot now applies a 3-day default to version updates.
    - Cooldown never delays security updates.
  - **`groups`** batch updates, which cuts PR count and CI minutes.
  - **Alerts and security updates use the same dependency graph.**
  - **ADR 0003's pins do not block it.**
    - Dependabot's npm updater image runs Node 24 and npm 11.17.0 (`npm_and_yarn/Dockerfile`), which is below `devEngines` (`^26.11.0`, `^11.20.0`).
    - Its lockfile updater runs `npm install --force --ignore-scripts --package-lock-only` (`npm_lockfile_updater.rb`).
    - The system checked that `--force` bypasses `devEngines`: on Node 24.16.0 with npm 11.13.0, a `package.json` with ADR 0003's `devEngines` fails `npm install --package-lock-only --ignore-scripts` with `EBADDEVENGINES`, and passes with `--force` added.
    - Dependabot picks the npm version from the `devEngines.packageManager` range through Corepack in its own container (a `dev_engines` fixture in its test suite). That does not affect the repository's no-Corepack rule.
- **Cons and risks.**
  - **No Dependabot alerts for actions pinned to a SHA.** The secure-use docs say Dependabot "will not create alerts for actions pinned to SHA values". Weekly version updates and the GitHub-owned-only action policy (below) limit the exposure.
  - **Security updates skip cooldown.** A fix published less than a day earlier can fail under `.npmrc` `min-release-age=1` until a day has passed. This is not tested; the risk is a delay of at most one day.
  - **A new transitive install script makes the PR's `npm ci` fail** with `ESTRICTALLOWSCRIPTS` (ADR 0003). The PR then needs an `allowScripts` entry. This is intended.
  - It has fewer grouping presets and no dependency dashboard, compared with Renovate.

#### Option U2: Renovate (Mend-hosted GitHub App)

- **What it is.** Renovate 44.145.1 (AGPL-3.0). The Mend app is "free to install for both public and private repositories."
- **Pros.**
  - Richer configuration: `minimumReleaseAge`, `pinDigests` for actions, monorepo presets (all `@angular/*` together), and a dependency dashboard issue.
  - Supports pnpm 12, which would reopen ADR 0003's pnpm option.
- **Cons and risks.**
  - **A third-party service gets write access** to this private repository's contents, PRs, and workflow files, and processes its code on Mend's infrastructure. That is a new external service under `gate:technology` and a wider trust boundary than GitHub itself.
  - A second update channel: GitHub's security alerts would still come from Dependabot alerts.
  - More configuration to review.

#### Option U3: manual updates

The orchestrator or owner runs `npm outdated` and checks action releases on a schedule. Nothing proposes SHA bumps, and the work is forgotten under load. Rejected.

### Workflow linting

| Option | What it is | Assessment |
| --- | --- | --- |
| **actionlint 1.7.12** (MIT, released 2026-03-30) | Static checker for workflow syntax, `${{ }}` expressions and contexts, `needs`/`steps` references, runner labels, and shell scripts (through `shellcheck`, preinstalled on the runner) | A single Go binary from the GitHub release. It needs no action: download it, check the SHA-256, and run it. The release has a GitHub build attestation (`gh attestation verify` passed, signed by `rhysd/actionlint/.github/workflows/release.yaml@refs/tags/v1.7.12`). It takes a few seconds. It caught a misspelled `steps.` reference and a non-numeric `timeout-minutes` in the test below. |
| zizmor 1.30.1 (MIT) | Security linter for workflows (dangerous triggers, unpinned `uses:`, excessive permissions, credential persistence, cache poisoning) | Overlaps with the rules below, most of which GitHub settings or review already enforce (SHA pinning policy, read-only default token). A second tool to install and pin. Not adopted now; revisit if workflows multiply (for example with #15's deploy workflow). |
| None | Review only | Expression and reference mistakes then show up as failed or silently skipped steps on GitHub. |

## Recommendation

**GitHub-hosted `ubuntu-24.04` runners; one workflow with two jobs, `checks` and `e2e`; Dependabot for actions and npm; actionlint adopted; only GitHub-owned actions, pinned by full commit SHA. For enforcement, the system recommends GitHub Pro with a ruleset on `main` (E1). The orchestrator's merge check (E3) applies on every plan, so the pipeline works unchanged whichever plan the owner chooses.**

### Workflow, triggers, and jobs

One file, `.github/workflows/ci.yml`, named `CI`:

- **Triggers:** `pull_request` (default types: opened, synchronize, reopened) and `push` to `main`. No `pull_request_target`, no `workflow_run`, no `schedule`. No workflow-level `paths` filters, because a path-filtered workflow leaves its required checks pending forever under a ruleset.
- **Concurrency:** `group: ci-${{ github.head_ref || github.run_id }}`, `cancel-in-progress: true`. A new push to a PR cancels that PR's previous run. Each `main` push has its own `run_id` and is never cancelled, so the post-merge run that #12 checks always finishes.
- **Timeouts:** `timeout-minutes: 15` on `checks` and `20` on `e2e`. The default is 360 minutes, which would let a hung run use a sixth of Free's monthly quota.

| Job (check name) | Runs on | Steps | Added by |
| --- | --- | --- | --- |
| `checks` | every PR push and every `main` push | checkout; setup-node (Node from `package.json` `devEngines.runtime`, npm cache automatic); `npm ci`; then, each as its own named step that runs if install succeeded even when an earlier check failed: `npm audit signatures`, `format:check`, `lint`, `typecheck`, `test`, `test:convex`, `build`; then `actionlint` | #12 |
| `e2e` | every PR push and every `main` push, in parallel with `checks` | checkout (depth 2); **scope step**: on `pull_request`, if every changed file is under `docs/`, `design/`, `.claude/`, or is a root `*.md`, the remaining steps are skipped and the job passes in about 1 billed minute; otherwise setup-node, `npm ci`, `npx playwright install --with-deps chromium` (plus `webkit` on `push`), the e2e script, and an artifact upload with `retention-days: 7` | #13 |

The scope step never skips on `push` to `main`. An empty diff counts as an app change. It reads the PR's changes as `git diff --name-only HEAD^1 HEAD` on the `refs/pull/<n>/merge` commit that `pull_request` checks out, whose first parent is the base branch. It avoids `grep -q` in a pipe, because under `pipefail` an early `grep -q` exit makes the producer fail with SIGPIPE; the system hit this while testing the filter.

`e2e` does not wait for `checks`. Agents run every check locally before opening a PR (dev cycle Phase 4), so failures in `checks` are rare, and waiting would add 3 to 4 minutes to every PR.

**Convex `_generated/` drift check (ADR 0004):** added by the first feature that wires the local backend into `e2e` (ADR 0005). Right after `npx convex dev --once`, which already regenerates the folder, a step runs `git diff --exit-code convex/_generated`. It costs no extra job.

### Required checks and enforcement

**Required checks: `checks` and `e2e`** (exact check-run names, which equal the job `name:`). `docs/process/ci.md` (#12, #13) lists them.

**Orchestrator merge check (all plans).** Before merging any PR, the merger:

1. reads the PR head SHA (`gh pr view <n> --json headRefOid`);
2. runs `gh pr checks <n> --json name,bucket,workflow` and requires that `checks` and `e2e` from workflow `CI` are present with `bucket` `pass`, and that no check has `bucket` `fail` or `pending`;
3. merges with `gh pr merge <n> --squash --delete-branch --match-head-commit <sha>`, so that a push after step 2 makes the merge fail instead of merging unchecked code.

On Free this is the only enforcement. Gate PRs merged by the owner follow the same rule. Agents never push to `main` directly.

**Ruleset on `main` (E1 Pro or E2 public), created by the owner:**

- target: the default branch; enforcement: active; **bypass list: empty**, so admins, and agents using the owner's token, are bound too;
- require a pull request before merging, with 0 required approvals (agents cannot approve a PR opened with the owner's identity, and the tester and reviewer record their verdicts as comments);
- require status checks `checks` and `e2e`, source "GitHub Actions"; **not** "require branches to be up to date", which would re-run CI on every open PR after each merge and multiply minutes, because the `main` push run catches post-merge breakage;
- block force pushes and deletion of `main`.

**Repository settings (owner, any plan):**

- allow squash merging only, and turn on automatic branch deletion;
- Actions permissions: "Allow jasonbryan, and select non-jasonbryan, actions and reusable workflows", with **"Allow actions created by GitHub"** checked, no other patterns, and **"Require actions to be pinned to a full-length commit SHA"** checked. The repository's Actions permissions API already exposes `sha_pinning_required` (currently `false`). The `gh api` equivalent is in Consequences.
- Workflow permissions stay "Read repository contents and packages permissions", with PR approval by Actions off (already so).
- Fork PR workflows stay disabled (already so).
- Turn on Dependabot alerts and Dependabot security updates.

### Minutes and cost

**Stated volume:** 60 PRs a month (the rate ADR 0005 used; this repository had 11 PRs in its first two days). Each PR gets 3 pushes, so 180 PR runs: 120 change app code and 60 are docs-only (gate ADRs, mockups, process docs). There are 66 `main` pushes (60 merges plus 6 Dependabot merges) and 12 Dependabot PR runs (about 6 grouped PRs, 2 runs each).

**Per run (billed minutes, after rounding up per job):**

| Job | Harness phase (#12, #13) | Once feature e2e exists |
| --- | --- | --- |
| `checks` (install about 1; lint 0.3 to 1; typecheck 0.2 to 0.5; `test` 0.3 to 0.5; `test:convex` 0.1 to 0.2; production SSR build 0.5 to 1; audit, format, actionlint under 0.2 in total) | 4 (range 3 to 5) | 4 |
| `e2e` on a PR with app changes (ADR 0005) | 3 | 5 to 8 |
| `e2e` on a docs-only PR (scope step skips) | 1 | 1 |
| `e2e` on `main` (adds WebKit) | 5 | 7 to 10 |

**Per month:**

| | Harness phase | Once feature e2e exists |
| --- | --- | --- |
| `checks`: 258 runs x 4 | 1,032 | 1,032 |
| `e2e`, PRs with app changes and Dependabot: 132 runs | 396 | 660 to 1,056 |
| `e2e`, docs-only PRs: 60 runs x 1 | 60 | 60 |
| `e2e`, `main`: 66 runs | 330 | 462 to 660 |
| **Total** | **~1,820** | **~2,210 to 2,810** |
| Shape S1 instead of S2 (`checks` at ~10) | ~3,370 | ~3,760 to 4,360 |
| Without the docs-only skip | ~1,940 | ~2,450 to 3,230 |

- **Free (2,000):** fits during the harness phase with about 10% margin, and runs out once feature e2e grows. Then either CI stops for the rest of the month, or, with a payment method and an Actions budget, overage costs about $1.30 to $4.90 a month (210 to 810 minutes at $0.006).
- **Pro (3,000):** covers the estimate with 190 to 790 minutes to spare. #15's preview deploys (below) would use most of that margin.
- **Public:** no minute cost.
- **Not included:** #15's preview deploy and smoke job. If it builds and deploys on the Actions runner, it adds roughly 3 to 5 minutes per app-changing PR push (about 400 to 650 a month at this volume). This is #9's decision. A host that builds previews on its own infrastructure uses no Actions minutes.
- **Concurrency cancellation** lowers these numbers, because a superseded run is billed only up to the moment it is cancelled. They are not reduced here.
- **Measured numbers replace estimates.** #12 and #13 record the billed job durations of their green runs. If a later month passes 80% of the quota, the orchestrator reports it to the owner. GitHub's "included usage alerts" also notify the owner by email.

**Artifacts and caches:**

- e2e artifacts (screenshots, plus Playwright report and traces on failure) at `retention-days: 7` stay well inside 500 MB.
- Caches: setup-node's npm cache (`~/.npm`, keyed on `package-lock.json`) and, later, the Convex backend (`~/.cache/convex`, 164 MB, keyed on the pinned backend version) fit easily in 10 GB per repository.
- Playwright browsers are not cached (ADR 0005).

### Actions inventory and pinning policy

**Policy:**

1. **Only GitHub-owned actions** (`actions/*`, `github/*`), enforced by the repository's allowed-actions setting.
2. **Every `uses:` is pinned to a full 40-character commit SHA, followed on the same line by `# vX.Y.Z`**, enforced by the repository's SHA-pinning setting. Dependabot updates the comment with the SHA.
   - Tags are mutable: the GitHub releases listed below report `"immutable": false`. GitHub's guide says a full SHA "is currently the only way to use an action as an immutable release".
   - SHAs are resolved from the action's own repository (`git ls-remote https://github.com/actions/<name>`), never from a fork, as GitHub advises.
3. **Version age:** a pinned version must have been published at least 1 day earlier, matching ADR 0003's `min-release-age`. Dependabot's cooldown applies this from now on.
4. **Adding actions later.** A new GitHub-owned action may be added by the issue that needs it, without a gate: GitHub is the CI platform accepted in ADR 0001. It must still be pinned and listed in `docs/process/ci.md`. **Any action from another owner needs a `gate:technology` amendment to this ADR.** Prefer an npm CLI that an accepted ADR already covers (for example `npx convex`) or a checksum-verified binary (as for actionlint) over a third-party action.
5. **Major versions of actions** arrive as separate Dependabot PRs. The PR reviewer reads the release notes. GitHub-owned action majors need no gate.

**Inventory for #12 and #13** (SHAs resolved on 2026-10-07; all run on `node24`):

| Action | Version | Commit SHA | Released | Used by | Purpose |
| --- | --- | --- | --- | --- | --- |
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | 2026-07-20 | #12, #13 | Checkout. Always `persist-credentials: false`; `fetch-depth: 2` in `e2e` for the scope step. v7.0.0 also refuses to check out fork PR code under `pull_request_target` and `workflow_run`. |
| `actions/setup-node` | v7.0.0 | `820762786026740c76f36085b0efc47a31fe5020` | 2026-07-14 | #12, #13 | Node from `node-version-file: package.json`, which reads `devEngines.runtime` (setup-node advanced usage). npm caching is automatic because `devEngines.packageManager` names npm. `actions/node-versions` lists 26.10.0 as its newest 26.x, so for `^26.11.0` the action falls back to downloading from nodejs.org, as its code documents. |
| `actions/upload-artifact` | v7.0.1 | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | 2026-04-10 | #13 | e2e screenshots and reports, `retention-days: 7`. **Not v7.0.2**: it was released 2026-10-07 at 10:08 UTC, less than a day before this ADR, and Dependabot proposes it after the cooldown. |
| `actions/cache` | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` | 2026-06-26 | first data feature (ADR 0005), not #12 or #13 | Restores `~/.cache/convex` for the local backend. Listed now so that the first data feature needs no gate. |

- **No package-manager setup action** (ADR 0003: npm comes with Node).
- **No Playwright action:** `npx playwright install --with-deps`.
- **No actionlint action:** the workflow downloads `actionlint_1.7.12_linux_amd64.tar.gz` from the GitHub release and checks it with `sha256sum --check` against `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8` (equal to the release's `checksums.txt` and to a local download, whose attestation verified).
  - The version and hash are bumped by hand, because Dependabot does not track a binary downloaded with `curl`. The PR reviewer checks the actionlint release about quarterly.
  - Changing the actionlint version is a patch or minor bump of an accepted tool and needs no gate.

### Workflow-security rules

1. **No `pull_request_target`.** No `workflow_run` that checks out or executes PR code, or that uses artifacts from a PR run.
2. **Top-level `permissions: contents: read`** in every workflow. Any elevation is granted per job, in the issue that needs it (for example `pull-requests: write` for #15's preview comment), never at the top level. The repository default is already read-only, and that stays.
3. **No secrets in `checks` or `e2e`.** No `secrets.` reference appears in them. Secrets for deploys (#15) live in a GitHub environment that only the deploy job references.
4. **`persist-credentials: false`** on every checkout, so the token is not left in `.git/config` for npm scripts or test code to read.
5. **Untrusted input in `run:`.** Event fields such as PR titles, branch names, and commit messages are passed through `env:` and quoted, never interpolated with `${{ }}` inside a script.
6. **Pinned, GitHub-owned actions only** (policy above).
7. **Fork PRs:** workflows stay disabled for forks of this private repo. If the repo becomes public, set "Require approval for all external contributors" for fork PR workflows. The jobs above need no secrets, so a fork run can read nothing sensitive.
8. **Caches:** `checks` and `e2e` run with read-only tokens and no secrets, so their caches are safe. GitHub scopes caches written by a PR run to that PR's merge ref, so a PR cannot write `main`'s cache. A job that holds deploy secrets sets `package-manager-cache: false` on setup-node, as setup-node's README recommends for "workflows with elevated privileges or access to sensitive information".
9. **`timeout-minutes`** is set on every job.

### Dependabot configuration

`.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
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
      interval: weekly
      day: monday
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
- **Minor and patch PRs** follow the normal merge rule: `checks` and `e2e` green, then PR reviewer `APPROVE` (release notes read, `allowScripts` changes justified), then the orchestrator merges. There is no linked issue and no tester phase. The dev-cycle text for this is a follow-up process PR (Consequences).

### Illustrative `ci.yml`

#12 and #13 implement this. It passes actionlint 1.7.12. The `e2e` steps after the scope step are #13's.

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.head_ref || github.run_id }}
  cancel-in-progress: true

env:
  ACTIONLINT_VERSION: 1.7.12
  ACTIONLINT_SHA256: 8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8

jobs:
  checks:
    name: checks
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version-file: package.json
      - name: install
        id: install
        run: npm ci
      - name: audit signatures
        if: ${{ !cancelled() && steps.install.outcome == 'success' }}
        run: npm audit signatures
      - name: format:check
        if: ${{ !cancelled() && steps.install.outcome == 'success' }}
        run: npm run format:check
      - name: lint
        if: ${{ !cancelled() && steps.install.outcome == 'success' }}
        run: npm run lint
      - name: typecheck
        if: ${{ !cancelled() && steps.install.outcome == 'success' }}
        run: npm run typecheck
      - name: test
        if: ${{ !cancelled() && steps.install.outcome == 'success' }}
        run: npm test
      - name: test:convex
        if: ${{ !cancelled() && steps.install.outcome == 'success' }}
        run: npm run test:convex
      - name: build
        if: ${{ !cancelled() && steps.install.outcome == 'success' }}
        run: npm run build
      - name: actionlint
        if: ${{ !cancelled() }}
        run: |
          curl -fsSL -o actionlint.tar.gz \
            "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"
          echo "${ACTIONLINT_SHA256}  actionlint.tar.gz" | sha256sum --check --strict
          tar -xzf actionlint.tar.gz actionlint
          ./actionlint -color

  e2e:
    name: e2e
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
          fetch-depth: 2
      - name: scope
        id: scope
        run: |
          changed="$(git diff --name-only HEAD^1 HEAD)"
          app_files="$(printf '%s\n' "$changed" | grep -vE '^(docs/|design/|\.claude/|[^/]+\.md$)' || true)"
          if [ "$GITHUB_EVENT_NAME" = "pull_request" ] && [ -n "$changed" ] && [ -z "$app_files" ]; then
            echo "app=false" >> "$GITHUB_OUTPUT"
          else
            echo "app=true" >> "$GITHUB_OUTPUT"
          fi
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        if: ${{ steps.scope.outputs.app == 'true' }}
        with:
          node-version-file: package.json
      - if: ${{ steps.scope.outputs.app == 'true' }}
        run: npm ci
      - if: ${{ steps.scope.outputs.app == 'true' }}
        run: npx playwright install --with-deps chromium
      - if: ${{ steps.scope.outputs.app == 'true' && github.event_name == 'push' }}
        run: npx playwright install --with-deps webkit
      - if: ${{ steps.scope.outputs.app == 'true' }}
        run: npm run e2e
      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        if: ${{ !cancelled() && steps.scope.outputs.app == 'true' }}
        with:
          name: e2e-report
          path: |
            playwright-report/
            test-results/
            e2e/screenshots/
          retention-days: 7
          if-no-files-found: ignore
```

### Runner image upgrades

Moving from `ubuntu-24.04` to `ubuntu-26.04` is a one-line PR whose own green run is the evidence. It needs no gate: it is the same accepted platform. Make the move after #13 is green on 24.04, and before GitHub announces 24.04's retirement.

## Owner question

**How should required checks be enforced on this private repository?**

| Option | Cost | Enforcement | Minutes |
| --- | --- | --- | --- |
| **(a) Upgrade to GitHub Pro (recommended)** | Pro price as shown on the upgrade page (listed elsewhere at $4/month) | GitHub refuses non-green merges for everyone, agents included | 3,000 a month, enough for the estimate |
| (b) Make the repository public | $0 | Same as (a) | Unlimited on standard runners |
| (c) Stay on Free | $0, plus about $1 to $5 a month of overage once feature e2e grows, if a payment method and Actions budget are set; otherwise CI stops when the quota runs out | Orchestrator check only (`gh pr checks` plus `--match-head-commit`) | 2,000 a month, enough only for the harness phase |

The system recommends (a). It is the cheapest option that both enforces the merge rule and fits the minute estimate, and it keeps the code private. (b) is cheaper, but making the source public is a business decision the system does not make. Under every option the orchestrator check stays in the process, so the pipeline in this ADR is the same; only the ruleset and the minute headroom change.

## Consequences

- **New tools and services:** GitHub Actions on GitHub-hosted `ubuntu-24.04` runners; the actions in the inventory above; Dependabot version and security updates; actionlint 1.7.12 (MIT), downloaded and verified at run time, never installed as an npm dependency. No third-party app. Cost depends on the owner question.
- **Owner setup (one time):**
  - answer the owner question; for (a) or (b), create the `main` ruleset above after #12 and #13 have produced the `checks` and `e2e` check runs (GitHub suggests check names it has recently seen; a name typed before its first run also works, but a typo then blocks every merge);
  - repository settings: squash merging only, auto-delete branches, Dependabot alerts and security updates on. Actions allowed-actions and SHA pinning, for example:
    - `gh api -X PUT repos/jasonbryan/omni-league/actions/permissions -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true`
    - `gh api -X PUT repos/jasonbryan/omni-league/actions/permissions/selected-actions -F github_owned_allowed=true -F verified_allowed=false`
  - set these **after** #12 merges, so the first workflow is already compliant;
  - under (c), optionally add a payment method and an Actions budget.
- **Process follow-up (separate PR for the owner to merge):**
  - define "CI is green" in dev cycle Phase 7 as the orchestrator merge check above;
  - add the Dependabot PR route (minor and patch: reviewer `APPROVE` plus green CI; npm majors: `gate:technology`);
  - record that agents never push to `main`.
- **Harder later:**
  - Separate per-check status lines are traded for minutes. The failing step is read from the job log.
  - SHA pins make reading workflow diffs slightly harder; the `# vX.Y.Z` comments compensate.
  - Without Pro or a public repo, a determined merger can still bypass CI.

### Effects on other issues

- **#12 (CI pipeline):** implements the `checks` job.
  - **Its criteria assume separate jobs per check. They need rewording to steps of one `checks` job:**
    - "the unit-test job fails" becomes "the `checks` job fails at its `test` step";
    - the same applies to lint;
    - "the format-check job is listed" becomes "the `format:check` step exists".
  - Its required-check list in `docs/process/ci.md` is `checks` (and `e2e` from #13).
  - **Scope additions:**
    - the `npm audit signatures` and actionlint steps;
    - `timeout-minutes`, `persist-credentials: false`, and runner `ubuntu-24.04`;
    - `.github/dependabot.yml` as above;
    - the orchestrator merge check and the ruleset/settings checklist in `docs/process/ci.md`;
    - billed durations of its green run recorded on the PR.
  - Its concurrency key matches its own optional note.
- **#13 (e2e harness):** adds the `e2e` job to the same `ci.yml` with check name `e2e`.
  - **Scope additions:** the docs-only scope step (with a criterion: a docs-only PR's `e2e` passes in about 1 minute without installing browsers, and a PR that changes `src/` runs the full job), `fetch-depth: 2`, `persist-credentials: false`, `timeout-minutes: 20`, and `actions/upload-artifact` pinned at v7.0.1 by SHA.
  - It records the billed e2e duration so that the estimate here can be checked.
- **#15 (previews) and #9 (hosting):**
  - the deploy job keeps the workflow's top-level read-only `permissions:` and gets `pull-requests: write` per job;
  - secrets come only through a GitHub environment;
  - it sets `package-manager-cache: false` and `persist-credentials: false`, and includes the same docs-only skip;
  - **any deploy action not owned by GitHub needs approval in #9's ADR or an amendment to this one**, so prefer the host's CLI through `npx`;
  - **#9 must count the preview job's Actions minutes**, about 400 to 650 a month if built on the runner; a host that builds previews itself avoids them;
  - since `run_workflows_from_fork_pull_requests` is `false`, fork PRs never run.
- **First feature with live Convex data in e2e:** uses `actions/cache` v6.1.0 (SHA above) for `~/.cache/convex`, and adds the `git diff --exit-code convex/_generated` drift check after `npx convex dev --once`.
- **ADR 0003:** confirmed. No package-manager setup action, `npm ci`, `npm audit signatures` in CI, and a Dependabot cooldown of 3 days, which is at least 1.

## Test evidence

Run on 2026-10-07, macOS arm64, in a scratch directory outside the repository.

1. **Plan and settings.**
   - `gh api` on `branches/main/protection` and `rulesets` returned 403 "Upgrade to GitHub Pro or make this repository public to enable this feature."
   - `actions/permissions` returned `{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}`.
   - `actions/permissions/workflow` returned `{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}`.
   - Fork PR workflows for private repos: all four options `false`.
   - `vulnerability-alerts`: 404 (off). `automated-security-fixes`: `{"enabled":false}`.
2. **Action SHAs.**
   - `git ls-remote --tags` on each `actions/*` repository resolved the tags in the inventory to the listed commits. They are lightweight tags with no `^{}` peel.
   - `gh api repos/actions/<name>/commits/<sha>` confirmed each commit exists in the canonical repository.
   - Release `immutable` flags are `false`.
3. **actionlint.**
   - The SHA-256 of the downloaded `linux_amd64` tarball matched `actionlint_1.7.12_checksums.txt`.
   - `gh attestation verify -R rhysd/actionlint` passed for the tarball.
   - The darwin build linted the illustrative `ci.yml` with no findings (exit 0).
   - A copy with `steps.instal.outcome` and `timeout-minutes: fifteen` produced `[expression]` and `[syntax-check]` errors.
4. **Scope step.**
   - Changed-file lists `docs/a.md`, `design/mockups/x.html`, `README.md` gave `app=false` on `pull_request`.
   - `docs/a.md` plus `src/app/x.ts` gave `app=true`; an empty list gave `app=true`; `docs/a.md` on `push` gave `app=true`; `.github/workflows/ci.yml` gave `app=true`; `e2e/README.md` gave `app=true`.
   - The first version, written with `grep -q` in a pipe, gave wrong results under `pipefail` and was replaced.
5. **Dependabot and `devEngines`.** On Node 24.16.0 with npm 11.13.0, a `package.json` with ADR 0003's `devEngines`:
   - `npm install --package-lock-only --ignore-scripts` failed with `EBADDEVENGINES` ("Invalid semver version "^26.11.0" does not match "v24.16.0"");
   - with `--force` added, the same command passed and wrote the lockfile.

   Dependabot's lockfile updater passes `--force` (source cited below). The first Dependabot npm PR after #12 confirms it end to end.
6. **Node 26.11 on runners.** nodejs.org `index.json` lists v26.11.0 and v26.11.1 (both 2026-10-07, npm 11.20.0). `actions/node-versions` lists up to 26.10.0, so setup-node v7.0.0 takes its documented fallback to nodejs.org (`official_builds.ts`: "Not found in manifest. Falling back to download directly from Node").

## Sources

- GitHub plans and billing:
  - [About GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)
  - [GitHub pricing](https://github.com/pricing)
  - [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
  - [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
  - [Budgets and alerts](https://docs.github.com/en/billing/concepts/budgets-and-alerts)
  - [Upgrade your plan](https://docs.github.com/en/billing/how-tos/manage-plan-and-licenses/upgrade-plan)
  - [2026 pricing changes for GitHub Actions](https://github.com/resources/insights/2026-pricing-changes-for-github-actions)
- Protection and rulesets:
  - [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
  - [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
  - availability text in github/docs `data/reusables/gated-features/protected-branches.md` and `repo-rules.md`
- Runners:
  - [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
  - [actions/runner-images README](https://github.com/actions/runner-images)
  - [Ubuntu 24.04 image readme](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
  - [`ubuntu-latest` to 26.04 announcement (#14748)](https://github.com/actions/runner-images/issues/14748)
  - [Playwright system requirements](https://playwright.dev/docs/intro#system-requirements)
- Security:
  - [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
  - [Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
  - [Preventing pwn requests (GitHub Security Lab)](https://securitylab.github.com/research/github-actions-preventing-pwn-requests/)
- Actions:
  - [actions/checkout releases](https://github.com/actions/checkout/releases)
  - [actions/setup-node](https://github.com/actions/setup-node), its [advanced usage](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md), and its v7.0.0 `src/distributions/official_builds/official_builds.ts`
  - [actions/node-versions manifest](https://github.com/actions/node-versions/blob/main/versions-manifest.json)
  - [actions/cache releases](https://github.com/actions/cache/releases)
  - [actions/upload-artifact releases](https://github.com/actions/upload-artifact/releases)
- Dependabot:
  - [options reference (`cooldown`, `groups`, `ignore`)](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
  - [Keeping your actions up to date with Dependabot](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/auto-update-actions)
  - github/docs `data/reusables/actions/dependabot-version-updates-actions-caveats.md`
  - dependabot-core [`npm_and_yarn/Dockerfile`](https://github.com/dependabot/dependabot-core/blob/main/npm_and_yarn/Dockerfile) and [`npm_lockfile_updater.rb`](https://github.com/dependabot/dependabot-core/blob/main/npm_and_yarn/lib/dependabot/npm_and_yarn/file_updater/npm_lockfile_updater.rb)
- Renovate:
  - [Renovate on GitHub (AGPL-3.0)](https://github.com/renovatebot/renovate)
  - [Mend Renovate app](https://github.com/apps/renovate)
  - [configuration options](https://docs.renovatebot.com/configuration-options/)
- Workflow linting:
  - [actionlint v1.7.12 release](https://github.com/rhysd/actionlint/releases/tag/v1.7.12)
  - [actionlint install](https://github.com/rhysd/actionlint/blob/main/docs/install.md) and [usage](https://github.com/rhysd/actionlint/blob/main/docs/usage.md)
  - [zizmor](https://github.com/zizmorcore/zizmor)
- Node.js: [dist index](https://nodejs.org/dist/index.json)
- GitHub CLI: `gh pr checks --help` and `gh pr merge --help` (gh 2.92.0; `--json bucket`, `--match-head-commit`)
