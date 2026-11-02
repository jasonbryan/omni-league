import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkDeployEnv, parseArgs, runCheck } from './check-deploy-env.mjs';

// Sentinel values: none of them may appear in any output.
const SECRET = {
  IS_TEST: 'sentinel-is-test-4f1c',
  RESEND_API_KEY: 're_sentinel_resend_9b2e',
  BETTER_AUTH_SECRET: 'sentinel-better-auth-7d3a',
  SITE_URL: 'https://sentinel-site-url.example',
  PREVIEW_ORIGIN_PATTERN: '^sentinel-pattern-5e8b$',
  DEMO_ACCOUNT_PASSWORD: 'sentinel-demo-password-3c7d',
  AUTH_EMAIL_DISABLED_WRONG: 'sentinel-yes-2a6f',
  VAPID_PUBLIC_KEY: 'sentinel-vapid-public-8e1d',
  VAPID_PRIVATE_KEY: 'sentinel-vapid-private-6b4a',
  VAPID_SUBJECT: 'mailto:sentinel-vapid-subject@example.test',
};

const VAPID_NAMES = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];

function stubReader(vars) {
  const reads = [];
  return {
    reads,
    names: async () => new Set(Object.keys(vars)),
    value: async (name) => {
      reads.push(name);
      return vars[name];
    },
  };
}

const ALLOWED_PREVIEW = {
  SITE_URL: SECRET.SITE_URL,
  PREVIEW_ORIGIN_PATTERN: SECRET.PREVIEW_ORIGIN_PATTERN,
  BETTER_AUTH_SECRET: SECRET.BETTER_AUTH_SECRET,
  AUTH_EMAIL_DISABLED: 'true',
};

const ALLOWED_PRODUCTION = {
  SITE_URL: SECRET.SITE_URL,
  BETTER_AUTH_SECRET: SECRET.BETTER_AUTH_SECRET,
  VAPID_PUBLIC_KEY: SECRET.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: SECRET.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: SECRET.VAPID_SUBJECT,
};

async function run(mode, vars) {
  const out = [];
  const err = [];
  const reader = stubReader(vars);
  const code = await runCheck(
    { mode, previewName: 'pr-15' },
    {
      reader,
      log: (line) => out.push(line),
      error: (line) => err.push(line),
    },
  );
  return { code, stdout: out.join('\n'), stderr: err.join('\n'), reads: reader.reads };
}

function assertNoValue(result) {
  for (const value of Object.values(SECRET)) {
    assert.ok(!result.stdout.includes(value), `stdout contains the stubbed value ${value}`);
    assert.ok(!result.stderr.includes(value), `stderr contains the stubbed value ${value}`);
  }
}

describe('checkDeployEnv, preview mode', () => {
  it('passes with only the allowed variables and AUTH_EMAIL_DISABLED=true', async () => {
    assert.deepEqual(await checkDeployEnv('preview', stubReader(ALLOWED_PREVIEW)), []);
  });

  it('fails when IS_TEST is set', async () => {
    const failures = await checkDeployEnv(
      'preview',
      stubReader({ ...ALLOWED_PREVIEW, IS_TEST: SECRET.IS_TEST }),
    );
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^IS_TEST /);
  });

  it('fails when AUTH_EMAIL_DISABLED is missing', async () => {
    const vars = { ...ALLOWED_PREVIEW };
    delete vars.AUTH_EMAIL_DISABLED;
    const failures = await checkDeployEnv('preview', stubReader(vars));
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^AUTH_EMAIL_DISABLED /);
  });

  for (const wrong of [SECRET.AUTH_EMAIL_DISABLED_WRONG, 'TRUE', 'true ', '1', '']) {
    it(`fails when AUTH_EMAIL_DISABLED is ${JSON.stringify(wrong)}, not exactly true`, async () => {
      const failures = await checkDeployEnv(
        'preview',
        stubReader({ ...ALLOWED_PREVIEW, AUTH_EMAIL_DISABLED: wrong }),
      );
      assert.equal(failures.length, 1);
      assert.match(failures[0], /^AUTH_EMAIL_DISABLED /);
    });
  }

  it('fails when RESEND_API_KEY is set', async () => {
    const failures = await checkDeployEnv(
      'preview',
      stubReader({ ...ALLOWED_PREVIEW, RESEND_API_KEY: SECRET.RESEND_API_KEY }),
    );
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^RESEND_API_KEY /);
  });

  it('reports every failing variable at once', async () => {
    const failures = await checkDeployEnv(
      'preview',
      stubReader({ IS_TEST: SECRET.IS_TEST, RESEND_API_KEY: SECRET.RESEND_API_KEY }),
    );
    assert.deepEqual(
      failures.map((line) => line.split(' ')[0]),
      ['IS_TEST', 'AUTH_EMAIL_DISABLED', 'RESEND_API_KEY', 'BETTER_AUTH_SECRET', 'SITE_URL'],
    );
  });

  it('reads no value except AUTH_EMAIL_DISABLED', async () => {
    const reader = stubReader({
      ...ALLOWED_PREVIEW,
      IS_TEST: SECRET.IS_TEST,
      RESEND_API_KEY: SECRET.RESEND_API_KEY,
    });
    await checkDeployEnv('preview', reader);
    assert.deepEqual(reader.reads, ['AUTH_EMAIL_DISABLED']);
  });
});

describe('checkDeployEnv, DEMO_ACCOUNT_PASSWORD in preview mode', () => {
  it('is not required: a preview without it passes, and with it passes', async () => {
    assert.deepEqual(await checkDeployEnv('preview', stubReader(ALLOWED_PREVIEW)), []);
    const reader = stubReader({
      ...ALLOWED_PREVIEW,
      DEMO_ACCOUNT_PASSWORD: SECRET.DEMO_ACCOUNT_PASSWORD,
    });
    assert.deepEqual(await checkDeployEnv('preview', reader), []);
    assert.deepEqual(reader.reads, ['AUTH_EMAIL_DISABLED']);
  });
});

describe('checkDeployEnv, production mode', () => {
  it('passes when neither IS_TEST nor AUTH_EMAIL_DISABLED is set', async () => {
    const reader = stubReader({ ...ALLOWED_PRODUCTION, RESEND_API_KEY: SECRET.RESEND_API_KEY });
    assert.deepEqual(await checkDeployEnv('production', reader), []);
    assert.deepEqual(reader.reads, []);
  });

  it('fails when IS_TEST is set', async () => {
    const failures = await checkDeployEnv(
      'production',
      stubReader({ ...ALLOWED_PRODUCTION, IS_TEST: SECRET.IS_TEST }),
    );
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^IS_TEST /);
  });

  it('fails when PREVIEW_ORIGIN_PATTERN is set, without reading its value', async () => {
    const reader = stubReader({
      ...ALLOWED_PRODUCTION,
      PREVIEW_ORIGIN_PATTERN: SECRET.PREVIEW_ORIGIN_PATTERN,
    });
    const failures = await checkDeployEnv('production', reader);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^PREVIEW_ORIGIN_PATTERN /);
    assert.deepEqual(reader.reads, []);
  });

  it('fails when DEMO_ACCOUNT_PASSWORD is set, without reading its value', async () => {
    const reader = stubReader({
      ...ALLOWED_PRODUCTION,
      DEMO_ACCOUNT_PASSWORD: SECRET.DEMO_ACCOUNT_PASSWORD,
    });
    const failures = await checkDeployEnv('production', reader);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^DEMO_ACCOUNT_PASSWORD /);
    assert.ok(!failures[0].includes(SECRET.DEMO_ACCOUNT_PASSWORD));
    assert.deepEqual(reader.reads, []);
  });

  for (const value of ['true', SECRET.AUTH_EMAIL_DISABLED_WRONG]) {
    it(`fails when AUTH_EMAIL_DISABLED is set (to ${JSON.stringify(value)})`, async () => {
      const failures = await checkDeployEnv(
        'production',
        stubReader({ ...ALLOWED_PRODUCTION, AUTH_EMAIL_DISABLED: value }),
      );
      assert.equal(failures.length, 1);
      assert.match(failures[0], /^AUTH_EMAIL_DISABLED /);
    });
  }
});

describe('checkDeployEnv, Web Push variables', () => {
  for (const name of VAPID_NAMES) {
    it(`production fails naming ${name} when it is not set, without reading any value`, async () => {
      const vars = { ...ALLOWED_PRODUCTION };
      delete vars[name];
      const reader = stubReader(vars);
      const failures = await checkDeployEnv('production', reader);
      assert.equal(failures.length, 1);
      assert.match(failures[0], new RegExp(`^${name} is not set`));
      assert.deepEqual(reader.reads, []);
      const result = await run('production', vars);
      assert.equal(result.code, 1);
      assertNoValue(result);
    });
  }

  it('production reports all three when none is set', async () => {
    const vars = { SITE_URL: SECRET.SITE_URL, BETTER_AUTH_SECRET: SECRET.BETTER_AUTH_SECRET };
    const failures = await checkDeployEnv('production', stubReader(vars));
    assert.deepEqual(
      failures.map((line) => line.split(' ')[0]),
      VAPID_NAMES,
    );
  });

  it('preview needs none of them: the preview pair is optional', async () => {
    assert.deepEqual(await checkDeployEnv('preview', stubReader(ALLOWED_PREVIEW)), []);
    const withPair = { ...ALLOWED_PREVIEW };
    for (const name of VAPID_NAMES) withPair[name] = SECRET[name];
    const reader = stubReader(withPair);
    assert.deepEqual(await checkDeployEnv('preview', reader), []);
    assert.deepEqual(reader.reads, ['AUTH_EMAIL_DISABLED']);
  });
});

// A deployment with no BETTER_AUTH_SECRET would sign with Better Auth's public default
// secret, and one with no SITE_URL trusts no origin. Names only: the values are never read.
describe('checkDeployEnv, required auth variables', () => {
  const without = (vars, ...names) =>
    Object.fromEntries(Object.entries(vars).filter(([name]) => !names.includes(name)));

  for (const [mode, allowed] of [
    ['preview', ALLOWED_PREVIEW],
    ['production', ALLOWED_PRODUCTION],
  ]) {
    it(`${mode}: fails with one line starting "BETTER_AUTH_SECRET is not set" when only the secret is missing`, async () => {
      const failures = await checkDeployEnv(
        mode,
        stubReader(without(allowed, 'BETTER_AUTH_SECRET')),
      );
      assert.equal(failures.length, 1);
      assert.match(failures[0], /^BETTER_AUTH_SECRET is not set/);
    });

    it(`${mode}: fails with one line starting "SITE_URL is not set" when only SITE_URL is missing`, async () => {
      const failures = await checkDeployEnv(mode, stubReader(without(allowed, 'SITE_URL')));
      assert.equal(failures.length, 1);
      assert.match(failures[0], /^SITE_URL is not set/);
    });

    it(`${mode}: reports both when both are missing, and runCheck says 2 problem(s)`, async () => {
      const vars = without(allowed, 'BETTER_AUTH_SECRET', 'SITE_URL');
      const failures = await checkDeployEnv(mode, stubReader(vars));
      assert.deepEqual(
        failures.map((line) => line.split(' ')[0]),
        ['BETTER_AUTH_SECRET', 'SITE_URL'],
      );
      const result = await run(mode, vars);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /2 problem\(s\)/);
      assertNoValue(result);
    });

    it(`${mode}: runCheck returns 1 when only the secret is missing and 0 when both are set`, async () => {
      assert.equal((await run(mode, without(allowed, 'BETTER_AUTH_SECRET'))).code, 1);
      assert.equal((await run(mode, allowed)).code, 0);
    });
  }

  it('production: with none of the forbidden variables, a missing secret or SITE_URL still fails', async () => {
    for (const missing of ['BETTER_AUTH_SECRET', 'SITE_URL']) {
      const vars = without(ALLOWED_PRODUCTION, missing);
      for (const forbidden of ['IS_TEST', 'AUTH_EMAIL_DISABLED', 'PREVIEW_ORIGIN_PATTERN']) {
        assert.ok(!(forbidden in vars));
      }
      const result = await run('production', vars);
      assert.equal(result.code, 1);
      assert.match(result.stderr, new RegExp(`FAIL ${missing} is not set`));
    }
  });

  it('reads no value: preview reads only AUTH_EMAIL_DISABLED, production reads none', async () => {
    const preview = stubReader(without(ALLOWED_PREVIEW, 'BETTER_AUTH_SECRET', 'SITE_URL'));
    await checkDeployEnv('preview', preview);
    assert.deepEqual(preview.reads, ['AUTH_EMAIL_DISABLED']);
    const production = stubReader(without(ALLOWED_PRODUCTION, 'BETTER_AUTH_SECRET', 'SITE_URL'));
    await checkDeployEnv('production', production);
    assert.deepEqual(production.reads, []);
  });
});

describe('runCheck output', () => {
  const cases = [
    ['preview', ALLOWED_PREVIEW, 0, []],
    ['preview', { ...ALLOWED_PREVIEW, IS_TEST: SECRET.IS_TEST }, 1, ['IS_TEST']],
    ['preview', { ...ALLOWED_PREVIEW, AUTH_EMAIL_DISABLED: undefined }, 1, ['AUTH_EMAIL_DISABLED']],
    [
      'preview',
      { ...ALLOWED_PREVIEW, AUTH_EMAIL_DISABLED: SECRET.AUTH_EMAIL_DISABLED_WRONG },
      1,
      ['AUTH_EMAIL_DISABLED'],
    ],
    [
      'preview',
      { ...ALLOWED_PREVIEW, RESEND_API_KEY: SECRET.RESEND_API_KEY },
      1,
      ['RESEND_API_KEY'],
    ],
    ['production', ALLOWED_PRODUCTION, 0, []],
    [
      'production',
      { ...ALLOWED_PRODUCTION, DEMO_ACCOUNT_PASSWORD: SECRET.DEMO_ACCOUNT_PASSWORD },
      1,
      ['DEMO_ACCOUNT_PASSWORD'],
    ],
    ['production', { ...ALLOWED_PRODUCTION, IS_TEST: SECRET.IS_TEST }, 1, ['IS_TEST']],
    [
      'production',
      { ...ALLOWED_PRODUCTION, AUTH_EMAIL_DISABLED: 'true' },
      1,
      ['AUTH_EMAIL_DISABLED'],
    ],
    [
      'production',
      { ...ALLOWED_PRODUCTION, PREVIEW_ORIGIN_PATTERN: SECRET.PREVIEW_ORIGIN_PATTERN },
      1,
      ['PREVIEW_ORIGIN_PATTERN'],
    ],
  ];

  for (const [mode, rawVars, expectedCode, failing] of cases) {
    const vars = Object.fromEntries(Object.entries(rawVars).filter(([, v]) => v !== undefined));
    const label = failing.length === 0 ? 'passes' : `fails naming ${failing.join(', ')}`;
    it(`${mode} mode ${label}, prints the checked deployment, and prints no value`, async () => {
      const result = await run(mode, vars);
      assert.equal(result.code, expectedCode);
      assert.match(result.stdout, /checking deployment pr-15 \(preview name\)/);
      for (const name of failing) assert.match(result.stderr, new RegExp(`FAIL ${name} `));
      if (failing.length === 0) assert.match(result.stdout, /PASS/);
      assertNoValue(result);
    });
  }

  it('fails, without printing the error text, when the reader throws', async () => {
    const out = [];
    const err = [];
    const code = await runCheck(
      { mode: 'preview', previewName: 'pr-15' },
      {
        reader: {
          names: async () => {
            throw new Error(`boom ${SECRET.BETTER_AUTH_SECRET}`);
          },
          value: async () => undefined,
        },
        log: (line) => out.push(line),
        error: (line) => err.push(line),
      },
    );
    assert.equal(code, 1);
    assertNoValue({ stdout: out.join('\n'), stderr: err.join('\n') });
  });
});

describe('parseArgs', () => {
  it('accepts preview mode with a preview name', () => {
    assert.deepEqual(parseArgs(['preview', '--preview-name', 'pr-15']), {
      mode: 'preview',
      previewName: 'pr-15',
    });
  });

  it('accepts production mode with no target (the deploy key selects the deployment)', () => {
    assert.deepEqual(parseArgs(['production']), { mode: 'production', previewName: undefined });
  });

  it('accepts production mode against a named preview deployment', () => {
    assert.deepEqual(parseArgs(['production', '--preview-name', 'pr-15']), {
      mode: 'production',
      previewName: 'pr-15',
    });
  });

  for (const argv of [
    [],
    ['staging'],
    ['preview'],
    ['preview', '--preview-name'],
    ['preview', '--preview-name', ''],
    ['preview', '--preview-name', 'pr-'],
    ['preview', '--preview-name', '--prod'],
    ['preview', '--preview-name', 'pr-15', 'extra'],
    ['production', '--prod'],
  ]) {
    it(`rejects ${JSON.stringify(argv)}`, () => {
      assert.throws(() => parseArgs(argv), /usage/);
    });
  }
});

describe('command line', () => {
  it('exits 2 with usage on bad arguments, before calling the Convex CLI', () => {
    const script = join(import.meta.dirname, 'check-deploy-env.mjs');
    const result = spawnSync(process.execPath, [script, 'staging'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage/);
  });
});
