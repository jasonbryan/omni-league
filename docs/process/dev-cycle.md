# Development cycle

How work moves from a requirement to production. GitHub is the single record of state: every unit of work is an issue, every change is a PR, and labels say where each issue stands. Any agent can pick up work by reading GitHub alone.

In Claude Code, the main session orchestrates the cycle with the `/dev-cycle` skill and delegates each phase to a role agent in `.claude/agents/`. Other agents follow the same phases by hand.

## Roles

| Role | Agent | Owns |
| --- | --- | --- |
| Orchestrator | main session (`/dev-cycle`) | Picks the next issue, dispatches role agents, moves labels, merges non-gated PRs, reports to the owner |
| Planner | `planner` | Turns a requirement into sliced, testable issues; drafts ADRs for `gate:technology` |
| Plan reviewer | `plan-reviewer` | Challenges an issue before any code is written |
| Designer | `designer` | Builds the HTML mockup for `gate:ui-design` |
| Implementer | `implementer` | Writes code and tests on a branch, opens the PR |
| Tester | `tester` | Independently verifies the PR against the acceptance criteria |
| PR reviewer | `pr-reviewer` | Reviews the diff for correctness, security, and conventions |
| Deployer | `deployer` | Ships merged work to preview/production and verifies it |
| Owner | the human | Approves gates by merging gate PRs; answers blocked questions |

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
- Open a draft PR from `.github/pull_request_template.md` with `Closes #<issue>`, and move the issue to `status:in-review`.

**Done when:** all local checks are **green** (lint, typecheck, unit tests, Convex tests, build) and the draft PR is open.

### 5. Test

The tester checks out the PR branch in its own worktree and verifies it without trusting the implementer's claims:

- Every acceptance criterion maps to a passing test; missing tests are written and pushed to the branch.
- The full suite and e2e tests run; UI work gets screenshots at mobile and desktop widths compared with the approved mockup, plus an automated accessibility check.
- Edge cases: empty data, permissions (wrong user, wrong league), concurrent edits, and for payments, failed and duplicated webhooks.

Returns `PASS` or `FAIL` with reproduction steps. On `FAIL`, the implementer fixes it and the tester re-runs.

**Done when:** `PASS` is recorded as a PR comment, with the test evidence.

### 6. PR review

The PR reviewer reads the full diff against the issue and the conventions files, and returns `APPROVE` or `CHANGES` with file:line findings ranked by severity. Focus: correctness, Convex authorization and argument validation, Stripe safety, Angular conventions, test quality, and scope creep beyond the issue.

On `CHANGES`, the implementer fixes it, then the tester re-runs, then the reviewer re-reviews. Implement → test → review loops are capped at three rounds; after that the PR goes to `status:blocked` with a summary for the owner.

**Done when:** `APPROVE` is recorded as a PR review comment and CI is green.

### 7. Merge

The orchestrator marks the PR ready and squash-merges it when all of these hold: CI is green, tester `PASS` and reviewer `APPROVE` are on the latest commit, the PR has no `gate:*` label, and every gate on the linked issue is approved. The branch is deleted and the issue closes through `Closes #n`.

### 8. Deploy

The deployer runs after merges to `main`:

- **Preview/staging:** deploy, run smoke tests against it, report the URL on the issue.
- **Production:** behind `gate:production`. The deployer opens a release PR or deploy request listing the merged changes since the last release, any Convex schema migrations, and any Stripe configuration changes. After the owner approves, the deployer ships, runs smoke tests, and on failure rolls back and opens a `type:bug` issue.

Hosting and the CI/CD pipeline are not yet chosen; they come from the first `gate:technology` decisions. Until then, this phase stops at a green build on `main`.

## Parallel work

The orchestrator may run several issues at once when none of them blocks another. Issues that change the Convex schema (`convex/schema.ts`) or shared design tokens run one at a time to avoid conflicting migrations and merges. Each implementer gets its own worktree.

## Escalation

When a decision belongs to the owner (an ambiguous requirement, a gate, a loop that hits its cap), the agent moves the issue to `status:blocked`, comments the question with the options and a recommendation, and the orchestrator relays it to the owner in chat. Agents do not guess at product requirements.

## Changing this process

This file is the single source of truth for the cycle. Changes to it, to `AGENTS.md`, or to `.claude/agents/` go through a normal PR that the owner merges.
