# 0001: Core platform

- **Status:** Accepted
- **Gate:** `gate:technology`
- **Date:** 2026-10-07

## Context

The owner set the core platform as a starting requirement.

## Decision

- **Frontend:** Angular, latest stable major version at scaffold time, using its current APIs (signals, standalone components, zoneless change detection, built-in control flow).
- **Backend:** Convex (database, server functions, scheduling, file storage, HTTP actions).
- **Payments:** Stripe.
- **Source control, issues, PRs, and CI host:** GitHub.

## Consequences

Everything else (package manager, auth provider, UI component library, styling, test runners, hosting for the Angular app, CI/CD) is undecided and goes through `gate:technology` before use.

Angular has no first-party Convex integration, so the app needs a signal-based adapter around the `convex` browser client; its design is part of the scaffold work.
