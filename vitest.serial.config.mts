import { defineConfig } from 'vitest/config';

// `npm run test:serial`: Angular specs in one worker, like the 2-vCPU CI runner,
// so cross-file leaks that parallel local runs hide can fail locally too.
// Passed to `ng test` via `--runner-config`; the builder merges it with its own config.
export default defineConfig({
  test: {
    maxWorkers: 1,
  },
});
