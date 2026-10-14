import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'convex',
    include: ['convex/**/*.test.ts'],
    environment: 'edge-runtime',
  },
});
