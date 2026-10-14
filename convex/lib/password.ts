// scrypt N=2^15, r=8, p=3 (32 MiB): an OWASP Password Storage Cheat Sheet setting, and the strongest
// that fits the Convex runtime's 64 MB memory limit. `@noble/hashes` is pure JavaScript, so it runs
// in the Convex V8 runtime. Each hash stores its parameters, so they can be raised later.
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';

export const SCRYPT_LOG_N = 15;
export const SCRYPT_R = 8;
export const SCRYPT_P = 3;
export const SCRYPT_SALT_BYTES = 16;
export const SCRYPT_KEY_BYTES = 32;

const MAX_LOG_N = 20;
const MAX_R = 32;
const MAX_P = 16;

const SCRYPT_MAXMEM_HEADROOM_BYTES = 1024 * 1024;

function scryptWorkingMemoryBytes(r: number, logN: number): number {
  return 128 * r * 2 ** logN;
}

const HEX = /^(?:[0-9a-f]{2})+$/;
const INTEGER = /^[1-9][0-9]{0,2}$/;

interface Params {
  logN: number;
  r: number;
  p: number;
  salt: Uint8Array;
  key: Uint8Array;
}

async function derive(
  password: string,
  { logN, r, p, salt, dkLen }: Omit<Params, 'key'> & { dkLen: number },
) {
  return scryptAsync(password.normalize('NFKC'), salt, {
    N: 2 ** logN,
    r,
    p,
    dkLen,
    // Without this, the library's 1 GiB default cap would reject the larger parameters `parse` accepts.
    maxmem: scryptWorkingMemoryBytes(r, logN) + SCRYPT_MAXMEM_HEADROOM_BYTES,
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const key = await derive(password, {
    logN: SCRYPT_LOG_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt,
    dkLen: SCRYPT_KEY_BYTES,
  });
  return ['scrypt', SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P, bytesToHex(salt), bytesToHex(key)].join('$');
}

function parse(stored: string): Params | null {
  const parts = stored.split('$');
  if (parts.length !== 6) return null;
  const [algorithm, logN, r, p, salt, key] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (algorithm !== 'scrypt') return null;
  if (![logN, r, p].every((value) => INTEGER.test(value))) return null;
  if (!HEX.test(salt) || !HEX.test(key)) return null;
  const params = { logN: Number(logN), r: Number(r), p: Number(p) };
  if (params.logN > MAX_LOG_N || params.r > MAX_R || params.p > MAX_P) return null;
  return { ...params, salt: hexToBytes(salt), key: hexToBytes(key) };
}

// A malformed hash never matches and never throws, so a bad row cannot turn a sign-in into a server
// error.
export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  const params = parse(hash);
  if (!params) return false;
  const key = await derive(password, { ...params, dkLen: params.key.length });
  return constantTimeEqual(key, params.key);
}

// Lengths are not secret here: the stored key length is fixed.
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}
