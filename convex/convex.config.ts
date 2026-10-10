import { defineApp } from 'convex/server';
import { v } from 'convex/values';

// Typed app environment variables, read through `env` from `./_generated/server`.
const app = defineApp({
  env: {
    // "true" only on the local e2e backend; never on cloud dev, preview, or production
    // (ADR 0005; scripts/check-deploy-env.mjs fails a preview or production deploy that sets it).
    IS_TEST: v.optional(v.string()),
    // The Convex default preview variable holding the constant in convex/lib/previewOrigin.ts, on
    // every preview and staging deployment; never on production (scripts/check-deploy-env.mjs).
    PREVIEW_ORIGIN_PATTERN: v.optional(v.string()),
  },
});

export default app;
