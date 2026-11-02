// Prints the public key and the path only, so the private key never reaches a terminal, a log, or an
// agent transcript.
import { open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

const USAGE = 'usage: node scripts/vapid-keys.mjs --out <file>';
const REPOSITORY = join(import.meta.dirname, '..');

class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @returns {string}
 */
function parseOut(argv) {
  if (argv.length !== 2 || argv[0] !== '--out' || !argv[1]) throw new UsageError(USAGE);
  return argv[1];
}

/** @param {string} path */
async function isInsideRepository(path) {
  const repository = await realpath(REPOSITORY);
  const parent = await realpath(dirname(path));
  const fromRepository = relative(repository, join(parent, basename(path)));
  return !fromRepository.startsWith('..') && !isAbsolute(fromRepository);
}

/** @returns {Promise<{ publicKey: string, privateKey: string }>} */
async function generatePair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  if (!jwk.d) throw new Error('the private key has no scalar');
  return { publicKey: Buffer.from(raw).toString('base64url'), privateKey: jwk.d };
}

/** @param {string[]} argv */
async function main(argv) {
  const out = resolve(parseOut(argv));
  if (await isInsideRepository(out)) {
    throw new Error(`${out} is inside the repository; write the pair somewhere outside it.`);
  }
  const { publicKey, privateKey } = await generatePair();
  let file;
  try {
    // `wx` refuses an existing file, and the mode applies from creation, so no other user can read it in between.
    file = await open(out, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(`${out} already exists; choose a new file.`, { cause: error });
    throw error;
  }
  try {
    await file.writeFile(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\n`);
  } finally {
    await file.close();
  }
  console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
  console.log(`Wrote the key pair to ${out} (mode 600). The private key is only in that file.`);
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`vapid-keys: ${error.message}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
