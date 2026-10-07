# 0007: UI component library and styling

- **Status:** Proposed
- **Gate:** `gate:technology`
- **Issue:** #6
- **Date:** 2026-10-07 (revised 2026-10-07 for ADR 0006 hybrid rendering)

## Context

No UI component library, styling tool, icon set, or font is accepted yet. This ADR decides three things together:

1. **Component library and styling approach.** This covers the stylesheet language, whether utility CSS is used, and the design-token mechanism. They are decided together because several libraries dictate their own theming system.
2. **Icon set** and how it is delivered.
3. **Font source.**

The decision is about tooling. The visual theme (palette, type scale, radius, spacing) is not decided here. It is designed and approved through `gate:ui-design` on the first feature screen, because the former UI foundation issue #14 was closed for that reason.

### Constraints

- **Angular version and change detection** (ADR 0001, `docs/conventions/angular.md`). The latest stable major is Angular 22.2 on 2026-10-07. Zoneless change detection is the default since v21, and `ng new` with CLI 22.2.2 generates no `zone.js`, which the system confirmed in a scratch app. Components are OnPush and use signals.
- **Accessibility.** WCAG 2.2 AA: keyboard reachable, visible focus, labelled controls, sufficient contrast. Layouts work from 360px wide.
- **Matching mockups.** Mockups in `design/mockups/` must be self-contained static HTML (dev cycle Phase 3). The implementer must "match an approved mockup exactly" (Phase 4), and the tester compares screenshots with the mockup (Phase 5). So the mockup has to use the same tokens and component styles as the app.
- **Licence.** Library, icons, and fonts must be licensed for commercial use at no cost or a known cost. The product takes Stripe payments, so it is a commercial product.
- **Scaffold.** This ADR sets the `ng new --style` value for the scaffold (#10), which installs no UI library.

### Known from ADR 0002 (PR #16, Proposed)

- Prettier 3 formats everything, including `design/mockups/**/*.html` with the `html` parser.
- ESLint with angular-eslint's `templateAccessibility` rules covers Angular templates.
- TypeScript stays on 6.0.x.
- Any Prettier or ESLint plugin that styling needs, such as a Tailwind class sorter, is a new package that belongs to this gate.

### Assumptions about decisions still open

| Open decision | What this ADR assumes | What happens if it goes the other way |
| --- | --- | --- |
| #1 package manager, Node, layout | **Package manager:** any of npm, pnpm, Yarn (node-modules linker), or Bun.<br>**Node:** 24 LTS or 26.<br>**Layout:** a single root package with `src/` and `design/` at the root. | **Package manager:** no change. None of the recommended packages has an install lifecycle script (checked on the npm registry). In a scratch install, the only blocked script was `@parcel/watcher`'s, which `@angular/build` already brings. Under ADR 0003's proposed policy (npm 11.20, `strict-allow-scripts=true`, the five-entry `allowScripts` map), all twelve packages installed into an SSR app with no new entry.<br>**Layout:** if #1 picks a workspace, the paths below gain the app's directory prefix. |
| #3 unit-test runner | Vitest through the Angular builder. | Helm directives and icon components are ordinary Angular code, so any runner can test them. |
| #4 e2e and accessibility | Playwright with axe. Screenshots at 360px and 1280px. | The self-hosted font chosen below makes rendering the same on macOS and on Linux CI runners, whichever runner is chosen. |
| #5 rendering mode (PR #18, ADR 0006) | **Hybrid rendering.** Public pages are `RenderMode.Server` and hydrate in the browser, static pages are prerendered, and `/app/**` is client-only. Public pages include the registration form, so form controls, buttons, icons, and the font all render on the server. | **Tested for the recommended stack** in a scratch Angular 22.2 SSR app; see "Server rendering and hydration". If #5 went back to CSR only, nothing here would change. |

## Options

All versions, licences, peer ranges, and install scripts below were checked on the npm registry on 2026-10-07.

**Bundle sizes were measured, not estimated.** The system built the same small screen with each stack using Angular CLI 22.2.2 (`ng build`, production, zoneless). The screen had a heading, a text input with a label, a single-choice list, a button, and a dialog.

| Build | Initial raw | Estimated transfer |
| --- | --- | --- |
| Baseline (`<h1>` only, no UI packages) | 189.88 kB | 51.76 kB |
| Option A: Angular Material form field + input, select, button, dialog | 554.90 kB | 122.34 kB |
| Option C: Angular Aria listbox, CDK dialog, Tailwind utilities | 298.44 kB | 77.77 kB |
| Option B, approximated: Option C plus spartan's helm runtime helpers (`clsx`, `class-variance-authority`, `tailwind-merge`) on one helm-style button | 333.94 kB | 87.66 kB |

These numbers are indicative only:

- **Option A's select is a full dropdown with overlay.** The Option C build used an inline listbox, so Option C is a little understated.
- **spartan was not measured directly.** Its primitives sit on the same CDK, so the Option B row adds only the helper cost to Option C.
- **Stylesheets stayed small in every build** (8 to 10 kB raw). Angular Material puts component CSS in the JavaScript bundle; only the theme tokens go in `styles.css`.

### Option A: Angular Material + CDK (Material 3)

- **What it is.** Google's first-party component library, implementing Material Design 3. It provides about 35 components (form field, select, datepicker, table, dialog, snackbar, and others) on top of the CDK.
- **Packages.** `@angular/material` 22.2.2 and `@angular/cdk` 22.2.2, both MIT and free.
  - **Angular version:** peers `@angular/core ^22.0.0 || ^23.0.0`. It is released on the same train as Angular, the same day.
- **Zoneless support.**
  - The Angular roadmap says: "As part of the initial release we also introduced zoneless support to the Angular CDK and Angular Material" ([angular.dev/roadmap](https://angular.dev/roadmap)).
  - The changelog shows zoneless-specific fixes since then, for example dialog focus (#29192), bottom sheet (#29277), and virtual scroll (#31316) ([CHANGELOG](https://github.com/angular/components/blob/main/CHANGELOG.md)).
- **Styling and tokens.**
  - **Sass is required for a custom theme.** The `mat.theme()` mixin in a `.scss` file takes color, typography, and density. It emits CSS custom properties (`--mat-sys-primary`, `--mat-sys-surface`, `--mat-sys-body-large`, and others) that app components can use.
  - **Overrides:** system tokens are changed through `mat.theme-overrides()`, and each component has an `*-overrides()` mixin.
  - **Without Sass:** prebuilt CSS themes exist (`azure-blue.css` and seven others), but they cannot be customised ([theming guide](https://github.com/angular/components/blob/main/guides/theming.md)).
  - **`ng new --style`:** `scss`.
  - **No Tailwind alongside it.** Tailwind v4 states it "is not designed to be used with CSS preprocessors like Sass" ([compatibility](https://tailwindcss.com/docs/compatibility)), so adding Tailwind would mean a second stylesheet pipeline.
- **Accessibility evidence.**
  - Each component's docs have an Accessibility section, for example [button.md](https://github.com/angular/components/blob/main/src/material/button/button.md): "uses native `<button>` and `<a>` elements".
  - The CDK `a11y` package provides focus trap, focus monitor, and live announcer.
  - **Known gaps:**
    - Material "does not automatically apply different styles or themes based on user preference media queries, such as `color-scheme`, `prefers-color-scheme` or `prefers-contrast`" ([theming guide](https://github.com/angular/components/blob/main/guides/theming.md)).
    - "Setting the density below 0 can reduce accessibility."
    - Contrast of a custom palette is the app's responsibility.
- **Mockups.**
  - **Tokens can be copied.** The compiled `styles.css` from a build holds the `--mat-sys-*` tokens and can be pasted into a mockup.
  - **Component styles cannot be copied.** They are emitted inside the JavaScript bundle and apply to Material's internal DOM, for example a `mat-form-field` renders nested `mdc-*` wrappers.
  - A static mockup would therefore have to reproduce Material's internal markup and CSS by hand. That markup is not a public API and can change between minor versions. In practice, mockups would approximate the app rather than match it exactly.
- **Icons and fonts by default.**
  - The getting-started guide adds Roboto and the Material Symbols icon font from Google Fonts.
  - Both can be self-hosted instead: Roboto via Fontsource; Material Symbols via the `material-symbols` package (Apache-2.0), or as SVGs registered with `MatIconRegistry`.
  - The full Material Symbols Outlined variable font is 4.0 MB as WOFF2. SVG delivery avoids that cost.
- **Visual character (for the owner).** Material Design 3, the look of Google's apps and Android:
  - tonal surface colours generated from a seed palette;
  - pill-shaped filled and tonal buttons;
  - filled or outlined text fields with floating labels;
  - Roboto type;
  - state layers on press.
  
  Colour, typography, density, and shape are themeable, but the component anatomy stays Material. Demo: [material.angular.dev/components](https://material.angular.dev/components/categories).
- **Pros.**
  - First-party, with same-day support for each Angular major.
  - Broadest ready-made component set, including a datepicker and data table, both useful for schedules and standings.
  - Documented per-component accessibility.
  - No licence risk.
- **Cons and risks.**
  - Mockups cannot match the built screen exactly (see Mockups).
  - The visual language is fixed before the owner sees the first mockup.
  - Largest measured bundle (+70.6 kB transfer over baseline for five components).
  - Sass is needed for theming.

### Option B: spartan/ui (brain primitives + helm styles) on Tailwind CSS 4

- **What it is.** An Angular port of shadcn/ui, in two layers:
  - **brain:** a package of unstyled, accessible primitives built on the CDK, with about 40 entry points, including dialog, select, combobox, date picker, popover, tooltip, tabs, and toast ("sonner").
  - **helm:** Tailwind-styled directives and components whose **source is copied into the app**, so the project owns and edits that code. Helm uses `class-variance-authority` for variants.
  - **Release history:** 1.0 was released on 2026-06-24, followed by 20 releases up to 1.6.1 on 2026-10-06.
  - **Project:** MIT licence, 2.9k GitHub stars, community maintained.
- **Packages.**
  - **Runtime:**
    - `@spartan-ng/brain` 1.6.1 (MIT). Peers `@angular/core >=21.0.0 <23.0.0`, `@angular/cdk`, `tailwindcss >=4`, `tw-animate-css`, and `clsx`; `luxon` is optional and not needed.
    - `@angular/cdk` 22.2.2 (MIT).
    - `clsx` 2.1.1 (MIT).
    - `class-variance-authority` 0.7.1 (Apache-2.0).
    - `tailwind-merge` 3.7.0 (MIT).
  - **Build:**
    - `tailwindcss`, `@tailwindcss/postcss` 4.3.3 (MIT).
    - `postcss` 8.5.29 (MIT).
    - `tw-animate-css` 1.4.0 (MIT).
    - Tailwind's CSS compiler pulls in `lightningcss` 1.33 (MPL-2.0). It runs only at build time and is not shipped.
  - **Version support:** spartan "supports the two latest major Angular versions" ([version support](https://www.spartan.ng/documentation/version-support)).
  - **Lag behind Angular majors:** Angular 22.0.0 was published on 2026-06-03, and the first stable brain release allowing it (1.0.0) on 2026-06-24, 21 days later.
- **Zoneless and SSR support.** The spartan 1.0 changelog says: "spartan is zoneless-ready and server-side-rendering compatible out of the box" ([changelog source](https://github.com/spartan-ng/spartan/blob/main/apps/app/src/app/pages/(documentation)/documentation/changelog.page.ts)). brain's directives use signals and OnPush. The system tested this claim on an Angular 22.2 Server route; see "Server rendering and hydration" under Recommendation.
- **Styling and tokens.**
  - The tokens are CSS custom properties in OKLCH, defined in `:root` with a `.dark` override: `--background`, `--foreground`, `--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, `--border`, `--input`, `--ring`, `--radius`, and others.
  - Tailwind maps them to utilities, for example `bg-primary`.
  - brain ships `hlm-tailwind-preset.css`, which adds `data-*` state variants and CDK overlay styles ([theming](https://www.spartan.ng/documentation/theming)).
  - Component stylesheets are plain `.css`; Tailwind runs as a PostCSS plugin through the Angular builder.
  - **`ng new --style`:** `css`. Tailwind itself is added later, see Consequences.
- **Accessibility evidence.**
  - The 1.0 changelog says brain provides "maintained accessibility - ARIA, keyboard navigation, and focus management".
  - brain's overlays use the CDK's focus trap.
  - **Known gaps:**
    - Component pages have no per-component accessibility section (the [button page](https://www.spartan.ng/components/button) has none).
    - Because helm styles live in the repo, focus rings, contrast, and target sizes are the project's to verify. axe in #4 and the mockup review cover this.
- **Mockups.** This option uses a "mockup kit" bundle built by the Angular builder (see Recommendation), which the system tested in a scratch app.
  - Helm directives apply Tailwind classes to native elements, for example `<button hlmBtn>` renders a `<button>` with utility classes.
  - A mockup uses the same elements and classes.
  - Its CSS comes from the same Tailwind build of the same token file.
- **Install path.**
  - The documented CLI (`@spartan-ng/cli` 1.6.1) depends on `nx`, `@nx/angular`, and related packages. `nx` 23.3.0 runs a `postinstall` script.
  - Each component page also has a "Manual" tab with the helm source to copy.
  - This ADR uses the manual path and does **not** add `@spartan-ng/cli`.
  - The CLI also pins `@ng-icons/*` at `^32.2.0`. The manual path uses the current major instead.
- **Visual character (for the owner).** The shadcn/ui look, common in current SaaS products:
  - neutral greys;
  - flat surfaces with thin 1px borders;
  - small to medium radius;
  - subtle shadows;
  - compact controls;
  - focus rings in the `--ring` colour.
  
  The helm component pages offer several style presets (Nova, Vega, Lyra, Maia, Mira, Luma) that change the class strings. Every colour, radius, and spacing value is a token or class the project owns. Demo: [spartan.ng/components](https://www.spartan.ng/components/button).
- **Pros.**
  - Mockups can match the app exactly.
  - The visual language is owned by the project and can be set at the first mockup.
  - Ready-made accessible behaviour for complex widgets: dialog, select, combobox, date picker, toast.
  - Small runtime cost (measured +9.9 kB transfer over Option C for the helpers).
  - MIT and Apache-2.0 only.
- **Cons and risks.**
  - Community project with a smaller maintainer base than Angular Material.
  - Angular major upgrades wait for a brain release (21 days for v22).
  - Copied helm code becomes the project's to maintain, and upstream fixes are pulled by re-copying.
  - Fewer components than Material. A data table is built from helm table styles plus app logic, not a ready-made grid.
  - **Fallback:** if spartan stalls, helm code is already in the repo, and brain primitives can be replaced one at a time with Angular Aria or CDK equivalents (Option C) without changing the markup classes.

### Option C: Angular Aria + CDK with in-repo components (Tailwind CSS 4 or plain CSS custom properties)

- **What it is.** Google's first-party headless directives (Angular Aria), plus CDK utilities for dialog and overlay, with every visual component written in the repo.
  - Aria implements the WAI-ARIA patterns for accordion, autocomplete, combobox, grid, listbox, menu, menubar, multiselect, select, tabs, toolbar, and tree.
  - **Two styling variants:**
    - **Tailwind 4:** the same toolchain and mockup mechanism as Option B.
    - **Hand-written CSS:** a `tokens.css` file of custom properties plus component CSS, needing no build step.
- **Packages.**
  - `@angular/aria` 22.2.2 (MIT). Peers `@angular/cdk 22.2.2` and `@angular/core ^22.0.0 || ^23.0.0`.
  - `@angular/cdk` 22.2.2 (MIT).
  - The Tailwind variant adds the same build packages as Option B.
- **Stability and zoneless support.**
  - "In Angular v22, we promoted Angular Aria to stable" ([angular.dev/roadmap](https://angular.dev/roadmap)).
  - Zoneless: Aria's docs do not mention zoneless or zone.js ([overview](https://angular.dev/guide/aria/overview)). Its directives use signal inputs and models (`model()` for listbox values, from the 22.2.2 type declarations). The CDK is covered by the roadmap statement quoted under Option A. The scratch build ran zoneless without errors.
- **Accessibility evidence.**
  - Aria directives "handle keyboard interactions, ARIA attributes, focus management, and screen reader support" ([overview](https://angular.dev/guide/aria/overview)).
  - **Known gaps:**
    - There is no dialog, date picker, toast, or tooltip pattern. The CDK covers dialog and overlay; a date picker would be built in the repo.
    - All visual accessibility (focus visibility, contrast, target size) is the project's to build and verify.
- **Mockups.**
  - **Tailwind variant:** same as Option B.
  - **Plain-CSS variant:** the mockup inlines `tokens.css` and the component CSS directly, with no build step.
- **Visual character (for the owner).** None: there is no default look. Every component's appearance is designed from scratch in the first mockups. Demo: the Aria guide pages show the same directives styled several ways ([angular.dev/guide/aria](https://angular.dev/guide/aria/overview)).
- **Pros.**
  - First-party only, with the same release train as Angular.
  - Smallest bundle (measured +26 kB transfer over baseline).
  - Complete ownership of the visual design.
  - The plain-CSS variant needs no CSS tooling at all.
- **Cons and risks.**
  - Every component (button, input, select, dialog, date picker, toast, table) is designed, built, and tested in the repo before features can use it.
  - The first several feature PRs would carry component-building work, which strains the one-PR, ~400-line slice size.
  - A date picker is absent from both Aria and the CDK.

### Option D: PrimeNG 22 (styled or unstyled mode)

- **What it is.** PrimeTek's component library: about 90 components with "Aura", "Material", "Lara", and "Nora" theme presets, and an unstyled mode.
- **Packages.**
  - `primeng` 22.1.2: peers `@angular/core ^22.1.0`. PrimeNG 22.0.0 was published on 2026-07-15, six weeks after Angular 22.
  - Theme and icon packages: `@primeuix/themes` 3.0.1, `@primeicons/angular` 8.0.2.
- **Zoneless support.** The PrimeNG v21 "What's new" lists "Initial zoneless support" ([source](https://github.com/primefaces/primeng/blob/master/apps/showcase/doc/migration/v21/whatsnewdoc.ts)). The showcase app uses `provideZonelessChangeDetection()`.
- **Licence: not open source from v22.**
  - **Licence field:** `primeng` 22.x on npm declares `SEE LICENSE IN LICENSE.md` and depends on `@primeui/license-manager`.
  - **Two licences:** the bundled licence describes "a family of commercial UI libraries" under a free Community License or a paid per-developer Commercial License.
  - **Key and restrictions:** "A valid license key is required"; "A missing, invalid, or expired key may cause the software to display a license notice"; reverse-engineering and decompiling are forbidden.
  - **Community License eligibility** ([primeui.dev/licenses/community](https://primeui.dev/licenses/community), last updated 2026-08-26):
    - fewer than 5 developers in total;
    - fewer than 10 employees;
    - under USD 1M annual revenue;
    - no more than USD 3M outside capital;
    - at most 4 seats, with annual renewal.
  - **Last open-source line:** the PrimeTek licence page calls PrimeNG 21 and earlier MIT, but PrimeNG 21's peer range does not cover Angular 22.
- **Accessibility evidence.** PrimeNG documents accessibility per component. This was not evaluated further, because of the licence.
- **Visual character (for the owner).** A dense, dashboard-style corporate look. The default theme is Aura. Demo: [primeng.org](https://primeng.org/).
- **Pros.**
  - Largest component set, including a full data table.
- **Cons and risks.**
  - Licence keys and annual eligibility renewal.
  - Eligibility ends if the business outgrows the thresholds, which then requires a paid per-developer licence.
  - The compiled-only distribution forbids inspecting the source.
  - The licence notice is shown if a key lapses.
  - **Not viable** against the "no or known cost" constraint once the product grows, and the key adds an operational secret.

### Icon set

| Option | Package and licence | Delivery | Notes |
| --- | --- | --- | --- |
| **Lucide via ng-icons** | `@ng-icons/core` 36.1.0 (MIT; peers `@angular/core >=22`) + `@ng-icons/lucide` 36.1.0 (registry: ISC). Lucide upstream: ISC, with the Feather-derived icons under MIT ([licence](https://github.com/lucide-icons/lucide/blob/main/LICENSE)). | Per-icon SVG strings bundled with the app; only registered icons ship. | spartan's helm source imports `NgIcon` from `@ng-icons/core` and Lucide icons from `@ng-icons/lucide`. The `NgIcon` component is OnPush with signal inputs (source); the ng-icons docs make no explicit zoneless statement. |
| Lucide via `@lucide/angular` | `@lucide/angular` 1.52.0 (ISC; peers `@angular/core >=17`). | SVG components bundled with the app. | Lucide's official Angular package; its README calls it "standalone, signal based, zoneless". It replaces `lucide-angular`, which is deprecated and whose last version (1.0.0) caps peers at Angular 21. A second icon wrapper is redundant if helm uses ng-icons. |
| Material Symbols | Font: `material-symbols` 0.47.6 (Apache-2.0), or SVGs: `@material-symbols/svg-400` 0.47.6 (Apache-2.0). Both are community packaging of Google's Apache-2.0 icons. | Self-hosted variable font (Outlined WOFF2 is 4.0 MB in full), or SVGs registered with `MatIconRegistry`, or the Google Fonts CDN (subsettable with `icon_names`). | Native to Option A. Ligature fonts render the icon name as text until the font loads. |

### Font source

| Option | Licence | Privacy and availability | Notes |
| --- | --- | --- | --- |
| **Self-hosted Inter via Fontsource** | `@fontsource-variable/inter` 5.3.0, OFL-1.1 (licence file in the package). | Font files are served from the app's own origin. No third-party request and no extra outage dependency. | The variable weight axis is 48 KB WOFF2 for the Latin subset and 85 KB for Latin Extended; the browser downloads a subset only when the page uses its characters. Inter has tabular figures (`font-variant-numeric: tabular-nums`) for scores and standings. The same file renders identically on macOS and Linux CI, so screenshot comparisons are stable. |
| Google Fonts CDN | Font licences vary; Inter and Roboto are OFL. | Every page view sends the visitor's IP address, User-Agent, and Referer to `fonts.gstatic.com` (Angular CLI's fonts optimisation inlines only the CSS; the font files still load from Google: [workspace config](https://angular.dev/reference/configs/workspace-config)). LG München I (3 O 17493/20, 20 Jan 2022) found that dynamically embedding Google Fonts without consent breached the GDPR and awarded damages ([summary](https://www.uni-regensburg.de/universitaet/aktuelles/nachrichten/nachricht/04-04-2022_dynamische-einbindung-von-google-fonts-ohne-einwilligung-verstoesst-gegen-dsgvo)). It adds a runtime dependency on Google's availability. | No package. A mockup that links the CDN is not self-contained. |
| System font stack | None needed. | No requests. | Zero bytes, but the typeface differs across operating systems, so the mockup on the designer's macOS and the tester's Linux screenshots render differently. |

## Recommendation

**Adopt Option B: spartan/ui (brain + copied helm) on Tailwind CSS 4, with Lucide icons through ng-icons and Inter self-hosted from Fontsource.**

- **It is the only option where mockups can match the app exactly.** Material puts component CSS inside its JavaScript and component markup inside its internal DOM. Aria-only needs every component built first. With spartan, the mockup reuses the same elements, classes, and compiled token CSS.
- **It provides accessible behaviour for the complex widgets** a league app needs early (dialog, select, combobox, date picker, toast) without first building them.
- **The visual language stays undecided until the owner approves the first mockup.** It is not inherited from Material Design.
- **Every package is MIT, ISC, Apache-2.0, or OFL-1.1.**

Option A is the runner-up. It is the better choice if the owner wants a first-party library with an established, ready-made design language and accepts mockups that approximate the app rather than match it. PrimeNG is not recommended because of its licence-key model from v22.

### Packages to add

The scaffold (#10) adds none of these; they arrive with the UI foundation work (see Consequences).

| Package | Version | Licence | Type |
| --- | --- | --- | --- |
| `@angular/cdk` | 22.2.2 | MIT | dependency |
| `@spartan-ng/brain` | 1.6.1 | MIT | dependency |
| `clsx` | 2.1.1 | MIT | dependency (helm) |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | dependency (helm) |
| `tailwind-merge` | 3.7.0 | MIT | dependency (helm) |
| `@ng-icons/core` | 36.1.0 | MIT | dependency |
| `@ng-icons/lucide` | 36.1.0 | ISC (Lucide; Feather-derived icons MIT) | dependency |
| `@fontsource-variable/inter` | 5.3.0 | OFL-1.1 | dependency |
| `tailwindcss` | 4.3.3 | MIT | devDependency |
| `@tailwindcss/postcss` | 4.3.3 | MIT | devDependency |
| `postcss` | 8.5.29 | MIT | devDependency |
| `tw-animate-css` | 1.4.0 | MIT | devDependency (CSS imported at build time) |

**Not added:**

- `@spartan-ng/cli`, which brings Nx and a `postinstall` script.
- `@angular/material`, `primeng`, `luxon`, `lucide-angular`, and `@lucide/angular`.
- Google Fonts.
- `prettier-plugin-tailwindcss`. Class sorting is not required; adding it later needs a gate because it is a new package.

**Version policy:**

- **Minor and patch versions** of these packages need no gate (AGENTS.md).
- **Angular majors:** `@angular/cdk` moves with Angular. A new Angular major waits until `@spartan-ng/brain` publishes a peer range that includes it, and the upgrade PR states this.
- **ng-icons majors** follow Angular majors, as in the table in the ng-icons README, and move with the Angular upgrade.
- **Font family:** replacing Inter with another OFL-1.1 family from the same `@fontsource-variable/*` scope, if the owner chooses one at the first feature screen's `gate:ui-design`, is covered by this ADR. Any other font source needs a new ADR.

### Stylesheet format for `ng new` (#10)

`ng new --style=css`.

- **Component stylesheets are `.css`.** No Sass anywhere.
- **#10 does not install Tailwind.** `--style=tailwind` exists in CLI 22.2.2, but it only adds Tailwind to the CSS setup, and #10 excludes the UI library and theme.
- **The UI foundation work adds Tailwind** with Angular's `tailwind` schematic (`ng add tailwindcss`). It adds `tailwindcss`, `@tailwindcss/postcss`, and `postcss`, and writes `.postcssrc.json`.

### Token mechanism

- **One token file, `src/styles/tokens.css`.** It holds CSS custom properties in spartan's naming (`--background`, `--foreground`, `--primary`, …, `--radius`) in `:root`, with a `.dark` block only if the owner approves a dark theme. A Tailwind `@theme` block maps them to utilities and sets `--font-sans` to Inter.
- **The values are a visual decision.** They are set in the first feature screen's mockup and approved through its `gate:ui-design`, not in this ADR.
- **`src/styles.css` imports Tailwind with an explicit source.** It contains `@import 'tailwindcss' source('.');` (scanning `src/` only), then `tokens.css`, brain's `hlm-tailwind-preset.css`, and the Inter font CSS. The explicit source keeps mockup-only classes out of production CSS.
- **Helm code lives in one app folder,** for example `src/app/ui/`, copied from each component page's "Manual" tab with its import paths adjusted.

### How a self-contained mockup gets the same tokens and styles

The system verified this mechanism in a scratch Angular 22.2 app with Tailwind 4.3.3. It needs no extra package:

1. **Mockup-kit entry.** `design/mockup-kit/mockup-kit.css` holds:

   ```css
   @import 'tailwindcss' source(none);
   @import '../../src/styles/tokens.css';
   @import '@spartan-ng/brain/hlm-tailwind-preset.css';
   @import '@fontsource-variable/inter/wght.css';
   @source '../mockups';
   @source '../../src/app';
   ```

2. **Build configuration.** A `mockup-kit` configuration in `angular.json` adds that file to `styles` as `{ "input": "design/mockup-kit/mockup-kit.css", "bundleName": "mockup-kit", "inject": false }` with `outputHashing: "none"`.
   - `ng build --configuration production,mockup-kit` emits `mockup-kit.css` beside the normal output.
   - It is not referenced from `index.html` (`inject: false` is documented in the [workspace config](https://angular.dev/reference/configs/workspace-config)).
   - In the scratch test, `mockup-kit.css` contained classes used only in a mockup, and the production `styles.css` did not.
   - Production deploys never use this configuration.
3. **Inline script.** A dependency-free Node script (for example `scripts/inline-mockup-kit.mjs`, behind a `design:css` package script) builds the kit and then writes it into each mockup.
   - **Fonts:** it rewrites the kit's font `url(...)` references as base64 `data:` URIs, about 65 KB for the Latin subset.
   - **Placement:** it writes the CSS into a `<style id="mockup-kit">` block preceded by `<!-- prettier-ignore -->`, so Prettier (ADR 0002) leaves the generated CSS alone.
   - **Result:** the mockup stays a single static file that opens offline.
4. **Markup.** The mockup uses the same native elements, `data-*` state attributes, and classes that the helm directives apply, for example the `buttonVariants` class string for a primary button.
5. **Icons.** Icons in mockups are inline `<svg>` markup taken from the installed `@ng-icons/lucide` version, where each export is an SVG string. That keeps mockup icons identical to the app's.

The same steps would serve Option C's Tailwind variant. Option A has no equivalent for component styles (see Option A, Mockups).

**The #10 placeholder mockup is not a style reference.** It is produced before any tokens exist, so the first feature screen's mockup defines the visual language from the tokens above.

### Server rendering and hydration (ADR 0006)

ADR 0006 renders public pages on the server and hydrates them. ADR 0006 requires this ADR to show that its components render on a Server route and hydrate without errors, and to state how its form controls bind to signal forms.

**Test (2026-10-07).** The system built a scratch `ng new --ssr` app on Node 26.11.0, installed with npm 11.20.0 under ADR 0003's strict script policy.

- **Packages:**
  - `@angular/*` 22.2.1, `@angular/ssr` 22.2.1, zoneless, `provideClientHydration()` with the v22 defaults;
  - the twelve packages in the table above;
  - helm source for `utils`, `button`, `input`, `label`, `dialog`, and `select`, copied from the `@spartan-ng/cli` 1.6.1 templates (the same source as the docs' "Manual" tab), plus the `style-vega.css` preset.
- **The `/ui` page (`RenderMode.Server`):**
  - a heading;
  - a Lucide icon through `<ng-icon>`;
  - a `hlmLabel` and `input[hlmInput]` bound with `[formField]`;
  - a `hlm-select` bound with `[formField]`;
  - a `hlm-dialog` whose trigger is a `hlmBtn` with an icon.
- **Tests:** Playwright 1.64.0 (Chromium) against `node dist/<app>/server/server.mjs`, on both a development build and a production build.

| Check | Development build | Production build |
| --- | --- | --- |
| Raw server HTML, JavaScript disabled: helm classes present (`spartan-button`, `spartan-input`, `spartan-label`, `spartan-select-trigger`), `<ng-icon>` contains an inline `<svg>`, select trigger has `role="combobox"` and `aria-expanded="false"`, input has `value`, `name`, and `required` from the signal form | pass | pass |
| Hydration: no `console.error`, no `pageerror`, no `NG0…` warning. Dev mode logged "Angular hydrated 7 component(s) and 42 node(s), 0 component(s) were skipped". Hydration mismatch checks run only in development builds (ADR 0005). | pass | pass (no console output at all) |
| After hydration: typing into the input updates the signal model. Opening the select and choosing an option updates the model. Opening the dialog shows the model values, and Cancel closes it. | pass | pass |
| Inter: the `.woff2` is requested from the app's own origin (`/media/…`), returns 200 `font/woff2`, and `document.fonts.check('16px "Inter Variable"')` is true. The computed `font-family` is Inter. | pass | pass |

**What the source shows (`@spartan-ng/brain` 1.6.1 `fesm2022`, helm templates, `@ng-icons/core` 36.1.0):**

- **Helm classes are server-rendered.** Helm's `classes()` helper (`utils/hlm.ts`) writes `element.className` from an `effect()`. Its own comment explains that it does not use `afterRenderEffect` because that "doesn't run in SSR contexts". Its `MutationObserver` and its transition suppression during hydration run only when `isPlatformBrowser` is true. Rewriting `class` after hydration changes no DOM structure, so it cannot cause NG0500.
- **brain's browser APIs are guarded.**
  - Browser-only work sits in `afterNextRender`, behind `isPlatformBrowser`, or behind `typeof ResizeObserver`/`MutationObserver` checks. This covers `autocomplete`, `checkbox`, `combobox`, `core`, `dialog`, `overlay`, `select`, `slider`, `sonner`, `switch`, `tabs`, and `tooltip`.
  - Direct `document` access in `navigation-menu` happens only in keyboard-focus handlers.
  - `sonner` reaches `matchMedia` through injected document and window references, inside `afterNextRender` or behind `isPlatformBrowser`.
  - `message-scroller`, a chat-style scroller this product does not plan to use, calls `window.*` inside `afterNextRender`, behind `typeof window` guards, and in animation-frame cleanup. It was not exercised.
  - A search of all 84 `fesm2022` files found no other use of the `window`, `document`, `navigator`, `localStorage`, or `matchMedia` globals.
  - Only `dialog` and `select` (with `button`, `input`, and `label`) were rendered in the test. Every other brain primitive that a feature adopts gets its SSR check in that feature's e2e test, through the raw-HTML and hydration checks of ADR 0005.
- **ng-icons has an explicit server path.** On the server, `NgIcon` writes the SVG through `innerHTML` and marks the host `data-ng-icon-ssr`. On hydration it reuses that markup. The icon is in the raw HTML, so it does not pop in after load.

**Caveats, which feature issues must follow:**

1. **Overlay content is not in the server HTML.**
   - Dialog bodies, select options, popovers, tooltips, and toasts are created through CDK portals only when opened in the browser. The raw `/ui` HTML contained the dialog trigger and the select placeholder, but not the dialog title or any option label.
   - Anything that must be indexable or appear in link previews belongs in page content, not inside an overlay. Examples: league details, price, and registration status.
2. **Toasts: set an explicit theme.** `hlm-toaster` with `theme="system"` resolves to `light` on the server (`getActualTheme` reads `matchMedia` only in the browser) and may flip after hydration. Use a fixed theme, or render the toaster only in the browser.
3. **Copied helm code is project code under ADR 0006's Server-route rules:**
   - no `window`/`document`/`localStorage` outside `afterNextRender`;
   - no platform branches that change DOM structure;
   - no direct DOM manipulation other than through helm's `classes()`.

   The PR that re-copies helm from upstream reviews the diff against those rules.
4. **`provideSpartanHlm()`** (helm `utils`) goes in `app.config.ts`. It sets the CDK overlay `usePopover: false` default, and the server config inherits it through `mergeApplicationConfig`.
5. **Fonts under SSR.**
   - Fontsource's `@font-face` rules compile into `styles.css`, and the font files are emitted to `dist/<app>/browser/media/`. The generated `src/server.ts` serves them with `express.static` (`maxAge: '1y'`). Production file names are content-hashed (`inter-latin-wght-normal-<hash>.woff2`), so the year-long cache is safe.
   - In the production build, Angular's critical-CSS inlining (beasties, through `@angular/ssr`) inlined the critical rules, including `@font-face`, into the server HTML. It also added `<link rel="preload" as="font" crossorigin href="/media/inter-latin-wght-normal-<hash>.woff2">`, so the Latin subset starts downloading with the HTML. The full stylesheet then loads without blocking render.
   - #9's host must serve `dist/<app>/browser/media/` with the other static assets, with long-lived caching.
   - No third-party font request is made on any route.

**Signal forms binding** (ADR 0006 adopts signal forms):

- **Native-element helm directives** (`[hlmInput]`, `[hlmTextarea]`) bind with `[formField]` directly on the native `<input>`/`<textarea>`. The server HTML then carries `value`, `name`, and `required`.
- **brain's composite controls and helm's `hlm-native-select`** implement `ControlValueAccessor` (`NG_VALUE_ACCESSOR`):
  - brain: `select`, `combobox`, `autocomplete`, `checkbox`, `switch`, `radio-group`, `slider`, `toggle-group`, `input-otp`, `command`, and `questionnaire`;
  - helm: the `hlm-native-select` component, which wraps a `<select>`.

  They bind with `[formField]` through `FormField`'s `ControlValueAccessor` compatibility path.
- spartan's own docs show this pattern: the select "form" example uses `form()`, `FormRoot`, and `[formField]` on `hlm-select` ([`select--form.preview.ts`](https://github.com/spartan-ng/spartan/blob/main/apps/app/src/app/pages/(components)/components/(select)/select--form.preview.ts)). The scratch test bound `hlm-select` the same way and got model updates both ways.
- This is ADR 0006's "a `ControlValueAccessor` is used only when a #6 library requires it" case. Custom controls written in the repo implement `FormValueControl`/`FormCheckboxControl` instead.

### Accessibility responsibilities under this option

- **brain:** provides ARIA roles, keyboard interaction, and focus management for its primitives.
- **The project:** verifies the visual layer it owns:
  - token contrast (4.5:1 for text, 3:1 for UI components and focus indicators);
  - visible focus;
  - target size of at least 24×24 CSS px (WCAG 2.2 SC 2.5.8);
  - reflow at 360px.
- **Checks:** the designer checks contrast in the mockup; axe (#4) checks the built screens; angular-eslint's template accessibility rules (ADR 0002) lint the helm templates.

## Consequences

- **New packages** are the twelve in the table, all permissive or OFL, at no cost. None runs install scripts.
- **The scaffold (#10)** uses `ng new --style=css` and installs none of them.
- **UI foundation work moves to the first feature screen.** With #14 closed, the first feature issue (or a gated chore split from it) carries:
  1. **Tailwind:** `ng add tailwindcss`.
  2. **Tokens and global styles:** `tokens.css` and the global `styles.css`.
  3. **Libraries:** the brain, CDK, ng-icons, and Fontsource installs.
  4. **Helm:** the first copied helm components.
  5. **Mockup kit:** the `mockup-kit` configuration and the inline script.
  6. **Mockup:** the first mockup, built with the kit and approved through `gate:ui-design`.
  
  Copied helm files are vendored code. The PR should list them separately so reviewers can tell them from hand-written code.

  Because of ADR 0006, the same work also:
  - adds `provideSpartanHlm()` to `app.config.ts`;
  - for each public page that uses helm components, includes the ADR 0005 raw-HTML assertion (helm classes and icon `<svg>` present without JavaScript) and the hydration check;
  - keeps indexable content out of overlays (caveat 1 under "Server rendering and hydration").
- **Ongoing maintenance:**
  - Helm code is the project's to maintain. Upstream helm fixes are applied by re-copying from the spartan docs and reviewing the diff.
  - Angular major upgrades depend on a brain release.
- **What becomes harder:**
  - Switching to Angular Material later would mean redesigning every screen.
  - Tailwind utility classes appear throughout templates, so moving away from Tailwind would touch every template.
- **Not used:** Sass, Google Fonts, and the Google Fonts CDN. Every font and icon is served from the app's own origin.

## Sources

- **npm registry,** checked 2026-10-07 for versions, licences, peer dependencies, publish dates, and install scripts:
  - Angular and Material: [@angular/core](https://www.npmjs.com/package/@angular/core), [@angular/material](https://www.npmjs.com/package/@angular/material), [@angular/cdk](https://www.npmjs.com/package/@angular/cdk), [@angular/aria](https://www.npmjs.com/package/@angular/aria)
  - spartan: [@spartan-ng/brain](https://www.npmjs.com/package/@spartan-ng/brain), [@spartan-ng/cli](https://www.npmjs.com/package/@spartan-ng/cli)
  - PrimeNG: [primeng](https://www.npmjs.com/package/primeng), [@primeui/license-manager](https://www.npmjs.com/package/@primeui/license-manager)
  - Tailwind: [tailwindcss](https://www.npmjs.com/package/tailwindcss), [@tailwindcss/postcss](https://www.npmjs.com/package/@tailwindcss/postcss), [tw-animate-css](https://www.npmjs.com/package/tw-animate-css)
  - Helm helpers: [clsx](https://www.npmjs.com/package/clsx), [class-variance-authority](https://www.npmjs.com/package/class-variance-authority), [tailwind-merge](https://www.npmjs.com/package/tailwind-merge)
  - Icons: [@ng-icons/core](https://www.npmjs.com/package/@ng-icons/core), [@ng-icons/lucide](https://www.npmjs.com/package/@ng-icons/lucide), [@lucide/angular](https://www.npmjs.com/package/@lucide/angular), [lucide-angular](https://www.npmjs.com/package/lucide-angular), [material-symbols](https://www.npmjs.com/package/material-symbols)
  - Fonts: [@fontsource-variable/inter](https://www.npmjs.com/package/@fontsource-variable/inter)
  - Build tooling: [nx](https://www.npmjs.com/package/nx)
- **Angular:**
  - [Roadmap](https://angular.dev/roadmap): Material/CDK zoneless; Aria stable in v22
  - [Zoneless guide](https://angular.dev/guide/zoneless)
  - [Angular Aria overview](https://angular.dev/guide/aria/overview)
  - [Tailwind guide](https://angular.dev/guide/tailwind)
  - [Workspace config](https://angular.dev/reference/configs/workspace-config): fonts inlining; `inject: false` styles
  - `@schematics/angular` 22.2.2 `ng-new/schema.json` (`style` enum includes `tailwind`) and `tailwind/index.js`
- **Angular Material:**
  - [Theming guide](https://github.com/angular/components/blob/main/guides/theming.md)
  - [Getting started](https://github.com/angular/components/blob/main/guides/getting-started.md)
  - [Button accessibility](https://github.com/angular/components/blob/main/src/material/button/button.md)
  - [CHANGELOG](https://github.com/angular/components/blob/main/CHANGELOG.md)
  - [Demo](https://material.angular.dev/components/categories)
- **spartan:**
  - [Installation](https://www.spartan.ng/documentation/installation)
  - [Theming](https://www.spartan.ng/documentation/theming)
  - [Version support](https://www.spartan.ng/documentation/version-support)
  - [Changelog source](https://github.com/spartan-ng/spartan/blob/main/apps/app/src/app/pages/(documentation)/documentation/changelog.page.ts)
  - [Button / demo](https://www.spartan.ng/components/button)
  - `@spartan-ng/cli` 1.6.1 `generators/base/versions.js`
  - `@spartan-ng/brain` 1.6.1 `hlm-tailwind-preset.css`
- **PrimeNG:**
  - `primeng` 22.1.2 `LICENSE.md`
  - [PrimeUI Community License](https://primeui.dev/licenses/community)
  - [v21 what's new](https://github.com/primefaces/primeng/blob/master/apps/showcase/doc/migration/v21/whatsnewdoc.ts)
  - [Demo](https://primeng.org/)
- **Tailwind CSS:** [Compatibility](https://tailwindcss.com/docs/compatibility)
- **Icons:**
  - [ng-icons README](https://github.com/ng-icons/ng-icons/blob/main/README.md)
  - [ng-icons icon component source](https://github.com/ng-icons/ng-icons/blob/main/packages/core/src/lib/components/icon/icon.component.ts)
  - [Lucide licence](https://github.com/lucide-icons/lucide/blob/main/LICENSE)
  - [@lucide/angular README](https://github.com/lucide-icons/lucide/blob/main/packages/angular/README.md)
  - [Lucide icons](https://lucide.dev/icons)
- **Fonts:**
  - `@fontsource-variable/inter` 5.3.0 `LICENSE` and file sizes
  - [Inter on Fontsource](https://fontsource.org/fonts/inter)
  - LG München I, 3 O 17493/20, 20 Jan 2022: [University of Regensburg summary](https://www.uni-regensburg.de/universitaet/aktuelles/nachrichten/nachricht/04-04-2022_dynamische-einbindung-von-google-fonts-ohne-einwilligung-verstoesst-gegen-dsgvo), [IHK summary](https://www.ihk.de/bergische/recht-und-steuern/wettbewerbsrecht/google-fonts-5646176)
- **Server rendering (added for ADR 0006):**
  - [Angular: server and hybrid rendering](https://angular.dev/guide/ssr)
  - [Angular: hydration](https://angular.dev/guide/hydration)
  - [spartan select with signal forms (`select--form.preview.ts`)](https://github.com/spartan-ng/spartan/blob/main/apps/app/src/app/pages/(components)/components/(select)/select--form.preview.ts)
  - [spartan dialog example (`dialog.preview.ts`)](https://github.com/spartan-ng/spartan/blob/main/apps/app/src/app/pages/(components)/components/(dialog)/dialog.preview.ts)
  - Package contents: `@spartan-ng/cli` 1.6.1 `src/generators/ui/libs/{utils,button,input,label,dialog,select,native-select,textarea}/files/**` and `src/generators/ui/style-vega.css`; `@spartan-ng/brain` 1.6.1 `fesm2022/*.mjs`; `@ng-icons/core` 36.1.0 `fesm2022/ng-icons-core.mjs`.
  - Scratch SSR app, 2026-10-07: Node 26.11.0, npm 11.20.0 under ADR 0003's policy, `@angular/*` and `@angular/ssr` 22.2.1, Playwright 1.64.0 (Chromium). Results are in "Server rendering and hydration".
- **Measurements:** scratch builds with Angular CLI 22.2.2 on Node 24.16.0, 2026-10-07. They covered the bundle sizes in the Options table and the `mockup-kit` configuration test (mockup-only class present in `mockup-kit.css`, absent from `styles.css`, kit not injected into `index.html`).
