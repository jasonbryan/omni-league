# Glossary

The shared vocabulary for Omni League: the product's domain terms and the terms of the development process. It is an index, not a second copy of the rules. Each entry is one or two sentences and links the document that defines it.

- **Use these terms exactly** in code, issues, PRs, and UI copy. Do not coin a synonym for a term listed here.
- **If a needed term is missing,** add it here in the same PR that first uses it.
- **The linked documents win on conflict.** If an entry disagrees with its source, the source is right and the entry is fixed.

Entries marked **Working definition — not yet specified by the owner** describe how a word is used today, not a decided requirement. Open questions about them are listed at the end; [docs/product/requirements.md](product/requirements.md) remains the source of truth for product behaviour.

## Product (domain) terms

- **Account:** the sign-in identity of a user. Only adults hold accounts at launch, and they sign in with email + password or Google. Source: [requirements, Constraints](product/requirements.md#constraints), [ADR 0008](decisions/0008-auth-provider.md).
- **Email verification:** confirming that a user owns the email address on a password account, by a link or code sent to it. Required before the first production release. Source: [requirements, Constraints](product/requirements.md#constraints), [ADR 0011](decisions/0011-transactional-email.md).
- **Game:** **Working definition — not yet specified by the owner.** A single scheduled contest in a league; players "follow their games". Source: [requirements, Product](product/requirements.md#product).
- **Guardian:** the adult who manages a minor's roster entry (an organizer can also manage it). ADR 0008's illustrative data model links the entry to the guardian's user id; the role is not otherwise specified. Source: [requirements, Constraints](product/requirements.md#constraints), [ADR 0008](decisions/0008-auth-provider.md).
- **League:** a sports league that belongs to one organization and is held at its locations. Organizers set up its teams, schedule, and payments; users register for it from its public page. Source: [requirements](product/requirements.md#organizations-and-public-registration).
- **Location:** a place where an organization's leagues are held. An organization can have several, and each has a public page. Source: [requirements](product/requirements.md#organizations-and-public-registration), [ADR 0006](decisions/0006-angular-app-baseline.md).
- **Minor:** a person below adult age. Minors hold no account at launch and appear only as roster entries managed by a guardian or organizer. Source: [requirements, Constraints](product/requirements.md#constraints), [ADR 0008](decisions/0008-auth-provider.md).
- **Organization:** the body that leagues belong to. It can have multiple locations, and visitors view its leagues on public pages. Source: [requirements](product/requirements.md#organizations-and-public-registration).
- **Organizer:** a person who sets up leagues, teams, schedules, and payments, and who may manage minors' roster entries. How an organizer relates to an organization is not specified (see open questions). Source: [requirements](product/requirements.md#product).
- **Password reset:** letting a user set a new password through a link or code sent by email. Required before the first production release. Source: [requirements, Constraints](product/requirements.md#constraints), [ADR 0011](decisions/0011-transactional-email.md).
- **Payment:** **Working definition — not yet specified by the owner.** Money players pay ("players register, pay"), set up by organizers and processed through Stripe; what is charged, and to whom it is paid out, is not specified. Source: [requirements, Product](product/requirements.md#product), [Stripe conventions](conventions/stripe.md).
- **Player:** a person who registers for a league, pays, and follows their games. Whether a player is always a user, or can be a roster entry without an account, is open. Source: [requirements, Product](product/requirements.md#product).
- **Public page:** a page anyone can view without signing in: the organization, location, league, and league registration pages. Public pages are indexed by search engines and show link previews when shared. Source: [requirements](product/requirements.md#organizations-and-public-registration), [ADR 0006](decisions/0006-angular-app-baseline.md).
- **Registration (register):** **Working definition — not yet specified by the owner.** A user signing up for an organization's league from its public page. Whether a registration is for one person or a whole team is not specified. Source: [requirements](product/requirements.md#organizations-and-public-registration).
- **Roster entry:** a person listed as taking part, for example on a team; minors exist only as roster entries. **Roster** itself is a **Working definition — not yet specified by the owner.** Source: [requirements, Constraints](product/requirements.md#constraints), [ADR 0008](decisions/0008-auth-provider.md).
- **Schedule:** **Working definition — not yet specified by the owner.** The planned games of a league, set up by organizers; Convex conventions cite "a published schedule" as an example of deliberately public data. Source: [requirements, Product](product/requirements.md#product), [Convex conventions](conventions/convex.md#functions).
- **Sign-in:** authenticating with email + password or Google, the two methods at launch. Email one-time codes are dropped for now. Source: [requirements, Constraints](product/requirements.md#constraints), [ADR 0008](decisions/0008-auth-provider.md).
- **Sport:** the game a league plays. Beach volleyball, soccer, and softball at launch, with more to be added. Source: [requirements, Sports](product/requirements.md#sports-initial).
- **Sport-specific rules (sport configuration):** the rules that differ by sport, such as scoring, team size, and standings, configurable per sport so new sports need no restructuring. Source: [requirements, Sports](product/requirements.md#sports-initial).
- **Standings:** **Working definition — not yet specified by the owner.** The ranking of teams in a league, calculated by the sport's standings rules. Source: [requirements, Sports](product/requirements.md#sports-initial).
- **Team:** **Working definition — not yet specified by the owner.** A group of players in a league, set up by organizers; its size is a sport-specific rule. Source: [requirements](product/requirements.md#product).
- **User:** a person with an account. Users register for leagues; in the backend the app's `users` record is keyed on the auth provider's user id. Source: [requirements](product/requirements.md#organizations-and-public-registration), [ADR 0008](decisions/0008-auth-provider.md).
- **Visitor:** anyone viewing a public page. A visitor goes from a public registration page to sign-in and back. Source: [requirements](product/requirements.md#organizations-and-public-registration), [ADR 0008](decisions/0008-auth-provider.md).

## Process terms

- **Acceptance criteria:** the checkable Given/When/Then statements on an issue. Each one must be provable by a test or a screenshot. See [dev cycle, Plan](process/dev-cycle.md#1-plan) and [feature template](../.github/ISSUE_TEMPLATE/feature.yml).
- **Accepted technology:** a framework, package, service, or tool named in an Accepted ADR on `main`. Anything else needs `gate:technology`; minor and patch bumps of accepted packages do not. See [AGENTS.md, Approval gates](../AGENTS.md#approval-gates).
- **ADR (architecture decision record):** a numbered file in `docs/decisions/`, written from [the template](decisions/0000-template.md), that records a `gate:technology` decision with at least two options. See [dev cycle, Gates](process/dev-cycle.md#3-gates).
  - **Accepted:** the status the planner writes in the gate PR. It takes effect when the owner merges the PR.
  - **Proposed:** not a status written in the file. A decision is a proposal while its PR is open and unmerged; a rejected proposal is closed unmerged and never reaches `main`.
  - **Superseded by NNNN:** the status edited onto an Accepted ADR on `main` when a later ADR replaces it.
- **Anonymous local Convex backend:** the Convex backend run on the developer's machine with `CONVEX_AGENT_MODE=anonymous npx convex dev`, with no Convex account; used for development and e2e. See [README](../README.md#run-the-convex-backend) and [ADR 0005](decisions/0005-e2e-and-accessibility-testing.md).
- **`AUTH_EMAIL_DISABLED`:** the Convex environment variable that, when `true`, turns off verification and reset email on developer dev and preview deployments. Unset means fully on; it must never be set on production. See [ADR 0011](decisions/0011-transactional-email.md).
- **Blocked by:** a `Blocked by: #n` line in an issue naming a dependency; the issue is not picked up while `#n` is open. See [dev cycle, Plan](process/dev-cycle.md#1-plan).
- **Chat approval:** the owner telling the orchestrator in chat to merge a specific gate PR. The orchestrator merges it and comments the owner's words, quoted exactly; this is the only case in which an agent merges a gate PR. See [dev cycle, Gates](process/dev-cycle.md#3-gates).
- **Client route:** a route rendered only in the browser (`RenderMode.Client`); the signed-in app under `/app/**`. See [Angular conventions, Rendering](conventions/angular.md#rendering).
- **Conventional Commits:** the commit-message format `type(scope): summary`, for example `feat(roster): add player to team`. See [dev cycle, Implement](process/dev-cycle.md#4-implement).
- **Conventions files:** the per-layer coding rules in `docs/conventions/` ([Angular](conventions/angular.md), [Convex](conventions/convex.md), [Stripe](conventions/stripe.md)), read before writing or reviewing code in that layer. See [AGENTS.md, Technology](../AGENTS.md#technology).
- **Convex adapter:** the in-repo, signal-based wrapper around the `convex` client through which Angular services read and write Convex data; components never call the Convex client directly. See [ADR 0006](decisions/0006-angular-app-baseline.md).
- **Convex tests:** tests of Convex functions run with `convex-test` on Vitest (`npm run test:convex`). Every public function covers the happy path, an unauthenticated caller, and a caller from another league or team. See [ADR 0004](decisions/0004-unit-and-convex-test-runners.md) and [Convex conventions, Tests](conventions/convex.md#tests).
- **Deploy request / release PR:** the `gate:production` proposal listing the changes, schema migrations, and Stripe configuration changes since the last release. See [dev cycle, Deploy](process/dev-cycle.md#8-deploy).
- **Deployment (Convex):** one Convex backend instance. The kinds are the local e2e backend, a developer dev deployment (one per developer or agent), a per-PR preview, and production. See [ADR 0008](decisions/0008-auth-provider.md) and [ADR 0011](decisions/0011-transactional-email.md).
- **Design tokens:** the shared CSS custom properties (colours, radius, font) in `src/styles/tokens.css` per ADR 0007, whose values are approved through `gate:ui-design`. Changes to them run one issue at a time. See [ADR 0007](decisions/0007-ui-library-and-styling.md) and [dev cycle, Parallel work](process/dev-cycle.md#parallel-work).
- **Draft PR:** the implementer's PR while it is being tested and reviewed. The orchestrator marks it ready only when the merge conditions hold. See [dev cycle, Implement](process/dev-cycle.md#4-implement) and [Merge](process/dev-cycle.md#7-merge).
- **E2E tests:** Playwright tests of user flows in a real browser against the anonymous local Convex backend, with an axe accessibility scan. See [ADR 0005](decisions/0005-e2e-and-accessibility-testing.md).
- **Escalation:** moving an issue to `status:blocked` with the question, the options, and a recommendation, for the orchestrator to relay to the owner. See [dev cycle, Escalation](process/dev-cycle.md#escalation).
- **First production release:** the first deploy to production. The domain must be bought and email verification and password reset added before it. See [requirements, Constraints](product/requirements.md#constraints).
- **Frontier:** the `status:ready` issues with no open `Blocked by` issue, worked oldest first. See [dev-cycle skill](../.claude/skills/dev-cycle/SKILL.md).
- **Gate:** an approval only the owner gives before work proceeds. Each is a label applied to the issue that needs it and to its gate PR. See [AGENTS.md, Approval gates](../AGENTS.md#approval-gates).
  - **`gate:production`:** any production deploy and any Stripe live-mode configuration change.
  - **`gate:technology`:** adding or replacing a framework, library, package, external service, hosting provider, or build or test tool; the proposal is an ADR.
  - **`gate:ui-design`:** any new screen or visible change to layout, navigation, or visual style; the proposal is a mockup.
- **Gate PR:** the PR that carries a gate's proposal (ADR, mockup, or release) and its `gate:*` label. Agents never merge it on their own judgement; the owner's merge, or chat approval, is the approval. See [dev cycle, Gates](process/dev-cycle.md#3-gates).
- **Green:** every local check named in [dev cycle, Implement](process/dev-cycle.md#4-implement) (Phase 4) passes. That list is the source of truth; PR #35 (pending) proposes adding `format` to it, so this entry does not repeat it. CI passing on the PR is a separate condition; see **Merge conditions**.
- **Hybrid rendering:** the Angular app's per-route choice of Server, Prerender, or Client rendering. See [ADR 0006](decisions/0006-angular-app-baseline.md) and [Angular conventions, Rendering](conventions/angular.md#rendering).
- **Hydration:** the browser taking over server-rendered HTML without re-rendering it. See [Angular conventions, Rendering](conventions/angular.md#rendering).
- **Internal function:** a Convex `internalQuery`, `internalMutation`, or `internalAction`, callable only from the backend; a **public function** is callable by clients and must validate and authorize. See [Convex conventions](conventions/convex.md#functions).
- **`IS_TEST`:** the Convex environment variable set to `true` only on the local e2e backend. It enables the test-only functions in `convex/testing.ts` and must never reach a cloud deployment. See [ADR 0005](decisions/0005-e2e-and-accessibility-testing.md).
- **Labels:** the issue and PR labels in four families: `status:`, `type:`, `gate:`, and `area:`. See [dev cycle, Labels](process/dev-cycle.md#labels).
  - **Area labels:** `area:frontend`, `area:backend`, `area:payments`, `area:infra`, naming the layers a change touches.
  - **Type labels:** `type:feature`, `type:bug`, `type:chore` (no user-visible behaviour), `type:decision` (ADR), `type:design` (mockup).
- **Loop cap (round):** one round is one pass of revise-and-recheck. Plan review is capped at two rounds and implement → test → review at three; on reaching the cap the issue goes to `status:blocked`. See [dev cycle, Plan review](process/dev-cycle.md#2-plan-review) and [PR review](process/dev-cycle.md#6-pr-review).
- **Merge conditions:** CI green, tester `PASS` and reviewer `APPROVE` on the latest commit, no `gate:*` label on the PR, and every gate on the issue approved; then the orchestrator squash-merges. See [dev cycle, Merge](process/dev-cycle.md#7-merge).
- **Migration plan:** the PR description section explaining how a change affecting existing Convex data is applied. Schema changes run one PR at a time. See [Convex conventions, Data](conventions/convex.md#data).
- **Mockup:** the self-contained static HTML page in `design/mockups/` that proposes a screen for `gate:ui-design`, showing every state at mobile and desktop widths. See [designer](../.claude/agents/designer.md).
- **Owner:** the human project owner. The owner approves gates, answers blocked questions, sets product requirements, and holds production secrets. See [AGENTS.md](../AGENTS.md#approval-gates) and [dev cycle, Roles](process/dev-cycle.md#roles).
- **Owner report:** the orchestrator's end-of-run summary: what needs the owner, what is done, and what is in flight. See [dev-cycle skill](../.claude/skills/dev-cycle/SKILL.md).
- **Prerender route:** a route rendered to static HTML at build time (`RenderMode.Prerender`); it must not read Convex data. See [Angular conventions, Rendering](conventions/angular.md#rendering).
- **Preview deployment:** the per-PR deployment of the app with its own Convex backend. See [requirements, Constraints](product/requirements.md#constraints) and [dev cycle, Deploy](process/dev-cycle.md#8-deploy).
- **Production:** the live environment used by real users. Every deploy to it, and its secrets, belong to the owner through `gate:production`. See [AGENTS.md, Secrets](../AGENTS.md#secrets).
- **Requirement:** a statement of what the product must do, from the owner and recorded in [docs/product/requirements.md](product/requirements.md). Agents do not invent requirements. See [dev cycle, Escalation](process/dev-cycle.md#escalation).
- **Role agents:** the subagents in `.claude/agents/`, each owning one phase. See [dev cycle, Roles](process/dev-cycle.md#roles).
  - **Deployer:** ships merged work to preview or production and verifies it with smoke tests ([deployer](../.claude/agents/deployer.md)).
  - **Designer:** builds the mockup for `gate:ui-design` ([designer](../.claude/agents/designer.md)).
  - **Implementer:** writes the tests and code on a branch and opens the draft PR ([implementer](../.claude/agents/implementer.md)).
  - **Orchestrator:** the main session running `/dev-cycle`. It dispatches role agents, moves labels, and merges non-gated PRs, but does no role's work itself ([dev-cycle skill](../.claude/skills/dev-cycle/SKILL.md)).
  - **Plan reviewer:** challenges an issue before code is written and returns `Plan review: APPROVE` or `Plan review: CHANGES` ([plan-reviewer](../.claude/agents/plan-reviewer.md)).
  - **Planner:** turns a requirement into slice issues and writes ADRs ([planner](../.claude/agents/planner.md)).
  - **PR reviewer:** reviews the diff and returns `Review: APPROVE` or `Review: CHANGES` as a comment ([pr-reviewer](../.claude/agents/pr-reviewer.md)).
  - **Tester:** verifies the PR independently against the acceptance criteria and returns `Test: PASS` or `Test: FAIL` ([tester](../.claude/agents/tester.md)).
- **Server route:** a route rendered on the server at request time (`RenderMode.Server`): public pages that read Convex data, and the not-found page. Server renders are anonymous only. See [Angular conventions, Rendering](conventions/angular.md#rendering).
- **Signed-in app:** everything under `/app/**`, rendered as Client routes. See [Angular conventions, Rendering](conventions/angular.md#rendering).
- **Slice:** one issue covering one user-visible behaviour end to end through Convex and Angular, small enough for one PR (aim under about 400 changed lines). Infrastructure work with no user-visible behaviour is a `type:chore` slice. See [dev cycle, Plan](process/dev-cycle.md#1-plan).
- **Smoke tests:** the short checks the deployer runs against a deployed URL to confirm it works. See [deployer](../.claude/agents/deployer.md).
- **Staging:** named beside preview in the dev cycle's Deploy phase; no Accepted ADR defines a separate staging environment yet. See [dev cycle, Deploy](process/dev-cycle.md#8-deploy).
- **Status labels:** each open issue carries exactly one, and only the orchestrator changes it. See [dev cycle, Issue state machine](process/dev-cycle.md#issue-state-machine).
  - **`status:blocked`:** waiting on an owner answer; the issue returns to its previous status once answered.
  - **`status:in-progress`:** the implementer is working on it.
  - **`status:in-review`:** the draft PR is open and in test and PR review.
  - **`status:needs-approval`:** plan approved; waiting for the owner to merge its gate PRs.
  - **`status:plan-review`:** written and waiting for the plan reviewer.
  - **`status:planning`:** the planner is still writing it.
  - **`status:ready`:** approved, with every gate merged; it can be implemented once nothing in `Blocked by` is open.
- **System (the system):** how every agent refers to itself in all output, never "I" or "we". See [AGENTS.md, Voice](../AGENTS.md#voice).
- **Tenant (tenancy):** **Working definition — not yet specified by the owner.** A seeded group of data (a league, its teams, and users) used as the isolation boundary in tests: each e2e test seeds its own tenant and asserts only on its data. Whether the organization is the access boundary for organizers is open (question 8). See [ADR 0005](decisions/0005-e2e-and-accessibility-testing.md).
- **Test plan:** the issue section naming the unit, Convex, and e2e tests that prove each acceptance criterion. See [dev cycle, Plan](process/dev-cycle.md#1-plan).
- **Unit tests:** Angular component and service tests run with Vitest through `ng test` (`npm test`). See [ADR 0004](decisions/0004-unit-and-convex-test-runners.md).
- **Worktree:** an isolated git checkout per agent and branch, so parallel work does not collide; branches are named `<type>/<issue>-<slug>`. See [dev cycle, Implement](process/dev-cycle.md#4-implement).

## Open questions for the owner

Ambiguities found while writing this glossary. They are recorded, not resolved; answers go into [docs/product/requirements.md](product/requirements.md) and then into the entries above.

1. **Organizer and organization.** Is an organizer a member or administrator of one organization, or can one organizer run leagues for several? Are there other organization roles (for example an organization admin distinct from a league organizer)?
2. **Player and user.** Is every player a user with an account, or can a player be a roster entry without one (as minors are)? Can one user be a player in several leagues?
3. **Guardian.** Is a guardian a user with an account who manages minors' roster entries, and can a guardian also be a player?
4. **Registration unit.** Does a user register as an individual, register a whole team, or join an existing team?
5. **Season.** The word does not appear in the requirements or ADRs. Does a league represent one season, or does a league run repeated seasons?
6. **Game, schedule, and standings.** What a game records (teams, location, time, score), who publishes a schedule, and how standings rank teams per sport are all unspecified.
7. **Payment.** What is charged (for example a per-player or per-team registration fee), and whether money goes to the organization or the platform, is unspecified.
8. **Tenancy boundary.** Convex conventions check access per league and team, and e2e seeds a league as the tenant. Is the organization the access boundary for organizers?
9. **Staging.** The dev cycle names "preview/staging". Is staging an environment distinct from per-PR previews, or another word for them?
