import { defineConfig } from 'vitest/config';

// Convex function tests only (ADR 0004). Angular specs run through `ng test`.
export default defineConfig({
  test: {
    name: 'convex',
    include: ['convex/**/*.test.ts'],
    environment: 'edge-runtime',
  },
});
