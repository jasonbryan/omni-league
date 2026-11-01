# UX conventions

Applies to every task flow and screen: planning, building, testing, and reviewing UI. It adds flow and behaviour rules to the design system (`src/styles/tokens.css`, `design/mockup-kit/`, approved mockups in `design/mockups/`) and to the [Angular conventions](angular.md). Where an approved mockup and a rule here disagree, the mockup wins for that screen until an issue changes it. The rules and the [UX checklist](#ux-checklist) apply to what a PR adds or changes. A gap that was already there and has an open issue is a note on the PR linking that issue, not a failure.

## Task flows

- **Fewest steps.** Count the screens, fields, and presses from intent to done, and remove any the server can work out. After a create, offer the next step (a link to the new item, or its next action) in the success status.
- **Defaults and preselection.** Preselect the only choice (one location, one format), derive fields from earlier ones (slug from name), and keep the user's previous answer when the form is reused.
- **Progressive disclosure.** Show the fields the common case needs; put rare options behind a disclosure, never on a second page.
- **Validation.** A field is checked when the user leaves it, then re-checked as they type until it is valid; never on the first keystroke. The rules live in `convex/lib/` and the page reuses them; the server checks again and is the source of truth, and its answer shows under the field it is about. A submit still checks every field and focuses the first invalid one.
- **Feedback.** A press shows its pending state at once (label such as "Saving…", `aria-disabled`). The result appears in a status region next to the action (`AdminAlert`: `role="status"` for success, `role="alert"` for failure) that takes focus when the element last pressed or focused has gone. A click or tap counts as a press, because it does not focus a link in WebKit. The same holds for the server-error and not-saved views: when one replaces content that held the element last pressed or focused, its `<h1>` (`tabindex="-1"`) takes focus (`focusWhenReplacing` in `src/app/core/replaced-focus.ts`). When that element is still on the page, or nothing was pressed, focus stays where it is. On a form with the sticky footer, a success status that leaves focus on the submit button sits in the footer, above the button, so a phone shows it without a scroll. A jump pressed before its target renders focuses the target when it renders, unless the user has pressed, focused, or scrolled since. Optimistic updates only where a failure can be shown and reverted, and never offline (ADR 0013, Decision 3A).
- **Undo over confirm.** A reversible action acts at once and offers Undo in its status. A confirmation dialog is only for an irreversible or public action (publish, payment, deleting data).
- **Keep input.** An error, a server refusal, or going offline never clears a field. Offline submits follow the offline note rules in [Angular conventions, State and data](angular.md#state-and-data).

## States

Every screen designs, builds, and tests each of these states that applies: **empty**, **loading**, **error**, **offline**, and **success**. A state that cannot occur (sign-in has no empty state, a prerendered page no loading state) is marked N/A with the reason.

- Empty states say what will appear and carry the primary action that fills them (or say who can).
- Loading content uses a skeleton shaped like the content (`bg-muted motion-safe:animate-pulse`) plus an `sr-only` `role="status"`; a spinner is only for a pending button. A route never renders a blank `<main>` while it loads. A skeleton that stands in for a whole public page sets `data-page-loading` on its host, and the public layout then leaves its footer out until the page loads, so a short page does not pull the footer up into view. Online, that skeleton gives way to the page's error view after `PAGE_LOAD_WAIT_MS` (10 s) of one continuous loading spell, so a query that never answers leaves a way forward. A status region that is in the page from the first render, empty, announces the change without moving focus, and the page shows its content if the answer arrives later (`injectPageLoadWait` and `PageLoadStatus` in `src/app/public-layout/`). The exception is a view that replaces the element last pressed or focused, which takes focus as the Feedback rule in [Task flows](#task-flows) says; the status region still announces.
- Errors say what failed and what to do next (Try again, a link), and keep the rest of the page usable.

## Layout

- Mobile first: build at 360px, then widen. No horizontal scroll at 320px (the axe helper's reflow check, `e2e/support/a11y.ts`).
- Touch targets are at least 44 by 44 CSS px on touch screens (buttons, inputs, list links, pagination).
  - `src/styles/base.css` enlarges `data-slot="button"`, `data-slot="input"`, and the rows of check boxes and radio buttons on `pointer: coarse`. Any other link people tap (a sidebar or list link, the title link of a list row) carries `pointer-coarse:min-h-11`; a link inside running text is exempt.
- On phones, a form taller than the screen keeps its primary action visible (sticky to the bottom of the form).
- Spacing, radius, and colour come from tokens and the existing Tailwind scale; no one-off values.

## Navigation

- The user always knows where they are: a breadcrumb on any page more than one level deep, and `aria-current` on the current sidebar or breadcrumb item.
- Every state a user might share or return to has a URL (page numbers, sections, the jump to a form). Back returns to the previous state; a finished one-time form (sign-in, sign-up, create) is replaced in history, not left behind it.
- A section or row address opened directly (a page load, or a route change) lands once its target renders: the page scrolls to it and focuses it (`LeagueLanding`, `src/app/organizations/league/`). A later choice or a user scroll since the arrival cancels the landing (`onLaterChoiceOrScroll`, `src/app/core/later-choice.ts`), and `<main>`'s own navigation focus is not a choice. The state belongs to the page component, so each arrival lands again.
- After a route change, focus moves to `<main>` (`provideFocusMainAfterNavigation`, registered once in `app.config.ts`; a change of query string or fragment only does not move it); after an in-page change, focus follows the Feedback rule in [Task flows](#task-flows). When a view that holds focus (the server-error or not-saved view, on its heading or Try again) gives way to the content, focus moves to `<main>`, as after a route change.

## Content

- Plain words a player or organizer would use, from the [glossary](../glossary.md); no internal or technical terms in the UI.
- Labels name the thing; errors say how to fix it ("Use at least 15 characters. This password has 9.").
- Dates and money go through `Intl` formatters in `en-US` and USD at launch (ADR 0012); instants show in the viewer's time zone, season calendar dates exactly as stored.

## Accessibility and performance

- Everything works by keyboard and screen reader: [Angular conventions, Accessibility](angular.md#accessibility) and the [WCAG checklist](../process/wcag-checklist.md).
- The initial bundle (the `Initial total` line of `ng build`) stays within the `angular.json` initial warning of 500 kB, so the build prints no `bundle initial exceeded` warning. Reserve space for content that arrives late (skeletons the size of the content, image width and height) so nothing shifts.

## UX checklist

The implementer copies this list into the PR body and ticks it; the tester and PR reviewer check it. It covers what the PR adds or changes; mark an item N/A with the reason, or link the open issue for a gap that was already there.

- [ ] The flow has no step the server or a default could take.
- [ ] Each state that applies (empty, loading with a skeleton, error, offline, success) exists and is tested; the others are N/A with a reason.
- [ ] Fields validate on leaving them; server refusals show under the field; input survives errors.
- [ ] Reversible actions offer Undo; only irreversible or public ones confirm.
- [ ] Touch targets are 44px or more; no horizontal scroll at 320px; long phone forms keep the action visible.
- [ ] Breadcrumb and current marker, a URL for each shareable state, Back works, focus moves after navigation.
- [ ] Copy is plain, errors say how to fix, dates and money use `Intl`.
- [ ] Initial bundle within 500 kB (no `bundle initial exceeded` warning); no layout shift as data arrives.
