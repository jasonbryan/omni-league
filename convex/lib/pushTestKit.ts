export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(parts.flatMap((part) => [...part]));

export interface BrowserSubscription {
  p256dh: string;
  auth: string;
  privateKey: CryptoKey;
  publicKeyBytes: Uint8Array<ArrayBuffer>;
  authBytes: Uint8Array<ArrayBuffer>;
}

export async function makeBrowserSubscription(): Promise<BrowserSubscription> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const authBytes = crypto.getRandomValues(new Uint8Array(16));
  return {
    p256dh: base64Url(publicKeyBytes),
    auth: base64Url(authBytes),
    privateKey: pair.privateKey,
    publicKeyBytes,
    authBytes,
  };
}

export interface VapidPair {
  publicKey: string;
  privateKey: string;
}

export async function makeVapidPair(): Promise<VapidPair> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return {
    publicKey: base64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    privateKey: jwk.d ?? '',
  };
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

const text = (value: string) => new TextEncoder().encode(value);

export async function decryptPushBody(
  body: Uint8Array,
  subscription: BrowserSubscription,
): Promise<string> {
  const salt = body.slice(0, 16);
  const keyIdLength = body[20] ?? 0;
  const serverPublic = body.slice(21, 21 + keyIdLength);
  const ciphertext = body.slice(21 + keyIdLength);
  const serverKey = await crypto.subtle.importKey(
    'raw',
    serverPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: serverKey },
      subscription.privateKey,
      256,
    ),
  );
  const ikm = await hkdf(
    subscription.authBytes,
    shared,
    concat(text('WebPush: info\0'), subscription.publicKeyBytes, serverPublic),
    32,
  );
  const contentKey = await hkdf(salt, ikm, text('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, text('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ciphertext),
  );
  const delimiter = padded.lastIndexOf(2);
  return new TextDecoder().decode(padded.slice(0, delimiter));
}

export interface VapidClaims {
  aud: string;
  sub: string;
  exp: number;
  signatureValid: boolean;
  publicKeyParameter: string;
}

export async function readVapidAuthorization(authorization: string): Promise<VapidClaims> {
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(authorization);
  if (!match) throw new Error('Not a VAPID authorization header');
  const [, header, claims, signature, publicKeyParameter] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  const key = await crypto.subtle.importKey(
    'raw',
    fromBase64Url(publicKeyParameter),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const signatureValid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    fromBase64Url(signature),
    text(`${header}.${claims}`),
  );
  const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(claims))) as {
    aud: string;
    sub: string;
    exp: number;
  };
  return { ...parsed, signatureValid, publicKeyParameter };
}
