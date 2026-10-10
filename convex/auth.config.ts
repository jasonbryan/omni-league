import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config';
import type { AuthConfig } from 'convex/server';

// ADR 0008: exactly one provider, the Better Auth component's JWTs (issuer CONVEX_SITE_URL,
// audience "convex"). No test issuer exists, so tests have no alternative token path.
export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig;
