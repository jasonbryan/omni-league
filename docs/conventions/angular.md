# Angular conventions

Applies to everything under the Angular app. Use the latest stable major (ADR 0001). When unsure whether an API exists or is stable in the installed version, check `node_modules/@angular/*` types or angular.dev for that version rather than relying on memory.

## Components

- Standalone components only; no NgModules. `standalone: true` is the default, so the decorator leaves it out.
- `ChangeDetectionStrategy.OnPush` on every component; the app runs zoneless.
- `input()`, `input.required()`, `output()`, `model()` and signal queries (`viewChild()`, `contentChildren()`) in place of decorator-based equivalents.
- Host bindings and listeners go in the `host` object of the decorator.
- `inject()` for dependencies, not constructor injection.
- One responsibility per component; inline templates for small components, relative paths for external templates and styles.

## State and data

- Signals for state: `signal()`, `computed()`, `linkedSignal()`, `effect()` only for side effects that leave Angular (logging, storage, imperative DOM APIs).
- Update signals with `set()` and `update()`.
- Convex data reaches components through signal-based services wrapping the Convex client; components never call the Convex client directly.
- Async loading of non-Convex data uses `resource()` / `httpResource()`.

## Templates

- Built-in control flow: `@if`, `@for` (with `track`), `@switch`, `@defer`, `@let`.
- `class` and `style` bindings, not `ngClass`/`ngStyle`.
- No logic beyond simple expressions; derive values with `computed()`.
- `NgOptimizedImage` for static images.

## Forms

Use Angular's signal-based forms API when present in the installed version; fall back to typed reactive forms otherwise. Record which one the scaffold chose in its ADR.

## Routing

Lazy-load every feature route with `loadComponent` / `loadChildren`. Guards and resolvers are functions.

## Accessibility

Every screen passes automated axe checks and meets WCAG 2.2 AA: keyboard reachable, visible focus, labelled controls, sufficient contrast. Players use phones, so layouts work from 360px wide.

## Tests

Each component and service with logic has a unit test. User-facing flows from acceptance criteria have an e2e test. Test runners are chosen via `gate:technology`.
