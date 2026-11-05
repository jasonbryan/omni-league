/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { describe, expect, test, vi } from 'vitest';
import { components } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import schema from '../schema';
import { modules } from '../test.setup';
import { authEmailsOf } from './authUsers';

async function createAuthUser(ctx: MutationCtx, email: string): Promise<string> {
  const now = Date.now();
  const account = (await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'user',
      data: { name: email, email, emailVerified: false, createdAt: now, updatedAt: now },
    },
  } as never)) as { _id: string };
  return account._id;
}

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  return t;
}

describe('authEmailsOf', () => {
  test('looks up many users in one component call and keys each lower-cased email by id', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) ids.push(await createAuthUser(ctx, `User-${i}@Example.test`));
      const runQuery = vi.spyOn(ctx, 'runQuery');
      const emails = await authEmailsOf(ctx, ids);
      expect(runQuery).toHaveBeenCalledTimes(1);
      expect(emails.size).toBe(50);
      ids.forEach((id, i) => expect(emails.get(id)).toBe(`user-${i}@example.test`));
    });
  });

  test('makes no component call for an empty list', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const runQuery = vi.spyOn(ctx, 'runQuery');
      expect((await authEmailsOf(ctx, [])).size).toBe(0);
      expect(runQuery).not.toHaveBeenCalled();
    });
  });

  test('answers a repeated id once', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const id = await createAuthUser(ctx, 'once@example.test');
      const emails = await authEmailsOf(ctx, [id, id, id]);
      expect([...emails]).toEqual([[id, 'once@example.test']]);
    });
  });

  test('leaves out a deleted user and keeps the others on their own ids', async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const first = await createAuthUser(ctx, 'first@example.test');
      const gone = await createAuthUser(ctx, 'gone@example.test');
      const third = await createAuthUser(ctx, 'third@example.test');
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: { model: 'user', where: [{ field: '_id', value: gone }] },
      } as never);
      const emails = await authEmailsOf(ctx, [first, gone, third]);
      expect(emails.get(first)).toBe('first@example.test');
      expect(emails.has(gone)).toBe(false);
      expect(emails.get(third)).toBe('third@example.test');
    });
  });
});
