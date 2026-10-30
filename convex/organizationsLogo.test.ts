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
const png = (size = 100 * 1024) => padded(PNG_HEAD, size);
const jpeg = (size = 2048) => padded([0xff, 0xd8, 0xff, 0xe0], size);
const webp = (size = 2048) => padded([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')], size);
const svg = () => Uint8Array.from(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'));
const html = () => Uint8Array.from(ascii('<!doctype html><script>alert(1)</script>'));
const pngThenHtml = () => Uint8Array.from([...PNG_HEAD, ...html()]);

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
    const member = async (
      authUserId: string,
      organization: Id<'organizations'> | null,
      role: 'orgAdmin' | 'leagueOrganizer',
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (organization) {
        await ctx.db.insert('memberships', {
          userId,
          organizationId: organization,
          role,
          leagueIds: [],
        });
      }
    };
    await member('admin-a', a, 'orgAdmin');
    await member('organizer-a', a, 'leagueOrganizer');
    await member('admin-b', b, 'orgAdmin');
    await member('stranger', null, 'orgAdmin');
    return { a, b };
  });
  return { t, ...ids, admin: t.withIdentity(identity('admin-a')) };
}

type T = Awaited<ReturnType<typeof setup>>['t'];

interface StorageMetadataWriter {
  patch(table: '_storage', id: Id<'_storage'>, value: { contentType: string }): Promise<void>;
}

/** convex-test does not record a stored blob's type, so it is written as the backend records it. */
const upload = (t: T, body: Uint8Array, contentType: string | null = 'image/png') =>
  t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([body.slice()]));
    if (contentType !== null) {
      await (ctx.db as unknown as StorageMetadataWriter).patch('_storage', storageId, {
        contentType,
      });
    }
    return storageId;
  });

const storedType = (t: T, id: Id<'_storage'>) =>
  t.run(async (ctx) => (await ctx.db.system.get('_storage', id))?.contentType ?? null);

const fileExists = (t: T, id: Id<'_storage'>) =>
  t.run(async (ctx) => (await ctx.db.system.get('_storage', id)) !== null);

const logoOf = (t: T, id: Id<'organizations'>) =>
  t.run(async (ctx) => (await ctx.db.get('organizations', id))?.logoStorageId ?? null);

const setLogoOn = (t: T, id: Id<'organizations'>, storageId: Id<'_storage'>) =>
  t.run(async (ctx) => ctx.db.patch('organizations', id, { logoStorageId: storageId }));

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ field: string; code: string; message: string }>).data;
}

async function rejected(call: Promise<unknown>): Promise<void> {
  await expect(call).rejects.toThrow();
}

describe('organizations.setLogo', () => {
  test('an org admin sets a 100 KB PNG, a JPEG, and a WebP, each stored as the type its bytes show', async () => {
    const { t, a, admin } = await setup();
    for (const [body, type] of [
      [png(), 'image/png'],
      [jpeg(), 'image/jpeg'],
      [webp(), 'image/webp'],
    ] as const) {
      const storageId = await upload(t, body, type);
      await expect(
        admin.action(api.organizations.setLogo, { organizationId: a, storageId }),
      ).resolves.toBeNull();
      expect(await logoOf(t, a)).toBe(storageId);
      expect(await storedType(t, storageId)).toBe(type);
    }
  });

  test.each([
    ['PNG bytes followed by a script, stored as text/html', pngThenHtml(), 'text/html'],
    ['PNG bytes stored as image/svg+xml', png(), 'image/svg+xml'],
    ['PNG bytes stored as application/octet-stream', png(), 'application/octet-stream'],
    ['PNG bytes stored with no Content-Type', png(), null],
    ['JPEG bytes stored as image/png', jpeg(), 'image/png'],
    ['WebP bytes stored as image/jpeg', webp(), 'image/jpeg'],
    ['PNG bytes stored as image/png with a parameter', png(), 'image/png; charset=utf-8'],
  ])('refuses %s, deletes it, and keeps the previous logo', async (_, body, contentType) => {
    const { t, a, admin } = await setup();
    const previous = await upload(t, png());
    await admin.action(api.organizations.setLogo, { organizationId: a, storageId: previous });
    const bad = await upload(t, body, contentType);
    const data = await refusal(
      admin.action(api.organizations.setLogo, { organizationId: a, storageId: bad }),
    );
    expect(data).toMatchObject({ field: 'logo', code: 'logoType' });
    expect(await fileExists(t, bad)).toBe(false);
    expect(await logoOf(t, a)).toBe(previous);
    expect(await fileExists(t, previous)).toBe(true);
  });

  test('a replacement keeps the new file and deletes the old one', async () => {
    const { t, a, admin } = await setup();
    const first = await upload(t, png());
    await admin.action(api.organizations.setLogo, { organizationId: a, storageId: first });
    const second = await upload(t, jpeg(), 'image/jpeg');
    await admin.action(api.organizations.setLogo, { organizationId: a, storageId: second });
    expect(await logoOf(t, a)).toBe(second);
    expect(await fileExists(t, first)).toBe(false);
    expect(await fileExists(t, second)).toBe(true);
  });

  test.each([
    ['an SVG body stored as image/png', svg(), 'image/png', 'logoType'],
    ['an HTML body stored as image/jpeg', html(), 'image/jpeg', 'logoType'],
    ['a 300 KB PNG', png(300 * 1024), 'image/png', 'logoSize'],
    ['a PNG one byte over 256 KB', png(LOGO_MAX_BYTES + 1), 'image/png', 'logoSize'],
  ])(
    'refuses %s, deletes the uploaded file, and keeps the previous logo',
    async (_, body, type, code) => {
      const { t, a, admin } = await setup();
      const previous = await upload(t, png());
      await admin.action(api.organizations.setLogo, { organizationId: a, storageId: previous });
      const bad = await upload(t, body, type);
      const data = await refusal(
        admin.action(api.organizations.setLogo, { organizationId: a, storageId: bad }),
      );
      expect(data).toMatchObject({ field: 'logo', code });
      expect(await fileExists(t, bad)).toBe(false);
      expect(await logoOf(t, a)).toBe(previous);
      expect(await fileExists(t, previous)).toBe(true);
    },
  );

  test('accepts a PNG of exactly 256 KB', async () => {
    const { t, a, admin } = await setup();
    const storageId = await upload(t, png(LOGO_MAX_BYTES));
    await admin.action(api.organizations.setLogo, { organizationId: a, storageId });
    expect(await logoOf(t, a)).toBe(storageId);
  });

  test('refuses a file uploaded more than an hour ago, deletes it, and keeps the previous logo', async () => {
    const { t, a, admin } = await setup();
    const previous = await upload(t, png());
    await admin.action(api.organizations.setLogo, { organizationId: a, storageId: previous });
    const old = await upload(t, png());
    vi.setSystemTime(NOW + LOGO_UPLOAD_MAX_AGE_MS + 1);
    const data = await refusal(
      admin.action(api.organizations.setLogo, { organizationId: a, storageId: old }),
    );
    expect(data).toMatchObject({ field: 'logo', code: 'logoOld' });
    expect(await fileExists(t, old)).toBe(false);
    expect(await logoOf(t, a)).toBe(previous);
  });

  test('accepts a file uploaded exactly an hour ago', async () => {
    const { t, a, admin } = await setup();
    const storageId = await upload(t, png());
    vi.setSystemTime(NOW + LOGO_UPLOAD_MAX_AGE_MS);
    await admin.action(api.organizations.setLogo, { organizationId: a, storageId });
    expect(await logoOf(t, a)).toBe(storageId);
  });

  test('a replacement succeeds when the old file is already gone', async () => {
    const { t, a, admin } = await setup();
    const old = await upload(t, png());
    await setLogoOn(t, a, old);
    await t.run(async (ctx) => ctx.storage.delete(old));
    const next = await upload(t, jpeg(), 'image/jpeg');
    await admin.action(api.organizations.setLogo, { organizationId: a, storageId: next });
    expect(await logoOf(t, a)).toBe(next);
  });

  test('refuses an id with no file, and changes nothing', async () => {
    const { t, a, admin } = await setup();
    const gone = await upload(t, png());
    await t.run(async (ctx) => ctx.storage.delete(gone));
    const data = await refusal(
      admin.action(api.organizations.setLogo, { organizationId: a, storageId: gone }),
    );
    expect(data).toMatchObject({ field: 'logo', code: 'logoMissing' });
    expect(await logoOf(t, a)).toBeNull();
  });

  test('an org admin of A cannot use the file that is the logo of B', async () => {
    const { t, a, b, admin } = await setup();
    const theirs = await upload(t, png());
    await setLogoOn(t, b, theirs);
    const data = await refusal(
      admin.action(api.organizations.setLogo, { organizationId: a, storageId: theirs }),
    );
    expect(data).toMatchObject({ field: 'logo', code: 'logoInUse' });
    expect(await logoOf(t, b)).toBe(theirs);
    expect(await logoOf(t, a)).toBeNull();
    expect(await fileExists(t, theirs)).toBe(true);
  });

  test('B keeps its file when A, after the refused attempt, replaces its own logo', async () => {
    const { t, a, b, admin } = await setup();
    const theirs = await upload(t, png());
    await setLogoOn(t, b, theirs);
    const mine = await upload(t, png());
    await admin.action(api.organizations.setLogo, { organizationId: a, storageId: mine });
    await rejected(
      admin.action(api.organizations.setLogo, { organizationId: a, storageId: theirs }),
    );
    const next = await upload(t, jpeg(), 'image/jpeg');
    await admin.action(api.organizations.setLogo, { organizationId: a, storageId: next });
    expect(await fileExists(t, theirs)).toBe(true);
    expect(await logoOf(t, b)).toBe(theirs);
  });

  test('an organization cannot set its own current file again, and the file stays', async () => {
    const { t, a, admin } = await setup();
    const storageId = await upload(t, png());
    await admin.action(api.organizations.setLogo, { organizationId: a, storageId });
    const data = await refusal(
      admin.action(api.organizations.setLogo, { organizationId: a, storageId }),
    );
    expect(data).toMatchObject({ code: 'logoInUse' });
    expect(await fileExists(t, storageId)).toBe(true);
    expect(await logoOf(t, a)).toBe(storageId);
  });

  test('a non-admin, an admin of another organization, and an anonymous caller are refused, and no file is deleted', async () => {
    const { t, a, b } = await setup();
    const theirs = await upload(t, png());
    await setLogoOn(t, b, theirs);
    const orphan = await upload(t, png());
    const bad = await upload(t, svg());
    const disguised = await upload(t, pngThenHtml(), 'text/html');
    for (const caller of ['organizer-a', 'admin-b', 'stranger', 'ghost', null]) {
      const run = caller ? t.withIdentity(identity(caller)) : t;
      for (const storageId of [theirs, orphan, bad, disguised]) {
        await rejected(run.action(api.organizations.setLogo, { organizationId: a, storageId }));
      }
    }
    for (const id of [theirs, orphan, bad, disguised]) expect(await fileExists(t, id)).toBe(true);
    expect(await logoOf(t, a)).toBeNull();
    expect(await logoOf(t, b)).toBe(theirs);
  });
});

describe('organizations.generateLogoUploadUrl', () => {
  test('gives an org admin an upload URL', async () => {
    const { a, admin } = await setup();
    const url = await admin.mutation(api.organizations.generateLogoUploadUrl, {
      organizationId: a,
    });
    expect(url).toMatch(/^https:\/\//);
  });
});

describe('organizations.removeLogo', () => {
  test('unsets the logo and deletes the file', async () => {
    const { t, a, admin } = await setup();
    const storageId = await upload(t, png());
    await admin.action(api.organizations.setLogo, { organizationId: a, storageId });
    await expect(
      admin.mutation(api.organizations.removeLogo, { organizationId: a }),
    ).resolves.toBeNull();
    expect(await logoOf(t, a)).toBeNull();
    expect(await fileExists(t, storageId)).toBe(false);
  });

  test('still unsets the logo when its file is already gone', async () => {
    const { t, a, admin } = await setup();
    const storageId = await upload(t, png());
    await setLogoOn(t, a, storageId);
    await t.run(async (ctx) => ctx.storage.delete(storageId));
    await admin.mutation(api.organizations.removeLogo, { organizationId: a });
    expect(await logoOf(t, a)).toBeNull();
  });

  test('does nothing for an organization with no logo', async () => {
    const { t, a, admin } = await setup();
    await expect(
      admin.mutation(api.organizations.removeLogo, { organizationId: a }),
    ).resolves.toBeNull();
    expect(await logoOf(t, a)).toBeNull();
  });

  test('leaves the logo of B alone when an admin of B removes their own', async () => {
    const { t, a, b } = await setup();
    const mine = await upload(t, png());
    await setLogoOn(t, a, mine);
    const theirs = await upload(t, png());
    await setLogoOn(t, b, theirs);
    await t
      .withIdentity(identity('admin-b'))
      .mutation(api.organizations.removeLogo, { organizationId: b });
    expect(await logoOf(t, a)).toBe(mine);
    expect(await fileExists(t, mine)).toBe(true);
  });
});

describe('the callers of the logo functions', () => {
  test('a league organizer, an org admin of another organization, a non-member, and an anonymous caller are refused, and nothing changes', async () => {
    const { t, a } = await setup();
    const current = await upload(t, png());
    await setLogoOn(t, a, current);
    const next = await upload(t, jpeg(), 'image/jpeg');
    for (const caller of ['organizer-a', 'admin-b', 'stranger', 'ghost', null]) {
      const run = caller ? t.withIdentity(identity(caller)) : t;
      await rejected(run.mutation(api.organizations.generateLogoUploadUrl, { organizationId: a }));
      await rejected(run.action(api.organizations.setLogo, { organizationId: a, storageId: next }));
      await rejected(run.mutation(api.organizations.removeLogo, { organizationId: a }));
    }
    expect(await logoOf(t, a)).toBe(current);
    expect(await fileExists(t, current)).toBe(true);
    expect(await fileExists(t, next)).toBe(true);
  });
});

describe('logoUrl in the public queries', () => {
  async function withLogo() {
    const s = await setup();
    const storageId = await upload(s.t, png());
    await setLogoOn(s.t, s.a, storageId);
    const expected = await s.t.run(async (ctx) => ctx.storage.getUrl(storageId));
    expect(expected).toEqual(expect.any(String));
    return { ...s, expected: expected! };
  }

  test('organizations.getPublicPage has it for an organization with a logo and not without', async () => {
    const { t, expected } = await withLogo();
    expect(await t.query(api.organizations.getPublicPage, { slug: 'org-a' })).toMatchObject({
      logoUrl: expected,
    });
    const without = await t.query(api.organizations.getPublicPage, { slug: 'org-b' });
    expect(without).not.toBeNull();
    expect(without).not.toHaveProperty('logoUrl');
  });

  test('leagues.getPublicPage has it on the organization', async () => {
    const { t, expected } = await withLogo();
    const withLogoPage = await t.query(api.leagues.getPublicPage, {
      orgSlug: 'org-a',
      leagueSlug: 'coed-4s',
    });
    expect(withLogoPage?.organization).toEqual({
      name: 'Org A',
      slug: 'org-a',
      logoUrl: expected,
    });
    const without = await t.query(api.leagues.getPublicPage, {
      orgSlug: 'org-b',
      leagueSlug: 'coed-7s',
    });
    expect(without?.organization).toEqual({ name: 'Org B', slug: 'org-b' });
  });

  test('search.leagues rows have it on the organization', async () => {
    const { t, expected } = await withLogo();
    const result = await t.query(api.search.leagues, { q: 'coed' });
    const byOrganization = Object.fromEntries(
      result.rows.map((row) => [row.organization.slug, row.organization]),
    );
    expect(byOrganization['org-a']).toEqual({ name: 'Org A', slug: 'org-a', logoUrl: expected });
    expect(byOrganization['org-b']).toEqual({ name: 'Org B', slug: 'org-b' });
  });

  test('search.organizations rows have it', async () => {
    const { t, expected } = await withLogo();
    const result = await t.query(api.search.organizations, { page: 1 });
    const rows = Object.fromEntries(result.rows.map((row) => [row.slug, row]));
    expect(rows['org-a']).toMatchObject({ logoUrl: expected });
    expect(rows['org-b']).not.toHaveProperty('logoUrl');
  });

  test('organizations.getAdminContext has it for the admin', async () => {
    const { admin, expected } = await withLogo();
    expect(await admin.query(api.organizations.getAdminContext, { slug: 'org-a' })).toMatchObject({
      logoUrl: expected,
    });
  });

  test('none of them has it after Remove', async () => {
    const { t, a, admin } = await withLogo();
    await admin.mutation(api.organizations.removeLogo, { organizationId: a });
    expect(await t.query(api.organizations.getPublicPage, { slug: 'org-a' })).not.toHaveProperty(
      'logoUrl',
    );
    const rows = (await t.query(api.search.organizations, { page: 1 })).rows;
    expect(rows.every((row) => !('logoUrl' in row))).toBe(true);
  });
});
