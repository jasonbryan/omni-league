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

The orchestrator may override both per dispatch: lighter for mechanical or docs-only tasks, at least `opus`/`high` for security, payments, auth, and server-rendering work, and `fable`/`xhigh` only for escalations: the final fix or review round after earlier rounds found defects, and the hardest security, payments, auth, and SSR tasks. When several rules match, the highest model and the highest effort among them apply. The rules are in the [dev-cycle skill, Model and effort](../../.claude/skills/dev-cycle/SKILL.md#model-and-effort), and every phase comment records the model and effort used.

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
- Run e2e with `npm run e2e:affected`, which runs only the specs the branch's changed files map to.
- Open a **draft** PR from `.github/pull_request_template.md` with `Closes #<issue>`, and move the issue to `status:in-review`.
- Stop local processes as in [Local processes](#local-processes).

The PR stays draft through Phases 4 to 6. CI does not run on drafts ([ADR 0009](../decisions/0009-ci-pipeline.md)), so every agent runs the full check suite locally.

**Done when:** all local checks are **green** (format, lint, typecheck, unit tests, serial unit tests, Convex tests, build), the draft PR is open, and no process the implementer started is still running.

The serial run (`npm run test:serial`) runs the Angular specs in one worker, as on the CI runner while it is the 2-vCPU private-repo runner (Vitest uses one worker fewer than the CPUs), so a cross-file leak that a many-core machine hides by spreading files across workers can fail locally too. File order can still differ from CI's, so it is not a guarantee.

### 5. Test

The tester checks out the PR branch in its own worktree and verifies it without trusting the implementer's claims:

- Every acceptance criterion maps to a passing test; missing tests are written and pushed to the branch.
- The checks run, including the serial unit tests and the affected e2e specs (`npm run e2e:affected`; the full e2e suite runs nightly on `main`, and the tester adds a named spec only when an acceptance criterion needs it); UI work gets screenshots at mobile and desktop widths, compared with the approved mockup where one exists and otherwise checked for consistency with the design system (tokens only, no new colours, existing component patterns), plus an automated accessibility check.
- Edge cases: empty data, permissions (wrong user, wrong league), concurrent edits, and for payments, failed and duplicated webhooks.
- The demo data shows the feature:
  - **Screens behind sign-in:** the proof is a screenshot as the matching demo account on the anonymous local backend with a local build ([hosting, Service worker, "With data"](hosting.md#service-worker)), using a throwaway `DEMO_ACCOUNT_PASSWORD` set only on that backend. `DEMO_ACCOUNT_PASSWORD` is owner-held and never given to an agent ([AGENTS.md, Secrets](../../AGENTS.md#secrets)), so no agent signs in on a preview.
  - **Signed-out pages:** the screenshot may come from the seeded preview.
- Stop local processes as in [Local processes](#local-processes).

Returns `PASS` or `FAIL` with reproduction steps. On `FAIL`, the implementer fixes it and the tester re-runs.

**Done when:** `PASS` is recorded as a PR comment, with the test evidence collapsed, and no process the tester started is still running.

### 6. PR review

The PR reviewer reads the full diff against the issue and the conventions files, and returns `APPROVE` or `CHANGES` with file:line findings ranked by severity. Focus: correctness, Convex authorization and argument validation, Stripe safety, Angular conventions, visible changes that break the design system, test quality, and scope creep beyond the issue.

It compares the PR's seed change with the issue's own Demo data criterion. A PR that does not deliver it is a **blocking** finding. So is a PR that changes `convex/schema.ts` with no seed change, where the issue has no such criterion and the PR states no reason.

On `CHANGES`, the implementer fixes it, then the tester re-runs, then the reviewer re-reviews. Implement → test → review loops are capped at three rounds; after that the PR goes to `status:blocked` with a summary for the owner.

**Done when:** `APPROVE` is recorded as a PR review comment.

### 7. Merge

A PR may merge when tester `PASS` and reviewer `APPROVE` are on its latest commit, it has no `gate:*` label, it is outside the owner-merge scope ([Who merges](#who-merges)), and every gate on the linked issue is approved. The orchestrator then merges it, one PR at a time, so a single `ci` run checks the exact tree that lands ([ADR 0009](../decisions/0009-ci-pipeline.md)):

1. **Update while draft.** If the branch is behind `main`, run `gh pr update-branch <n>`. A clean update (no conflicts, none of the PR's own files changed) keeps `PASS` and `APPROVE`. A conflicted update sends the PR back to the implementer, and Phases 5 and 6 run again.
2. **Mark ready.** `gh pr ready <n>` starts the `ci` run.
3. **Wait for `ci`.** Note the head SHA (`gh pr view <n> --json headRefOid`), then `gh pr checks <n> --watch` until `ci` passes. `skipping` is not a pass.
4. **Merge.** `gh pr merge <n> --squash --delete-branch --match-head-commit <sha>`. If GitHub refuses because `main` moved, go back to step 1.
5. **On failure.** If `ci` fails, `gh pr ready <n> --undo` and send the PR back to the implementer.

The branch is deleted and the issue closes through `Closes #n`. Merging (or closing) the PR also deletes its Convex preview deployment `pr-<n>` automatically ([Phase 8](#8-deploy)); nobody deletes it by hand.

Until #12 adds the `ci` workflow, the orchestrator merges on `PASS` and `APPROVE` alone, with a one-line merge note on the PR saying CI was waived (as on PR #30).

### 8. Deploy

The deployer runs after merges to `main`:

- **Preview/staging:** deploy, run smoke tests against it, report the URL on the issue.
- **Production:** behind `gate:production`. The deployer opens a release PR or deploy request listing the merged changes since the last release, any Convex schema migrations, and any Stripe configuration changes. After the owner approves, the deployer ships, runs smoke tests, and on failure rolls back and opens a `type:bug` issue.

Hosting and deployment follow [ADR 0010](../decisions/0010-hosting-and-deployment.md). Netlify builds and deploys from Git, so no deploy secret lives in GitHub. The two exceptions are the Convex team token for preview cleanup, held as a secret of the `preview-cleanup` environment, and the Netlify build hook URL for the scheduled staging rebuild, held as a secret of the `staging-rebuild` environment. Only `main` can read either ([hosting, Where secrets live](hosting.md#where-secrets-live)).

- **Previews.** Every PR against `main` gets `https://deploy-preview-<n>--<site>.netlify.app` with its own Convex preview deployment `pr-<n>`. Previews are public and `noindex`. The tester smoke-tests the preview locally (`E2E_BASE_URL=<preview URL> npm run e2e -- <smoke spec>`) and puts the output in the Evidence block of its PR comment; no GitHub Actions workflow runs it. **Merging a PR deletes its Convex preview deployment automatically** (`.github/workflows/clean-previews.yml` runs on the push to `main`; a daily sweep deletes the preview of a PR closed without a merge and any the push run missed; [hosting, Cleanup](hosting.md#cleanup)), so the team's 40-deployment cap is not reached. The orchestrator checks the daily run's result (`gh run list --workflow clean-previews.yml`) and reports a failure to the owner. Netlify deletes preview deploys after 30 days (Free) or 90 days (paid plans); Convex also deletes preview backends after 5 days.
- **Staging.** Every merge to `main` updates staging at `https://main--<site>.netlify.app` and resets it to the seeded demo data and demo logins ([hosting, Staging reset](hosting.md#staging-reset)); owner-created data and sessions do not survive a merge. The deployer smoke-tests it and reports the URL. The owner reviews UI changes there and requests changes as new issues. A scheduled workflow (`staging-rebuild.yml`) also rebuilds it every 2 days, so its Convex deployment never expires in a week without merges, and a failed run opens the issue `Scheduled staging rebuild failed`. GitHub turns scheduled workflows off after 60 days without repository activity, so the orchestrator checks `gh workflow list --all` for `disabled_inactivity` whenever work resumes after a pause, and runs `gh workflow enable <file>` for each ([hosting, Scheduled staging rebuild](hosting.md#scheduled-staging-rebuild)).
- **Production.** The deployer opens a release PR from `main` into the `production` branch. The owner's merge approves and ships it: Netlify builds with the owner-held production key, then the deployer smoke-tests the production URL.
- **Rollback.** If the production smoke tests fail, the deployer opens a `type:bug` issue with the rollback steps, and the owner runs them: Netlify **Publish deploy** of the previous build, then merging a revert on `production` to redeploy the previous Convex functions.

## Who merges

The owner merges only:

- **Gate PRs** (`gate:technology`, `gate:production`), as in [Phase 3](#3-gates) and [Phase 8](#8-deploy).
- **Changes to secrets or security policy:** the secrets sections of [hosting.md](hosting.md) (Owner setup, Where secrets live), the Secrets and Approval gates sections of [AGENTS.md](../../AGENTS.md), and anything else that changes who holds a secret or who may approve what.

The owner may also tell the orchestrator in chat to merge one of these PRs; the orchestrator then merges it and comments the owner's words on it, quoted exactly, as the record of approval. Only the owner's own chat message counts; no agent's message is an approval.

Every other PR, including changes to this file, `.claude/`, the rest of `AGENTS.md`, other process docs, and design mockups, merges like any reviewed PR: the orchestrator merges it in [Phase 7](#7-merge) once it has `PASS` and `APPROVE` where those phases apply and `ci` is green. A PR that touches the owner-merge scope plus other files is owner-merged as a whole. Its author says so in the PR body (`Needs owner: merge`), and the orchestrator holds the PR for the owner.

## Reporting to the owner

The orchestrator reports **per milestone**, not per step. A milestone is a feature merged and live on staging (with its staging link), a release, or a set of issues that finished together. Between milestones it keeps working and does not report.

It reports **immediately**, outside that cadence, only when the owner must act:

- a gate PR waiting for approval, or a PR in the owner-merge scope;
- a `status:blocked` question, with the options and a recommendation;
- a budget or access problem only the owner can fix.

Each report follows [AGENTS.md, Writing on GitHub](../../AGENTS.md#writing-on-github): the outcome or ask first, one screen, one line per item, grouped as needs the owner, done, and in flight.

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

Local e2e runs (`npm run e2e`, `e2e:affected`, `e2e:screenshots`) also share one machine-wide lock, a file at `~/.cache/omni-league/e2e.lock` that holds the PID of the run in progress. A second run waits and prints that PID, a lock whose process is gone is taken over (a PID reused by another process keeps the lock held until that process ends), and CI (a truthy `CI`) and runs against `E2E_BASE_URL` skip it; nobody deletes the file by hand.

## Escalation

When a decision belongs to the owner (an ambiguous requirement, a gate, a loop that hits its cap), the agent moves the issue to `status:blocked`, comments the question with the options and a recommendation, and the orchestrator relays it to the owner in chat. Agents do not guess at product requirements.

## Changing this process

This file is the single source of truth for the cycle. Changes to it, to `.claude/`, and to the parts of `AGENTS.md` outside the owner-merge scope go through a normal PR, reviewed and merged like any other. The owner merges only the PRs listed in [Who merges](#who-merges).
