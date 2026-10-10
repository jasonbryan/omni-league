// Unit tests for scripts/check-deploy-env.mjs (#15, #97). Run with `npm run test:scripts` (node:test).
// The Convex CLI is never called: each case passes a stub reader.
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
  AUTH_EMAIL_DISABLED_WRONG: 'sentinel-yes-2a6f',
};

/** A reader over `vars`; `value` may be called only for AUTH_EMAIL_DISABLED. */
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

/** The allowed preview variables (prerequisite 4), with AUTH_EMAIL_DISABLED=true. */
const ALLOWED_PREVIEW = {
  SITE_URL: SECRET.SITE_URL,
  PREVIEW_ORIGIN_PATTERN: SECRET.PREVIEW_ORIGIN_PATTERN,
  BETTER_AUTH_SECRET: SECRET.BETTER_AUTH_SECRET,
  AUTH_EMAIL_DISABLED: 'true',
};

/** Runs `runCheck` with a stub reader and captures everything it writes. */
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
      ['IS_TEST', 'AUTH_EMAIL_DISABLED', 'RESEND_API_KEY'],
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

describe('checkDeployEnv, production mode', () => {
  it('passes when neither IS_TEST nor AUTH_EMAIL_DISABLED is set', async () => {
    const reader = stubReader({ SITE_URL: SECRET.SITE_URL, RESEND_API_KEY: SECRET.RESEND_API_KEY });
    assert.deepEqual(await checkDeployEnv('production', reader), []);
    assert.deepEqual(reader.reads, []);
  });

  it('fails when IS_TEST is set', async () => {
    const failures = await checkDeployEnv('production', stubReader({ IS_TEST: SECRET.IS_TEST }));
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^IS_TEST /);
  });

  it('fails when PREVIEW_ORIGIN_PATTERN is set, without reading its value (#97)', async () => {
    const reader = stubReader({ PREVIEW_ORIGIN_PATTERN: SECRET.PREVIEW_ORIGIN_PATTERN });
    const failures = await checkDeployEnv('production', reader);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^PREVIEW_ORIGIN_PATTERN /);
    assert.deepEqual(reader.reads, []);
  });

  for (const value of ['true', SECRET.AUTH_EMAIL_DISABLED_WRONG]) {
    it(`fails when AUTH_EMAIL_DISABLED is set (to ${JSON.stringify(value)})`, async () => {
      const failures = await checkDeployEnv(
        'production',
        stubReader({ AUTH_EMAIL_DISABLED: value }),
      );
      assert.equal(failures.length, 1);
      assert.match(failures[0], /^AUTH_EMAIL_DISABLED /);
    });
  }
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
    ['production', { SITE_URL: SECRET.SITE_URL }, 0, []],
    ['production', { IS_TEST: SECRET.IS_TEST }, 1, ['IS_TEST']],
    ['production', { AUTH_EMAIL_DISABLED: 'true' }, 1, ['AUTH_EMAIL_DISABLED']],
    [
      'production',
      { PREVIEW_ORIGIN_PATTERN: SECRET.PREVIEW_ORIGIN_PATTERN },
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
