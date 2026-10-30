/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { LOGO_MAX_BYTES, LOGO_UPLOAD_MAX_AGE_MS } from './lib/logoFile';
import { insertTenant } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const NOW = Date.UTC(2027, 0, 15, 12);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const padded = (head: number[], size: number) => {
  const body = new Uint8Array(size);
  body.set(head);
  return body;
};
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (size = 2048) => padded(PNG_HEAD, size);
const jpeg = (size = 2048) => padded([0xff, 0xd8, 0xff, 0xe0], size);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Courts', address: '1 Rd' }],
      leagues: [{ name: 'Coed 4s', sport: 'beachVolleyball', locations: ['Courts'] }],
    });
    const b = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'Fields', address: '2 Rd' }],
      leagues: [{ name: 'Coed 7s', sport: 'soccer', locations: ['Fields'] }],
    });
    for (const [authUserId, organizationId] of [
      ['admin-a', a],
      ['admin-b', b],
    ] as const) {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      await ctx.db.insert('memberships', {
        userId,
        organizationId,
        role: 'orgAdmin',
        leagueIds: [],
      });
    }
    return { a, b };
  });
  return {
    t,
    ...ids,
    adminA: t.withIdentity(identity('admin-a')),
    adminB: t.withIdentity(identity('admin-b')),
  };
}

type T = Awaited<ReturnType<typeof setup>>['t'];

const upload = (t: T, body: Uint8Array, type = 'image/png') =>
  t.run(async (ctx) => ctx.storage.store(new Blob([body.slice()], { type })));

const fileExists = (t: T, id: Id<'_storage'>) =>
  t.run(async (ctx) => (await ctx.db.system.get('_storage', id)) !== null);

const logoOf = (t: T, id: Id<'organizations'>) =>
  t.run(async (ctx) => (await ctx.db.get('organizations', id))?.logoStorageId ?? null);

const setLogoOn = (t: T, id: Id<'organizations'>, storageId: Id<'_storage'>) =>
  t.run(async (ctx) => ctx.db.patch('organizations', id, { logoStorageId: storageId }));

async function refusalCode(call: Promise<unknown>): Promise<string | undefined> {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ code?: string }>).data.code;
}

describe('organizations.setLogo, files that are not a logo', () => {
  test.each([
    ['an empty file', new Uint8Array(0)],
    ['a GIF', padded(ascii('GIF89a'), 2048)],
    [
      'a RIFF file that is not a WebP',
      padded([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')], 2048),
    ],
    ['a PNG signature cut short', Uint8Array.from(PNG_HEAD.slice(0, 7))],
    ['a PDF', padded(ascii('%PDF-1.7'), 2048)],
  ])('refuses %s sent as image/png, deletes it, and keeps the previous logo', async (_, body) => {
    const { t, a, adminA } = await setup();
    const previous = await upload(t, png());
    await adminA.action(api.organizations.setLogo, { organizationId: a, storageId: previous });
    const bad = await upload(t, body);
    const code = await refusalCode(
      adminA.action(api.organizations.setLogo, { organizationId: a, storageId: bad }),
    );
    expect(code).toBe('logoType');
    expect(await fileExists(t, bad)).toBe(false);
    expect(await logoOf(t, a)).toBe(previous);
    expect(await fileExists(t, previous)).toBe(true);
  });
});

describe('organizations.setLogo, a file another organization holds', () => {
  test('is refused as in use, not as old, and stays when the other logo is older than an hour', async () => {
    const { t, a, b, adminA } = await setup();
    const theirs = await upload(t, png());
    await setLogoOn(t, b, theirs);
    vi.setSystemTime(NOW + LOGO_UPLOAD_MAX_AGE_MS * 24);
    const code = await refusalCode(
      adminA.action(api.organizations.setLogo, { organizationId: a, storageId: theirs }),
    );
    expect(code).toBe('logoInUse');
    expect(await fileExists(t, theirs)).toBe(true);
    expect(await logoOf(t, b)).toBe(theirs);
  });

  test.each([
    [
      'bytes that are not an image',
      padded(ascii('<svg xmlns="http://www.w3.org/2000/svg">'), 2048),
    ],
    ['a size over 256 KB', png(LOGO_MAX_BYTES + 1)],
  ])('stays when it has %s, and is refused as in use', async (_, body) => {
    const { t, a, b, adminA } = await setup();
    const theirs = await upload(t, body);
    await setLogoOn(t, b, theirs);
    const code = await refusalCode(
      adminA.action(api.organizations.setLogo, { organizationId: a, storageId: theirs }),
    );
    expect(code).toBe('logoInUse');
    expect(await fileExists(t, theirs)).toBe(true);
    expect(await logoOf(t, b)).toBe(theirs);
  });

  test('goes to one organization when both claim it at once, and the file stays', async () => {
    const { t, a, b, adminA, adminB } = await setup();
    const shared = await upload(t, jpeg());
    const outcomes = await Promise.allSettled([
      adminA.action(api.organizations.setLogo, { organizationId: a, storageId: shared }),
      adminB.action(api.organizations.setLogo, { organizationId: b, storageId: shared }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const holders = [await logoOf(t, a), await logoOf(t, b)].filter((id) => id === shared);
    expect(holders).toHaveLength(1);
    expect(await fileExists(t, shared)).toBe(true);
  });
});

describe('organizations.removeLogo, with a file another organization holds', () => {
  test('an admin of A cannot remove the logo of B, and the file stays', async () => {
    const { t, b, adminA } = await setup();
    const theirs = await upload(t, png());
    await setLogoOn(t, b, theirs);
    await expect(
      adminA.mutation(api.organizations.removeLogo, { organizationId: b }),
    ).rejects.toThrow();
    expect(await logoOf(t, b)).toBe(theirs);
    expect(await fileExists(t, theirs)).toBe(true);
  });
});
