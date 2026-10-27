/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { insertCustomLevel, insertSeason, insertTenant, type NewSeason } from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

const identity = (authUserId: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: `${authUserId}@example.test`,
  emailVerified: false,
  name: authUserId,
  sessionId: 's1',
});

const season = (
  name: string,
  slug: string,
  startDate: string,
  minimumRosterSize = 4,
): NewSeason => ({
  name,
  slug,
  startDate,
  endDate: '2027-12-01',
  registrationDeadline: '2027-01-01',
  playersPerSide: 4,
  minimumRosterSize,
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'North Beach', address: '1 Beach Rd' }],
      leagues: [
        {
          name: 'Sunday Reverse Coed 4s',
          sport: 'beachVolleyball',
          locations: ['North Beach'],
          division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
        },
        {
          name: 'Other Sand',
          sport: 'beachVolleyball',
          locations: ['North Beach'],
          division: { gender: 'coed', playersPerSide: 2, level: 'b', ageGroup: 'adult' },
        },
        {
          name: 'Coed 7v7',
          sport: 'soccer',
          locations: ['North Beach'],
          division: { gender: 'coed', playersPerSide: 7, level: 'rec', ageGroup: 'adult' },
        },
      ],
    });
    const b = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [],
      leagues: [],
    });
    const league = async (slug: string) =>
      (await ctx.db
        .query('leagues')
        .withIndex('by_organizationId_and_slug', (q) => q.eq('organizationId', a).eq('slug', slug))
        .unique())!;
    const sunday = await league('sunday-reverse-coed-4s');
    const otherSand = await league('other-sand');
    const soccer = await league('coed-7v7');
    const summer = await insertSeason(
      ctx,
      sunday,
      season('Summer 2027', 'summer-2027', '2027-06-06'),
      'published',
    );
    const fall = await insertSeason(ctx, sunday, season('Fall 2027', 'fall-2027', '2027-09-12'));
    const ownMinimum = await insertSeason(
      ctx,
      sunday,
      season('Winter 2027', 'winter-2027', '2027-12-12', 6),
    );
    const member = async (
      authUserId: string,
      organizationId: Id<'organizations'> | null,
      role: 'orgAdmin' | 'leagueOrganizer' = 'orgAdmin',
      leagueIds: Id<'leagues'>[] = [],
    ) => {
      const userId = await ctx.db.insert('users', {
        authUserId,
        name: authUserId,
        adultConfirmedAt: 1,
      });
      if (organizationId) {
        await ctx.db.insert('memberships', { userId, organizationId, role, leagueIds });
      }
    };
    await member('admin-a', a);
    await member('organizer-sunday', a, 'leagueOrganizer', [sunday._id]);
    await member('organizer-other', a, 'leagueOrganizer', [otherSand._id]);
    await member('admin-b', b);
    await member('stranger', null);
    const goldA = await insertCustomLevel(ctx, a, {
      sport: 'beachVolleyball',
      name: 'Gold',
      standardLevel: 'a',
    });
    const goldB = await insertCustomLevel(ctx, b, {
      sport: 'beachVolleyball',
      name: 'Gold',
      standardLevel: 'a',
    });
    const softballA = await insertCustomLevel(ctx, a, {
      sport: 'softball',
      name: 'D',
      standardLevel: 'rec',
    });
    return {
      a,
      sundayId: sunday._id,
      soccerId: soccer._id,
      summer,
      fall,
      ownMinimum,
      goldA,
      goldB,
      softballA,
    };
  });
  return {
    t,
    ...ids,
    admin: t.withIdentity(identity('admin-a')),
    organizer: t.withIdentity(identity('organizer-sunday')),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const sundayArgs = (s: Setup) => ({
  leagueId: s.sundayId,
  name: 'Sunday Reverse Coed 4s',
  gender: 'coed' as const,
  playersPerSide: 4,
  level: 'bb' as const,
  ageGroup: 'adult',
});

const stored = (s: Setup) =>
  s.t.run(async (ctx) => ({
    league: await ctx.db.get('leagues', s.sundayId),
    seasons: await Promise.all(
      [s.summer, s.fall, s.ownMinimum].map((id) => ctx.db.get('seasons', id)),
    ),
  }));

async function refusal(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ field: string; code: string; message: string }>).data;
}

function refusedCallers(s: Setup) {
  return [
    ['unauthenticated', s.t, 'Sign in required'],
    ['identity with no users row', s.t.withIdentity(identity('ghost')), 'Sign in required'],
    [
      'league organizer of another league',
      s.t.withIdentity(identity('organizer-other')),
      'Not allowed',
    ],
    ['org admin of another organization', s.t.withIdentity(identity('admin-b')), 'Not allowed'],
    ['non-member', s.t.withIdentity(identity('stranger')), 'Not allowed'],
  ] as const;
}

describe('leagues.update', () => {
  test('changes the format: the league and draft seasons follow, a published season keeps its own', async () => {
    const s = await setup();
    const before = await stored(s);
    await s.organizer.mutation(api.leagues.update, { ...sundayArgs(s), playersPerSide: 6 });
    const after = await stored(s);
    expect(after.league).toMatchObject({ playersPerSide: 6 });
    expect(after.seasons[0]).toEqual(before.seasons[0]);
    expect(after.seasons[1]).toMatchObject({ playersPerSide: 6, minimumRosterSize: 6 });
    expect(after.seasons[2]).toMatchObject({ playersPerSide: 6, minimumRosterSize: 6 });
  });

  test('returns the earlier league values and the draft seasons it changed', async () => {
    const s = await setup();
    const earlier = await s.admin.mutation(api.leagues.update, {
      ...sundayArgs(s),
      name: 'Sunday Sand',
      playersPerSide: 6,
    });
    expect(earlier.league).toEqual({
      name: 'Sunday Reverse Coed 4s',
      gender: 'coed',
      playersPerSide: 4,
      level: 'bb',
      ageGroup: 'adult',
    });
    expect(earlier.draftSeasons).toEqual(
      expect.arrayContaining([
        { seasonId: s.fall, playersPerSide: 4, minimumRosterSize: 4 },
        { seasonId: s.ownMinimum, playersPerSide: 4, minimumRosterSize: 6 },
      ]),
    );
    expect(earlier.draftSeasons).toHaveLength(2);
  });

  test('keeps sortName in step with the name', async () => {
    const s = await setup();
    await s.admin.mutation(api.leagues.update, { ...sundayArgs(s), name: '  Alpha Sand  ' });
    expect((await stored(s)).league).toMatchObject({ name: 'Alpha Sand', sortName: 'alpha sand' });
  });

  test('a save that changes only the name leaves every season unchanged', async () => {
    const s = await setup();
    const before = await stored(s);
    const earlier = await s.admin.mutation(api.leagues.update, {
      ...sundayArgs(s),
      name: 'Sunday Sand',
      gender: 'mens',
      level: 'a',
      ageGroup: 'over40',
    });
    const after = await stored(s);
    expect(after.seasons).toEqual(before.seasons);
    expect(after.seasons[2]).toMatchObject({ minimumRosterSize: 6 });
    expect(earlier.draftSeasons).toEqual([]);
    expect(after.league).toMatchObject({
      name: 'Sunday Sand',
      gender: 'mens',
      level: 'a',
      ageGroup: 'over40',
    });
  });

  test('a custom level stores its standard level and the custom level', async () => {
    const s = await setup();
    await s.admin.mutation(api.leagues.update, {
      ...sundayArgs(s),
      level: 'a',
      customLevelId: s.goldA,
    });
    expect((await stored(s)).league).toMatchObject({ level: 'a', customLevelId: s.goldA });
    await s.admin.mutation(api.leagues.update, sundayArgs(s));
    const league = (await stored(s)).league!;
    expect(league.level).toBe('bb');
    expect(league.customLevelId).toBeUndefined();
  });

  test('refuses a custom level of another organization or of another sport, changing nothing', async () => {
    const s = await setup();
    const before = await stored(s);
    for (const customLevelId of [s.goldB, s.softballA]) {
      await expect(
        s.admin.mutation(api.leagues.update, {
          ...sundayArgs(s),
          name: 'Renamed',
          playersPerSide: 6,
          level: 'a',
          customLevelId,
        }),
      ).rejects.toThrow('Not allowed');
    }
    expect(await stored(s)).toEqual(before);
  });

  test('a raised minimum stays on the draft seasons when the format narrows, and clearing it follows the format', async () => {
    const s = await setup();
    await s.admin.mutation(api.leagues.update, {
      ...sundayArgs(s),
      playersPerSide: 6,
      minimumRosterSize: 8,
    });
    let after = await stored(s);
    expect(after.league).toMatchObject({ playersPerSide: 6, minimumRosterSize: 8 });
    expect(after.seasons[1]).toMatchObject({ playersPerSide: 6, minimumRosterSize: 8 });

    await s.admin.mutation(api.leagues.update, { ...sundayArgs(s), minimumRosterSize: 8 });
    after = await stored(s);
    expect(after.league).toMatchObject({ playersPerSide: 4, minimumRosterSize: 8 });
    expect(after.seasons[1]).toMatchObject({ playersPerSide: 4, minimumRosterSize: 8 });

    await s.admin.mutation(api.leagues.update, sundayArgs(s));
    after = await stored(s);
    expect(after.league!.minimumRosterSize).toBeUndefined();
    expect(after.seasons[1]).toMatchObject({ playersPerSide: 4, minimumRosterSize: 4 });
    expect(after.seasons[2]).toMatchObject({ playersPerSide: 4, minimumRosterSize: 4 });
  });

  test('refuses a format change on a league with more than 200 draft seasons, changing nothing', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const league = (await ctx.db.get('leagues', s.sundayId))!;
      for (let n = 0; n < 199; n++) {
        await insertSeason(ctx, league, season(`Extra ${n}`, `extra-${n}`, '2028-01-01'));
      }
    });
    const before = await stored(s);
    const draftCount = await s.t.run(
      async (ctx) => (await ctx.db.query('seasons').collect()).length,
    );
    expect(draftCount).toBe(202);
    const data = await refusal(
      s.admin.mutation(api.leagues.update, {
        ...sundayArgs(s),
        name: 'Renamed',
        playersPerSide: 6,
      }),
    );
    expect(data).toEqual({
      field: 'format',
      code: 'draftSeasonsTooMany',
      message: 'This league has too many draft seasons to update. Publish or remove some first.',
    });
    expect(await stored(s)).toEqual(before);
  });

  test('still renames a league with more than 200 draft seasons', async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const league = (await ctx.db.get('leagues', s.sundayId))!;
      for (let n = 0; n < 199; n++) {
        await insertSeason(ctx, league, season(`Extra ${n}`, `extra-${n}`, '2028-01-01'));
      }
    });
    await s.admin.mutation(api.leagues.update, { ...sundayArgs(s), name: 'Renamed' });
    expect((await stored(s)).league!.name).toBe('Renamed');
  });

  test('allows an org admin and the assigned league organizer', async () => {
    const s = await setup();
    await s.admin.mutation(api.leagues.update, { ...sundayArgs(s), name: 'By admin' });
    expect((await stored(s)).league!.name).toBe('By admin');
    await s.organizer.mutation(api.leagues.update, { ...sundayArgs(s), name: 'By organizer' });
    expect((await stored(s)).league!.name).toBe('By organizer');
  });

  test.each([0, 1, 2, 3, 4])('refuses caller %#, changing nothing', async (index) => {
    const s = await setup();
    const before = await stored(s);
    const [, caller, message] = refusedCallers(s)[index];
    await expect(
      caller.mutation(api.leagues.update, {
        ...sundayArgs(s),
        name: 'Hijacked',
        playersPerSide: 6,
      }),
    ).rejects.toThrow(message);
    expect(await stored(s)).toEqual(before);
  });

  test.each([
    ['an empty name', { name: '   ' }, 'name', 'nameEmpty'],
    ['a name over 100 characters', { name: 'x'.repeat(101) }, 'name', 'nameTooLong'],
    ['a format outside the sport', { playersPerSide: 9 }, 'format', 'formatInvalid'],
    [
      'a minimum below the format',
      { playersPerSide: 6, minimumRosterSize: 5 },
      'minimumRosterSize',
      'minimumRosterSizeLow',
    ],
    ['a level outside the sport', { level: 'intermediate' as const }, 'level', 'levelInvalid'],
    ['an unknown age group', { ageGroup: 'over99' }, 'ageGroup', 'ageGroupInvalid'],
  ])('refuses %s with its field error, changing nothing', async (_title, change, field, code) => {
    const s = await setup();
    const before = await stored(s);
    const data = await refusal(
      s.admin.mutation(api.leagues.update, { ...sundayArgs(s), ...change }),
    );
    expect(data).toMatchObject({ field, code });
    expect(await stored(s)).toEqual(before);
  });
});

describe('leagues.undoUpdate', () => {
  test('returns the league and each draft season to its own earlier values', async () => {
    const s = await setup();
    const before = await stored(s);
    const earlier = await s.organizer.mutation(api.leagues.update, {
      ...sundayArgs(s),
      name: 'Sunday Sand',
      playersPerSide: 6,
    });
    await s.organizer.mutation(api.leagues.undoUpdate, { leagueId: s.sundayId, ...earlier });
    const after = await stored(s);
    expect(after.league).toEqual(before.league);
    expect(after.seasons).toEqual(before.seasons);
    expect(after.seasons[2]).toMatchObject({ playersPerSide: 4, minimumRosterSize: 6 });
  });

  test('leaves a season published in between as it is', async () => {
    const s = await setup();
    const earlier = await s.admin.mutation(api.leagues.update, {
      ...sundayArgs(s),
      playersPerSide: 6,
    });
    await s.t.run((ctx) => ctx.db.patch('seasons', s.fall, { status: 'published' }));
    await s.admin.mutation(api.leagues.undoUpdate, { leagueId: s.sundayId, ...earlier });
    const after = await stored(s);
    expect(after.league).toMatchObject({ playersPerSide: 4 });
    expect(after.seasons[1]).toMatchObject({ playersPerSide: 6, minimumRosterSize: 6 });
    expect(after.seasons[2]).toMatchObject({ playersPerSide: 4, minimumRosterSize: 6 });
  });

  test('restores a league that had no custom level or raised minimum', async () => {
    const s = await setup();
    const earlier = await s.admin.mutation(api.leagues.update, {
      ...sundayArgs(s),
      level: 'a',
      customLevelId: s.goldA,
      minimumRosterSize: 6,
    });
    await s.admin.mutation(api.leagues.undoUpdate, { leagueId: s.sundayId, ...earlier });
    const league = (await stored(s)).league!;
    expect(league.level).toBe('bb');
    expect(league.customLevelId).toBeUndefined();
    expect(league.minimumRosterSize).toBeUndefined();
  });

  test.each([0, 1, 2, 3, 4])('refuses caller %#, changing nothing', async (index) => {
    const s = await setup();
    const earlier = await s.admin.mutation(api.leagues.update, {
      ...sundayArgs(s),
      name: 'Sunday Sand',
      playersPerSide: 6,
    });
    const before = await stored(s);
    const [, caller, message] = refusedCallers(s)[index];
    await expect(
      caller.mutation(api.leagues.undoUpdate, { leagueId: s.sundayId, ...earlier }),
    ).rejects.toThrow(message);
    expect(await stored(s)).toEqual(before);
  });

  test('refuses values the update could not have returned', async () => {
    const s = await setup();
    const earlier = await s.admin.mutation(api.leagues.update, sundayArgs(s));
    const before = await stored(s);
    const attempts = [
      { ...earlier, league: { ...earlier.league, customLevelId: s.goldB } },
      { ...earlier, league: { ...earlier.league, playersPerSide: 40 } },
      { ...earlier, league: { ...earlier.league, name: ' ' } },
      { ...earlier, league: { ...earlier.league, ageGroup: undefined } },
      {
        ...earlier,
        draftSeasons: [{ seasonId: s.fall, playersPerSide: 4, minimumRosterSize: 500 }],
      },
      {
        ...earlier,
        draftSeasons: [{ seasonId: s.fall, playersPerSide: 40, minimumRosterSize: 40 }],
      },
    ];
    for (const attempt of attempts) {
      await expect(
        s.admin.mutation(api.leagues.undoUpdate, { leagueId: s.sundayId, ...attempt }),
      ).rejects.toThrow();
    }
    expect(await stored(s)).toEqual(before);
  });

  test('ignores a season of another league listed in the values', async () => {
    const s = await setup();
    const foreign = await s.t.run(async (ctx) => {
      const league = (await ctx.db.get('leagues', s.soccerId))!;
      return insertSeason(ctx, league, {
        ...season('Soccer fall', 'soccer-fall', '2027-09-01'),
        playersPerSide: 7,
        minimumRosterSize: 7,
      });
    });
    const earlier = await s.admin.mutation(api.leagues.update, sundayArgs(s));
    await s.admin.mutation(api.leagues.undoUpdate, {
      leagueId: s.sundayId,
      ...earlier,
      draftSeasons: [{ seasonId: foreign, playersPerSide: 4, minimumRosterSize: 4 }],
    });
    const after = await s.t.run((ctx) => ctx.db.get('seasons', foreign));
    expect(after).toMatchObject({ playersPerSide: 7, minimumRosterSize: 7 });
  });
});

describe('leagues.update edge cases', () => {
  test.each([
    ['a fractional format', { playersPerSide: 4.5 }, 'format', 'formatInvalid'],
    ['a format that is not a number', { playersPerSide: NaN }, 'format', 'formatInvalid'],
    [
      'a fractional minimum',
      { minimumRosterSize: 4.5 },
      'minimumRosterSize',
      'minimumRosterSizeInvalid',
    ],
    [
      'a minimum that is not a number',
      { minimumRosterSize: NaN },
      'minimumRosterSize',
      'minimumRosterSizeInvalid',
    ],
    ['a negative minimum', { minimumRosterSize: -1 }, 'minimumRosterSize', 'minimumRosterSizeLow'],
    [
      'a minimum above the cap',
      { minimumRosterSize: 501 },
      'minimumRosterSize',
      'minimumRosterSizeInvalid',
    ],
  ])('refuses %s with its field error, changing nothing', async (_title, change, field, code) => {
    const s = await setup();
    const before = await stored(s);
    const data = await refusal(
      s.admin.mutation(api.leagues.update, { ...sundayArgs(s), ...change }),
    );
    expect(data).toMatchObject({ field, code });
    expect(await stored(s)).toEqual(before);
  });

  test('a league created without a division takes one on update, and Undo cannot take it away again', async () => {
    const s = await setup();
    const legacyId = await s.t.run(async (ctx) => {
      await insertTenant(ctx, {
        organization: { name: 'Org C', slug: 'org-c' },
        locations: [{ name: 'Court', address: '1 Court Rd' }],
        leagues: [{ name: 'Legacy', sport: 'beachVolleyball', locations: ['Court'] }],
      });
      const league = (await ctx.db.query('leagues').collect()).find((l) => l.name === 'Legacy')!;
      const userId = await ctx.db.insert('users', {
        authUserId: 'admin-c',
        name: 'admin-c',
        adultConfirmedAt: 1,
      });
      await ctx.db.insert('memberships', {
        userId,
        organizationId: league.organizationId,
        role: 'orgAdmin',
        leagueIds: [],
      });
      return league._id;
    });
    const adminC = s.t.withIdentity(identity('admin-c'));
    const read = () => s.t.run((ctx) => ctx.db.get('leagues', legacyId));
    expect((await read())!.playersPerSide).toBeUndefined();

    const earlier = await adminC.mutation(api.leagues.update, {
      leagueId: legacyId,
      name: 'Legacy Sand',
      gender: 'coed',
      playersPerSide: 2,
      level: 'b',
      ageGroup: 'adult',
    });
    expect(earlier.league).toEqual({ name: 'Legacy' });
    expect(await read()).toMatchObject({ name: 'Legacy Sand', playersPerSide: 2, level: 'b' });

    await expect(
      adminC.mutation(api.leagues.undoUpdate, { leagueId: legacyId, ...earlier }),
    ).rejects.toThrow('Not allowed');
    expect(await read()).toMatchObject({ name: 'Legacy Sand', playersPerSide: 2, level: 'b' });
  });

  test('an Undo is refused once another save changed the league, and changes nothing', async () => {
    const s = await setup();
    const first = await s.admin.mutation(api.leagues.update, {
      ...sundayArgs(s),
      name: 'First',
      playersPerSide: 6,
    });
    await s.organizer.mutation(api.leagues.update, {
      ...sundayArgs(s),
      name: 'Second',
      playersPerSide: 6,
    });
    const before = await stored(s);
    const data = await refusal(
      s.admin.mutation(api.leagues.undoUpdate, { leagueId: s.sundayId, ...first }),
    );
    expect(data).toEqual({
      field: 'name',
      code: 'changedSince',
      message: 'The league details changed since this save, so it cannot be undone.',
    });
    expect(await stored(s)).toEqual(before);
  });

  test('an Undo is refused when a field other than the name changed since the save', async () => {
    const s = await setup();
    const earlier = await s.admin.mutation(api.leagues.update, { ...sundayArgs(s), name: 'First' });
    await s.t.run((ctx) => ctx.db.patch('leagues', s.sundayId, { minimumRosterSize: 9 }));
    const data = await refusal(
      s.admin.mutation(api.leagues.undoUpdate, { leagueId: s.sundayId, ...earlier }),
    );
    expect(data).toMatchObject({ code: 'changedSince' });
  });

  test('an Undo cannot strip the division from a league that has one', async () => {
    const s = await setup();
    const earlier = await s.admin.mutation(api.leagues.update, { ...sundayArgs(s), name: 'First' });
    await expect(
      s.admin.mutation(api.leagues.undoUpdate, {
        leagueId: s.sundayId,
        ...earlier,
        league: { name: 'Sunday Reverse Coed 4s' },
      }),
    ).rejects.toThrow('Not allowed');
    expect((await stored(s)).league).toMatchObject({ name: 'First', playersPerSide: 4 });
  });
});
