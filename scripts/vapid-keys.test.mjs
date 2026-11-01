import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { promisify } from 'node:util';

const ROOT = join(import.meta.dirname, '..');
const SCRIPT = join(import.meta.dirname, 'vapid-keys.mjs');
const run = promisify(execFile);

async function runScript(...args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

function bytes(base64url) {
  return new Uint8Array(Buffer.from(base64url, 'base64url'));
}

function parseKeyFile(text) {
  return Object.fromEntries(
    text
      .trim()
      .split('\n')
      .map((line) => line.split('=', 2)),
  );
}

describe('vapid-keys.mjs', () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vapid-keys-'));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a matching P-256 pair to a new mode-600 file and prints only the public key and the path', async () => {
    const out = join(dir, 'pair.env');
    const result = await runScript('--out', out);
    assert.equal(result.code, 0, result.stderr);

    assert.equal((await stat(out)).mode & 0o777, 0o600);
    const keys = parseKeyFile(await readFile(out, 'utf8'));
    assert.deepEqual(Object.keys(keys).sort(), ['VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY']);
    const publicKey = bytes(keys.VAPID_PUBLIC_KEY);
    assert.equal(publicKey.length, 65);
    assert.equal(publicKey[0], 0x04);
    assert.equal(bytes(keys.VAPID_PRIVATE_KEY).length, 32);
    assert.match(keys.VAPID_PUBLIC_KEY, /^[A-Za-z0-9_-]+$/);
    assert.match(keys.VAPID_PRIVATE_KEY, /^[A-Za-z0-9_-]+$/);

    // The private key signs what the public key verifies, so the two are one pair.
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      d: keys.VAPID_PRIVATE_KEY,
      x: Buffer.from(publicKey.slice(1, 33)).toString('base64url'),
      y: Buffer.from(publicKey.slice(33)).toString('base64url'),
    };
    const ecdsa = { name: 'ECDSA', namedCurve: 'P-256' };
    const signer = await crypto.subtle.importKey('jwk', jwk, ecdsa, false, ['sign']);
    const verifier = await crypto.subtle.importKey('raw', publicKey, ecdsa, false, ['verify']);
    const data = new TextEncoder().encode('omni-league');
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, data);
    assert.equal(
      await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, signature, data),
      true,
    );

    assert.ok(result.stdout.includes(keys.VAPID_PUBLIC_KEY));
    assert.ok(result.stdout.includes(out));
    assert.ok(!result.stdout.includes(keys.VAPID_PRIVATE_KEY));
    assert.ok(!result.stderr.includes(keys.VAPID_PRIVATE_KEY));
  });

  it('writes a new pair each run', async () => {
    const first = join(dir, 'first.env');
    const second = join(dir, 'second.env');
    await runScript('--out', first);
    await runScript('--out', second);
    assert.notEqual(await readFile(first, 'utf8'), await readFile(second, 'utf8'));
  });

  it('refuses an existing file and leaves it unchanged', async () => {
    const out = join(dir, 'existing.env');
    await writeFile(out, 'keep me\n');
    const result = await runScript('--out', out);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /already exists/);
    assert.equal(await readFile(out, 'utf8'), 'keep me\n');
  });

  it('refuses a path inside the repository and writes nothing there', async () => {
    for (const out of [join(ROOT, 'vapid-test-pair.env'), join(ROOT, 'scripts', 'pair.env')]) {
      const result = await runScript('--out', out);
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /inside the repository/);
      await assert.rejects(stat(out), { code: 'ENOENT' });
    }
  });

  it('refuses a path that reaches the repository through ..', async () => {
    const out = `${dir}/../${relative(join(dir, '..'), join(ROOT, 'x.env'))}`;
    const result = await runScript('--out', out);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /inside the repository/);
  });

  it('refuses a missing --out or an unknown argument with the usage line', async () => {
    for (const args of [[], ['--out'], ['--print'], ['--out', join(dir, 'a.env'), 'extra']]) {
      const result = await runScript(...args);
      assert.equal(result.code, 2);
      assert.match(result.stderr, /usage: node scripts\/vapid-keys\.mjs --out <file>/);
    }
  });
});
