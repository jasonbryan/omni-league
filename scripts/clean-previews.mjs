// Deletes the Convex preview deployments of closed and merged PRs (#158). Node built-ins only.
//
//   npm run previews:clean                 list, ask for one `y`, then delete
//   npm run previews:clean -- --yes        delete without the prompt
//   npm run previews:clean -- --dry-run    list only; never deletes (wins over --yes)
//   node scripts/clean-previews.mjs --yes --pr <n>
//                                          consider only the preview pr-<n> (the workflow on a push to main)
//
// WHY. The Convex team caps deployments (40), and every PR creates a preview deployment `pr-<n>`
// that nothing removes before Convex's own 5-day expiry. At the cap the next preview build fails
// with `DeploymentQuotaReached`. Running this frees the slots of PRs that are already done.
//
// It uses the Convex Management API (https://api.convex.dev/v1) with a team access token:
//   GET  /teams/{team}/projects/{project}                       resolve the project id from its slug
//   GET  /projects/{id}/list_deployments?deploymentType=preview list the preview deployments
//   POST /deployments/{name}/delete                             delete one
// and `gh pr view <n> --json state` for the state of the PR.
//
// SAFETY. A deployment is deleted only when ALL of these hold; each is tested:
//   - it is in the omni-league project (resolved from the team slug and project slug, and the
//     deployment's own projectId matches), is type `preview`, and is a cloud deployment;
//   - its preview name matches `^pr-[1-9][0-9]*$` (so never `main`, a branch name, dev, or prod);
//   - `gh pr view <n> --json state` succeeded and says CLOSED or MERGED. OPEN, an unknown state,
//     and a failed lookup all keep the deployment;
//   - it was listed to the user and, unless --yes, confirmed with a single `y`.
//
// THE TOKEN. It comes from CONVEX_TEAM_TOKEN, or a silent TTY prompt (nothing echoed). It is held
// in memory only and sent only as the Authorization header of the requests above. It is never
// printed, logged, put on a command line, passed to `gh`, or written to a file; error text built
// here never includes a response body or the original error message, only the HTTP status.
// The owner creates the token: Convex dashboard, Team Settings, Access Tokens. See
// docs/process/hosting.md.
//
// AUTOMATION (#158). .github/workflows/clean-previews.yml runs this on a push to main (`--yes --pr <n>`
// per PR in the commit subjects) and on a daily schedule (`--yes`), with the environment secret
// CONVEX_TEAM_TOKEN of `preview-cleanup` (readable only on main) and the built-in
// workflow token for `gh`. `--pr` narrows the list; every safety rule above still applies,
// including the CLOSED or MERGED check. `npm run previews:clean` stays as a manual fallback.
//
// Exit codes: 0 done (including nothing to delete, or declined), 1 an API error or a delete
// failed, 2 bad usage or no token.
import { execFile as execFileCallback } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';

export const BASE_URL = 'https://api.convex.dev/v1';
const TEAM_SLUG = 'jason-bryan';
const PROJECT_SLUG = 'omni-league';
const REQUEST_TIMEOUT_MS = 30_000;

const USAGE = 'usage: npm run previews:clean -- [--yes] [--dry-run] [--pr <n>]';

/**
 * @param {string[]} argv
 * @returns {{ yes: boolean, dryRun: boolean, pr: number | undefined }}
 */
export function parseArgs(argv) {
  const options = { yes: false, dryRun: false, pr: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--yes') options.yes = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--pr') {
      index += 1;
      const value = argv[index];
      if (value === undefined || !/^[1-9][0-9]*$/.test(value)) throw new Error(USAGE);
      options.pr = Number(value);
      if (!Number.isSafeInteger(options.pr)) throw new Error(USAGE);
    } else throw new Error(USAGE);
  }
  return options;
}

/**
 * The preview name of a deployment: its `previewIdentifier`, or the part of its `reference` after
 * `preview/` when it has none. Undefined when neither names a preview, and also when both do and
 * disagree: such a deployment is kept, never deleted.
 */
export function previewNameOf(deployment) {
  const id =
    typeof deployment.previewIdentifier === 'string' ? deployment.previewIdentifier : undefined;
  const ref =
    typeof deployment.reference === 'string' && deployment.reference.startsWith('preview/')
      ? deployment.reference.slice('preview/'.length)
      : undefined;
  if (id !== undefined && ref !== undefined && id !== ref) return undefined;
  return id ?? ref;
}

/** True when `previewIdentifier` and a `preview/` `reference` both exist and differ. */
function namesDisagree(deployment) {
  return (
    typeof deployment.previewIdentifier === 'string' &&
    typeof deployment.reference === 'string' &&
    deployment.reference.startsWith('preview/') &&
    deployment.reference !== `preview/${deployment.previewIdentifier}`
  );
}

/** Why `deployment` may not be considered at all, or undefined when it may. */
function ineligibleReason(deployment, projectId, previewName) {
  if (deployment.kind !== undefined && deployment.kind !== 'cloud') return 'not a cloud deployment';
  if (deployment.projectId !== projectId) return 'other project';
  if (deployment.deploymentType !== 'preview') return `type ${String(deployment.deploymentType)}`;
  if (previewName === undefined) {
    return namesDisagree(deployment)
      ? 'preview identifier and reference disagree'
      : 'no preview name';
  }
  if (!/^pr-[1-9][0-9]*$/.test(previewName)) return 'not a pr-<n> preview';
  if (!Number.isSafeInteger(Number(previewName.slice(3)))) return 'not a pr-<n> preview';
  if (typeof deployment.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(deployment.name)) {
    return 'unexpected deployment name';
  }
  return undefined;
}

/**
 * Splits the listed deployments into those that may be checked against GitHub and those that are
 * kept regardless. Nothing here decides deletion: the PR state still has to say CLOSED or MERGED.
 *
 * @returns {{
 *   candidates: { deployment: object, previewName: string, pr: number }[],
 *   kept: { deployment: object, previewName: string | undefined, reason: string }[],
 * }}
 */
export function selectCandidates(deployments, projectId) {
  const candidates = [];
  const kept = [];
  for (const deployment of deployments) {
    const previewName = previewNameOf(deployment);
    const reason = ineligibleReason(deployment, projectId, previewName);
    if (reason === undefined) {
      candidates.push({ deployment, previewName, pr: Number(previewName.slice(3)) });
    } else {
      kept.push({ deployment, previewName, reason });
    }
  }
  return { candidates, kept };
}

/**
 * The Convex Management API client. `fetchFn` is Node's `fetch`, or a stub in tests. Thrown
 * messages carry the request and the HTTP status only: no body, no original error text.
 */
export function createApi({ fetch: fetchFn, token }) {
  async function request(method, path) {
    let response;
    try {
      response = await fetchFn(`${BASE_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error(`${method} ${path.split('?')[0]} failed: no response`);
    }
    if (!response.ok) {
      const failure = new Error(`${method} ${path.split('?')[0]} failed: HTTP ${response.status}`);
      failure.status = response.status;
      throw failure;
    }
    return response;
  }
  return {
    async projectId() {
      const response = await request(
        'GET',
        `/teams/${encodeURIComponent(TEAM_SLUG)}/projects/${encodeURIComponent(PROJECT_SLUG)}`,
      );
      const { id } = await response.json();
      if (!Number.isSafeInteger(id)) throw new Error('project lookup returned no id');
      return id;
    },
    async listPreviewDeployments(projectId) {
      const response = await request(
        'GET',
        `/projects/${encodeURIComponent(projectId)}/list_deployments?deploymentType=preview`,
      );
      const list = await response.json();
      if (!Array.isArray(list)) throw new Error('deployment list was not an array');
      return list;
    },
    /** A 404 means the deployment is already gone (Convex expired it), which is the goal. */
    async deleteDeployment(name) {
      try {
        await request('POST', `/deployments/${encodeURIComponent(name)}/delete`);
      } catch (failure) {
        if (failure.status !== 404) throw failure;
      }
    },
  };
}

/**
 * Reads a PR's state with the GitHub CLI: `gh pr view <n> --json state`. No shell, and the team
 * token is removed from the child's environment. Rejects on any failure or unexpected output.
 *
 * @returns {(pr: number) => Promise<string>}
 */
export function createGhState({ execFile = promisify(execFileCallback), env = process.env } = {}) {
  const childEnv = { ...env };
  delete childEnv['CONVEX_TEAM_TOKEN'];
  return async (pr) => {
    const { stdout } = await execFile('gh', ['pr', 'view', String(pr), '--json', 'state'], {
      env: childEnv,
      encoding: 'utf8',
      timeout: REQUEST_TIMEOUT_MS,
    });
    const { state } = JSON.parse(stdout);
    if (typeof state !== 'string') throw new Error('gh returned no state');
    return state;
  };
}

const row = (name, preview, status) =>
  `${name.padEnd(32)} ${(preview ?? '-').padEnd(10)} ${status}`;

/**
 * Lists, confirms, and deletes. Returns the exit code.
 *
 * @param {{ yes: boolean, dryRun: boolean, pr?: number }} options
 * @param {{
 *   api: ReturnType<typeof createApi>,
 *   getPrState: (pr: number) => Promise<string>,
 *   confirm: (question: string) => Promise<string>,
 *   log: (line: string) => void,
 *   error: (line: string) => void,
 * }} deps
 */
export async function runClean({ yes, dryRun, pr }, { api, getPrState, confirm, log, error }) {
  let selection;
  try {
    const projectId = await api.projectId();
    selection = selectCandidates(await api.listPreviewDeployments(projectId), projectId);
    if (pr !== undefined) {
      // One PR only: everything else is out of scope, so it is neither listed nor checked.
      selection = {
        candidates: selection.candidates.filter((candidate) => candidate.pr === pr),
        kept: [],
      };
    }
  } catch (failure) {
    error(`previews:clean: ${failure.message}`);
    return 1;
  }

  const eligible = [];
  const kept = [...selection.kept];
  for (const candidate of selection.candidates) {
    let state;
    try {
      state = await getPrState(candidate.pr);
    } catch {
      kept.push({ ...candidate, reason: 'lookup failed' });
      continue;
    }
    if (state === 'CLOSED' || state === 'MERGED') eligible.push({ ...candidate, state });
    else if (state === 'OPEN') kept.push({ ...candidate, reason: 'OPEN' });
    else kept.push({ ...candidate, reason: 'lookup failed (unexpected state)' });
  }

  for (const item of kept) {
    log(`kept ${row(item.deployment.name, item.previewName, item.reason)}`);
  }
  if (eligible.length === 0) {
    log('previews:clean: nothing to delete.');
    return 0;
  }
  log(`${eligible.length} preview deployment(s) of closed or merged PRs:`);
  log(row('DEPLOYMENT', 'PREVIEW', 'PR STATE'));
  for (const item of eligible) log(row(item.deployment.name, item.previewName, item.state));

  if (dryRun) {
    log('previews:clean: dry run, nothing deleted.');
    return 0;
  }
  if (!yes) {
    const answer = await confirm(`Delete these ${eligible.length} deployment(s)? [y/N] `);
    if (answer.trim().toLowerCase() !== 'y') {
      log('previews:clean: not confirmed, nothing deleted.');
      return 0;
    }
  }

  let deleted = 0;
  let failed = 0;
  for (const item of eligible) {
    try {
      await api.deleteDeployment(item.deployment.name);
      deleted += 1;
      log(`deleted ${item.deployment.name} (${item.previewName})`);
    } catch (failure) {
      failed += 1;
      error(`FAILED ${item.deployment.name} (${item.previewName}): ${failure.message}`);
    }
  }
  log(`previews:clean: ${deleted} deleted, ${failed} failed.`);
  return failed === 0 ? 0 : 1;
}

/** Reads a line from the TTY without echoing it. Rejects on Ctrl-C. */
function promptSecret(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    let value = '';
    const finish = (settle, result) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write('\n');
      settle(result);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n' || character === '\u0004') {
          return finish(resolve, value);
        }
        if (character === '\u0003') return finish(reject, new Error('cancelled'));
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    stderr.write(question);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

/** Asks one question on the terminal and returns the answer line. */
async function ask(question) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

/** The team token from CONVEX_TEAM_TOKEN, else a silent prompt. Undefined when neither works. */
async function readToken() {
  const fromEnv = process.env['CONVEX_TEAM_TOKEN']?.trim();
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) return undefined;
  const typed = (await promptSecret('Convex team access token (hidden): ')).trim();
  return typed || undefined;
}

if (import.meta.main) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (parseError) {
    console.error(parseError.message);
    process.exit(2);
  }
  let token;
  try {
    token = await readToken();
  } catch {
    console.error('previews:clean: cancelled.');
    process.exit(2);
  }
  if (token === undefined) {
    console.error(
      'previews:clean: no team access token. Set CONVEX_TEAM_TOKEN, or run in a terminal to be prompted. ' +
        'Create one in the Convex dashboard: Team Settings, Access Tokens.',
    );
    process.exit(2);
  }
  process.exitCode = await runClean(options, {
    api: createApi({ fetch, token }),
    getPrState: createGhState(),
    confirm: ask,
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
