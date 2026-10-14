import betterAuth from '@convex-dev/better-auth/convex.config';
import { defineApp } from 'convex/server';
import { v } from 'convex/values';

const app = defineApp({
  env: {
    // "true" only on the local e2e backend; never on cloud dev, preview, or production.
    IS_TEST: v.optional(v.string()),
    SITE_URL: v.optional(v.string()),
    BETTER_AUTH_SECRET: v.optional(v.string()),
    // Set on preview and staging deployments, never on production.
    PREVIEW_ORIGIN_PATTERN: v.optional(v.string()),
  },
});

app.use(betterAuth);

export default app;
