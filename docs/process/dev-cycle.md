# Development cycle

How work moves from a requirement to production. GitHub is the single record of state: every unit of work is an issue, every change is a PR, and labels say where each issue stands. Any agent can pick up work by reading GitHub alone.

In Claude Code, the main session orchestrates the cycle with the `/dev-cycle` skill and delegates each phase to a role agent in `.claude/agents/`. Other agents follow the same phases by hand.

## Roles

| Role          | Agent                       | Owns                                                                                                                                                   |
| ------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Orchestrator  | main session (`/dev-cycle`) | Picks the next issue, dispatches role agents, moves labels, merges non-gated PRs (gate PRs only on the owner's chat instruction), reports to the owner |
| Planner       | `planner`                   | Turns a requirement into sliced, testable issues; drafts ADRs for `gate:technology`                                                                    |
| Plan reviewer | `plan-reviewer`             | Challenges an issue before any code is written                                                                                                         |
| Designer      | `designer`                  | Builds the HTML mockup for `gate:ui-design`                                                                                                            |
| Implementer   | `implementer`               | Writes code and tests on a branch, opens the PR                                                                                                        |
| Tester        | `tester`                    | Independently verifies the PR against the acceptance criteria                                                                                          |
| PR reviewer   | `pr-reviewer`               | Reviews the diff for correctness, security, and conventions                                                                                            |
| Deployer      | `deployer`                  | Ships merged work to preview/production and verifies it                                                                                                |
| Owner         | the human                   | Approves gates by merging gate PRs or telling the orchestrator in chat to merge them; answers blocked questions                                        |

## Issue state machine

Each open issue carries exactly one `status:` label.

```
status:planning ─► status:plan-review ─┬─► status:needs-approval ─► status:ready
                                       └──────────────────────────► status:ready
status:ready ─► status:in-progress ─► status:in-review ─► (merged, issue closed) ─► deploy
any state ─► status:blocked  (question for the owner; returns to the prior state once answered)
```

The orchestrator owns every transition. It updates the label and leaves a one-line issue comment naming the phase result, so the history reads top to bottom.

## Labels

- **Status:** `status:planning`, `status:plan-review`, `status:needs-approval`, `status:ready`, `status:in-progress`, `status:in-review`, `status:blocked`
- **Type:** `type:feature`, `type:bug`, `type:chore`, `type:decision` (ADR), `type:design` (mockup)
- **Gate:** `gate:ui-design`, `gate:technology`, `gate:production`. Applied to the issue that needs the gate and to the gate PR itself.
- **Area:** `area:frontend`, `area:backend`, `area:payments`, `area:infra`

`scripts/setup-github.sh` creates them all.

## Phases

### 1. Plan

**Input:** a requirement from the owner or `docs/product/requirements.md`.

The planner writes issues using `.github/ISSUE_TEMPLATE/feature.yml`. Each issue is a vertical **slice**: one user-visible behaviour, end to end through Convex and Angular, small enough for one PR (aim for under ~400 changed lines excluding generated files and lockfiles). Every issue carries:

- user story and acceptance criteria written as checkable Given/When/Then statements
- test plan naming the unit, Convex, and e2e tests that prove each criterion
- gates required, with reasons
- `Blocked by: #n` lines for dependencies

**Done when:** every criterion is checkable by a test or a screenshot, every gate is identified, and the issue is labelled `status:plan-review`.

### 2. Plan review

The plan reviewer reads the issue cold and returns `APPROVE` or `CHANGES` with specific edits. It checks: scope fits one PR, criteria are testable, gates are not missed (any new package → `gate:technology`; any visible UI → `gate:ui-design`), security and tenancy implications are covered, and payments flows name their webhook and failure cases.

On `CHANGES`, the planner revises. After two rounds without `APPROVE`, the issue goes to `status:blocked` with the open disagreement summarised for the owner.

**Done when:** `APPROVE` is recorded as an issue comment.

### 3. Gates

If the issue has no gate labels, it moves straight to `status:ready`.

Otherwise it moves to `status:needs-approval`, and one gate PR is opened per gate:

- **`gate:technology`:** the planner writes `docs/decisions/NNNN-<slug>.md` from `docs/decisions/0000-template.md` with status `Accepted`, comparing at least two options. PR title `decision: <topic>`.
- **`gate:ui-design`:** the designer writes `design/mockups/<issue>-<slug>.html`, a self-contained static page showing every state (empty, loading, error, populated) at mobile and desktop widths. PR title `design: <screen>`.

Gate PRs carry the `gate:*` label, link the issue, and are never merged by an agent on its own judgement. The owner merges to approve, or comments with changes, which the authoring agent applies. On merge, the issue moves to `status:ready`.

**ADR status.** The planner writes `Status: Accepted` in the gate PR itself. An open, unmerged PR is by definition a proposal, and merging it is the owner's acceptance, so no follow-up commit is needed to change the status after merge. If the owner rejects the decision, the PR is closed unmerged and the ADR never reaches `main`.

**Approval in chat.** The owner may approve a gate PR by telling the orchestrator in chat to merge it. The orchestrator then merges that PR and comments the owner's words on it, quoted exactly, as the record of approval. This is the only case in which an agent merges a gate PR.

**Done when:** every gate PR for the issue is merged.

### 4. Implement

The implementer works in an isolated worktree on branch `<type>/<issue>-<slug>` (for example `feature/12-team-roster`).

- Write the failing test for each acceptance criterion first, then the code.
- Match an approved mockup exactly; any deviation goes back through `gate:ui-design`.
- Use only accepted technology. Needing anything new stops the work: the implementer reports it, and the orchestrator sends the issue back to Phase 3.
- Commits follow Conventional Commits (`feat(roster): add player to team`).
- Open a **draft** PR from `.github/pull_request_template.md` with `Closes #<issue>`, and move the issue to `status:in-review`.
- Stop local processes as in [Local processes](#local-processes).

The PR stays draft through Phases 4 to 6. CI does not run on drafts ([ADR 0009](../decisions/0009-ci-pipeline.md)), so every agent runs the full check suite locally.

**Done when:** all local checks are **green** (format, lint, typecheck, unit tests, serial unit tests, Convex tests, build), the draft PR is open, and no process the implementer started is still running.

The serial run (`npm run test:serial`) runs the Angular specs in one worker, as on the CI runner while it is the 2-vCPU private-repo runner (Vitest uses one worker fewer than the CPUs), so a cross-file leak that a many-core machine hides by spreading files across workers can fail locally too. File order can still differ from CI's, so it is not a guarantee.

### 5. Test

The tester checks out the PR branch in its own worktree and verifies it without trusting the implementer's claims:

- Every acceptance criterion maps to a passing test; missing tests are written and pushed to the branch.
- The full suite, including the serial unit tests, and e2e tests run; UI work gets screenshots at mobile and desktop widths compared with the approved mockup, plus an automated accessibility check.
- Edge cases: empty data, permissions (wrong user, wrong league), concurrent edits, and for payments, failed and duplicated webhooks.
- Stop local processes as in [Local processes](#local-processes).

Returns `PASS` or `FAIL` with reproduction steps. On `FAIL`, the implementer fixes it and the tester re-runs.

**Done when:** `PASS` is recorded as a PR comment, with the test evidence, and no process the tester started is still running.

### 6. PR review

The PR reviewer reads the full diff against the issue and the conventions files, and returns `APPROVE` or `CHANGES` with file:line findings ranked by severity. Focus: correctness, Convex authorization and argument validation, Stripe safety, Angular conventions, test quality, and scope creep beyond the issue.

On `CHANGES`, the implementer fixes it, then the tester re-runs, then the reviewer re-reviews. Implement → test → review loops are capped at three rounds; after that the PR goes to `status:blocked` with a summary for the owner.

**Done when:** `APPROVE` is recorded as a PR review comment.

### 7. Merge

A PR may merge when tester `PASS` and reviewer `APPROVE` are on its latest commit, it has no `gate:*` label, and every gate on the linked issue is approved. The orchestrator then merges it, one PR at a time, so a single `ci` run checks the exact tree that lands ([ADR 0009](../decisions/0009-ci-pipeline.md)):

1. **Update while draft.** If the branch is behind `main`, run `gh pr update-branch <n>`. A clean update (no conflicts, none of the PR's own files changed) keeps `PASS` and `APPROVE`. A conflicted update sends the PR back to the implementer, and Phases 5 and 6 run again.
2. **Mark ready.** `gh pr ready <n>` starts the `ci` run.
3. **Wait for `ci`.** Note the head SHA (`gh pr view <n> --json headRefOid`), then `gh pr checks <n> --watch` until `ci` passes. `skipping` is not a pass.
4. **Merge.** `gh pr merge <n> --squash --delete-branch --match-head-commit <sha>`. If GitHub refuses because `main` moved, go back to step 1.
5. **On failure.** If `ci` fails, `gh pr ready <n> --undo` and send the PR back to the implementer.

The branch is deleted and the issue closes through `Closes #n`.

Until #12 adds the `ci` workflow, the orchestrator merges on `PASS` and `APPROVE` alone, with a merge note on the PR saying CI was waived (as on PR #30).

### 8. Deploy

The deployer runs after merges to `main`:

- **Preview/staging:** deploy, run smoke tests against it, report the URL on the issue.
- **Production:** behind `gate:production`. The deployer opens a release PR or deploy request listing the merged changes since the last release, any Convex schema migrations, and any Stripe configuration changes. After the owner approves, the deployer ships, runs smoke tests, and on failure rolls back and opens a `type:bug` issue.

Hosting and deployment follow [ADR 0010](../decisions/0010-hosting-and-deployment.md). Netlify builds and deploys from Git, so no deploy secret lives in GitHub.

- **Previews.** Every PR against `main` gets `https://deploy-preview-<n>--<site>.netlify.app` with its own Convex preview deployment `pr-<n>`. Previews are public and `noindex`. The tester smoke-tests the preview locally (`E2E_BASE_URL=<preview URL> npm run e2e -- <smoke spec>`) and pastes the output in the PR; no GitHub Actions workflow runs it. No cleanup job runs: Convex deletes preview backends after 5 days, and Netlify deletes preview deploys after 30 days (Free) or 90 days (paid plans).
- **Staging.** Every merge to `main` updates staging at `https://main--<site>.netlify.app`. The deployer smoke-tests it and reports the URL.
- **Production.** The deployer opens a release PR from `main` into the `production` branch. The owner's merge approves and ships it: Netlify builds with the owner-held production key, then the deployer smoke-tests the production URL.
- **Rollback.** If the production smoke tests fail, the deployer opens a `type:bug` issue with the rollback steps, and the owner runs them: Netlify **Publish deploy** of the previous build, then merging a revert on `production` to redeploy the previous Convex functions.

## Parallel work

The orchestrator may run several issues at once when none of them blocks another. Issues that change the Convex schema (`convex/schema.ts`) or shared design tokens run one at a time to avoid conflicting migrations and merges. Each implementer gets its own worktree.

### Local processes

Sessions share one machine, and default ports (`ng serve` 4200, Convex local backend 3210) are shared between them. An agent that starts a local process (dev server, SSR server, Convex local backend):

1. Records the PID it started (`$!`), which is often a wrapper (`npm start`, `npx convex dev`) whose child holds the port.
2. Once the server is up, records the port it actually used (which may differ from the default when that port is busy) and the PID listening on it: `lsof -nP -t -iTCP:<port> -sTCP:LISTEN`. It records a listening PID only if it is the started PID or a descendant of it: walk up with `ps -o ppid= -p <pid>` until the started PID is reached (accept) or PID 1 (reject). It does this while the wrapper is still running, because an orphaned child is reparented to PID 1.
3. Stops each recorded listening PID first, then the started PID, before reporting.
4. Confirms all are gone: `kill -0 <pid>` fails for each recorded PID, and the `lsof` line above lists none of them.
5. If a PID it did not record holds the port, leaves it running and mentions it in the report.

It never stops a process the system did not start, whether by name (`pkill`, `killall`) or by a PID found with `lsof`.

## Escalation

When a decision belongs to the owner (an ambiguous requirement, a gate, a loop that hits its cap), the agent moves the issue to `status:blocked`, comments the question with the options and a recommendation, and the orchestrator relays it to the owner in chat. Agents do not guess at product requirements.

## Changing this process

This file is the single source of truth for the cycle. Changes to it, to `AGENTS.md`, or to `.claude/agents/` go through a normal PR that the owner merges.
