// Imports nothing, so the app can import it.

export const LOGO_MAX_BYTES = 256 * 1024;

/** An upload URL lives one hour, so an older file in storage is not an upload in progress. */
export const LOGO_UPLOAD_MAX_AGE_MS = 60 * 60 * 1000;

export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

/** The longest signature is a WebP's: `RIFF`, four size bytes, `WEBP`. */
export const LOGO_HEAD_BYTES = 12;

export const LOGO_HINT = 'Square images work best. PNG, JPEG, or WebP, up to 256 KB.';

export type LogoInputCode = 'logoType' | 'logoSize' | 'logoOld' | 'logoInUse' | 'logoMissing';

export interface LogoInputError {
  field: 'logo';
  code: LogoInputCode;
  message: string;
}

const KB = 1024;
const MB = KB * KB;

export function formatFileSize(bytes: number): string {
  if (bytes < KB) return `${bytes} bytes`;
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  return `${Number((bytes / MB).toFixed(1))} MB`;
}

export const LOGO_MESSAGES = {
  logoType: 'Use a PNG, JPEG, or WebP image.',
  logoSize: (size: number) =>
    `Use an image of ${LOGO_MAX_BYTES / KB} KB or less. This one is ${formatFileSize(size)}.`,
  logoOld: 'This upload has expired. Choose the image again.',
  logoInUse: 'This image is already in use. Choose the image again.',
  logoMissing: 'This upload was not found. Choose the image again.',
} as const;

export function logoError(
  code: 'logoType' | 'logoOld' | 'logoInUse' | 'logoMissing',
): LogoInputError;
export function logoError(code: 'logoSize', size: number): LogoInputError;
export function logoError(code: LogoInputCode, size = 0): LogoInputError {
  const message = code === 'logoSize' ? LOGO_MESSAGES.logoSize(size) : LOGO_MESSAGES[code];
  return { field: 'logo', code, message };
}

/** The checks the page runs before it uploads; the server checks the same size and the file's bytes again. */
export function checkLogoPick(file: { type: string; size: number }): LogoInputError | null {
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type) || file.size === 0) {
    return logoError('logoType');
  }
  if (file.size > LOGO_MAX_BYTES) return logoError('logoSize', file.size);
  return null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function startsWith(head: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => head[offset + index] === byte);
}

/** The type the file's first bytes show, whatever Content-Type the uploader sent. */
export function detectLogoType(head: Uint8Array): LogoMimeType | null {
  if (startsWith(head, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(head, JPEG_SIGNATURE)) return 'image/jpeg';
  if (startsWith(head, RIFF) && startsWith(head, WEBP, 8)) return 'image/webp';
  return null;
}
