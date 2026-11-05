import { env } from '../_generated/server';

export interface PushConfig {
  vapid: { subject: string; publicKey: string; privateKey: string };
  siteUrl: string;
}

function values() {
  return {
    VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY?.trim() ?? '',
    VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY?.trim() ?? '',
    VAPID_SUBJECT: env.VAPID_SUBJECT?.trim() ?? '',
    SITE_URL: env.SITE_URL?.trim() ?? '',
  };
}

// Callers log this list, so it holds variable names and never a secret value.
export function missingPushConfig(): string[] {
  return Object.entries(values())
    .filter(([, value]) => value === '')
    .map(([name]) => name);
}

export function readPushConfig(): PushConfig | null {
  if (missingPushConfig().length > 0) return null;
  const read = values();
  return {
    vapid: {
      publicKey: read.VAPID_PUBLIC_KEY,
      privateKey: read.VAPID_PRIVATE_KEY,
      subject: read.VAPID_SUBJECT,
    },
    siteUrl: read.SITE_URL,
  };
}
