// Preview mode runs AFTER `npx convex deploy`, because a preview deployment does not exist before
// it. Production mode runs BEFORE it: a failure after the deploy would leave the new functions
// already pushed to the production backend.
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const USAGE =
  'usage: node scripts/check-deploy-env.mjs <preview|production> [--preview-name <name>] ' +
  '(--preview-name is required in preview mode)';

/**
 * Never includes a value.
 * @param {'preview' | 'production'} mode
 * @param {{ names: () => Promise<ReadonlySet<string>>, value: (name: string) => Promise<string | undefined> }} reader
 * @returns {Promise<string[]>}
 */
export async function checkDeployEnv(mode, reader) {
  const names = await reader.names();
  const failures = [];
  if (mode === 'preview') {
    if (names.has('IS_TEST')) {
      failures.push('IS_TEST is set; it must not be set on a preview deployment.');
    }
    if (!names.has('AUTH_EMAIL_DISABLED')) {
      failures.push(
        'AUTH_EMAIL_DISABLED is not set; it must be exactly true on a preview deployment.',
      );
    } else if ((await reader.value('AUTH_EMAIL_DISABLED')) !== 'true') {
      failures.push(
        'AUTH_EMAIL_DISABLED is set but not exactly true; it must be exactly true on a preview deployment.',
      );
    }
    if (names.has('RESEND_API_KEY')) {
      failures.push('RESEND_API_KEY is set; it must not be set on a preview deployment.');
    }
  } else if (mode === 'production') {
    if (names.has('IS_TEST')) {
      failures.push('IS_TEST is set; it must not be set on production.');
    }
    if (names.has('AUTH_EMAIL_DISABLED')) {
      failures.push('AUTH_EMAIL_DISABLED is set; it must not be set on production.');
    }
    if (names.has('PREVIEW_ORIGIN_PATTERN')) {
      failures.push(
        'PREVIEW_ORIGIN_PATTERN is set; it must not be set on production (it admits preview origins and lets seed:demo write).',
      );
    }
    if (names.has('DEMO_ACCOUNT_PASSWORD')) {
      failures.push(
        'DEMO_ACCOUNT_PASSWORD is set; it must not be set on production (it is the shared password of the demo accounts).',
      );
    }
    for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
      if (!names.has(name)) {
        failures.push(
          `${name} is not set; it must be set on production, or push notifications cannot be turned on or sent.`,
        );
      }
    }
  } else {
    throw new Error(USAGE);
  }
  // Names only: these values are secrets or origins and are never read.
  if (!names.has('BETTER_AUTH_SECRET')) {
    failures.push(
      'BETTER_AUTH_SECRET is not set; it must be set on every deployment, or auth would sign with a public default secret.',
    );
  }
  if (!names.has('SITE_URL')) {
    failures.push(
      'SITE_URL is not set; it must be set on every deployment, or no browser origin is trusted.',
    );
  }
  return failures;
}

function isPreviewName(name) {
  if (name.startsWith('pr-')) return /^pr-[1-9][0-9]*$/.test(name);
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name);
}

/**
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
    // The error text is not printed: it could hold a value.
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

// In case a CLI message ever echoes the key.
function redactKey(text) {
  const key = process.env['CONVEX_DEPLOY_KEY'];
  return key ? text.split(key).join('<redacted>') : text;
}

function captureConvexCli(args) {
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

function convexReader(previewName) {
  const target = previewName === undefined ? [] : ['--preview-name', previewName];
  return {
    async names() {
      const result = await captureConvexCli(['env', 'list', '--names-only', ...target]);
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
      const result = await captureConvexCli(['env', 'get', name, ...target]);
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
