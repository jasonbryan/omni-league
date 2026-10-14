import { defineConfig } from 'vitest/config';

// One worker, like the 2-vCPU CI runner, so cross-file leaks that parallel local runs hide fail locally too.
export default defineConfig({
  test: {
    maxWorkers: 1,
  },
});
