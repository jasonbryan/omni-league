# Omni League

A league management web application for recreational sports, starting with beach volleyball, soccer, and softball. Product requirements: [docs/product/requirements.md](docs/product/requirements.md).

These rules apply to every coding agent working in this repository (Claude Code, Codex, Cursor, Copilot, Gemini, and others) and govern all output: chat replies, issues, commit messages, PR descriptions, code comments, and documentation.

## Voice

- Refer to yourself as "the system", never in the first person ("I", "me", "my", "we", "let me").
  - Wrong: "I updated the schema." Right: "The system updated the schema."
- Vocabulary: use the terms in [docs/glossary.md](docs/glossary.md) in code, issues, PRs, and UI text, and add any missing term there in the same PR.
- Respond with substance only. Praise of the user or any input (prompts, ideas, code, other agents' output) is off-limits: no "Great question", "Nice catch", "You're right", "Perfect". Disagreement and factual corrections are expected.

## Writing on GitHub

Issues, PR bodies, and comments from every agent follow this standard:

- The first line states the outcome or the ask: `Test: PASS`, `Review: CHANGES (1 blocking)`, `Merged`, `Needs owner: <question>`.
- Keep it to one screen, containing only what the reader needs to act or verify.
- Write plain, short sentences. Link to the issue, ADR, or earlier comment rather than restating it, and report results rather than the steps taken.
- Put evidence (command output, long tables, probe logs, reproduction scripts) in a collapsed `<details><summary>Evidence</summary>…</details>` block, or link to the run.
- Write each finding on one line as `path:line`: problem, then fix. List blocking findings first and label the rest `optional`.

## Approval gates

The project owner is the final approver for the gates below. Agents prepare the proposal, then stop and wait. Agents never merge, approve, or self-approve a gate PR on their own judgement. Only the owner approves, either by merging the gate PR or by telling the orchestrator in chat to merge it; in that case the orchestrator merges the PR and comments the owner's words on it, quoted exactly, as the record of approval.

| Gate              | Triggers                                                                                                                                | Proposal artifact                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `gate:technology` | Adding or replacing a framework, library, package (dependency or devDependency), external service, hosting provider, or build/test tool | ADR in `docs/decisions/` with status `Accepted`, opened as a PR (the open PR is the proposal; the merge is the acceptance) |
| `gate:production` | Any deploy to the production environment, and any change to Stripe live-mode configuration                                              | Release PR or deploy request issue listing the changes                                                                     |

Bumping the minor or patch version of an already-accepted package does not need a gate. Code built against an unapproved gate stays on its branch until the gate PR is merged.

New screens and visible UI changes need no gate (owner, 2026-10-10). Implementers build them against the design system: `src/styles/tokens.css`, `design/mockup-kit/`, [docs/conventions/angular.md](docs/conventions/angular.md), and the approved mockups in `design/mockups/`; where an approved mockup covers a screen, the UI matches it. The owner reviews the UI on staging after merge and requests changes as new issues.

## Development cycle

All work moves through plan → plan review → gates → implement → test → PR review → merge → deploy, tracked on GitHub issues and PRs. Read [docs/process/dev-cycle.md](docs/process/dev-cycle.md) before creating issues, branches, or PRs, changing labels, or merging.

## Technology

Accepted decisions live in `docs/decisions/` (ADRs). Use only accepted technology; anything else goes through `gate:technology`.

- **Frontend:** Angular, latest stable major, using its current APIs. Conventions: [docs/conventions/angular.md](docs/conventions/angular.md).
- **Backend:** Convex. Conventions: [docs/conventions/convex.md](docs/conventions/convex.md).
- **Payments:** Stripe. Conventions: [docs/conventions/stripe.md](docs/conventions/stripe.md).
- **UX (task flows and UI):** Conventions: [docs/conventions/ux.md](docs/conventions/ux.md).
- **Source control, issues, PRs:** GitHub, via the `gh` CLI.

Read the matching conventions file before writing or reviewing code in that layer, and `docs/conventions/ux.md` as well for any change to a screen or task flow.

## Code comments

- Names, types, small functions, and named constants say what the code does. Where a comment would explain what, rename, extract a function, or name a constant instead.
- A comment only gives a why the code cannot express: an external constraint, a workaround for a library or platform bug (a link to the upstream bug is allowed), or a security reason. One line where possible.
- History, the reason for a change, and references to this repo's issues, PRs, ADRs, reviews, or agent roles go in commits, PRs, and ADRs.
- Future work lives in an issue, not in code. Remove an existing pointer once an open issue names that code; if none does, open one first.
- Test titles describe behaviour and carry no issue numbers.
- Comments a tool reads stay, without tracker references: `eslint-disable*`, `@ts-expect-error`, `prettier-ignore`, `// @ts-check`, `/// <reference types>`, JSDoc type tags in `.js`/`.mjs` (`@type`, `@param {T}`, `@returns {T}`, `@typedef`), and the `# vX.Y.Z` after a pinned action ([ADR 0009](docs/decisions/0009-ci-pipeline.md)). Notes on vendored code keep their why.

## Secrets

Agents use Stripe test-mode keys and Convex dev/preview deployments only. Live keys, production environment variables, and production dashboards are handled by the owner. Secrets never go into the repo, issues, PRs, or logs.
