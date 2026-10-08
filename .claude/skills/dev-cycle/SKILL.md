---
name: dev-cycle
description: Runs the Omni League development cycle by dispatching role agents. Use when the owner asks to build a feature, fix a bug, plan a requirement, work an issue, continue the backlog, or deploy.
---

The main session is the **orchestrator**. It dispatches the role agents in `.claude/agents/`, moves issue labels, merges non-gated PRs (gate PRs only on the owner's chat instruction), and reports to the owner. It does not plan, design, write feature code, test, or review itself; each of those goes to its role agent, so every phase gets a fresh, independent context.

Read `docs/process/dev-cycle.md` first. It defines the phases, the done-criteria, the labels, and the loop caps used below.

## Steps

1. **Sync.** `git fetch` and fast-forward `main`. List open issues with their labels (`gh issue list --state open --json number,title,labels`) and open PRs (`gh pr list --json number,title,labels,headRefName`). Check which gate PRs the owner has merged since the last run, and move their issues to `status:ready`.

2. **Choose work.** If the owner gave a new requirement, start at step 3. If the owner named an issue, work that issue. Otherwise pick the **frontier**: `status:ready` issues with no open `Blocked by` issue, oldest first. Run independent frontier issues in parallel, but only one issue at a time that touches `convex/schema.ts` or shared design tokens.

3. **Plan.** Dispatch `planner` with the requirement. Then, for each new issue, dispatch `plan-reviewer`. On `CHANGES`, send the edits back to `planner`; after two rounds without `APPROVE`, label `status:blocked` and add the issue to the owner report.

4. **Gates.** For an approved issue with gate labels, set `status:needs-approval` and dispatch the authoring agent: `planner` for an ADR (`gate:technology`), `designer` for a mockup (`gate:ui-design`). The issue now waits for the owner; move on to other work. With no gates, set `status:ready`.

5. **Implement.** Set `status:in-progress` and dispatch `implementer` with `isolation: "worktree"`, passing the issue number. If it reports a need for new technology, send the issue back to step 4.

6. **Test, then review.** Dispatch `tester` with the PR number. On `FAIL`, dispatch `implementer` to fix, then `tester` again. On `PASS`, dispatch `pr-reviewer`. On `CHANGES`, run `implementer` → `tester` → `pr-reviewer` again. After three rounds, label `status:blocked` and report.

7. **Merge.** When the merge conditions in Phase 7 of the process doc all hold, follow its five steps, one PR at a time: update the branch from `main` while still draft; `gh pr ready <n>`; `gh pr checks <n> --watch` until `ci` passes; `gh pr merge <n> --squash --delete-branch --match-head-commit <sha>`. If `ci` fails, run `gh pr ready <n> --undo` and send it back to `implementer`. Until #12 adds `ci`, merge on `PASS` and `APPROVE` with a merge note. The orchestrator never merges a PR carrying any `gate:*` label unless the owner told it in chat to merge that specific PR; it then comments the owner's words on the PR, quoted exactly, before merging.

8. **Deploy.** After merges, dispatch `deployer` for preview/staging. Production goes through the deployer's `gate:production` release request.

9. **Report.** Finish with a short owner report:
   - **Needs the owner:** gate PRs awaiting approval (with links) and `status:blocked` questions, each with the recommended answer.
   - **Done:** merged PRs and deployments.
   - **In flight:** issues still moving, and their phase.

**Done when** every issue picked in step 2 is merged, waiting on the owner, or blocked with a question in the report.

## Dispatching

Give each role agent the issue or PR number, the phase, and any feedback it must act on. Agents read GitHub themselves, so pass references, not copies of the issue. Agent reports are not shown to the owner; relay what matters in step 9.

### Model and effort

Each agent's frontmatter sets its default `model` and `effort` (table in [dev cycle, Roles](../../../docs/process/dev-cycle.md#model-and-effort)). The owner authorizes the orchestrator to override them per dispatch with the Agent tool's `model` and `effort` parameters, by these rules:

- **Mechanical or docs-only tasks** (label edits, applying a reviewer's exact wording, glossary entries): `sonnet` or `haiku`, `low` or `medium`.
- **Complex implementation or testing** (concurrency, SSR/hydration, cross-cutting infra): `implementer` and `tester` escalate to `opus`, `high`.
- **Security, payments, auth, and server-rendering work:** at least `opus`, `high`, in every role; the hardest of these may use `fable`, `xhigh`.
- **Escalation round:** the final fix round or final review round after earlier rounds found defects uses `fable`, `xhigh`. `fable`/`xhigh` is for escalations only: this final round, and the hardest security, payments, auth, and SSR tasks. `opus` stays the heavy default.

When several rules match, use the highest model and the highest effort among them (model order `haiku` < `sonnet` < `opus` < `fable`; effort order `low` < `medium` < `high` < `xhigh` < `max`). Every phase comment the orchestrator posts records the model and effort used, for example `(model: opus, effort: high)`.
