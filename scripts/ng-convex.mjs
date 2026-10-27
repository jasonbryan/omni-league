import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { checkServerBundle } from './edge-bundle.mjs';
import { noindexForContext, writeNoindexHeaders } from './noindex.mjs';
import { writeStagingSlotFile } from './staging-slot-file.mjs';
import { serviceWorkerDefine, swConfigCheck } from './sw-config-check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...extraArgs] = process.argv.slice(2);
if (command !== 'build' && command !== 'serve')
  fail('usage: ng-convex.mjs <build|serve> [ng args]');

function fail(message) {
  console.error(`ng-convex: ${message}`);
  process.exit(1);
}

let url = process.env.CONVEX_URL || null;
let source = 'environment';
const envFile = join(root, '.env.local');
if (!url && existsSync(envFile)) {
  url = parseEnv(readFileSync(envFile, 'utf8')).CONVEX_URL || null;
  source = '.env.local';
}

const defines = [];
if (url) {
  // The value is compiled in as a JS string literal, so quotes, backslashes, and whitespace are
  // rejected outright (code-injection guard).
  if (/['"`\\\s]/.test(url)) fail('CONVEX_URL must not contain quotes, backslashes, or whitespace');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    // Never echo the raw value here: it has not passed the credential check yet.
    fail('CONVEX_URL is not a valid URL');
  }
  // Only a bare origin: no credentials (they would ship in the public bundle), path, query, or fragment.
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    url.includes('?') ||
    url.includes('#')
  ) {
    fail('CONVEX_URL must be a bare origin, with no credentials, path, query, or fragment');
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    fail(`CONVEX_URL must use https:, or http: on localhost/127.0.0.1; got ${parsed.protocol}`);
  }

  let siteUrl;
  if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.convex.cloud') && !parsed.port) {
    siteUrl = `https://${parsed.hostname.replace(/\.convex\.cloud$/, '.convex.site')}`;
  } else if (parsed.protocol === 'http:' && local && parsed.port === '3210') {
    siteUrl = `http://${parsed.hostname}:3211`;
  } else {
    fail(
      `cannot derive the Convex site URL from ${parsed.origin}; supported forms are ` +
        `https://<name>.convex.cloud and http://localhost:3210 (or http://127.0.0.1:3210)`,
    );
  }

  // The deployment URL is public: it ships to every browser.
  const origin = parsed.origin;
  console.log(`Convex URL: ${origin} (from ${source}), site: ${siteUrl}`);
  defines.push(`--define=__CONVEX_URL__='${origin}'`, `--define=__CONVEX_SITE_URL__='${siteUrl}'`);
} else {
  console.log('Convex URL: none');
}

// CONTEXT is public build metadata, so it is safe to log.
const noindex = command === 'build' && noindexForContext(process.env.CONTEXT);
if (command === 'build') {
  console.log(
    `noindex: ${noindex ? 'on' : 'off'} (Netlify CONTEXT ${process.env.CONTEXT || 'unset'})`,
  );
  defines.push(`--define=__NOINDEX__=${noindex}`);
}

// Removing the `serviceWorker` option (the kill switch) turns off both the worker build and its
// registration.
const swDefine = serviceWorkerDefine(JSON.parse(readFileSync(join(root, 'angular.json'), 'utf8')));
console.log(
  `service worker: ${swDefine.endsWith('=true') ? 'on' : 'off'} (angular.json serviceWorker option)`,
);
defines.push(swDefine);

// Through Node with an argv array: no shell, same quoting on every OS.
const ngArgs = [command, ...defines, ...extraArgs];
console.log(`Running: ng ${ngArgs.join(' ')}`);
const ng = join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
const child = spawn(process.execPath, [ng, ...ngArgs], { stdio: 'inherit' });
// Forward termination signals so a SIGTERM to the wrapper alone (CI timeout, process manager) does
// not orphan `ng serve`/`ng build`.
let received = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    received ??= signal;
    child.kill(signal);
  });
}
// Terminated by a signal: exit 128 + its number (130 for SIGINT, 143 for SIGTERM), as a shell does.
// The signal the wrapper received wins, because `ng` turns SIGINT into its own exit (serve re-kills
// itself with SIGTERM, build exits 127); otherwise use the signal that killed the child.
child.on('exit', (code, signal) => {
  const terminatedBy = received ?? signal;
  if (terminatedBy) process.exit(128 + constants.signals[terminatedBy]);
  if (code !== 0 || command !== 'build') process.exit(code ?? 0);
  afterBuild().then(
    () => process.exit(0),
    (error) => fail(error.message),
  );
});

async function afterBuild() {
  const serverDir = join(root, 'dist', 'omni-league', 'server');
  const problems = await checkServerBundle(serverDir);
  for (const { file, problem } of problems) {
    console.error(`edge-bundle: FAIL dist/omni-league/server/${file}: ${problem}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `${problems.length} problem(s) in the server bundle; Netlify Edge Functions refuse ` +
        `filesystem access (scripts/edge-bundle.mjs)`,
    );
  }
  console.log('edge-bundle: PASS (no filesystem access in dist/omni-league/server)');
  const sw = await swConfigCheck({
    angularJsonPath: join(root, 'angular.json'),
    browserDir: join(root, 'dist', 'omni-league', 'browser'),
  });
  for (const line of sw.lines) (sw.status === 'FAIL' ? console.error : console.log)(line);
  if (sw.status === 'FAIL') {
    throw new Error(
      'the built ngsw.json could cache more than same-origin build files (scripts/sw-config-check.mjs)',
    );
  }
  const browserDir = join(root, 'dist', 'omni-league', 'browser');
  if (await writeStagingSlotFile(browserDir, process.env)) {
    console.log(`staging slot: ${process.env.STAGING_SLOT}`);
  }
  if (!noindex) return;
  try {
    await writeNoindexHeaders(browserDir);
  } catch (error) {
    throw new Error(`could not write the noindex _headers file: ${error.message}`, {
      cause: error,
    });
  }
  console.log('noindex: wrote dist/omni-league/browser/_headers');
}
