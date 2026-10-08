import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';
import { modules } from './test.setup';

test('health.ping returns "ok" through the Convex test harness', async () => {
  const t = convexTest({ schema, modules });
  await expect(t.query(internal.health.ping, {})).resolves.toBe('ok');
});
