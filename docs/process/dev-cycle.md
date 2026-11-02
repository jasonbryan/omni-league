# Development cycle

How work moves from a requirement to production. GitHub is the single record of state: every unit of work is an issue, every change is a PR, and labels say where each issue stands. Any agent can pick up work by reading GitHub alone.

In Claude Code, the main session orchestrates the cycle with the `/dev-cycle` skill and delegates each phase to a role agent in `.claude/agents/`. Other agents follow the same phases by hand.

## Roles

| Role          | Agent                       | Owns                                                                                                                                                                     |
| ------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Orchestrator  | main session (`/dev-cycle`) | Picks the next issue, dispatches role agents, moves labels, merges every PR outside the owner-merge scope, reports to the owner per [Reporting](#reporting-to-the-owner) |
| Planner       | `planner`                   | Turns a requirement into sliced, testable issues; drafts ADRs for `gate:technology`                                                                                      |
| Plan reviewer | `plan-reviewer`             | Challenges an issue before any code is written                                                                                                                           |
| Designer      | `designer`                  | Builds an HTML mockup when the owner asks for one                                                                                                                        |
| Implementer   | `implementer`               | Writes code and tests on a branch, opens the PR                                                                                                                          |
| Tester        | `tester`                    | Independently verifies the PR against the acceptance criteria                                                                                                            |
| PR reviewer   | `pr-reviewer`               | Reviews the diff for correctness, security, and conventions                                                                                                              |
| Deployer      | `deployer`                  | Ships merged work to preview/production and verifies it                                                                                                                  |
| Owner         | the human                   | Merges gate PRs and changes to secrets or security policy ([Who merges](#who-merges)); reviews UI on staging; answers blocked questions                                  |

### Model and effort

Each role agent's frontmatter (`model:` and `effort:` in `.claude/agents/<agent>.md`) sets its default model and effort level:

| Agent           | Model    | Effort   |
| --------------- | -------- | -------- |
| `planner`       | `opus`   | `high`   |
| `plan-reviewer` | `opus`   | `high`   |
| `designer`      | `opus`   | `high`   |
| `implementer`   | `sonnet` | `high`   |
| `tester`        | `sonnet` | `high`   |
| `pr-reviewer`   | `opus`   | `high`   |
| `deployer`      | `sonnet` | `medium` |

The orchestrator may override both per dispatch: lighter for mechanical or docs-only tasks, at least `opus`/`high` for security, payments, auth, and server-rendering work, and `fable`/`xhigh` only for escalations: the final fix or review round after earlier rounds found defects, and the hardest security, payments, auth, and SSR tasks. A fix, test, or review round whose push is a safe change (code comments other than directive comments, `*.md` docs, test titles) uses `sonnet`/`medium`, unless the security, payments, auth, and SSR rule or the escalation round applies. When several rules match, the highest model and the highest effort among them apply. The rules are in the [dev-cycle skill, Model and effort](../../.claude/skills/dev-cycle/SKILL.md#model-and-effort), and every phase comment records the model and effort used.

## Issue state machine

Each open issue carries exactly one `status:` label.

```
status:planning ─► status:plan-review ─┬─► status:needs-approval ─► status:ready
                                       └──────────────────────────► status:ready
status:ready ─► status:in-progress ─► status:in-review ─► (merged, issue closed) ─► deploy
any state ─► status:blocked  (question for the owner; returns to the prior state once answered)
```

The orchestrator owns every transition. It updates the label and leaves a one- or two-line issue comment naming the phase result, so the history reads top to bottom. All issue, PR, and comment text follows [AGENTS.md, Writing on GitHub](../../AGENTS.md#writing-on-github).

## Labels

- **Status:** `status:planning`, `status:plan-review`, `status:needs-approval`, `status:ready`, `status:in-progress`, `status:in-review`, `status:blocked`
- **Type:** `type:feature`, `type:bug`, `type:chore`, `type:decision` (ADR), `type:design` (mockup)
- **Gate:** `gate:technology`, `gate:production`. Applied to the issue that needs the gate and to the gate PR itself.
- **Area:** `area:frontend`, `area:backend`, `area:payments`, `area:infra`

`scripts/setup-github.sh` creates them all.

## Phases

### 1. Plan

**Input:** a requirement from the owner or `docs/product/requirements.md`.

The planner writes issues using `.github/ISSUE_TEMPLATE/feature.yml`. Each issue is a vertical **slice**: one user-visible behaviour, end to end through Convex and Angular, small enough for one PR (aim for under ~400 changed lines excluding generated files and lockfiles). Every issue carries:

- user story and acceptance criteria written as checkable Given/When/Then statements
- test plan naming the unit, Convex, and e2e tests that prove each criterion
- a **Demo data** criterion when the issue adds or changes a table, a field, or a user-visible feature: it names the rows `seed:demo` adds, or the demo account that shows the feature, or says `Demo data: none` with the reason ([Demo data](hosting.md#demo-data))
- gates required, with reasons
- `Blocked by: #n` lines for dependencies

**Done when:** every criterion is checkable by a test or a screenshot, every gate is identified, and the issue is labelled `status:plan-review`.

### 2. Plan review

The plan reviewer reads the issue cold and returns `APPROVE` or `CHANGES` with specific edits. It checks: scope fits one PR, criteria are testable, gates are not missed (any new package → `gate:technology`), security and tenancy implications are covered, payments flows name their webhook and failure cases, and any screen or task flow follows [`docs/conventions/ux.md`](../conventions/ux.md).

On `CHANGES`, the planner revises. After two rounds without `APPROVE`, the issue goes to `status:blocked` with the open disagreement summarised for the owner.

**Done when:** `APPROVE` is recorded as an issue comment.

### 3. Gates

If the issue has no gate labels, it moves straight to `status:ready`.

Otherwise it moves to `status:needs-approval`, and one gate PR is opened per gate:

- **`gate:technology`:** the planner writes `docs/decisions/NNNN-<slug>.md` from `docs/decisions/0000-template.md` with status `Accepted`, comparing at least two options. PR title `decision: <topic>`.

New screens and visible UI changes need no gate and no mockup (owner, 2026-10-10). When the owner asks for a mockup, the designer writes `design/mockups/<issue>-<slug>.html`, a self-contained static page showing every state (empty, loading, error, populated) at mobile and desktop widths, in an ordinary `type:design` PR titled `design: <screen>` with no gate label, which the orchestrator merges like any reviewed PR after the designer applies the owner's comments.

Gate PRs carry the `gate:*` label, link the issue, and are never merged by an agent on its own judgement (see [Who merges](#who-merges)). The owner merges to approve, or comments with changes, which the authoring agent applies. On merge, the issue moves to `status:ready`.

**ADR status.** The planner writes `Status: Accepted` in the gate PR itself. An open, unmerged PR is by definition a proposal, and merging it is the owner's acceptance, so no follow-up commit is needed to change the status after merge. If the owner rejects the decision, the PR is closed unmerged and the ADR never reaches `main`.

**Approval in chat.** The owner may approve a gate PR by telling the orchestrator in chat to merge it. The orchestrator then merges that PR and comments the owner's words on it, quoted exactly, as the record of approval. This is the only case in which an agent merges a gate PR.

**Done when:** every gate PR for the issue is merged.

### 4. Implement

The implementer works in an isolated worktree on branch `<type>/<issue>-<slug>` (for example `feature/12-team-roster`).

- Write the failing test for each acceptance criterion first, then the code.
- Build UI against the design system: `src/styles/tokens.css`, `design/mockup-kit/`, [Angular conventions](../conventions/angular.md), and the approved mockups in `design/mockups/` as references. Where an approved mockup covers the screen, match it. Use tokens only: no new colours or tokens, and no new patterns where an existing one fits.
- Use only accepted technology. Needing anything new stops the work: the implementer reports it, and the orchestrator sends the issue back to Phase 3.
- Update `convex/seed.ts` to match the issue's Demo data criterion. New tables get demo rows, changed fields are set on the demo rows, and a feature for a role shows on that role's demo account (#98; `hosting.md` Demo data once #98 merges). The seed must still pass on a fresh deployment: `convex/seedCoverage.test.ts` fails when a schema table has no demo rows and no listed exception, and `test:convex` runs it.
- Commits follow Conventional Commits (`feat(roster): add player to team`).
- Run the PR's [own e2e specs](#own-e2e-specs) with `npm run e2e -- <files>`, not the full suite, which runs once per [batch](#batch-run) on `main`. Put the command and its result in the PR Evidence block, or the empty list when the PR has no own specs. The result is for the head SHA pushed last, including after a review fix: a push after the run means the run is repeated or the evidence is marked stale.
- Before opening or updating the PR, re-read every added or changed comment against [AGENTS.md, Code comments](../../AGENTS.md#code-comments) and fix what-comments. The PR Evidence block says `Comments re-read against AGENTS.md`.
- A new route, or a new source directory under `src/app/` whose files would run the full suite, still adds its rule in `scripts/e2e-affected.mjs` in the same PR, and `npm run test:scripts` fails until it does ([CI, Affected e2e specs](ci.md#affected-e2e-specs-and-the-nightly-run)). `npm run e2e:affected` is an on-demand tool, not the per-PR run.
- Open a **draft** PR from `.github/pull_request_template.md` with `Closes #<issue>`, and move the issue to `status:in-review`.
- Stop local processes as in [Local processes](#local-processes).

The PR stays draft through Phases 4 to 6. CI does not run on drafts ([ADR 0009](../decisions/0009-ci-pipeline.md)), so every agent runs the full check suite locally.

**Done when:** all local checks are **green** (format, lint, typecheck, unit tests, serial unit tests, Convex tests, build), the draft PR is open, and no process the implementer started is still running.

The serial run (`npm run test:serial`) runs the Angular specs in one worker, as on the CI runner while it is the 2-vCPU private-repo runner (Vitest uses one worker fewer than the CPUs), so a cross-file leak that a many-core machine hides by spreading files across workers can fail locally too. File order can still differ from CI's, so it is not a guarantee.

#### Own e2e specs

The implementer and the tester run only the PR's own specs, with `npm run e2e -- <files>`, which takes the machine lock ([Local processes](#local-processes)), pushes the local backend, and builds first. A bare `npx playwright test` skips all three, so it is not the per-PR run. The changed files are `git diff --no-renames --name-only origin/main...HEAD`. The own specs are:

- every `e2e/**/*.spec.ts` the PR adds or changes: `git diff --no-renames --name-only --diff-filter=d origin/main...HEAD -- 'e2e/*.spec.ts' 'e2e/**/*.spec.ts'`;
- every spec that imports a changed non-spec file (any path, deleted files included), directly or through other files under `e2e/`. For each file in the set, run `git grep -lE "[/']<stem>(\.[a-z]+)?'" -- 'e2e/'`, where `<stem>` is the file name without its extension. The `[/']` finds an import path (`'./support/fixtures'`) and a quoted file name (`join(…, '125-126-seasons.html')`), so a mockup-only PR runs its mockup spec. Add every non-spec file found to the set and repeat until no new file turns up, then take every spec found. For example, `e2e/support/console-guard.ts` finds `e2e/support/fixtures.ts`, which finds every spec that imports it. A stem that also matches an unrelated file only adds specs, which is safe;
- every spec that the issue's Test plan or an acceptance criterion names;
- `e2e/smoke.spec.ts`, when the list above is empty and the PR's ci scope is `app`: `git diff --no-renames --name-only origin/main...HEAD | GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=main node scripts/ci-scope.mjs` prints `scope=app`.

If the list is still empty, the PR runs no e2e. A Dependabot PR has no linked issue; its test path is in [Low-risk PRs](#low-risk-prs).

### 5. Test

A [low-risk PR](#low-risk-prs) skips this phase. On every other PR, the tester checks out the PR branch in its own worktree and verifies it without trusting the implementer's claims:

- Every acceptance criterion maps to a passing test; missing tests are written and pushed to the branch.
- The checks run, including the serial unit tests and the PR's [own e2e specs](#own-e2e-specs) with `npm run e2e -- <files>`. An npm Dependabot PR that is not low-risk runs the full `npm run e2e` instead ([Low-risk PRs](#low-risk-prs)).
- UI work gets screenshots at mobile and desktop widths, compared with the approved mockup where one exists and otherwise checked for consistency with the design system (tokens only, no new colours, existing component patterns), plus an automated accessibility check.
- Edge cases: empty data, permissions (wrong user, wrong league), concurrent edits, and for payments, failed and duplicated webhooks.
- The demo data shows the feature:
  - **Screens behind sign-in:** the proof is a screenshot as the matching demo account on the anonymous local backend with a local build ([hosting, Service worker, "With data"](hosting.md#service-worker)), using a throwaway `DEMO_ACCOUNT_PASSWORD` set only on that backend. `DEMO_ACCOUNT_PASSWORD` is owner-held and never given to an agent ([AGENTS.md, Secrets](../../AGENTS.md#secrets)), so no agent signs in on a preview.
  - **Signed-out pages:** the screenshot may come from the seeded preview.
- Stop local processes as in [Local processes](#local-processes).

Returns `PASS` or `FAIL` with reproduction steps. On `FAIL`, the implementer fixes it and the tester re-runs.

**Done when:** `PASS` is recorded as a PR comment, with the test evidence collapsed and naming the head SHA tested and the own-specs command, and no process the tester started is still running.

#### Low-risk PRs

The orchestrator classifies the PR's head SHA from `git fetch origin pull/<n>/head && git diff --no-renames --name-only origin/main...FETCH_HEAD`, so a rename counts both its old and its new path, as in `scripts/ci-scope.mjs`. The fix push case below is the exception: it reads its own diff, from the last `Test: PASS` SHA to the head. Otherwise a PR is low-risk when one of these holds:

- **Tests and docs only.** Every changed file is a test file or a docs file:
  - a test file is `*.spec.ts`, `*.test.ts`, `*.test.mjs`, or any file under `e2e/`, `scripts/fixtures/`, or a `testing/` directory under `src/`. A file under `src/**/testing/` counts only while no non-test `src/` file imports one: `git grep -lE "/testing/" -- 'src/' ':!*.spec.ts' ':!src/**/testing/**'` prints nothing;
  - a docs file is a `*.md` under `docs/` or `.claude/`, a root `*.md`, or a `README.md` under `src/` or `convex/` (`scripts/e2e-affected.mjs` already treats those as outside the build).
- **Dependency bump only.** The changed files are exactly `package.json` and `package-lock.json`, and `git diff origin/main...FETCH_HEAD -- package.json` changes only the version strings of existing entries in `dependencies`, `devDependencies`, and `overrides`. Each changed version keeps its major: for `>=1.0.0` the first number; for `0.y.z` the first two (`^0.12` to `^0.13` is a major); for `0.0.z` any change is a major. A package added or removed, or a change to any other field (`devEngines`, `engines`, `allowScripts`, `scripts`, and the rest), brings the tester back.
- **Dependabot.** An npm Dependabot PR (groups included) is low-risk only when it meets the dependency bump rule, read from its `package.json` diff, not from Dependabot's label or group: Dependabot calls `convex-test` `0.0.60` to `0.0.66` a patch and `@convex-dev/better-auth` `0.12` to `0.13` a minor, and both are majors here. It records `dependency bump`. A Dependabot PR that changes only `package-lock.json` (a transitive security update) is low-risk only when every package whose version changes in `git diff origin/main...FETCH_HEAD -- package-lock.json` keeps its major by the same rule and no package entry is added or removed, and it also records `dependency bump`. The entry check is `git diff origin/main...FETCH_HEAD -- package-lock.json | grep -E '^[+-] +"node_modules/'`, which prints nothing for a low-risk PR; a printed line means an entry was added or removed, and the PR goes to the tester. An npm Dependabot PR that is not low-risk, such as one that moves a 0.x major, goes to the tester. It has no linked issue, so the tester runs the full `npm run e2e` on the head SHA, and that run is the `Test: PASS` or `FAIL`. This "major" sets only the tester path: the `gate:technology` rule for npm majors ([CI, Merge procedure](ci.md#merge-procedure), `AGENTS.md`) stays as it is. A GitHub Actions Dependabot PR is low-risk while every changed file is under `.github/`, and records `Dependabot github-actions`; the reviewer still reads the action's release notes.

- **Fix push with no behaviour change.** A fix push on a PR that already has `Test: PASS` is low-risk for that round when the cumulative diff from the last `Test: PASS` SHA to the new head (not each push alone) is only safe changes: code comments (not directive comments such as `@ts-`, `eslint-`, `prettier-ignore`), `*.md` docs, and test titles. In a code file, "comment-only" means every added or removed line is a comment line. A rename of an export, a Convex function, a test id, a route, or a CSS class, and a reworded visible string, are behaviour changes. The stand-in for the tester run is all local checks plus the own specs run on that exact head; evidence marked stale cannot stand in.

Any other changed file (in the `origin/main` diff; the fix push case reads its own diff) brings the tester back, including:

- any non-test file under `src/`, `convex/` (`convex/testing.ts` included), `public/`, `design/`, `.github/` (`.github/pull_request_template.md` included), or `scripts/`. The one exception is a file under `.github/` on a GitHub Actions Dependabot PR;
- root config files such as `playwright.config.ts`, `angular.json`, `tsconfig*`, `netlify.toml`, and `ngsw-config.json`.

A low-risk PR goes from the implementer straight to Phase 6. The orchestrator first posts `Test: skipped (low-risk: <tests and docs only | dependency bump | Dependabot github-actions>) at <head SHA>` on the PR; for the fix push case it posts `Test: skipped (low-risk fix push: <reason>) at <sha>`. It re-classifies on every push: a push that adds a file outside these rules sends the PR to the tester, and a push that keeps the PR low-risk gets a new record for the new head SHA. An update from `main` keeps the record when the PR's own changes are unchanged ([Phase 7, step 1](#7-merge)). `ci` still gates the merge in Phase 7. The implementer's PR Evidence block still carries the own-specs command and its result for the head SHA.

### 6. PR review

The PR reviewer reads the full diff against the issue and the conventions files, and returns `APPROVE` or `CHANGES` with file:line findings ranked by severity. Focus: correctness, Convex authorization and argument validation, Stripe safety, Angular conventions, visible changes that break the design system, test quality, and scope creep beyond the issue.

It checks that the latest own-specs run on the head SHA under review, in the PR Evidence block or the tester's `Test: PASS` Evidence (a tester push moves the head), lists the [own e2e specs](#own-e2e-specs) and passed. On a PR with a `Test: skipped` record, it re-checks the [low-risk](#low-risk-prs) classification against the file list and, for a bump, the version diff its rule reads (`package.json`, or `package-lock.json` on a lockfile-only Dependabot PR). For a `low-risk fix push` record, it re-checks that `git diff <last Test: PASS sha> <head>` is only safe changes, and that the stand-in checks and own-specs run are on that head. A classification that does not hold is a **blocking** finding.

It compares the PR's seed change with the issue's own Demo data criterion. A PR that does not deliver it is a **blocking** finding. So is a PR that changes `convex/schema.ts` with no seed change, where the issue has no such criterion and the PR states no reason.

On `CHANGES`, the implementer fixes it, the orchestrator re-classifies the new head SHA ([Low-risk PRs](#low-risk-prs)), the tester re-runs unless the PR is still low-risk, and the reviewer re-reviews. Implement → test → review loops are capped at three rounds; after that the PR goes to `status:blocked` with a summary for the owner.

**Fix before merge.** A reviewer whose only remaining findings are safe changes (code comments other than directive comments, `*.md` docs, test titles) may post `Review: APPROVE (fix before merge: <n>)`, listing each fix as `path:line` with the exact old and new text. The implementer applies exactly those replacements. The orchestrator checks that the fix diff is exactly the listed replacements and posts `Fix before merge: applied as listed at <sha>`, then merges without another review round. Anything else in the diff sends the PR back to review. An `APPROVE (fix before merge)` is not a round for the three-round cap. A change to a name, a Convex function, a test id, a route, a CSS class, or a visible string is not a safe change.

**Done when:** `APPROVE` is recorded as a PR review comment.

### 7. Merge

A PR may merge when all of these hold:

- On the SHA that merges, it has tester `PASS`, or a `Test: skipped (low-risk: <tests and docs only | dependency bump | Dependabot github-actions>) at <sha>` record, or a `Test: skipped (low-risk fix push: <reason>) at <sha>` record, and still meets [Low-risk PRs](#low-risk-prs). A push that adds a file outside those rules brings the tester back.
- Reviewer `APPROVE` is on its latest commit. Reviewer `APPROVE (fix before merge)` on the previous head, plus the `Fix before merge: applied as listed at <sha>` record, counts as `APPROVE` on the latest commit; the fix head carries the fix push record above, or a new `Test: skipped (low-risk: ...)` record when the PR is still low-risk.
- It has no `gate:*` label, it is outside the owner-merge scope ([Who merges](#who-merges)), and every gate on the linked issue is approved.
- No [batch run](#batch-run) regression holds merges, or the PR is ci-scope `docs` or the fix or revert PR for it.

The orchestrator then merges it, one PR at a time, so a single `ci` run checks the exact tree that lands ([ADR 0009](../decisions/0009-ci-pipeline.md)):

1. **Update while draft.** If the branch is behind `main`, run `gh pr update-branch <n>`. A conflicted update sends the PR back to the implementer, and Phases 5 and 6 run again. An update that merges without conflict keeps `PASS`, a `Test: skipped` record, and `APPROVE` when the PR's own changes are unchanged:
   - Before `gh pr update-branch`, record `<old head>` and `git merge-base origin/main <old head>`.
   - After the update, run `git fetch`, then on the new head: `diff <(git diff <old merge-base> <old head> -- . ':!convex/_generated') <(git diff origin/main <new head> -- . ':!convex/_generated')`. The output is raw, with index lines kept, so a `main` change to a file the PR also changes shows up. Output that is not empty drops the records, and the tester and reviewer run again.
   - For `convex/_generated/`, run `node scripts/e2e-convex.mjs push` on the new head (anonymous local backend, which runs codegen), then the drift check from [CI, E2E steps](ci.md#e2e-steps): `git diff --exit-code convex/_generated` and `git status --porcelain --untracked-files=all -- convex/_generated` must print nothing.
   - Post `Update: own changes unchanged, old <old head sha>, new <new head sha>` so the reviewer can repeat the check.
2. **Mark ready.** `gh pr ready <n>` starts the `ci` run.
3. **Wait for `ci`.** Note the head SHA (`gh pr view <n> --json headRefOid`), then run `gh run list --workflow CI --commit <head sha> --json databaseId,status,conclusion,createdAt` and take the newest run created after `gh pr ready`; if there is none, list again until one appears. Wait with `gh run watch <id>`, then read the `ci` job's `conclusion` from `gh run view <id> --json jobs`. `ci` passes only on `success`. A `cancelled` job (CI has `cancel-in-progress`), `skipped` (the draft-time run), or a missing run is not a pass. The `gh pr checks` list is not the source.
4. **Merge.** `gh pr merge <n> --squash --delete-branch --match-head-commit <sha>`. If GitHub refuses because `main` moved, go back to step 1.
5. **On failure.** If `ci` fails, `gh pr ready <n> --undo` and send the PR back to the implementer.

The branch is deleted and the issue closes through `Closes #n`. Merging (or closing) the PR also deletes its Convex preview deployment `pr-<n>` automatically ([Phase 8](#8-deploy)); nobody deletes it by hand.

Until #12 adds the `ci` workflow, the orchestrator merges on `PASS` and `APPROVE` alone, with a one-line merge note on the PR saying CI was waived (as on PR #30).

### 8. Deploy

The deployer runs after merges to `main`:

- **Preview/staging:** deploy, run smoke tests against it, report the URL on the issue. The staging check runs on a `main` SHA that the batch SHA covers ([Batch run, batch SHA rule](#batch-run)).
- **Production:** behind `gate:production`. The deployer opens a release PR or deploy request listing the merged changes since the last release, any Convex schema migrations, and any Stripe configuration changes. After the owner approves, the deployer ships, runs smoke tests, and on failure rolls back and opens a `type:bug` issue.

Hosting and deployment follow [ADR 0010](../decisions/0010-hosting-and-deployment.md). Netlify builds and deploys from Git, so no deploy secret lives in GitHub. The two exceptions are the Convex team token for preview cleanup, held as a secret of the `preview-cleanup` environment, and the Netlify build hook URL for the scheduled staging rebuild, held as a secret of the `staging-rebuild` environment. Only `main` can read either ([hosting, Where secrets live](hosting.md#where-secrets-live)).

- **Previews.** Every PR against `main` gets `https://deploy-preview-<n>--<site>.netlify.app` with its own Convex preview deployment `pr-<n>`. Previews are public and `noindex`. The tester smoke-tests the preview locally (`E2E_BASE_URL=<preview URL> npm run e2e -- <smoke spec>`) and puts the output in the Evidence block of its PR comment; no GitHub Actions workflow runs it. **Merging a PR deletes its Convex preview deployment automatically** (`.github/workflows/clean-previews.yml` runs on the push to `main`; a daily sweep deletes the preview of a PR closed without a merge and any the push run missed; [hosting, Cleanup](hosting.md#cleanup)), so the team's 40-deployment cap is not reached. The orchestrator checks the daily run's result (`gh run list --workflow clean-previews.yml`) and reports a failure to the owner. Netlify deletes preview deploys after 30 days (Free) or 90 days (paid plans); Convex also deletes preview backends after 5 days.
- **Staging.** Every merge to `main` updates staging at `https://main--<site>.netlify.app` and resets it to the seeded demo data and demo logins ([hosting, Staging reset](hosting.md#staging-reset)); owner-created data and sessions do not survive a merge. The deployer smoke-tests it on a `main` SHA that the batch SHA covers ([Batch run, batch SHA rule](#batch-run)) and reports the URL with the batch SHA. The owner reviews UI changes there and requests changes as new issues. A scheduled workflow (`staging-rebuild.yml`) also rebuilds it every 2 days, so its Convex deployment never expires in a week without merges, and a failed run opens the issue `Scheduled staging rebuild failed`. GitHub turns scheduled workflows off after 60 days without repository activity, so the orchestrator checks `gh workflow list --all` for `disabled_inactivity` whenever work resumes after a pause, and runs `gh workflow enable <file>` for each ([hosting, Scheduled staging rebuild](hosting.md#scheduled-staging-rebuild)).
- **Production.** The deployer opens a release PR from `main` into the `production` branch. The owner's merge approves and ships it: Netlify builds with the owner-held production key, then the deployer smoke-tests the production URL.
- **Rollback.** If the production smoke tests fail, the deployer opens a `type:bug` issue with the rollback steps, and the owner runs them: Netlify **Publish deploy** of the previous build, then merging a revert on `production` to redeploy the previous Convex functions.

## Batch run

The orchestrator runs the full e2e suite once on the `main` head per batch. A batch is the PRs merged to `main` since the SHA the last batch run tested. The run happens:

- before each milestone report;
- after the 5th merge since the SHA the last batch run tested;
- before the deployer opens a release PR.

The run is skipped when every PR in the batch had ci scope `docs`.

The **batch SHA** is the SHA of the last green batch run. It covers a `main` SHA being deployed or released when it is that SHA, or when every squash commit `<c>` in `git rev-list <batch SHA>..<main SHA>` has ci scope `docs` (`git diff --no-renames --name-only <c>^ <c> | GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=main node scripts/ci-scope.mjs` prints `scope=docs`). The orchestrator names the batch SHA to the deployer, and the deployer reports it.

Merges continue while a run is in progress; a PR merged during the run belongs to the next batch.

**How it runs.** By default, a local `npm run e2e` in a worktree detached at `origin/main` (`git fetch origin main`, `git worktree add --detach <path> origin/main`, then `npm ci`), under the machine lock. When the local run cannot complete, the fallback is `gh workflow run E2E --ref main` (about 25 CI minutes, [CI, Minutes](ci.md#minutes)). The orchestrator runs these commands itself, as it watches `ci`, and writes no code. The deployer's staging check runs on a `main` SHA that the batch SHA covers ([batch SHA rule](#batch-run)). The nightly `E2E` run stays as the backstop.

**On failure.** The orchestrator re-runs the failing specs once. A spec that passes on the re-run is flaky: the batch counts as `PASS`, and a `type:bug` issue records the flaky test. A spec that fails twice is a regression:

- From then until a batch run is green again, only ci-scope `docs` PRs and the fix or revert PR below merge.
- The orchestrator finds the causing PR by running the failing specs at the squash commits from the last green batch SHA to the failing head: `git bisect start <failing head> <last green batch SHA>`, then `git bisect run sh -c 'npm ci && npm run e2e -- <failing specs>'`, so each commit runs on its own dependencies.
- It opens a `type:bug` issue, `status:ready`, that names that PR.
- It dispatches `implementer` for a fix-forward PR. If that PR's first tester round returns `FAIL`, it dispatches `implementer` for a `git revert` PR of the causing squash commit instead.
- The own specs of the fix or revert PR include the failing specs.

## Who merges

The owner merges only:

- **Gate PRs** (`gate:technology`, `gate:production`), as in [Phase 3](#3-gates) and [Phase 8](#8-deploy).
- **Changes to secrets or security policy:** the secrets sections of [hosting.md](hosting.md) (Owner setup, Where secrets live), the Secrets and Approval gates sections of [AGENTS.md](../../AGENTS.md), and anything else that changes who holds a secret or who may approve what.

The owner may also tell the orchestrator in chat to merge one of these PRs; the orchestrator then merges it and comments the owner's words on it, quoted exactly, as the record of approval. Only the owner's own chat message counts; no agent's message is an approval.

Every other PR, including changes to this file, `.claude/`, the rest of `AGENTS.md`, other process docs, and design mockups, merges like any reviewed PR: the orchestrator merges it in [Phase 7](#7-merge) once it has `PASS` (or a low-risk `Test: skipped` record) and `APPROVE` (or `APPROVE (fix before merge)` on the previous head plus the `Fix before merge: applied as listed at <sha>` record, as in [Phase 7](#7-merge)) where those phases apply and `ci` is green. A PR that touches the owner-merge scope plus other files is owner-merged as a whole. Its author says so in the PR body (`Needs owner: merge`), and the orchestrator holds the PR for the owner.

## Reporting to the owner

The orchestrator reports **per milestone**, not per step. A milestone is a feature merged and live on staging (with its staging link), a release, or a set of issues that finished together. Between milestones it keeps working and does not report.

It reports **immediately**, outside that cadence, only when the owner must act:

- a gate PR waiting for approval, or a PR in the owner-merge scope;
- a `status:blocked` question, with the options and a recommendation;
- a budget or access problem only the owner can fix.

Each report follows [AGENTS.md, Writing on GitHub](../../AGENTS.md#writing-on-github): the outcome or ask first, one screen, one line per item, grouped as needs the owner, done, and in flight.

## Parallel work

The orchestrator may run several issues at once when none of them blocks another. Issues that change the Convex schema (`convex/schema.ts`) or shared design tokens run one at a time to avoid conflicting migrations and merges. Each implementer gets its own worktree.

**Open-PR limit.** The orchestrator starts no new frontier issue while 5 or more non-Dependabot PRs are open. It first moves each open PR to its next phase. Not counted: PRs labelled `gate:*` or carrying `Needs owner: merge` (everything in the owner-merge scope), and PRs whose linked issue is labelled `status:blocked` (this covers the three-round cap). Exempt from the limit: the fix-forward or revert issue during a [batch run](#batch-run) regression, and work the owner names in chat. Count with `gh pr list --state open --json number,author,labels,body,closingIssuesReferences` and `gh issue list --state open --label status:blocked --json number`, excluding author `app/dependabot` and the PRs above.

### Local processes

Sessions share one machine, and default ports (`ng serve` 4200, Convex local backend 3210) are shared between them. An agent that starts a local process (dev server, SSR server, Convex local backend):

1. Records the PID it started (`$!`), which is often a wrapper (`npm start`, `npx convex dev`) whose child holds the port.
2. Once the server is up, records the port it actually used (which may differ from the default when that port is busy) and the PID listening on it: `lsof -nP -t -iTCP:<port> -sTCP:LISTEN`. It records a listening PID only if it is the started PID or a descendant of it: walk up with `ps -o ppid= -p <pid>` until the started PID is reached (accept) or PID 1 (reject). It does this while the wrapper is still running, because an orphaned child is reparented to PID 1.
3. Stops each recorded listening PID first, then the started PID, before reporting.
4. Confirms all are gone: `kill -0 <pid>` fails for each recorded PID, and the `lsof` line above lists none of them.
5. If a PID it did not record holds the port, leaves it running and mentions it in the report.

It never stops a process the system did not start, whether by name (`pkill`, `killall`) or by a PID found with `lsof`.

Local e2e runs (`npm run e2e`, `e2e:affected`, `e2e:screenshots`, and the orchestrator's [batch run](#batch-run)) also share one machine-wide lock, a file at `~/.cache/omni-league/e2e.lock` that holds the PID of the run in progress. A second run waits and prints that PID, a lock whose process is gone is taken over (a PID reused by another process keeps the lock held until that process ends), and CI (a truthy `CI`) and runs against `E2E_BASE_URL` skip it; nobody deletes the file by hand.

## Escalation

When a decision belongs to the owner (an ambiguous requirement, a gate, a loop that hits its cap), the agent moves the issue to `status:blocked`, comments the question with the options and a recommendation, and the orchestrator relays it to the owner in chat. Agents do not guess at product requirements.

## Changing this process

This file is the single source of truth for the cycle. Changes to it, to `.claude/`, and to the parts of `AGENTS.md` outside the owner-merge scope go through a normal PR, reviewed and merged like any other. The owner merges only the PRs listed in [Who merges](#who-merges).
