import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config';
import type { AuthConfig } from 'convex/server';

// Exactly one provider, so no alternative token path exists.
export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig;
