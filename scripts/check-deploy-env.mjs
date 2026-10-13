// Deploy environment check (#15; ADR 0005, ADR 0008, ADR 0010, ADR 0011). Node built-ins only.
//
//   node scripts/check-deploy-env.mjs preview --preview-name <name>
//   node scripts/check-deploy-env.mjs production [--preview-name <name>]
//
// It reads which environment variables are set on one Convex deployment and fails (exit 1) when a
// forbidden one is present or a required one is missing, so the Netlify build fails and nothing is
// published. Every failure names the variable. It never prints a value: it reads only variable
// names (`npx convex env list --names-only`), plus the value of AUTH_EMAIL_DISABLED in preview mode,
// which it compares in memory. It prints the name of the deployment it checked.
//
// - preview: IS_TEST must be unset, AUTH_EMAIL_DISABLED must be exactly `true`, and RESEND_API_KEY
//   must be unset.
// - production: IS_TEST, AUTH_EMAIL_DISABLED, PREVIEW_ORIGIN_PATTERN, and DEMO_ACCOUNT_PASSWORD
//   (the demo accounts' shared password, #98; preview mode does not require it) must be unset.
//   (The email slice adds the presence checks for RESEND_API_KEY, RESEND_WEBHOOK_SECRET, and
//   EMAIL_FROM, ADR 0011.)
// - both: BETTER_AUTH_SECRET and SITE_URL must be set (#111, ADR 0008). Without the secret Better
//   Auth would sign with its public default; without SITE_URL no origin is trusted. Only the names
//   are read. An empty value is invisible to `--names-only`; convex/auth.ts refuses requests then.
//
// Targeting: `--preview-name <name>` selects the preview deployment `<name>` (for example `pr-12`,
// or `main` for staging) with the preview deploy key in CONVEX_DEPLOY_KEY. Without it, the CLI
// acts on the deployment that CONVEX_DEPLOY_KEY itself names (a production key).
//
// ORDERING. Preview mode runs AFTER `npx convex deploy ... --preview-create|--preview-name`, because
// the `pr-<n>` deployment does not exist before it (netlify.toml). PR previews use
// `--preview-create` (deleted and recreated per push). Staging uses `--preview-name`, which reuses
// the deployment `main` and its data (#222): the variables checked here are then those the
// deployment got at creation. Convex applies its default preview variables only when it creates a
// deployment and does not sync later changes, so a default added or changed after staging was
// created must be set on `main` by hand (a missing variable this check requires fails the staging
// build). Production mode must run BEFORE `npx convex deploy`:
//
//   npm ci && node scripts/check-deploy-env.mjs production && npx convex deploy ...
//
// A production failure after `npx convex deploy` would leave the new functions already pushed to
// the production backend, with only the Netlify publish stopped. Do not copy the preview ordering.
// See docs/process/hosting.md.
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const USAGE =
  'usage: node scripts/check-deploy-env.mjs <preview|production> [--preview-name <name>] ' +
  '(--preview-name is required in preview mode)';

/**
 * Checks one deployment's variables. Returns one failure line per problem, each starting with the
 * variable's name; an empty array means the check passed. Never includes a value.
 *
 * @param {'preview' | 'production'} mode
 * @param {{ names: () => Promise<ReadonlySet<string>>, value: (name: string) => Promise<string | undefined> }} reader
 *   `names` lists the variables set on the deployment; `value` reads one value, and is called only
 *   for AUTH_EMAIL_DISABLED in preview mode.
 * @returns {Promise<string[]>}
 */
export async function checkDeployEnv(mode, reader) {
  const names = await reader.names();
  const failures = [];
  if (mode === 'preview') {
    if (names.has('IS_TEST')) {
      failures.push(
        'IS_TEST is set; it must not be set on a preview deployment (ADR 0005, ADR 0008).',
      );
    }
    if (!names.has('AUTH_EMAIL_DISABLED')) {
      failures.push(
        'AUTH_EMAIL_DISABLED is not set; it must be exactly true on a preview deployment (ADR 0011).',
      );
    } else if ((await reader.value('AUTH_EMAIL_DISABLED')) !== 'true') {
      failures.push(
        'AUTH_EMAIL_DISABLED is set but not exactly true; it must be exactly true on a preview deployment (ADR 0011).',
      );
    }
    if (names.has('RESEND_API_KEY')) {
      failures.push(
        'RESEND_API_KEY is set; it must not be set on a preview deployment (ADR 0011).',
      );
    }
  } else if (mode === 'production') {
    if (names.has('IS_TEST')) {
      failures.push('IS_TEST is set; it must not be set on production (ADR 0005, ADR 0008).');
    }
    if (names.has('AUTH_EMAIL_DISABLED')) {
      failures.push('AUTH_EMAIL_DISABLED is set; it must not be set on production (ADR 0011).');
    }
    if (names.has('PREVIEW_ORIGIN_PATTERN')) {
      failures.push(
        'PREVIEW_ORIGIN_PATTERN is set; it must not be set on production (it admits preview origins and lets seed:demo write).',
      );
    }
    if (names.has('DEMO_ACCOUNT_PASSWORD')) {
      failures.push(
        'DEMO_ACCOUNT_PASSWORD is set; it must not be set on production (it is the shared password of the demo accounts, #98).',
      );
    }
  } else {
    throw new Error(USAGE);
  }
  // Required in both modes. Names only: these values are secrets or origins and are never read.
  if (!names.has('BETTER_AUTH_SECRET')) {
    failures.push(
      'BETTER_AUTH_SECRET is not set; it must be set on every deployment, or auth would sign with a public default secret (ADR 0008).',
    );
  }
  if (!names.has('SITE_URL')) {
    failures.push(
      'SITE_URL is not set; it must be set on every deployment, or no browser origin is trusted (ADR 0008).',
    );
  }
  return failures;
}

/** A Convex preview name: `pr-<n>` (n from 1), or a branch-like name such as `main`. */
function isPreviewName(name) {
  if (name.startsWith('pr-')) return /^pr-[1-9][0-9]*$/.test(name);
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name);
}

/**
 * Parses `<mode> [--preview-name <name>]`. Throws an Error whose message starts with "usage" on
 * anything else, including an empty `pr-` (unset REVIEW_ID).
 *
 * @param {string[]} argv
 * @returns {{ mode: 'preview' | 'production', previewName: string | undefined }}
 */
export function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (mode !== 'preview' && mode !== 'production') throw new Error(USAGE);
  let previewName;
  if (rest.length === 2 && rest[0] === '--preview-name' && isPreviewName(rest[1])) {
    previewName = rest[1];
  } else if (rest.length !== 0) {
    throw new Error(USAGE);
  }
  if (mode === 'preview' && previewName === undefined) throw new Error(USAGE);
  return { mode, previewName };
}

/**
 * Runs the check and reports it. Returns the exit code: 0 pass, 1 fail (including any error while
 * reading the deployment, whose text is not printed: it could hold a value).
 */
export async function runCheck({ mode, previewName }, { reader, log, error }) {
  const target =
    previewName === undefined
      ? 'the deployment selected by CONVEX_DEPLOY_KEY'
      : `${previewName} (preview name)`;
  log(`check-deploy-env: mode ${mode}, checking deployment ${target}`);
  let failures;
  try {
    failures = await checkDeployEnv(mode, reader);
  } catch {
    error(`check-deploy-env: FAIL could not read the environment variables of ${target}`);
    return 1;
  }
  if (failures.length === 0) {
    log(`check-deploy-env: PASS (${mode}) on ${target}`);
    return 0;
  }
  for (const failure of failures) error(`check-deploy-env: FAIL ${failure}`);
  error(`check-deploy-env: ${failures.length} problem(s) on ${target}; the build stops here.`);
  return 1;
}

/** Removes the deploy key from `text`, in case a CLI message ever echoes it. */
function redactKey(text) {
  const key = process.env['CONVEX_DEPLOY_KEY'];
  return key ? text.split(key).join('<redacted>') : text;
}

/** Runs the project's Convex CLI with `args`; output is captured in memory, never inherited. */
function convexCli(args) {
  const cli = join(import.meta.dirname, '..', 'node_modules', 'convex', 'bin', 'main.js');
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  delete env['CONVEX_VERBOSE'];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** The reader backed by `npx convex env`, for the deployment `previewName` (or the key's own). */
function convexReader(previewName) {
  const target = previewName === undefined ? [] : ['--preview-name', previewName];
  return {
    async names() {
      const result = await convexCli(['env', 'list', '--names-only', ...target]);
      if (result.code !== 0) {
        // `--names-only` writes no value anywhere, so its error text is safe to show.
        console.error(redactKey(result.stderr.trim()));
        throw new Error('convex env list failed');
      }
      return new Set(
        result.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(line)),
      );
    },
    async value(name) {
      const result = await convexCli(['env', 'get', name, ...target]);
      // Not printed on failure: this command's output is a value.
      if (result.code !== 0) throw new Error('convex env get failed');
      return result.stdout.endsWith('\n') ? result.stdout.slice(0, -1) : result.stdout;
    },
  };
}

if (import.meta.main) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (parseError) {
    console.error(`check-deploy-env: ${parseError.message}`);
    process.exit(2);
  }
  process.exitCode = await runCheck(args, {
    reader: convexReader(args.previewName),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
