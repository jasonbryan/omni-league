# Product requirements

Source of truth for what the product must do. The planner turns these into GitHub issues; update this file when the owner adds or changes a requirement.

## Product

A web application for running sports leagues. Organizers set up leagues, teams, schedules, and payments; players register, pay, and follow their games.

## Sports (initial)

- Beach volleyball
- Soccer
- Softball

Sport-specific rules (scoring, team size, standings) must be configurable per sport so more sports can be added without restructuring.

## Organizations and public registration

Leagues belong to an organization.

- Public pages are needed at launch: visitors can view an organization's leagues on public pages, and users can register for those leagues from them (owner's words, [relayed on #5](https://github.com/jasonbryan/omni-league/issues/5#issuecomment-6049202887): "users will need to be able to register to organizations leagues").
- Public pages should be indexed by search engines and show link previews when shared (owner follow-up answer, [relayed on #5](https://github.com/jasonbryan/omni-league/issues/5#issuecomment-6049202887)).
- An organization can have multiple locations where its leagues are held (owner answer on #5).
- **Draft, then publish.** Leagues and seasons stay off public pages until an organizer publishes them (owner answer, 2026-10-09, chat: "Yes, draft then publish"). Until then they are drafts, which the organization's staff see in the signed-in app.

## Organizations and staff

Owner answers, 2026-10-09 (chat).

- An organization has two staff roles:
  - **Org admins** manage everything in the organization and invite people.
  - **League organizers** run the specific leagues they are assigned to.
- One person can belong to several organizations, with a role in each.
- **Any signed-in user may create an organization** and becomes its first org admin (owner answer, 2026-10-09, chat: "Any signed-in user").
- **The organization is the access boundary for staff.** Staff see and change only their own organization's data. A league organizer is further limited to their assigned leagues.

## Accounts, players, and guardians

Owner answers, 2026-10-09 (chat), as corrected the same day: "I would like a correction, invites dont require accounts but to actually sign up you need an account."

- **Invites need no account.** A captain or organizer can invite anyone by email, whether or not that person has an account.
- **Joining needs an account.** To accept an invite, join a team, or register, the person signs up for an account (or signs in). Adult rostered players therefore always have accounts.
- **A pending invite is not a roster entry.** The invited person is on the roster only after accepting.
- **Minors** are always roster entries under a guardian, with no account.
- **Guardian** (owner, chat, 2026-10-10: "As proposed", answering [#139](https://github.com/jasonbryan/omni-league/issues/139#issuecomment-6098208263)): an adult account holder who adds and manages a minor's roster entry and may also play.
  - A captain invites the guardian's email; on accepting, the guardian joins the roster, adds a minor, or both.
  - Only the minor's display name is stored.
  - Opponents see a minor's first name and last initial.

## Seasons

A league runs repeated **seasons** (owner answer, 2026-10-09). Registration, teams, the schedule, standings, and fees belong to a season.

Owner answers, 2026-10-10 (chat):

- **Registration deadline** ("Organizer sets a date"): each season has a registration deadline set by an organizer. Registration also closes when the season starts.
- **Limits:** a season can have a maximum number of teams and a maximum roster size, which is at or above the sport format's minimum roster size.
- **Waitlist:** when a season is full, new teams go on its waitlist, and an organizer promotes teams from it.
- **One team per season** ("No" to playing on two teams): a person is on at most one team in a season, and a rostered player cannot also be a free agent in that season.

Owner decision, 2026-10-27 (chat, "Sounds good", accepting option A of leagues vs seasons):

- **League → Season stays,** as in TeamSnap. The league is the lasting thing players know by name, such as Sunday Coed 4s. A season is **one run of the league**, such as Fall 2027, with its own dates, registration, teams, schedule, and standings. The wording on every screen says so (#324).
- **Public pages lead with what's open now:** the season with registration open and the way to register come first, as in "Sunday Coed 4s · Fall 2027 · Registration open · Register" (#245, #246, #325).
- **Registration stays part of each season:** team registration, joining a team, and free agent registration (see Registration), at the season's team and player prices (#288).

## Registration

Three ways to take part, all needed (owner answer, 2026-10-09):

1. **Team registration:** a captain registers a whole team.
2. **Free agent:** an individual registers alone, and an organizer places them on a team.
3. **Join a team:** a person joins an existing team, for example through an invite.

Every way ends with the person signed in to an account (see Accounts).

## Schedule, scores, and standings

Owner answers, 2026-10-09 (chat):

- Organizers build and publish the schedule.
- Captains report scores. Organizers can confirm or correct them.
- Standings rules per sport are not specified by the owner. The defaults below are a **proposal for the owner to confirm**; they are not decided.

| Sport            | Ranking (proposed)                              | Tiebreakers, in order (proposed)                                         | Forfeit (proposed) |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------ | ------------------ |
| Beach volleyball | Match win percentage                            | Head-to-head, set win percentage, point differential                     | Straight-sets loss |
| Soccer           | Points: 3 for a win, 1 for a draw, 0 for a loss | Goal difference, goals scored, head-to-head                              | 3–0 loss           |
| Softball         | Win percentage (a tie counts as half a win)     | Head-to-head, run differential capped at 7 per game, fewest runs allowed | 7–0 loss           |

Results keep **per-player stat lines**, not only team scores, so that the planned Player Pro tier (see Future) can be added without restructuring.

## Payments

Owner answers, 2026-10-09 (chat):

- Each organization connects its own Stripe account (**Stripe Connect**). Players pay the organization.
- The platform takes an **application fee** on those payments.

### Application fee cannot be avoided

Owner's words: "I know of some systems and orgs that will try to cheat the system by having only one person sign up to reduce my cut (application cut). I want to prevent that, so what ever method would prevent that then do that."

**Requirement:** the application fee cannot be avoided by under-registering players.

**Fee amount: greater of a percentage or a per-player floor.** The owner asked on [PR #74](https://github.com/jasonbryan/omni-league/pull/74#issuecomment-6085088864) whether an organization could still claim one player when two or more play. Owner decision, 2026-10-09 (chat): "Hybrid: % of payment, per-player floor".

- The application fee on each registration payment is the **greater of** a percentage of that payment and a **per-player floor** for every roster entry the payment pays for.
- Where no payment carries the fee (free seasons, offline payments), the floor still applies to every roster entry (see below).
- The percentage depends on the money paid, not on how many players are listed, so listing fewer players does not lower it.

**Mechanism** (owner answer, 2026-10-09, chat: "Confirm as proposed"; kept with the hybrid decision):

1. **Per rostered player.** The per-player floor is assessed for every roster entry in a season, whatever the organization's pricing (team fee, per-player fee, or a split). A pending invite is not charged; the floor applies once the invite is accepted.
2. **Everyone who plays is rostered.** Only rostered players can appear in score reports and stat lines.
3. **Minimum roster size per sport format,** set in the sport configuration: the number of players on the field (beach volleyball 2, 4, or 6; soccer 5, 7, or 11; softball 10). An organization may raise it but not lower it. It must be met by rostered players (accepted adults and guardian-managed minors), not by pending invites.
4. **A team is confirmed only when** its roster meets the minimum and the fee for every roster entry is paid. A team payment's floor counts the larger of the roster size and the minimum.
5. **Late additions pay.** A player added after the team has paid is not active (cannot appear in score reports) until the fee for that roster entry is paid.
6. **Rosters are visible to opponents.** The teams in a season can see each other's rosters, so a player who is not listed is noticed.

**Trade-offs:** captains must collect accepts before the team is confirmed; late additions add a checkout step; small fees on a late addition may cost the organization a Stripe processing fee.

### Free seasons and offline payments

Owner answer, 2026-10-09 (chat): "Yes, org is invoiced."

- The per-player floor applies to every roster entry in a free (zero-price) season.
- An organizer may mark a roster entry as paid outside the platform (an **offline payment**). The fee still applies to that roster entry.
- When no player payment carries the fee, the platform bills the organization's connected account for it.

**Residual gap:** the platform cannot see who turns up in person or money paid outside the platform. An organization that both lists fewer players than play and takes their money outside the platform still pays less. The minimum roster size, rostered-only scores and stat lines, and visible rosters limit this. Beyond that it is a terms-of-service matter for the owner.

How the fee is collected and calculated (Connect account type, charge type, the greater-of calculation, and how the organization's connected account is billed when no player payment carries the fee) is decided in [ADR 0012](../decisions/0012-stripe-connect.md) (#57).

## Installable app (PWA)

Owner's words, 2026-10-09 (chat): "I would like to add that the app should be a PWA as well, so i don't have to create a separate mobile application".

The web app is also a progressive web app (**PWA**), so no separate mobile app is built. The owner chose this launch scope the same day (chat):

- **Installable.** Users can install the app to the home screen on iPhone, Android, and desktop. It has its own icon and opens in its own window, without the browser's address bar (standalone display).
- **Works on a weak signal.** The app shell and recently viewed public pages, such as schedules and standings, load offline or on poor field wifi, with a clear note that the user is offline. Changes, such as registering or reporting a score, need a connection.
- **Push notifications:** game reminders, schedule changes, and score updates. On iPhone and iPad they work only after the app is installed to the Home Screen (an Apple limit).
- **Not chosen: offline score entry.** A score cannot be entered offline to be sent later.

Who receives each notification, when reminders are sent, and whether users choose per kind are open (#85). The technology is decided in the `gate:technology` proposal for #79.

## Program types (proposal)

Owner's words, 2026-10-27 (chat): "Sounds good but I also want to be able to support types of programs, like leagues, tournements, camps, and training".

**Requirement:** an organization can offer other types of program besides leagues: tournaments, camps, and training. The model below is the system's **proposal**, not yet decided. Its open questions are on #323, and no slice is planned until the owner answers them.

### Model

- A **program** is something an organization offers for registration. It has one **program type**: league, tournament, camp, or training.
- **Today's league is the league type.** A program record sits above each league, one to one. Leagues keep their slugs, URLs (`/organizations/<org>/leagues/<league>`), seasons, and data, so nothing built so far changes.
- Each program has a name, a slug unique within the organization across all types, a sport, a division where the type uses one, its locations, and draft or published status. The type-specific part hangs off it: a league's seasons, a tournament's event, a camp's sessions, or a training program's classes.
- Comparable products differ mainly in how they split this up. TeamSnap nests program, season, division, and team, with registration per season ([TeamSnap](https://info.teamsnap.com/youth-sports-registration-software.html)). LeagueApps lists camps, clubs, leagues, and tournaments as program types ([LeagueApps](https://leagueapps.com/)). Playpass sells leagues, tournaments, and clubs, plus bookings with a capacity per slot ([Playpass](https://playpass.com/)). The proposal keeps Omni League's League → Season and adds the type above it.
- **Rejected alternative:** adding a `type` field to the `leagues` table. A camp has no format, minimum roster size, or standings, so the league fields would sit empty. A camp would also be called a "league" in code, the glossary, and URLs.

### What differs by type

| Type       | People register for                                      | Who registers                                       | Structure                                                       | Results                              |
| ---------- | -------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------ |
| League     | A season, one run of the league                          | Teams (captain), people joining a team, free agents | Repeating seasons; teams; a schedule of games                   | Standings                            |
| Tournament | The tournament, one event of one or more days (#323, Q3) | Teams (captain) and people joining a team           | Pools, then a bracket (#323, Q2); maximum teams                 | Pool standings, then bracket results |
| Camp       | A session with dates, for example June 8 to 12           | Individuals; guardians for minors (#323, Q4)        | Sessions, each with a capacity, an age range, and a price       | None                                 |
| Training   | A series of classes, or one class (#323, Q5)             | Individuals; guardians for minors (#323, Q4)        | Classes from a weekly pattern, each with a capacity and a coach | None at first                        |

### What every type shares

- The organization, its staff, and its access boundary. A league organizer is assigned programs of any type.
- Locations, draft then publish, and a public page that leads with what's open now.
- Registration: an account to register, a deadline, a capacity (maximum teams or places), and a waitlist when full.
- Payments through Stripe Connect, with the application fee on every registration (#323, Q7).
- Public listing and search. The organization page lists programs by type, and Find a league becomes **Find a program** (#323, Q6).
- Offline saved copies of public pages, and demo data for each type.

### Sequence

1. **Leagues first.** The public-site milestone (#240 to #262) and season registration and payments (#129 to #145, #288) finish on leagues.
2. **The program record above leagues,** with no visible change: a `programs` table, one row per league, kept by the tenant writers, with a `seed:demo` backfill and a migration plan.
3. **The second type,** chosen by the owner (#323, Q1). The system recommends tournaments, because they reuse teams, rosters, games, and standings.
4. **The remaining types.** Find a league becomes Find a program when the second type ships, and `/leagues` keeps working.

## Future (out of scope)

- **Player Pro:** a planned paid subscription for players to track their personal stats across leagues (owner direction, 2026-10-07). Out of scope until the owner raises it; it is why results keep per-player stat lines.

## Platform requirements

- Frontend: newest Angular and its current API features.
- Backend: Convex.
- Payments: Stripe.
- Version control, issues, and PRs: GitHub.
- Installable progressive web app, instead of a separate mobile app (see Installable app (PWA)).

## Constraints

Owner answers. ADRs that apply them go through `gate:technology`; only `Accepted` ADRs in `docs/decisions/` are decided.

- **Sign-in (#7):** email + password, plus Google, at launch. Email one-time codes are dropped for now. Email verification and password-reset emails are added before the first production release ([owner decision, relayed on #7](https://github.com/jasonbryan/omni-league/issues/7#issuecomment-6049577799)).
- **Auth budget (#7):** the auth provider's free tier at launch.
- **Accounts (#7):** adults only at launch. Minors appear as roster entries managed by a guardian or organizer. Adults need an account to join a team or register (see Accounts, players, and guardians).
- **Hosting budget (#9):** up to about $25/month for hosting and Convex combined; the terms of both the host and the Convex plan must allow commercial use.
- **Previews (#9):** every PR gets a preview deployment with its own Convex backend.
- **Domain (#9):** the host's default domain until the first production release.
- **Staging (#15):** the deploy of the `main` branch at https://main--charming-longma-28c00d.netlify.app, distinct from per-PR previews ([ADR 0010](../decisions/0010-hosting-and-deployment.md)).
- **Domain (#7):** bought before the first production release; needed for verification and password-reset emails. No project-owned sending domain is needed during development.

## Open

Questions still open for the owner. The planner records them as `status:blocked` issues or in the PR that raises them, rather than inventing requirements.

1. **Standings:** confirm or change the proposed defaults per sport.
2. **Fee percentage:** the percentage of each registration payment.
3. **Per-player floor:** the minimum fee per roster entry, in dollars.
4. **Fee shown to the payer:** whether the fee is a separate line for the payer or absorbed by the organization.
5. **Fee on refunds and lost disputes:** whether the platform returns the application fee when a payment is refunded or a dispute is lost.
6. **Push notifications (#85):** who receives each kind, when game reminders are sent, and whether users choose per kind.
7. **Invite email:** whether the platform emails team invites, or the captain sends the link (#131).
8. **Free agents:** what a free agent tells the organizer (position, skill, availability), and whether free agents and waitlisted teams can withdraw (#133, #145).
9. **Payments before registration ships:** whether the first production release that offers registration must include the payment slices, or ships registration behind them (#126).
10. **Registration deadline scope:** whether the deadline also stops accepting invites and organizer placement, or only new teams and free agents (#132, #135).
11. **Program types (#323):** which type ships second, tournament pools and brackets, repeating tournaments, guardians registering minors for camps and training, training classes or bookings, one search or one per type, and the application fee on each type.

Features beyond the above are not yet specified.
