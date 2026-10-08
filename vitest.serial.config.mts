import { defineConfig } from 'vitest/config';

// `npm run test:serial`: Angular specs in one worker, as on the CI runner,
// so cross-file leaks that parallel local runs hide fail locally too.
// Passed to `ng test` via `--runner-config`; the builder merges it with its own config.
export default defineConfig({
  test: {
    maxWorkers: 1,
  },
});
