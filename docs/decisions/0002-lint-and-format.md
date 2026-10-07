# 0002: Lint and format tooling

- **Status:** Proposed
- **Gate:** `gate:technology`
- **Issue:** #2
- **Date:** 2026-10-07

## Context

The dev cycle requires `lint` to be green before a PR is opened and CI (#12) runs it, but no linter or formatter is accepted yet. The decision has to cover:

- **Angular app** (ADR 0001, latest stable major: Angular 22.2 on 2026-10-07): TypeScript plus templates, both external `.html` and inline. `docs/conventions/angular.md` requires built-in control flow, signals, OnPush, `inject()`, the `host` object, and WCAG 2.2 AA, so template and accessibility rules are needed.
- **`convex/`** (TypeScript): Convex publishes ESLint rules for Convex functions. `docs/conventions/convex.md` requires argument validators, index-backed queries, and an authorization check in every public function.
- **Restricted imports:** #11 needs a rule that allows `convex/browser` only inside the Convex adapter folder.
- **Other files:** HTML mockups in `design/mockups/`, Markdown in `docs/` and the repo root, workflow and issue-template YAML in `.github/`, and JSON.
- **Ignores:** `convex/_generated/`, lockfiles, Angular build output, and test-runner output.
- **Scripts** that the scaffold (#10) adds and CI (#12) calls.
- **Git hooks and commit-message linting:** adopt or exclude.

### Assumptions about decisions still open

| Open decision | What this ADR assumes | What happens if the decision goes the other way |
| --- | --- | --- |
| #1 package manager | Any of npm, pnpm, Yarn (node-modules linker), or Bun as the package manager. | The tools stay the same. Every recommended package is a plain Node CLI or ESLint plugin with **no install lifecycle scripts** (checked on the npm registry), so a policy that blocks or allow-lists scripts does not affect them. Every plugin that the ESLint config imports is a direct devDependency, so pnpm's strict `node_modules` layout works. Yarn PnP is not assumed. If #1 picks PnP, the #1 ADR has to confirm that ESLint plugin resolution works under it. |
| #1 Node version | Node 24 LTS or Node 26. | The engine ranges below accept both. |
| #1 repository layout | A single root package with `src/` (Angular) and `convex/` at the root, as in Convex's quickstarts. | If #1 picks a workspace, the globs below get the app's directory prefix (for example `apps/web/src/**`). The tools, rules, and scripts stay the same. |
| #3 unit-test runner | Angular 22's default (Vitest through the Angular builder) or another runner that uses explicit imports. | Spec files use the same TypeScript config. typescript-eslint's `eslint-recommended` layer turns `no-undef` off for TS files, so runner globals need no `globals` package. |
| #4 e2e runner | Possibly Playwright. | Its output directories are on the ignore list. If #4 picks another runner, the implementer adds that runner's output directories to the ignore list instead. |
| #5 adapter folder | `src/app/core/data/convex/` (#11 places the adapter under the app's core/data folder). | Only the `ignores` glob of the restricted-imports block changes. |
| #6 styling | CSS or SCSS. | Prettier formats both natively. Any Prettier or ESLint plugin that #6 brings (for example a Tailwind class sorter) is a new package and goes through #6's own gate, not this one. |
| #8 CI | CI runs `lint` and `format:check` as scripts. | Workflow linting (for example actionlint) and any PR-title check are #8's decisions. |

## Options

### Option A: ESLint (flat config) + typescript-eslint + angular-eslint + Convex plugin, with Prettier for formatting

- **What it is.** ESLint is the linter. typescript-eslint adds the TypeScript parser and rules, angular-eslint adds Angular TypeScript and template rules (including accessibility rules), and `@convex-dev/eslint-plugin` adds Convex rules. Prettier formats every file type. All are free and open source (licences are in the package table below).
- **Pros.**
  - **First-party support from both platforms.** Angular CLI 22's `ng new` template already adds `prettier` (`^3.8.1`) and a `.prettierrc` with the `angular` parser for `*.html`. `ng add angular-eslint` is the documented path, and its major version follows Angular's. Convex documents ESLint as the main host for its plugin.
  - **Angular templates are covered,** including inline templates through `angular.processInlineTemplates`. This includes the `templateAccessibility` rule set and `prefer-control-flow`.
  - **Type-aware rules are available.** Examples are `no-floating-promises` for unawaited Convex mutation promises, and Convex's `explicit-table-ids`, which needs type information.
  - **`no-restricted-imports` is a core ESLint rule.** It is scoped per folder with flat-config `files`/`ignores` and needs no extra package.
  - **Prettier formats every required file type natively:** TS, JS, HTML (Angular and plain), CSS/SCSS, Markdown, YAML, and JSON.
- **Cons and risks.**
  - **Speed.** Type-aware linting is slower than Rust-based tools. At this repo's size that means seconds, not minutes.
  - **Two tools and two config files** (`eslint.config.mjs`, `.prettierrc`).
  - **TypeScript cap.** typescript-eslint 8.71 supports TypeScript `<6.1`. TypeScript 7.0.2 is npm `latest`, but Angular 22 also caps TypeScript at `<6.1`, so the cap does not bind today. A future Angular major on TypeScript 7 will need a typescript-eslint release that supports it.
  - **The ESLint config must be ESM.** `@convex-dev/eslint-plugin` 5.0.0 picks its config shape by module system. Its CommonJS build returns an ESLint 8 (`eslintrc`) shaped `recommended` config, which flat config rejects. Using `eslint.config.mjs`, or `.js` with `"type": "module"`, avoids this.

### Option B: Biome alone (lint and format)

- **What it is.** `@biomejs/biome` 2.5.15 (MIT OR Apache-2.0) is a single Rust binary that lints and formats.
- **Pros.**
  - One fast tool with one config file.
  - Has `noRestrictedImports` (since v1.6; `patterns` since v2.2).
  - Formats TS, JS, JSON, and CSS.
- **Cons and risks.**
  - **No documented Angular template support.** Biome's language-support page and configuration reference do not mention Angular. HTML formatting is experimental, and the only HTML options are `{{ }}` interpolation and Vue syntax. Neither page states support for Angular control flow (`@if`, `@for`, `@let`) or binding syntax, and there are no Angular template accessibility rules. This fails the accessibility constraint in #2.
  - **Cannot run the Convex rules.** `@convex-dev/eslint-plugin` is an ESLint plugin. Convex documents ESLint and Oxlint as hosts, not Biome.
  - **No Markdown or YAML formatting.** Both are marked "in progress" on the language-support page. The Biome 2026 roadmap says Markdown lacks resources.

### Option C: ESLint (angular-eslint, typescript-eslint, Convex plugin) for linting, with Biome formatting TS/JSON/CSS

- **What it is.** Option A's lint stack, with Biome replacing Prettier for the file types Biome formats stably.
- **Pros.**
  - Faster formatting of TS and JSON.
- **Cons and risks.**
  - **Still needs Prettier.** Biome does not format Angular templates, Markdown, or YAML, so this becomes three tools instead of two.
  - **Fights the CLI default.** It replaces the formatter that Angular CLI 22 installs and configures by default.
  - **Possible formatting conflicts** where Biome's and Prettier's output differ on overlapping files.

### Also considered: Oxlint + oxfmt

`oxlint` 1.87.0 and `oxfmt` 0.72.0 (MIT) are not recommended:

- Oxlint can host the Convex plugin, but Convex documents that it gets no type information there, so `explicit-table-ids` and `no-collect-in-query` are unavailable.
- Oxlint has no Angular template linting.
- oxfmt is pre-1.0.

### Git hooks and commit-message linting

| Option | Assessment |
| --- | --- |
| None: CI and explicit local runs only | The dev cycle already requires the implementer to run every check before opening the draft PR, and CI (#12) runs them on every push. Adds no packages and no install-time scripts. |
| husky 9.1.7 (MIT) and lint-staged 17.6.0 (MIT) | Needs a `prepare` lifecycle script on the repo's own package, which interacts with #1's lifecycle-script policy. Agents working in throwaway worktrees and CI runners gain nothing from it. Hooks can be bypassed with `--no-verify`, so CI stays the real check. |
| lefthook 2.2.0 (MIT) | Has a `postinstall` script that downloads or links a platform binary, so it is affected by any script-blocking policy from #1. Same bypass caveat. |
| @commitlint/cli 21.2.3 (MIT) | The dev cycle squash-merges PRs, so the commit that lands on `main` takes the PR title, and branch commit messages are discarded. Linting every branch commit enforces the format where it matters least. |

## Recommendation

**Adopt Option A.** It is the only option that covers Angular templates (including accessibility rules), runs Convex's own rules with type information, and formats every required file type with one formatter. It also matches what Angular CLI 22 and angular-eslint generate, so the scaffold (#10) keeps the CLI defaults instead of working against them.

**Exclude git hooks and commitlint.** CI is the enforcement point, and local runs are already part of the implementer's definition of done. Conventional Commits matter for the squash-merged PR title, which the PR reviewer checks. If the owner wants that checked automatically, a PR-title check belongs in the CI decision (#8). These can be revisited through a new ADR if contributors start pushing unformatted code often.

### Packages to add (devDependencies)

All versions and licences are checked against the npm registry on 2026-10-07.

| Package | Latest version | Licence | Notes |
| --- | --- | --- | --- |
| `eslint` | 10.12.0 | MIT | Flat config only. Engines `^20.19.0 \|\| ^22.13.0 \|\| >=24`. |
| `@eslint/js` | 10.0.1 | MIT | `eslint.configs.recommended`. Peer `eslint ^10`. |
| `typescript-eslint` | 8.71.1 | MIT | Peers: `eslint ^8.57 \|\| ^9 \|\| ^10`, `typescript >=4.8.4 <6.1.0`. |
| `angular-eslint` | 22.5.0 | MIT | Meta-package that pulls in `@angular-eslint/{builder,eslint-plugin,eslint-plugin-template,template-parser,schematics}` 22.5.0. Peers: `eslint ^9 \|\| ^10`, `typescript-eslint ^8`. Depends on `@angular-devkit/* >=22 <23`. |
| `@convex-dev/eslint-plugin` | 5.0.0 | Apache-2.0 | Peer `convex ^1.43.0` (current `convex` is 1.46.0). Bundles `@typescript-eslint/utils ~8.58`, which installs a second copy alongside 8.71. That is harmless: there is no peer conflict. |
| `prettier` | 3.9.9 | MIT | Already added by `ng new` (Angular CLI 22.2.2 template: `^3.8.1`). This ADR accepts it. Engines `>=14`. |

**Not added:**

- `eslint-config-prettier`. ESLint 10's recommended config, typescript-eslint 8's configs, and angular-eslint's recommended configs contain no stylistic formatting rules, because typescript-eslint moved those out in v8. There is nothing for it to turn off.
- `@biomejs/biome`, `oxlint`, `husky`, `lefthook`, `lint-staged`, `@commitlint/*`.

**Version policy:**

- `ng add angular-eslint` (22.5.0) writes `eslint ^10.9.1`, `@eslint/js ^10.0.1`, `angular-eslint 22.5.0`, and `typescript-eslint 8.69.0`. Bumping these to the current minor or patch versions in the table above is allowed under AGENTS.md without a gate.
- angular-eslint's major version follows Angular's. Moving both to the next Angular major together counts as part of the Angular upgrade, which ADR 0001 already covers.
- **TypeScript stays on 6.0.x.** That is what Angular CLI 22 pins (`~6.0.2`), and both `@angular/compiler-cli` 22.2.1 (`>=6.0 <6.1`) and typescript-eslint require it. Do not install TypeScript 7 (npm `latest`).

**Node compatibility:** the intersection of the engine ranges is Node `^22.22.3 || ^24.15.0 || >=26.0.0` (Angular 22 is the narrowest). Both of #1's likely outcomes, Node 24 LTS and Node 26, satisfy it.

### Rule sets

The full config lives in a single root `eslint.config.mjs`, which must be ESM (see Option A, Cons). The paths below assume the single-root layout.

1. **All `**/*.ts`:**
   - `@eslint/js` `recommended`, plus typescript-eslint `recommendedTypeChecked` and `stylisticTypeChecked`.
   - `parserOptions.projectService: true` and `tsconfigRootDir: import.meta.dirname`.
   - The project service finds the Angular tsconfig references and `convex/tsconfig.json`. TS files outside every tsconfig, such as a root `vitest.config.ts`, are listed in `projectService.allowDefaultProject`.
   - Type-aware linting is required by Convex's `explicit-table-ids` and gives `no-floating-promises` and `no-misused-promises`.
   - Moving to the `strict*` presets later is a config change, not a gate.
2. **`src/**/*.ts`:**
   - angular-eslint `tsRecommended` with `processor: angular.processInlineTemplates`. This preset includes `prefer-standalone`, `prefer-on-push-component-change-detection`, and `prefer-inject`.
   - These rules turned on at `error` because they enforce `angular.md`: `@angular-eslint/prefer-signals`, `prefer-output-emitter-ref`, `prefer-host-metadata-property`, and `no-uncalled-signals`.
   - Component and directive selector prefixes stay as the schematic generates them.
3. **`src/**/*.html`, plus inline templates through the processor:**
   - angular-eslint `templateRecommended`, which includes `prefer-control-flow`.
   - **`templateAccessibility`, which is enabled.** It contains `alt-text`, `click-events-have-key-events`, `elements-content`, `interactive-supports-focus`, `label-has-associated-control`, `mouse-events-have-key-events`, `no-autofocus`, `no-distracting-elements`, `role-has-required-aria`, `table-scope`, and `valid-aria`.
   - These additional rules at `error`: `@angular-eslint/template/button-has-type`, `no-positive-tabindex`, `prefer-class-binding`, `prefer-style-binding`, and `prefer-ngsrc`. The last three enforce `angular.md`'s class/style binding and `NgOptimizedImage` rules.
   - Lint rules catch only static template problems. Runtime axe checks are #4's job.
4. **`convex/**/*.ts`:**
   - **`@convex-dev/eslint-plugin` `recommended`, which is enabled.** It contains `no-old-registered-function-syntax`, `require-args-validator`, `explicit-table-ids`, `no-schema-import-cycle`, `no-duplicate-indexes`, and `no-process-env` as errors, and `no-filter-in-query` and `no-top-of-hour-crons` as warnings.
   - Also turned on at `error`: **`@convex-dev/require-access-control`**, which is off in `recommended`. It flags exported public functions that make no call to a function named `require*`, `assert*`, `check*`, `ensure*`, `can*`, or `has*`. This enforces `convex.md`'s "every public function authenticates the caller". The shared helpers in `convex/lib/` are named to match. A deliberately public function, such as a published schedule, carries an `eslint-disable-next-line` comment with a reason, which the PR reviewer sees.
   - `no-collect-in-query` and the experimental `import-wrong-runtime` stay off.
   - Because `lint` runs with `--max-warnings=0`, the two warning rules fail the check too. A justified `.filter()` on an index-bounded result needs a disable comment with a reason.
5. **Root `*.js`, `*.mjs`, `*.cjs`** (config files): `@eslint/js` `recommended` only, with no type information.

### Restricted-imports rule for #11

#11 uses ESLint's **core `no-restricted-imports`** rule. No extra package is needed. It sits in its own config block:

```js
{
  files: ['src/**/*.ts'],
  ignores: ['src/app/core/data/convex/**'], // adapter folder fixed by the #5 ADR
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{
        name: 'convex/browser',
        message: 'Use the Convex adapter in src/app/core/data/convex/ (docs/conventions/angular.md).',
      }],
    }],
  },
}
```

- `allowTypeImports` stays at its default of `false`, so `import type` from `convex/browser` is also blocked outside the adapter. Test fakes get the client type from the adapter's injection token.
- The rule checks static `import`/`export` only, not dynamic `import()`. PR review covers that remaining case.
- `convex/server` and `convex/values` stay allowed, because components need `FunctionReference` types and `api` from `convex/_generated/api`.

### Covered file types

| Files | ESLint | Prettier |
| --- | --- | --- |
| `src/**/*.ts` (app, specs) | Rule sets 1 and 2, plus restricted imports | Yes |
| `src/**/*.html` and inline templates | Rule set 3 | Yes, `angular` parser (override scoped to `src/**/*.html`) |
| `src/**/*.{css,scss}` | No | Yes |
| `convex/**/*.ts` (except `_generated/`) | Rule sets 1 and 4 | Yes |
| e2e specs (directory per #4) | Rule set 1 | Yes |
| Root config files (`*.{js,mjs,cjs,ts}`) | Rule set 1 or 5 | Yes |
| `design/mockups/**/*.html` | No: these are static HTML, not Angular templates, and their accessibility is checked when the designer reviews the mockup | Yes, `html` parser |
| Markdown: `docs/**/*.md`, `*.md`, `.claude/**/*.md`, `.github/**/*.md` | No | Yes, with `proseWrap: "preserve"` so existing line breaks stay |
| YAML: `.github/workflows/*.yml`, `.github/ISSUE_TEMPLATE/*.yml` | No; workflow linting is #8's decision | Yes |
| JSON: `package.json`, `angular.json`, `tsconfig*.json`, `.vscode/*.json` | No | Yes |

**`.prettierrc`:**

- It keeps the Angular CLI's generated options (`printWidth: 100`, `singleQuote: true`).
- **Scope the CLI's `*.html` override to `src/**/*.html`.** The generated override applies the `angular` parser to every `*.html`, which would parse the plain-HTML mockups as Angular templates and can fail on literal `{`, `}`, or `@` in their text.
- Add `design/mockups/**/*.html` with `parser: "html"` and `**/*.md` with `proseWrap: "preserve"`.

### Ignore list

ESLint's flat config does not read `.gitignore`, so its ignores go in `globalIgnores([...])` in `eslint.config.mjs`. Prettier reads `.gitignore` when run from the repo root and also gets a `.prettierignore`. Both tools ignore:

- `convex/_generated/` (generated by Convex, including `ai/guidelines.md`)
- `dist/`, `.angular/`, `out-tsc/`, `coverage/` (Angular build output, CLI cache, test coverage)
- `playwright-report/`, `test-results/`, `blob-report/` (e2e output if #4 picks Playwright; otherwise that runner's output directories)
- **Lockfiles, all four listed so the list holds for any #1 outcome:** `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, and `bun.lock`/`bun.lockb`. Only Prettier would touch these, but they are listed for both tools.
- `node_modules/` (both tools' default), `.yarn/`, `.pnpm-store/`
- `.env*` (never formatted; also gitignored per #10)

### Scripts the scaffold (#10) adds

`lint` and `format:check` are separate scripts, so CI (#12) reports them as separate checks.

| Script | Command | Used by |
| --- | --- | --- |
| `lint` | `eslint . --max-warnings=0` | Dev cycle "lint" check; CI |
| `format:check` | `prettier . --check` | CI; the dev cycle's lint step includes it |
| `lint:fix` | `eslint . --fix` | Local convenience |
| `format` | `prettier . --write` | Local convenience |

- Scripts run with whatever runner #1 picks: `npm run lint`, `pnpm lint`, `yarn lint`, or `bun run lint`.
- `ng add angular-eslint` also adds an `ng lint` target to `angular.json`. It may stay, but the scripts call `eslint .` directly so that `convex/` and the root files are covered too.
- In the dev cycle, "lint green" means both `lint` and `format:check` exit 0.

## Consequences

- **New devDependencies:** the six packages in the table. They all have permissive licences, cost nothing, and run no install lifecycle scripts.
- **Setup steps in #10:**
  1. Run `ng new` (which brings Prettier), then `ng add angular-eslint`.
  2. Rename or convert the generated `eslint.config.js` to ESM (`eslint.config.mjs`), add the Convex, restricted-imports, and extra-rule blocks, and add the global ignores.
  3. Edit `.prettierrc` and add `.prettierignore`.
  4. Run `prettier . --write` once.
- **First-run diff:** that one-time `prettier . --write` reformats existing Markdown, YAML, and HTML in the repo (`AGENTS.md`, `docs/`, `.github/`, `.claude/`). The diff is formatting-only and excluded from #10's 400-line budget, the same way generated files are.
- **Convex authors:**
  - Every public function needs a `require*`/`assert*`/`check*`/`ensure*`/`can*`/`has*` call, or a disable comment with a reason.
  - `.filter()` in queries needs a disable comment with a reason.
  - `process.env` in `convex/` is replaced by Convex's typed `env` object.
- **Lint speed:** type-aware linting makes `lint` slower than a syntax-only lint. Acceptable at this size; revisit only if `lint` exceeds roughly a minute in CI.
- **Harder later:** moving to TypeScript 7 waits on typescript-eslint support as well as Angular support. Replacing Prettier or ESLint later (for example with Biome once it supports Angular templates) needs a new ADR that supersedes this one.
- **No local enforcement before push.** Contributors and agents run `lint` and `format:check` themselves, and CI catches anything missed.

## Sources

- npm registry, checked 2026-10-07 for versions, licences, peer dependencies, engines, and install scripts:
  - [eslint](https://www.npmjs.com/package/eslint)
  - [@eslint/js](https://www.npmjs.com/package/@eslint/js)
  - [typescript-eslint](https://www.npmjs.com/package/typescript-eslint)
  - [angular-eslint](https://www.npmjs.com/package/angular-eslint)
  - [@convex-dev/eslint-plugin](https://www.npmjs.com/package/@convex-dev/eslint-plugin)
  - [prettier](https://www.npmjs.com/package/prettier)
  - [@biomejs/biome](https://www.npmjs.com/package/@biomejs/biome)
  - [oxlint](https://www.npmjs.com/package/oxlint)
  - [husky](https://www.npmjs.com/package/husky)
  - [lefthook](https://www.npmjs.com/package/lefthook)
  - [lint-staged](https://www.npmjs.com/package/lint-staged)
  - [@commitlint/cli](https://www.npmjs.com/package/@commitlint/cli)
  - [@angular/compiler-cli](https://www.npmjs.com/package/@angular/compiler-cli)
  - [typescript](https://www.npmjs.com/package/typescript)
- Angular CLI workspace schematic 22.2.2 (Prettier dependency and `.prettierrc`): [packages/schematics/angular/workspace/files](https://github.com/angular/angular-cli/tree/main/packages/schematics/angular/workspace/files)
- angular-eslint:
  - [README](https://github.com/angular-eslint/angular-eslint/blob/main/README.md)
  - [Configuring ESLint](https://github.com/angular-eslint/angular-eslint/blob/main/docs/CONFIGURING_ESLINT.md)
  - `@angular-eslint/schematics` 22.5.0 `ng-add` source
  - `angular-eslint` 22.5.0 `dist/configs`
- Convex:
  - [ESLint docs](https://docs.convex.dev/eslint)
  - `@convex-dev/eslint-plugin` 5.0.0 `dist/esm/index.js` (recommended rules, ESM/CJS behaviour)
- ESLint: [no-restricted-imports](https://eslint.org/docs/latest/rules/no-restricted-imports)
- typescript-eslint: [Typed linting](https://typescript-eslint.io/getting-started/typed-linting)
- Prettier: [Ignoring code](https://prettier.io/docs/ignore)
- Biome:
  - [Language support](https://biomejs.dev/internals/language-support/)
  - [Configuration](https://biomejs.dev/reference/configuration/)
  - [noRestrictedImports](https://biomejs.dev/linter/rules/no-restricted-imports/)
  - [Roadmap 2026](https://biomejs.dev/blog/roadmap-2026/)
