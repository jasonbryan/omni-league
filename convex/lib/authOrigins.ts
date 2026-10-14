import { PREVIEW_ORIGIN_PATTERN } from './previewOrigin';

const PREVIEW_ORIGIN = new RegExp(PREVIEW_ORIGIN_PATTERN);

export interface OriginEnv {
  SITE_URL?: string | undefined;
  PREVIEW_ORIGIN_PATTERN?: string | undefined;
}

// The pattern is compiled from the constant, never from the variable's value, so a wider value on a
// deployment widens nothing.
export function trustedOrigins(request: Request | undefined, env: OriginEnv): string[] {
  const origins: string[] = [];
  const site = originOf(env.SITE_URL);
  if (site) origins.push(site);
  if (env.PREVIEW_ORIGIN_PATTERN === PREVIEW_ORIGIN_PATTERN) {
    const origin = request?.headers.get('origin');
    if (origin && PREVIEW_ORIGIN.test(origin) && !origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
