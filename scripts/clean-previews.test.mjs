// Unit tests for scripts/clean-previews.mjs (#158). Run with `npm run test:scripts` (node:test).
// The Convex API and `gh` are never called: each case passes a stub `fetch`, `gh`, and prompt.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  BASE_URL,
  createApi,
  createGhState,
  parseArgs,
  previewNameOf,
  runClean,
  selectCandidates,
} from './clean-previews.mjs';

// Sentinel token: it must not appear in any output.
const TOKEN = 'sentinel-team-token-c0ffee-8f3a';
const PROJECT_ID = 4242;

/** One deployment as the list endpoint returns it. */
function deployment(name, overrides = {}) {
  return {
    id: 1,
    name,
    createTime: 0,
    deploymentType: 'preview',
    projectId: PROJECT_ID,
    previewIdentifier: null,
    isDefault: false,
    reference: `preview/${name}`,
    deploymentUrl: `https://${name}.convex.cloud`,
    class: 's16',
    kind: 'cloud',
    ...overrides,
  };
}

/** A preview deployment with Convex name `animal-<pr>` for the preview `pr-<pr>`. */
function prDeployment(pr, overrides = {}) {
  return deployment(`animal-${pr}`, { previewIdentifier: `pr-${pr}`, ...overrides });
}

/** A fetch stub over a table of `METHOD path` routes; records every request. */
function stubFetch(routes) {
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url: String(url), method, headers: init.headers ?? {} });
    const path = String(url).slice(BASE_URL.length);
    const route = routes[`${method} ${path}`];
    if (route === undefined) throw new Error(`unexpected request ${method} ${path}`);
    const { status = 200, body = {} } = typeof route === 'function' ? route() : route;
    return new Response(JSON.stringify(body), { status });
  };
  fetchStub.calls = calls;
  return fetchStub;
}

/** Everything `runClean` needs, over in-memory stubs. */
function harness({ deployments, states = {}, answer = 'y', deleteStatus = {}, args = {} }) {
  const out = [];
  const err = [];
  const prompts = [];
  const ghCalls = [];
  const fetchStub = stubFetch({
    'GET /teams/jason-bryan/projects/omni-league': { body: { id: PROJECT_ID } },
    [`GET /projects/${PROJECT_ID}/list_deployments?deploymentType=preview`]: { body: deployments },
    ...Object.fromEntries(
      deployments.map((d) => [
        `POST /deployments/${d.name}/delete`,
        { status: deleteStatus[d.name] ?? 200 },
      ]),
    ),
  });
  const deps = {
    api: createApi({ fetch: fetchStub, token: TOKEN }),
    getPrState: async (pr) => {
      ghCalls.push(pr);
      const state = states[pr];
      if (state instanceof Error) throw state;
      return state;
    },
    confirm: async (question) => {
      prompts.push(question);
      return answer;
    },
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  };
  const options = { yes: false, dryRun: false, ...args };
  return {
    run: () => runClean(options, deps),
    out,
    err,
    prompts,
    ghCalls,
    fetchStub,
    deletes: () => fetchStub.calls.filter((c) => c.method === 'POST').map((c) => c.url),
  };
}

describe('parseArgs', () => {
  it('defaults to prompting and deleting every closed PR preview', () => {
    assert.deepEqual(parseArgs([]), { yes: false, dryRun: false, pr: undefined });
  });
  it('reads --yes and --dry-run', () => {
    assert.deepEqual(parseArgs(['--yes']), { yes: true, dryRun: false, pr: undefined });
    assert.deepEqual(parseArgs(['--dry-run']), { yes: false, dryRun: true, pr: undefined });
  });
  it('reads --pr <n>', () => {
    assert.deepEqual(parseArgs(['--yes', '--pr', '140']), { yes: true, dryRun: false, pr: 140 });
  });
  it('rejects anything else', () => {
    assert.throws(() => parseArgs(['--force']), /usage/);
    assert.throws(() => parseArgs(['pr-1']), /usage/);
  });
  it('rejects a --pr that is missing or not a plain PR number', () => {
    for (const bad of ['', '0', '01', '-1', '1.5', 'pr-1', '1 ', '99999999999999999999', 'main']) {
      assert.throws(() => parseArgs(['--pr', bad]), /usage/, JSON.stringify(bad));
    }
    assert.throws(() => parseArgs(['--pr']), /usage/);
  });
});

describe('previewNameOf', () => {
  it('reads previewIdentifier', () => {
    assert.equal(previewNameOf(prDeployment(12)), 'pr-12');
  });
  it('falls back to a preview/ reference', () => {
    assert.equal(
      previewNameOf(deployment('x', { previewIdentifier: null, reference: 'preview/pr-7' })),
      'pr-7',
    );
  });
  it('is undefined when neither names a preview', () => {
    assert.equal(
      previewNameOf(deployment('x', { previewIdentifier: null, reference: 'dev/jason' })),
      undefined,
    );
  });
  it('prefers previewIdentifier over the reference', () => {
    assert.equal(
      previewNameOf(deployment('x', { previewIdentifier: 'main', reference: 'preview/pr-2' })),
      'main',
    );
  });
});

describe('selectCandidates (what may be considered for deletion)', () => {
  const kept = (list) => selectCandidates(list, PROJECT_ID).kept.map((k) => k.deployment.name);
  const considered = (list) =>
    selectCandidates(list, PROJECT_ID).candidates.map((c) => c.deployment.name);

  it('considers a preview named pr-<n>', () => {
    const [candidate] = selectCandidates([prDeployment(140)], PROJECT_ID).candidates;
    assert.equal(candidate.pr, 140);
    assert.equal(candidate.previewName, 'pr-140');
    assert.equal(candidate.deployment.name, 'animal-140');
  });

  it('never considers main (staging)', () => {
    const main = deployment('main-staging', { previewIdentifier: 'main' });
    assert.deepEqual(considered([main]), []);
    assert.deepEqual(kept([main]), ['main-staging']);
  });

  it('never considers a dev, prod, or custom deployment, even one named pr-<n>', () => {
    for (const deploymentType of ['dev', 'prod', 'custom']) {
      const d = prDeployment(5, { deploymentType });
      assert.deepEqual(considered([d]), [], deploymentType);
    }
  });

  it('never considers a deployment of another project', () => {
    assert.deepEqual(considered([prDeployment(5, { projectId: PROJECT_ID + 1 })]), []);
  });

  it('never considers a local deployment', () => {
    assert.deepEqual(considered([prDeployment(5, { kind: 'local' })]), []);
  });

  it('refuses names that are not exactly pr-<n>', () => {
    const names = [
      'pr-0',
      'pr-01',
      'pr-',
      'pr-1a',
      'pr-1-2',
      'PR-1',
      'xpr-1',
      'pr-1x',
      'pr--1',
      'pr-1\npr-2',
      'pr-1/../main',
      ' pr-1',
      'pr-1 ',
      'pr-99999999999999999999',
      'feature-pr-1',
    ];
    for (const previewIdentifier of names) {
      const d = deployment('animal-x', { previewIdentifier, reference: 'preview/zzz' });
      assert.deepEqual(considered([d]), [], JSON.stringify(previewIdentifier));
    }
  });

  it('refuses a deployment whose name is unsafe in a URL path', () => {
    for (const name of ['../prod', 'a/b', 'a b', 'a?x=1', '']) {
      assert.deepEqual(considered([prDeployment(3, { name })]), [], JSON.stringify(name));
    }
  });
});

describe('createApi', () => {
  it('sends the token as a bearer header and resolves the project by slug', async () => {
    const fetchStub = stubFetch({
      'GET /teams/jason-bryan/projects/omni-league': { body: { id: 77 } },
    });
    const api = createApi({ fetch: fetchStub, token: TOKEN });
    assert.equal(await api.projectId(), 77);
    assert.equal(fetchStub.calls[0].headers['Authorization'], `Bearer ${TOKEN}`);
  });

  it('lists preview deployments of the project', async () => {
    const fetchStub = stubFetch({
      'GET /projects/77/list_deployments?deploymentType=preview': { body: [prDeployment(1)] },
    });
    const api = createApi({ fetch: fetchStub, token: TOKEN });
    assert.deepEqual(await api.listPreviewDeployments(77), [prDeployment(1)]);
  });

  it('posts a delete to the deployment name, encoded', async () => {
    const fetchStub = stubFetch({ 'POST /deployments/animal-1/delete': {} });
    const api = createApi({ fetch: fetchStub, token: TOKEN });
    await api.deleteDeployment('animal-1');
    assert.equal(fetchStub.calls[0].method, 'POST');
    assert.equal(fetchStub.calls[0].url, `${BASE_URL}/deployments/animal-1/delete`);
  });

  it('throws with the HTTP status, never the token, on a failure', async () => {
    const fetchStub = stubFetch({
      'GET /teams/jason-bryan/projects/omni-league': { status: 401, body: { message: TOKEN } },
    });
    const api = createApi({ fetch: fetchStub, token: TOKEN });
    await assert.rejects(
      api.projectId(),
      (e) => /401/.test(e.message) && !e.message.includes(TOKEN),
    );
  });
});

describe('createGhState', () => {
  it('runs gh pr view without a shell and without the token in its environment', async () => {
    const calls = [];
    const execFile = async (file, args, options) => {
      calls.push({ file, args, options });
      return { stdout: '{"state":"MERGED"}\n' };
    };
    const getPrState = createGhState({ execFile, env: { PATH: '/bin', CONVEX_TEAM_TOKEN: TOKEN } });
    assert.equal(await getPrState(140), 'MERGED');
    assert.equal(calls[0].file, 'gh');
    assert.deepEqual(calls[0].args, ['pr', 'view', '140', '--json', 'state']);
    assert.equal(calls[0].options.env.CONVEX_TEAM_TOKEN, undefined);
    assert.equal(calls[0].options.env.PATH, '/bin');
    assert.notEqual(calls[0].options.shell, true);
  });

  it('throws on output that is not a state', async () => {
    const getPrState = createGhState({ execFile: async () => ({ stdout: 'nope' }), env: {} });
    await assert.rejects(getPrState(1));
  });
});

describe('runClean', () => {
  it('lists name, preview name and PR state, asks once, then deletes closed and merged PRs', async () => {
    const h = harness({
      deployments: [prDeployment(1), prDeployment(2), prDeployment(3)],
      states: { 1: 'CLOSED', 2: 'MERGED', 3: 'OPEN' },
    });
    assert.equal(await h.run(), 0);
    assert.deepEqual(h.deletes(), [
      `${BASE_URL}/deployments/animal-1/delete`,
      `${BASE_URL}/deployments/animal-2/delete`,
    ]);
    assert.equal(h.prompts.length, 1);
    const listing = h.out.join('\n');
    assert.match(listing, /animal-1\s+pr-1\s+CLOSED/);
    assert.match(listing, /animal-2\s+pr-2\s+MERGED/);
    assert.match(listing, /deleted animal-1/);
    assert.match(listing, /deleted animal-2/);
    assert.match(listing, /2 deleted, 0 failed/);
  });

  it('never deletes an open PR preview', async () => {
    const h = harness({ deployments: [prDeployment(3)], states: { 3: 'OPEN' } });
    assert.equal(await h.run(), 0);
    assert.deepEqual(h.deletes(), []);
    assert.equal(h.prompts.length, 0);
    assert.match(h.out.join('\n'), /kept animal-3\s+pr-3\s+OPEN/);
  });

  it('never deletes a PR whose gh lookup fails or returns an unknown state', async () => {
    const h = harness({
      deployments: [prDeployment(4), prDeployment(5), prDeployment(6)],
      states: { 4: new Error('gh: not found'), 5: undefined, 6: 'DRAFT' },
      args: { yes: true },
    });
    assert.equal(await h.run(), 0);
    assert.deepEqual(h.deletes(), []);
    const text = h.out.join('\n');
    assert.match(text, /kept animal-4\s+pr-4\s+lookup failed/);
    assert.match(text, /kept animal-5\s+pr-5\s+lookup failed/);
    assert.match(text, /kept animal-6\s+pr-6\s+lookup failed/);
  });

  it('never asks gh about, or deletes, main or a non-pr name', async () => {
    const h = harness({
      deployments: [
        deployment('staging-1', { previewIdentifier: 'main' }),
        deployment('feature-1', { previewIdentifier: 'feature/x' }),
        prDeployment(9),
      ],
      states: { 9: 'CLOSED' },
      args: { yes: true },
    });
    assert.equal(await h.run(), 0);
    assert.deepEqual(h.ghCalls, [9]);
    assert.deepEqual(h.deletes(), [`${BASE_URL}/deployments/animal-9/delete`]);
  });

  it('never deletes dev, prod, or other-project deployments in the list', async () => {
    const h = harness({
      deployments: [
        prDeployment(1, { deploymentType: 'prod' }),
        prDeployment(2, { deploymentType: 'dev' }),
        prDeployment(3, { projectId: PROJECT_ID + 1 }),
      ],
      states: { 1: 'CLOSED', 2: 'CLOSED', 3: 'CLOSED' },
      args: { yes: true },
    });
    assert.equal(await h.run(), 0);
    assert.deepEqual(h.ghCalls, []);
    assert.deepEqual(h.deletes(), []);
  });

  it('deletes nothing when the answer is not y', async () => {
    for (const answer of ['', 'n', 'yes', 'no', 'maybe']) {
      const h = harness({ deployments: [prDeployment(1)], states: { 1: 'CLOSED' }, answer });
      assert.equal(await h.run(), 0, answer);
      assert.deepEqual(h.deletes(), [], answer);
      assert.match(h.out.join('\n'), /nothing deleted/i);
    }
  });

  it('accepts a single y or Y with surrounding space', async () => {
    for (const answer of ['y', 'Y', ' y\n']) {
      const h = harness({ deployments: [prDeployment(1)], states: { 1: 'CLOSED' }, answer });
      await h.run();
      assert.equal(h.deletes().length, 1, JSON.stringify(answer));
    }
  });

  it('--yes skips the prompt', async () => {
    const h = harness({
      deployments: [prDeployment(1)],
      states: { 1: 'MERGED' },
      args: { yes: true },
    });
    assert.equal(await h.run(), 0);
    assert.equal(h.prompts.length, 0);
    assert.equal(h.deletes().length, 1);
  });

  it('--dry-run lists only: no prompt, no delete, even with --yes', async () => {
    const h = harness({
      deployments: [prDeployment(1)],
      states: { 1: 'CLOSED' },
      args: { dryRun: true, yes: true },
    });
    assert.equal(await h.run(), 0);
    assert.equal(h.prompts.length, 0);
    assert.deepEqual(h.deletes(), []);
    assert.match(h.out.join('\n'), /animal-1\s+pr-1\s+CLOSED/);
    assert.match(h.out.join('\n'), /dry run/i);
  });

  it('reports each failed delete, keeps going, and exits 1', async () => {
    const h = harness({
      deployments: [prDeployment(1), prDeployment(2), prDeployment(3)],
      states: { 1: 'CLOSED', 2: 'CLOSED', 3: 'MERGED' },
      deleteStatus: { 'animal-2': 500 },
      args: { yes: true },
    });
    assert.equal(await h.run(), 1);
    assert.equal(h.deletes().length, 3);
    const text = `${h.out.join('\n')}\n${h.err.join('\n')}`;
    assert.match(text, /deleted animal-1/);
    assert.match(text, /FAILED animal-2.*500/);
    assert.match(text, /deleted animal-3/);
    assert.match(text, /2 deleted, 1 failed/);
  });

  it('--pr <n> considers only that PR, and still requires it to be closed or merged', async () => {
    const h = harness({
      deployments: [prDeployment(1), prDeployment(2), prDeployment(3)],
      states: { 1: 'CLOSED', 2: 'CLOSED', 3: 'OPEN' },
      args: { yes: true, pr: 2 },
    });
    assert.equal(await h.run(), 0);
    assert.deepEqual(h.ghCalls, [2]);
    assert.deepEqual(h.deletes(), [`${BASE_URL}/deployments/animal-2/delete`]);

    const open = harness({
      deployments: [prDeployment(3)],
      states: { 3: 'OPEN' },
      args: { yes: true, pr: 3 },
    });
    assert.equal(await open.run(), 0);
    assert.deepEqual(open.deletes(), []);
  });

  it('--pr <n> with no such preview deletes nothing and exits 0', async () => {
    const h = harness({
      deployments: [prDeployment(1)],
      states: { 1: 'CLOSED' },
      args: { yes: true, pr: 9 },
    });
    assert.equal(await h.run(), 0);
    assert.deepEqual(h.ghCalls, []);
    assert.deepEqual(h.deletes(), []);
    assert.match(h.out.join('\n'), /nothing to delete/i);
  });

  it('says so and exits 0 when nothing is a candidate', async () => {
    const h = harness({ deployments: [], args: { yes: true } });
    assert.equal(await h.run(), 0);
    assert.match(h.out.join('\n'), /nothing to delete/i);
  });

  it('exits 1 when the Convex API rejects the token', async () => {
    const out = [];
    const err = [];
    const fetchStub = stubFetch({
      'GET /teams/jason-bryan/projects/omni-league': { status: 401, body: { message: 'bad' } },
    });
    const code = await runClean(
      { yes: true, dryRun: false },
      {
        api: createApi({ fetch: fetchStub, token: TOKEN }),
        getPrState: async () => 'CLOSED',
        confirm: async () => 'y',
        log: (l) => out.push(l),
        error: (l) => err.push(l),
      },
    );
    assert.equal(code, 1);
    assert.match(err.join('\n'), /401/);
  });
});

describe('the team token is never printed, logged, or written', () => {
  it('appears in no output, including error paths and a fetch error that echoes it', async () => {
    const out = [];
    const err = [];
    const echoing = async () => {
      throw new Error(`connect failed for Bearer ${TOKEN}`);
    };
    const cases = [
      // happy path, with a delete failure
      harness({
        deployments: [prDeployment(1), prDeployment(2)],
        states: { 1: 'CLOSED', 2: new Error(`gh said ${TOKEN}`) },
        deleteStatus: { 'animal-1': 500 },
        args: { yes: true },
      }),
      harness({ deployments: [prDeployment(1)], states: { 1: 'CLOSED' }, args: { dryRun: true } }),
    ];
    for (const h of cases) {
      await h.run();
      out.push(...h.out);
      err.push(...h.err);
    }
    const code = await runClean(
      { yes: true, dryRun: false },
      {
        api: createApi({ fetch: echoing, token: TOKEN }),
        getPrState: async () => 'CLOSED',
        confirm: async () => 'y',
        log: (l) => out.push(l),
        error: (l) => err.push(l),
      },
    );
    assert.equal(code, 1);
    const all = [...out, ...err].join('\n');
    assert.ok(all.length > 0);
    assert.ok(!all.includes(TOKEN), 'token leaked into output');
  });

  it('leaves the process silent about it in the CLI when no token is given', () => {
    const env = { ...process.env, SENTINEL: TOKEN };
    delete env['CONVEX_TEAM_TOKEN'];
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dirname, 'clean-previews.mjs'), '--dry-run'],
      { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /CONVEX_TEAM_TOKEN/);
    assert.ok(!(result.stdout + result.stderr).includes(TOKEN));
  });

  it('exits 2 with usage on an unknown flag, before reading any token', () => {
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dirname, 'clean-previews.mjs'), '--force'],
      { env: { ...process.env, CONVEX_TEAM_TOKEN: TOKEN }, encoding: 'utf8' },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage/);
    assert.ok(!(result.stdout + result.stderr).includes(TOKEN));
  });

  it('the script has no way to write a file or log the token', () => {
    const source = readFileSync(join(import.meta.dirname, 'clean-previews.mjs'), 'utf8');
    assert.ok(!/node:fs|writeFile|appendFile|createWriteStream/.test(source));
    // The token is interpolated exactly once: the Authorization header.
    assert.equal(source.match(/\$\{token\}/g)?.length, 1);
    assert.match(source, /Authorization: `Bearer \$\{token\}`/);
  });
});
