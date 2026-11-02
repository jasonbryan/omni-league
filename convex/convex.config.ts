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
    // The shared password of the demo accounts, set by the owner as a Convex default preview
    // variable. Secret; read only by `seed:demo`, never logged, and never on production
    // (scripts/check-deploy-env.mjs production fails when it is set).
    DEMO_ACCOUNT_PASSWORD: v.optional(v.string()),
    // Public by design: push.getConfig hands it to every browser that subscribes.
    VAPID_PUBLIC_KEY: v.optional(v.string()),
  },
});

app.use(betterAuth);

export default app;
