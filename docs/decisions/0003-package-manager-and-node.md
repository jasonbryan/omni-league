# 0003: Package manager and Node.js version

- **Status:** Proposed
- **Gate:** `gate:technology`
- **Issue:** #1
- **Date:** 2026-10-07 (revised 2026-10-07 for ADR 0006 hybrid rendering)

## Context

No package manager or Node.js version is accepted yet. The scaffold (#10), the CI decision (#8), and the CI pipeline (#12) all depend on this one. The decision covers:

1. The package manager, and how its binary is installed and version-pinned on a fresh machine and on GitHub-hosted runners.
2. The Node.js major, its Active LTS and end-of-life dates, how it is pinned, and the planned upgrade point.
3. The policy for dependency lifecycle scripts, and whether a minimum release age or an audit step is used.
4. Whether the repository is one root package or a workspace, and the directory layout #10 follows.

Constraints from #1:

- ADR 0001 requires Angular (latest stable major) and Convex, so `ng new --package-manager` and `npx convex ...` must work.
- CI must install with a frozen lockfile and cache dependencies.
- The pin must be machine-readable.
- Corepack must not be assumed. Node.js stopped shipping it from v25 onward, following a TSC vote on 2025-03-19 ([Node.js Corepack docs](https://nodejs.org/download/release/latest-v25.x/docs/api/corepack.html)). This ADR confirmed it: the `bin/` directory of the Node 26.11.0 macOS tarball contains only `node`, `npm`, and `npx`.

### State of the tools on 2026-10-07

| Item | Current version | Source |
| --- | --- | --- |
| Angular | 22.2.1 (`@angular/core`), CLI 22.2.2. Node range `^22.22.3 \|\| ^24.15.0 \|\| ^26.0.0`; TypeScript `>=6.0.0 <6.1.0` | [angular.dev/reference/versions](https://angular.dev/reference/versions), npm registry `engines` |
| Angular 23 | Planned for about June 2027 | [angular.dev/reference/releases](https://angular.dev/reference/releases) |
| `convex` | 1.46.0 (Apache-2.0), engines `node >=20.0.0` | [npm: convex](https://www.npmjs.com/package/convex) |
| Convex `"use node"` action runtime | Node 20 (default), 22, or 24, set by `node.nodeVersion` in `convex.json` | [Convex: runtimes](https://docs.convex.dev/functions/runtimes), [project configuration](https://docs.convex.dev/production/project-configuration) |
| Node.js 26 | 26.11.0 (2026-10-07), bundles **npm 11.20.0** | [nodejs.org/dist/index.json](https://nodejs.org/dist/index.json) |
| Node.js 24 | 24.21.0 (2026-09-07), bundles npm 11.19.0 | same |

### Node.js release schedule

From the Node.js Release working group's [schedule.json](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json) and [README](https://github.com/nodejs/Release/blob/main/README.md):

| Line | First release | Active LTS start | Maintenance start | End of life |
| --- | --- | --- | --- | --- |
| 24 (Krypton) | 2025-05-06 | 2025-10-28 | **2026-10-20** | 2028-04-30 |
| 26 | 2026-05-05 | **2026-10-28** | 2027-10-20 | **2029-04-30** |
| 27 | Alpha from 2026-10-28; Current from 2027-04-22 | October 2027 | — | 2030-04-30 |

Starting with Node 27, Node.js ships one major per year (April), and every major becomes LTS in October. Odd-numbered lines no longer stay non-LTS, and a new Alpha channel replaces their early-testing role ([Node.js blog: Evolving the Node.js Release Schedule](https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule)). Node 26 is the last line under the old model.

### Assumptions about decisions still open

| Open decision | What this ADR assumes | What happens if the decision goes the other way |
| --- | --- | --- |
| #2 lint and format (PR #16) | ESLint 10, typescript-eslint 8, angular-eslint 22, `@convex-dev/eslint-plugin` 5, Prettier 3; TypeScript stays on 6.0.x. | All of these were installed in the test below. None has an install script, and all are compatible with npm's hoisted `node_modules`. |
| #3 unit and Convex test runners | Vitest (Angular 22's default), `convex-test`, `@edge-runtime/vm`. | These were installed in the test and have no install scripts. Any other runner that has one needs an `allowScripts` entry (see the lifecycle-script policy). |
| #4 e2e and accessibility | Possibly `@playwright/test` and `@axe-core/playwright`. | These were installed in the test and have no install scripts. Playwright browsers are installed by an explicit `npx playwright install` command, not by a lifecycle script, so the script policy does not affect them. |
| #5 Angular baseline (PR #18, ADR 0006) | **Hybrid rendering** (`@angular/ssr`, `outputMode: "server"`): public Convex-backed routes render on the server per request, static pages are prerendered, and `/app/**` is client-only. This adds `@angular/ssr`, `@angular/platform-server`, and `express` (dependencies) and `@types/express` and `@types/node` (devDependencies). | **None of these has an install script, and none pulls one in** (tested below), so the `allowScripts` map stays at five entries. The build still runs on Node 26. The production server's Node major is #9's choice, within Angular 22's range `^22.22.3 \|\| ^24.15.0 \|\| ^26.0.0`. It does not have to match `devEngines`, because the server bundle needs no `node_modules` at runtime (see "Server runtime and `devEngines`"). If #5 went back to CSR only, these five packages would drop out and nothing else here would change. |
| #6 UI and styling | Unknown packages. | The #6 ADR must list any of its packages that have install scripts (for example native CSS engines), with an allow or deny entry and a reason. Otherwise the first install fails under the strict policy below, which is intended. |
| #7 auth provider (PR #25, ADR 0008) | `@convex-dev/better-auth` 0.12.x and `better-auth` 1.6.x (dependencies), plus one npm `overrides` entry for a `vitest` peer conflict. | **No install scripts in the tree**, so the `allowScripts` map stays at five entries. The `overrides` entry is recorded below ("npm `overrides`"). If #7 chose another provider, the entry and this row drop out. |
| #8 CI | GitHub-hosted Ubuntu runners, `actions/setup-node`, Dependabot or Renovate for updates. | See Consequences, "Effects on other issues". |

## Options

### Package manager

Licences and versions are from the npm registry on 2026-10-07.

#### Option A: npm 11, as bundled with Node.js 26

- **What it is.** npm 11.20.0 ships inside Node 26.11.0. Licence Artistic-2.0, free. No separate installation.
- **Pros.**
  - **Nothing to bootstrap.** Installing Node installs npm, on laptops and on runners. No Corepack, setup action, or install script is needed, and #8 needs one third-party action fewer to pin.
  - **Default for both CLIs.** `ng new` defaults to npm, and Convex's docs use `npx convex`.
  - **Dependabot supports it.** GitHub's supported-ecosystems table lists npm v7 to v11 ([GitHub docs](https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories)).
  - **Fail-closed install-script policy, tested.** Dependency scripts are governed by an `allowScripts` map in `package.json`. With `strict-allow-scripts=true` in `.npmrc`, `npm ci` fails with `ESTRICTALLOWSCRIPTS` when a dependency has an install script that is not listed ([npm config docs](https://docs.npmjs.com/cli/v11/using-npm/config)).
  - **Minimum release age.** `min-release-age` (in days) is enforced at resolution. A too-new version fails with `ETARGET` rather than falling back silently. Tested.
  - **Engine pins enforced.** `devEngines.runtime` and `devEngines.packageManager` with `onFail: "error"` fail the install on the wrong Node or npm (`EBADDEVENGINES`). Tested.
  - **Registry signatures.** `npm audit signatures` verifies registry signatures and provenance attestations: 204 packages in the test tree have verified attestations.
  - **CI caching built in.** `actions/setup-node` caches npm automatically when `devEngines.packageManager` names npm.
- **Cons and risks.**
  - **npm's version follows Node's.** The exact npm version depends on the Node patch release, so `devEngines.packageManager` pins a range (`^11.20.0`), not an exact version.
  - **Hoisted `node_modules`.** Code can import a package that is not declared in `package.json` (a phantom dependency) without an error. ADR 0002 adds no import-plugin rule to catch this, so PR review does.
  - **Fewer supply-chain controls than pnpm.** npm has no trust-downgrade check. Exclusions from `min-release-age` match package names, not exact versions.
  - **`package-lock.json` is verbose JSON.** Lockfile diffs are larger than with pnpm's YAML.
  - **Unlisted install scripts run by default on npm 11.** They are blocked only because `.npmrc` sets `strict-allow-scripts=true`. If that line is lost, unlisted scripts run with only a warning, which the test confirmed for `esbuild`.

#### Option B: pnpm 12

- **What it is.** pnpm 12.10.1 (MIT), a Rust rewrite shipped as a native executable. 12.0.0 was released on 2026-08-26 ([pnpm 12 release notes](https://pnpm.io/blog/releases/12.0)).
- **Pros.**
  - **Secure defaults.**
    - Dependency builds are blocked unless listed in `allowBuilds`. `strictDepBuilds` defaults to `true`, so an unreviewed build fails the install ([pnpm build settings](https://pnpm.io/settings/build)).
    - `minimumReleaseAge` defaults to 1440 minutes, and setting it explicitly makes it strict. `trustPolicy: no-downgrade` fails when a package's publishing trust level drops. `blockExoticSubdeps` defaults to `true` ([pnpm dependency-resolution settings](https://pnpm.io/settings/dependency-resolution)).
  - **Exact package-manager pin.** The `packageManager` field pins an exact pnpm version. With `pmOnFail: download` (the default), a different pnpm on PATH switches to the pinned one. The lockfile records the pinned pnpm's platform binaries with integrity hashes (`packageManagerDependencies`). Tested.
  - **Catches undeclared imports.** The strict `node_modules` layout fails on phantom dependencies.
  - **Readable diffs.** The YAML lockfile is compact. `minimumReleaseAgeExclude` entries are exact versions, so each one is visible and reviewable.
- **Cons and risks.**
  - **Must be bootstrapped.** On a fresh machine that means the standalone script ([pnpm installation](https://pnpm.io/installation)) or `npm i -g pnpm`. On CI it means `pnpm/action-setup@v6`, one more third-party action for #8 to pin.
  - **Dependabot support is not documented.** GitHub's table lists pnpm v7 to v10 only, not 11 or 12. #8 would have to adopt Renovate or verify Dependabot against a pnpm 12 lockfile first.
  - **Young major.** The Rust rewrite is six weeks old, with ten minor releases since. pnpm 12's own release notes list behaviour changes from 11.
  - **Config file name.** pnpm reads its settings from `pnpm-workspace.yaml` even in a single-package repository, which can be mistaken for a workspace.

#### Option C: Yarn 4 (Berry)

- **What it is.** Yarn 4.18.1 (`@yarnpkg/cli-dist`, BSD-2-Clause).
- **Pros.**
  - Dependency scripts are off by default (`enableScripts: false`).
  - Has an age gate (`npmMinimalAgeGate`) ([Yarn configuration](https://yarnpkg.com/configuration/yarnrc)).
  - Supported by `ng new`.
- **Cons and risks.**
  - **Relies on Corepack.** Yarn's docs recommend Corepack for pinning the binary, and Corepack is gone from Node 25+. The alternative, `yarnPath`, commits a Yarn release file to the repo.
  - **PnP by default.** `nodeLinker` defaults to `pnp`. ADR 0002 does not assume PnP, so `node-modules` would have to be forced.
  - **Most configuration surface.** It needs `.yarnrc.yml`, the linker choice, and an install method. It gains nothing over A or B for this project.

#### Option D: Bun 1.4 (as package manager only)

- **What it is.** Bun 1.4.2 (MIT). Supported by `ng new --package-manager bun`.
- **Pros.**
  - Very fast installs, a text lockfile (`bun.lock`), and `bun ci` for frozen installs.
  - A `minimumReleaseAge` setting ([Bun install docs](https://bun.com/docs/pm/cli/install)).
  - Lifecycle scripts are blocked except for a built-in trusted list ([Bun lifecycle docs](https://bun.com/docs/pm/lifecycle)).
- **Cons and risks.**
  - **Implicit trust.** The built-in trusted list is not stated in the docs and includes `esbuild`, so packages run scripts that the repository never reviewed. Setting `trustedDependencies` replaces that list rather than extending it.
  - **A second runtime.** Bun must be installed next to Node, through a setup action on CI or a curl script locally. Angular and Convex both document Node, not Bun.

#### Also considered: npm 12

npm 12.2.0 blocks dependency install scripts by default and sets `allow-git` to `none` by default ([npm v12.0.0 release](https://github.com/npm/cli/releases/tag/v12.0.0)). Node 26 still bundles npm 11, so npm 12 would need `npm i -g npm@12` on every machine and runner. Dependabot's table also stops at npm 11. The policy below gets npm 12's script and git behaviour on npm 11 through `.npmrc`, so npm 12 adds nothing yet.

### Node.js line

| Option | Pros | Cons |
| --- | --- | --- |
| **Node 24** | Same major as Convex's newest `"use node"` action runtime. | Leaves Active LTS on **2026-10-20**, 13 days from now, and becomes maintenance-only (security and critical fixes). EOL 2028-04-30, so a move to 26 would be needed within about a year. |
| **Node 26** | Active LTS from **2026-10-28**, 21 days from now. EOL **2029-04-30**, one year after 24. It is the last line of the old schedule and the newest Angular 22 supports. Tested on 26.11.0: install, `ng build`, `ng test`, ESLint, and Convex's esbuild all work. | It is "Current", not LTS, for the next 21 days, before any production deploy exists (hosting, #9, is blocked). It is two majors ahead of Convex's newest `"use node"` runtime (24). |

### Repository layout

| Option | Assessment |
| --- | --- |
| **Single root package** | The Angular CLI generates the app at the root (`src/`, `public/`, `angular.json`), and `convex/` sits beside it with one shared `package.json`, the layout of Convex's quickstarts. The app imports `convex/_generated/api` by relative path, with no cross-package build step. It needs one lockfile, one install, and one CI cache key, and no workspace features. |
| Workspace (for example `apps/web` and `packages/backend`) | Separates dependencies. However, Convex's generated `api` types would have to be exported across packages. Every tool's globs gain a prefix (ADR 0002 already notes this). It adds workspace configuration and cross-package versioning for one app with one backend and nothing shared to publish. |

## Recommendation

**npm 11 (as bundled with Node.js 26), Node.js 26, single root package.**

- **Why npm.** npm with the policy below gives the controls #1 asks for: a fail-closed script allow-list, a strict minimum release age, enforced Node and npm pins, and a signature check. It needs no bootstrap tool on any machine, so the Corepack question disappears. It is the only candidate that is both the default for both CLIs and on Dependabot's documented support list.
- **Why not pnpm.** pnpm 12 has the stronger supply-chain defaults and would be the choice if those outweighed the extra bootstrap step, the undocumented Dependabot support, and a six-week-old major.
- **What would reverse it.** If #8 picks Renovate, or Dependabot documents pnpm 12, switching to pnpm is a small, self-contained change: a new lockfile and a config file. It would go through a superseding ADR.

**Why Node 26.** It enters Active LTS before any code beyond the scaffold lands, and it stays supported a year longer than 24. Pinning 24 now would mean pinning a line that enters maintenance in 13 days and then moving within a year.

### Pins

| What | Where | Value |
| --- | --- | --- |
| Node.js (enforced) | `package.json` `devEngines.runtime` | `{ "name": "node", "version": "^26.11.0", "onFail": "error" }` |
| npm (enforced) | `package.json` `devEngines.packageManager` | `{ "name": "npm", "version": "^11.20.0", "onFail": "error" }` |
| Node.js (local version managers) | `.nvmrc` | `26`, read by nvm, fnm, and mise |
| Dependency engines | `.npmrc` | `engine-strict=true`, so a dependency whose `engines` excludes the running Node fails the install. All tested packages pass on 26.11.0. |

The minimum `26.11.0` is chosen because it is the first Node 26 release that bundles npm 11.20.0. That is the version tested with `allowScripts` and `strict-allow-scripts`. #10 deletes the `packageManager` field that `ng new` writes. Without Corepack nothing enforces it, and `devEngines.packageManager` replaces it. The `cli.packageManager: "npm"` entry in `angular.json` stays.

### Installing the package-manager binary

- **Fresh machine:** install Node 26 (for example `nvm install` in the repo root, which reads `.nvmrc`). npm comes with it. No other step is needed.
- **CI runners:** `actions/setup-node` with `node-version-file: package.json` reads `devEngines.runtime`, which is documented in setup-node's [advanced usage](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md). npm comes with that Node. If the setup-node version that #8 pins lacks `devEngines.runtime` support, point it at `.nvmrc` instead. A drift between the two files then fails the install through `devEngines`. No package-manager setup action is needed.
- **Install commands:** `npm ci` in CI and on a fresh clone (frozen: it fails if `package.json` and `package-lock.json` disagree). `npm install <pkg>` when changing dependencies. Lockfile: `package-lock.json` (lockfileVersion 3), committed.

### Server runtime and `devEngines`

ADR 0006's hybrid rendering adds a production Node process: `node dist/<app>/server/server.mjs`. The pins above apply where `npm` runs (laptops, CI, and any host build step), not where the built server runs.

- **The server bundle is self-contained.** The Angular build bundles Express, `@angular/ssr`, and the app into `dist/<app>/server/*.mjs`. Those files import only Node built-ins (`node:path`, `node:url`, `node:process`). A copy of `dist/` run on **Node 24.16.0**, with no `node_modules` anywhere above it, served the Server route with its data, `Cache-Control` header, and `ng-state`. Tested; see item 6.
- **So the runtime Node major can differ from `devEngines`.** A host that deploys `dist/` and runs it on Node 22.22.3+, 24.15+, or 26 works, because nothing on the runtime runs `npm ci`. A host that **builds** on its own image must provide Node 26.11+ for the build, or the install fails on `devEngines`. That is the existing #9 constraint below.
- **Typing server code.** `src/server.ts` and anything it imports run on the runtime's Node. If #9 picks a runtime major below 26, `@types/node` is set to **that** major, not 26, so that a Node 26-only API in server code fails `typecheck`. This follows the same rule as Convex `"use node"` actions. It narrows ADR 0006's "pin `@types/node` to the Node major from #1". Build-time scripts (`scripts/ng-convex.mjs`) use only APIs present in Node 24 (`util.parseEnv` is stable from 24.10.0), so one `@types/node` major covers both.

### Lifecycle-script policy: allow-list, fail closed

- **`package.json` `allowScripts`:** an explicit map, with every entry denied unless a reason to allow it is recorded in the PR that adds it.
- **`.npmrc`:** `strict-allow-scripts=true`, so any dependency with an install script that is not in the map fails `npm install` and `npm ci`. Adding a dependency with a script therefore forces an explicit, reviewed `true` or `false` entry. A single PR can approve or deny an entry with `npm install-scripts approve <pkg>` or `npm install-scripts deny <pkg>`.
- **`.npmrc`:** `allow-git=none`, so no dependency can come from a git URL (npm 12's default).

Packages with install scripts in a real Angular 22.2 + Convex 1.46 tree (see Test evidence):

| Package | Script | Pulled in by | Entry | Why it can be denied |
| --- | --- | --- | --- | --- |
| `esbuild` (0.28.2 and 0.27.0) | `postinstall: node install.js` | `@angular/build`, `vite` (0.28.2); `convex` (0.27.0) | `false` | The platform binary comes from an optional dependency (`@esbuild/linux-x64` on CI). esbuild's docs say that without the script "API usage is largely unaffected" and only the `.bin` shim is slower ([esbuild: getting started](https://esbuild.github.io/getting-started/)). |
| `lmdb` | `install: node-gyp-build-optional-packages` | `@angular/build` (build cache) | `false` | Loads the prebuilt `@lmdb/lmdb-<platform>`; the script only compiles from source when no prebuilt exists. |
| `msgpackr-extract` | `install: node-gyp-build-optional-packages` | `lmdb` → `msgpackr` | `false` | Same mechanism (`@msgpackr-extract/msgpackr-extract-<platform>`). |
| `@parcel/watcher` | `install: node scripts/build-from-source.js` | `@angular/build`, `sass` | `false` | Loads the prebuilt `@parcel/watcher-<platform>`; the script only builds from source. |
| `fsevents` | `install: node-gyp rebuild` | file watching (macOS only) | `false` | It ships a prebuilt binary. It is not installed on Linux CI. npm reports it on macOS; pnpm did not. |

All four Linux-relevant packages publish `linux-x64` prebuilds (checked on the registry), so CI needs no scripts.

With all five denied, the system ran `ng build`, `ng test` (Vitest), and an esbuild bundle through Convex's own copy of esbuild, on both Node 24.16.0 and Node 26.11.0. All passed.

`@playwright/test`, `@axe-core/playwright`, `convex-test`, `@edge-runtime/vm`, the ESLint packages, and Prettier have no install scripts.

**SSR packages (ADR 0006).** `@angular/ssr` 22.2.1, `@angular/platform-server` 22.2.1, `express` 5.2.1, `@types/express` 5.0.6, and `@types/node` 26.6.4 have no install scripts. The same is true of their transitive dependencies, including `beasties` 0.5.4 (Apache-2.0) and the Express middleware tree. A tree with them added installed under `strict-allow-scripts=true` with only the five entries above. Its lockfile marks `hasInstallScript` on exactly the same packages (`esbuild` twice, `lmdb`, `msgpackr-extract`, `@parcel/watcher`, `fsevents`). With all five denied, the SSR build and its Node server worked (Test evidence, item 6).

**Auth packages (ADR 0008, PR #25).** `@convex-dev/better-auth` 0.12.5, `better-auth` 1.6.33, and their transitive dependencies (`convex-helpers`, `jose`, `zod`, `kysely`, `nanostores`, `better-call`, `@noble/*`, `@better-auth/*`) have no install scripts. ADR 0008's scratch install found `hasInstallScript` only on `esbuild`. The system re-checked on 2026-10-07 by resolving `@convex-dev/better-auth@0.12.5`, `better-auth@1.6.33`, `convex@1.46.0`, and `vitest@5.0.3` with the override below (`npm install --package-lock-only --ignore-scripts`, npm 11.13.0 on Node 24.16.0): the lockfile marks `hasInstallScript` only on `esbuild` (from `convex` and `vite`) and `fsevents` (from `vite`), both already denied in the map. **No new `allowScripts` entry is needed.**

### npm `overrides`

- **Policy:** an `overrides` entry in `package.json` is allowed only when it is recorded in the ADR that needs it, with the conflict it resolves and the condition for removing it. No other overrides.
- **Current entry (ADR 0008):** `"overrides": { "better-auth": { "vitest": "$vitest" } }`.
  - **Conflict:** `better-auth` 1.6.x declares an optional peer `vitest ^2 || ^3 || ^4`, and ADR 0004 uses `vitest` 5.0.3, so `npm install` fails with `ERESOLVE` (`peerOptional vitest@"^2.0.0 || ^3.0.0 || ^4.0.0" from better-auth@1.6.33`). Reproduced on 2026-10-07 without the entry; with it, resolution succeeds and the lockfile has a single `vitest@5.0.3`.
  - **Effect:** `$vitest` points the peer at the root `vitest` devDependency, so no second Vitest is installed and the version stays under ADR 0004's control.
  - **Added by:** the first PR that installs `better-auth` (the sign-in feature), not #10.
  - **Removed when:** `@convex-dev/better-auth` accepts `better-auth` 1.7, which accepts Vitest 5. That bump is a minor one and needs no gate (ADR 0008).
- `npm ci` honours `overrides` from `package.json` and the lockfile, so CI (#12) needs no flag. `--legacy-peer-deps` and `--force` are not used.

The repository's own scripts (for example a root `prepare`) are not covered by `allowScripts`. ADR 0002 adds none.

### Minimum release age and audit

- **Minimum release age: yes, 1 day.** Set with `min-release-age=1` in `.npmrc`. A version published less than 24 hours earlier cannot be resolved, which gives the registry time to pull compromised releases.
  - npm's exclusions (`min-release-age-exclude[]=<name>`) match every version of a package, so the policy is **no standing exclusions**.
  - If a range can only be met by a too-new version, lower the range floor to the previous release (for example `^22.2.1` instead of `^22.2.2`) or wait a day.
  - This applies the day #10 runs `ng new`: Angular CLI 22.2.2 was published at 07:13 UTC today, and the test install failed `ETARGET` on it as intended.
  - `npm ci` installs from the lockfile and is not affected.
- **Signature audit: yes.** `npm audit signatures` runs as a CI step and fails on missing or invalid registry signatures. It needs no configuration file. The step itself is defined by #8 and #12.
- **Vulnerability audit: not a blocking step.** A blocking `npm audit` fails unrelated PRs whenever an advisory is published. Advisories reach the repository through GitHub's Dependabot alerts and security updates, which #8 configures.

### Repository layout for #10

```text
/
├── package.json          # one package: Angular app + Convex functions + tooling; devEngines; allowScripts
├── package-lock.json
├── .npmrc                # strict-allow-scripts, allow-git, min-release-age, engine-strict
├── .nvmrc                # 26
├── angular.json          # cli.packageManager: "npm"; project root ""
├── tsconfig.json, tsconfig.app.json, tsconfig.spec.json
├── src/                  # Angular app (main.ts, index.html, styles, app/)
├── public/               # static assets
├── convex/               # schema.ts, functions, _generated/ (committed), tsconfig.json
├── e2e/                  # per #4 (directory name may change there)
├── design/mockups/, docs/, .github/
```

`ng new` creates the root files with `--package-manager npm`. Run `npm install convex`, then `npx convex dev`, from the same root to create `convex/`. No workspace configuration exists.

### Planned upgrade point

- **Node.** Stay on Node 26. Move to Node 27 once it enters LTS (October 2027) and the Angular major in use lists 27 in its supported range. Angular 23 is due about June 2027, and its range is not yet published. Move no later than **2028-10-31**, six months before Node 26's EOL. A Node major change is made by editing `.nvmrc` and `devEngines.runtime` together in one PR, recorded as an amendment to this ADR.
- **npm 12.** Move when a Node release used by this repository bundles npm 12, and Dependabot (or the #8 update tool) supports it.
- **Minor and patch updates** of Node 26 and npm 11 need no gate (AGENTS.md).

## Consequences

- **New tools:** Node.js 26 (MIT) and the npm 11 it bundles (Artistic-2.0). No new services, no cost.
- **Files #10 adds:** `.nvmrc`, `.npmrc` (four policy lines, no exclusions), `devEngines` and `allowScripts` in `package.json`, and `package-lock.json`. It also removes the CLI-written `packageManager` field.
- **Contributors:**
  - They need Node 26.11 or later. Other Node or npm versions fail at install with `EBADDEVENGINES`, which is deliberate. The owner's current local Node (24.16.0) needs `nvm install 26`.
  - Adding a dependency with an install script fails until the PR adds an `allowScripts` entry with a reason.
  - A same-day release cannot be installed.
- **Convex `"use node"` actions.** Local Node 26 is ahead of Convex's newest action runtime (24). Any issue that adds the first `"use node"` file must:
  - set `node.nodeVersion` to `"24"` in `convex.json` (the default is 20);
  - type `"use node"` code against `@types/node` at that major, so that APIs added after Node 24 fail `typecheck`.
  `convex-test` runs those actions on local Node 26, so tests alone do not catch runtime differences.
- **Harder later:** moving to pnpm means regenerating the lockfile and translating the policy (`allowScripts` → `allowBuilds`, `.npmrc` → `pnpm-workspace.yaml`) in a superseding ADR. Phantom imports are caught only in review.

### Effects on other issues

- **#8 (CI decision):**
  - No package-manager setup action and no Corepack step are needed. `actions/setup-node` handles both Node and npm caching (`cache: npm`, or automatic through `devEngines.packageManager`).
  - The update tool must not propose versions younger than `min-release-age`, otherwise CI fails on resolution. If Dependabot is chosen, its `cooldown` setting must be at least 1 day.
  - `npm audit signatures` should be listed as a CI step.
  - Dependabot's supported-ecosystems table lists npm up to v11. npm 11 is covered; npm 12 and pnpm 11/12 are not listed.
- **#9 (hosting):**
  - Any build image must run Node 26.11 or later, or the install fails on `devEngines`.
  - The SSR server's runtime Node major is #9's choice within Angular 22's range. The ADR states it, and if it is below 26 it also states the matching `@types/node` major (see "Server runtime and `devEngines`").
  - Deploying `dist/` needs no `npm ci` on the runtime.
- **#10 (scaffold):**
  - Follows the layout, pins, `.npmrc`, and the five-entry `allowScripts` map above. The SSR packages from ADR 0006 need no extra entry.
  - Adds no `overrides` entry; the `better-auth` entry arrives with the sign-in feature (ADR 0008).
  - The layout gains the SSR files ADR 0006 generates (`src/server.ts`, `src/main.server.ts`, `src/app/app.config.server.ts`, `src/app/app.routes.server.ts`), all in the same single root package.
  - Lowers the floor of any `ng new` range that resolves only to a version published less than a day earlier.
  - The install command is `npm ci`.
- **#12 (CI pipeline):** `npm ci`; `setup-node` reads `package.json` (or `.nvmrc`). The lockfile-mismatch check in #12 is `npm ci`'s built-in behaviour.
- **#6 (UI and styling):** must list any install-script packages it adds (see the assumptions table).
- **ADR 0002 (PR #16):** unaffected. Its packages have no install scripts and work with a hoisted `node_modules`. It also already lists `package-lock.json` in the ignore list.

## Test evidence

Run on 2026-10-07 on macOS arm64, in a scratch directory outside the repository.

1. **Project generation.** Generated with `@schematics/angular@22.2.2` (the `workspace` and `application` schematics that `ng new` runs). The system then added `convex@^1.46.0` and the packages assumed for #2, #3, and #4 (`eslint`, `@eslint/js`, `typescript-eslint`, `angular-eslint`, `@convex-dev/eslint-plugin`, `convex-test`, `@edge-runtime/vm`, `@playwright/test`, `@axe-core/playwright`). That gave 418 packages.
2. **npm 12.2.0, no policy.** Install scripts were blocked and reported for `@parcel/watcher`, `esbuild` 0.27.0 and 0.28.2, `lmdb`, `msgpackr-extract`, and `fsevents`.
3. **pnpm 12.10.1, defaults.** The install failed with `ERR_PNPM_IGNORED_BUILDS` for the same packages except `fsevents`. pnpm's default non-strict age gate also wrote six `minimumReleaseAgeExclude` entries on its own for the Angular 22.2.2 tooling packages, which had been published 16 hours earlier.
4. **pnpm 12.10.1, all builds denied.** Frozen install, `ng build`, `ng test` (2 tests), Convex's esbuild bundling, and `eslint --version` all passed, on Node 24.16.0 and on Node 26.11.0.
   - An explicit `minimumReleaseAge: 1440` failed with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` on those six packages.
   - `trustPolicy: no-downgrade` passed for the whole tree.
   - A pnpm 12.10.1 binary switched itself to a pinned `pnpm@12.10.0`.
   - `engines.node: ^26` was **not** enforced until `engineStrict: true` was set.
5. **npm 11.20.0 (Node 26.11.0), with the recommended `.npmrc` and `package.json`.**
   - `min-release-age=1` failed with `ETARGET` on `@angular/build@^22.2.2`.
   - With the five denials, `npm install` and `npm ci` passed, and the esbuild postinstall did not run (its `.bin` remained the JavaScript shim).
   - With `esbuild` removed from the map, npm 11 **ran** its postinstall with only a warning. With `strict-allow-scripts`, it failed with `ESTRICTALLOWSCRIPTS`.
   - Under Node 24.16.0, `devEngines` failed with `EBADDEVENGINES`.
   - `npm audit signatures` passed (204 packages with verified attestations).
6. **SSR packages under the same policy (added 2026-10-07 for ADR 0006), npm 11.20.0 on Node 26.11.0.**
   - Starting from an `ng new --ssr` dependency set plus `convex@1.46.0`, the system set `@types/node` to `^26.0.0` and copied the `.npmrc` and the five-entry `allowScripts` map unchanged.
   - `npm install` passed: 359 packages, no `ESTRICTALLOWSCRIPTS`.
     - Resolved versions: `@angular/ssr` 22.2.1, `@angular/platform-server` 22.2.1, `express` 5.2.1, `@types/express` 5.0.6, `@types/node` 26.6.4, `beasties` 0.5.4.
     - `@angular/ssr` 22.2.2, published the same day, was held back by `min-release-age=1`, as intended.
     - The lockfile's `hasInstallScript` entries were exactly the five denied packages.
   - `ng build` (`outputMode: "server"`) passed: it prerendered 1 route and emitted `dist/<app>/server/server.mjs`, and esbuild's postinstall did not run.
   - `node dist/<app>/server/server.mjs` returned:
     - the prerendered `/`;
     - a `RenderMode.Server` route with its data, `Cache-Control: public, max-age=0, s-maxage=30, stale-while-revalidate=60`, and the `ng-state` script;
     - the empty client shell for a `RenderMode.Client` route.
   - The same `dist/`, copied to a directory with no `node_modules` and run on **Node 24.16.0**, served the Server route identically. The server bundle imports only Node built-ins.

## Sources

- Node.js: [release schedule (schedule.json)](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json), [Release WG README](https://github.com/nodejs/Release/blob/main/README.md), [Evolving the Node.js Release Schedule](https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule), [dist index (versions, bundled npm)](https://nodejs.org/dist/index.json), [Corepack docs (removal from v25)](https://nodejs.org/download/release/latest-v25.x/docs/api/corepack.html), [licence (MIT)](https://github.com/nodejs/node/blob/main/LICENSE)
- Angular: [version compatibility](https://angular.dev/reference/versions), [releases](https://angular.dev/reference/releases); npm registry [`@angular/core`](https://www.npmjs.com/package/@angular/core), [`@angular/cli`](https://www.npmjs.com/package/@angular/cli), [`@angular/ssr`](https://www.npmjs.com/package/@angular/ssr), [`@angular/platform-server`](https://www.npmjs.com/package/@angular/platform-server), [`express`](https://www.npmjs.com/package/express), [`@types/express`](https://www.npmjs.com/package/@types/express); [server and hybrid rendering](https://angular.dev/guide/ssr)
- Convex: [`convex` on npm](https://www.npmjs.com/package/convex), [runtimes](https://docs.convex.dev/functions/runtimes), [project configuration (`node.nodeVersion`)](https://docs.convex.dev/production/project-configuration)
- npm: [npm on the registry (12.2.0, Artistic-2.0)](https://www.npmjs.com/package/npm), [v11 config (`allow-scripts`, `strict-allow-scripts`, `min-release-age`, `allow-git`)](https://docs.npmjs.com/cli/v11/using-npm/config), [v12 config](https://docs.npmjs.com/cli/v12/using-npm/config), [v12.0.0 release](https://github.com/npm/cli/releases/tag/v12.0.0)
- pnpm: [pnpm on the registry (12.10.1, MIT)](https://www.npmjs.com/package/pnpm), [installation](https://pnpm.io/installation), [build settings](https://pnpm.io/settings/build), [dependency-resolution settings](https://pnpm.io/settings/dependency-resolution), [CLI settings (`pmOnFail`)](https://pnpm.io/settings/cli), [pnpm 12 release](https://pnpm.io/blog/releases/12.0), [pnpm/action-setup](https://github.com/pnpm/action-setup)
- Yarn: [`@yarnpkg/cli-dist` (4.18.1, BSD-2-Clause)](https://www.npmjs.com/package/@yarnpkg/cli-dist), [`.yarnrc.yml` reference](https://yarnpkg.com/configuration/yarnrc)
- Bun: [`bun` on the registry (1.4.2, MIT)](https://www.npmjs.com/package/bun), [install](https://bun.com/docs/pm/cli/install), [lifecycle scripts](https://bun.com/docs/pm/lifecycle)
- esbuild: [getting started (install script)](https://esbuild.github.io/getting-started/)
- GitHub: [Dependabot supported ecosystems](https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories), [actions/setup-node](https://github.com/actions/setup-node), [setup-node advanced usage](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md)
