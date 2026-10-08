# Omni League

League management for recreational sports. Angular (hybrid rendering) on the frontend, Convex on the backend. Product requirements: [docs/product/requirements.md](docs/product/requirements.md). Contributor and agent rules: [AGENTS.md](AGENTS.md).

## Local development

### Prerequisites

- Node.js 26.11 or later, with the npm 11 it bundles (ADR 0003). `nvm install` in the repo root reads `.nvmrc`. Other Node or npm versions fail the install with `EBADDEVENGINES`.
- No Convex account is needed: development uses an anonymous local Convex backend.

### Install

```sh
npm ci
```

`.npmrc` enforces the install policy: dependency install scripts fail unless listed in `allowScripts`, and versions published less than a day ago are not resolved.

### Run the Convex backend

Before the first run, copy the committed example so the CLI keeps the variable name `CONVEX_URL`. Without it, the CLI sees `vite` in `package.json` and writes `VITE_CONVEX_URL`, which the app does not read.

```sh
cp .env.example .env.local
CONVEX_AGENT_MODE=anonymous npx convex dev
```

The first run downloads the local backend binary, starts it on `http://127.0.0.1:3210`, and writes the deployment name and `CONVEX_URL` to `.env.local` (gitignored). Its state lives in `.convex/` (gitignored). It keeps watching `convex/` and pushes changes. Add `--once` to push once and exit. Anonymous mode is in beta in the Convex CLI.

### Run the app

```sh
npm start              # ng serve on http://localhost:4200
```

`npm start` and `npm run build` run through `scripts/ng-convex.mjs`. It takes the Convex URL from `CONVEX_URL` in the environment or else from `.env.local`, checks it, and compiles it in. It prints `Convex URL: <url> (from <source>), site: <site-url>`, or `Convex URL: none`, in which case the app runs with no Convex client (see [the adapter README](src/app/core/data/convex/README.md)). Extra arguments go to `ng`: `npm run build -- --configuration development`.

### Build and run the SSR server

```sh
npm run build          # browser bundle, server bundle, and prerendered routes in dist/omni-league/
npm run serve:ssr      # node dist/omni-league/server/server.mjs on http://localhost:4000 (set PORT to change)
```

The server only answers requests whose `Host` is `localhost` or `127.0.0.1` (`security.allowedHosts` in `angular.json`); any other host gets HTTP 400.

### Checks

All checks run without a Convex deployment, `.env.local`, or Convex credentials.

```sh
npm run lint           # ESLint
npm run format:check   # Prettier (npm run format to fix)
npm run typecheck      # tsc over the app, specs, tooling files, and convex/
npm test               # Angular unit tests (Vitest through ng test)
npm run test:convex    # Convex function tests (convex-test on Vitest)
npm run build
```

### Regenerating `convex/_generated/`

`convex/_generated/` is committed. After changing anything under `convex/`, regenerate it and commit the result:

```sh
CONVEX_AGENT_MODE=anonymous npx convex dev --once
```

`npx convex ai-files install` refreshes `convex/_generated/ai/guidelines.md`. It also writes Convex sections into `AGENTS.md` and `CLAUDE.md` and installs agent skills under `.claude/` and `.agents/`; those extra changes are not committed.
