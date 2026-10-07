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

- Public pages are needed at launch: visitors can view an organization's leagues and locations on public pages; users can register for those leagues from them (owner answer on #5: "users will need to be able to register to organizations leagues").
- An organization can have multiple locations where its leagues are held (owner answer on #5).

## Platform requirements

- Frontend: newest Angular and its current API features.
- Backend: Convex.
- Payments: Stripe.
- Version control, issues, and PRs: GitHub.

## Constraints

Owner answers. ADRs that apply them go through `gate:technology`; only `Accepted` ADRs in `docs/decisions/` are decided.

- **Sign-in (#7):** email one-time code or magic link, plus Google, at launch.
- **Auth budget (#7):** the auth provider's free tier at launch.
- **Accounts (#7):** adults only at launch. Minors appear as roster entries managed by a guardian or organizer.
- **Hosting budget (#9):** up to about $25/month for hosting and Convex combined; the terms of both the host and the Convex plan must allow commercial use.
- **Previews (#9):** every PR gets a preview deployment with its own Convex backend.
- **Domain (#9):** the host's default domain until the first production release.

## Open

Features beyond the above are not yet specified. The planner records open questions for the owner as issues labelled `status:blocked` rather than inventing requirements.
