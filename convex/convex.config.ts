import betterAuth from '@convex-dev/better-auth/convex.config';
import { defineApp } from 'convex/server';
import { v } from 'convex/values';

// Typed app environment variables, read through `env` from `./_generated/server`.
const app = defineApp({
  env: {
    // "true" only on the local e2e backend; never on cloud dev, preview, or production
    // (ADR 0005; scripts/check-deploy-env.mjs fails a preview or production deploy that sets it).
    IS_TEST: v.optional(v.string()),
    // Better Auth (ADR 0008, #62). The browser app's origin: set per deployment, a Convex default
    // preview variable on previews (docs/process/hosting.md), and set per run on the e2e backend.
    SITE_URL: v.optional(v.string()),
    // Encrypts the JWT signing key in the component's `jwks` table. Secret; never logged.
    BETTER_AUTH_SECRET: v.optional(v.string()),
    // The Convex default preview variable holding the constant in convex/lib/previewOrigin.ts, on
    // every preview and staging deployment; never on production (scripts/check-deploy-env.mjs).
    // Better Auth then trusts this project's preview origins (convex/lib/authOrigins.ts).
    PREVIEW_ORIGIN_PATTERN: v.optional(v.string()),
    // The shared password of the demo accounts (#98), set by the owner as a Convex default preview
    // variable. Secret; read only by `seed:demo`, never logged, and never on production
    // (scripts/check-deploy-env.mjs production fails when it is set).
    DEMO_ACCOUNT_PASSWORD: v.optional(v.string()),
  },
});

// Better Auth's tables (user, session, account, verification, jwks, rateLimit) live in the
// component, not in convex/schema.ts.
app.use(betterAuth);

export default app;
