/// <reference types="vite/client" />
import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  defaultDivision,
  insertDraftTournament,
  insertSeason,
  insertTenant,
  publishTournament,
} from './lib/tenantWrites';
import schema from './schema';
import { modules } from './test.setup';

/** 12:00 UTC on the deadline day, well inside registration. */
export const OPEN_NOW = Date.parse('2030-05-20T12:00:00Z');

export const TOURNAMENT_SLUGS = { orgSlug: 'org-a', tournamentSlug: 'gulf-coast-beach-open' };

export const emailOf = (name: string) => `${name}@example.test`;

const identityOf = (authUserId: string, name: string) => ({
  subject: authUserId,
  issuer: 'http://127.0.0.1:3211',
  email: emailOf(name),
  emailVerified: false,
  name,
  sessionId: 's1',
});

export interface Person {
  name: string;
  authUserId: string;
  userId: Id<'users'>;
}

const NEW_TOURNAMENT = {
  sport: 'beachVolleyball' as const,
  division: {
    gender: 'coed' as const,
    playersPerSide: 2,
    level: 'open' as const,
    ageGroup: 'adult' as const,
  },
  startDate: '2030-06-01',
  endDate: '2030-06-02',
  registrationDeadline: '2030-05-20',
  maximumTeams: 4,
};

export async function tournamentWorld() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t, 'betterAuth');
  const ids = await t.run(async (ctx) => {
    const a = await insertTenant(ctx, {
      organization: { name: 'Org A', slug: 'org-a' },
      locations: [{ name: 'Alpha Beach', address: '1 Alpha St' }],
      leagues: [
        {
          name: 'Coed 4s',
          sport: 'beachVolleyball',
          locations: ['Alpha Beach'],
          division: defaultDivision('beachVolleyball'),
        },
      ],
    });
    const b = await insertTenant(ctx, {
      organization: { name: 'Org B', slug: 'org-b' },
      locations: [{ name: 'B Beach', address: '9 B St' }],
      leagues: [],
    });
    const location = async (organizationId: Id<'organizations'>) =>
      (await ctx.db
        .query('locations')
        .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organizationId))
        .first())!._id;
    const tournament = async (
      name: string,
      slug: string,
      status: 'draft' | 'published' = 'published',
    ) => {
      const id = await insertDraftTournament(ctx, a, {
        ...NEW_TOURNAMENT,
        name,
        slug,
        locationIds: [await location(a)],
      });
      if (status === 'published')
        await publishTournament(ctx, (await ctx.db.get('tournaments', id))!);
      return id;
    };
    const person = async (name: string): Promise<Person> => {
      const now = Date.now();
      const account = (await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'user',
          data: {
            name,
            email: emailOf(name),
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
          },
        },
      } as never)) as { _id: string };
      const userId = await ctx.db.insert('users', {
        authUserId: account._id,
        name: `Name ${name}`,
        adultConfirmedAt: 1,
      });
      return { name, authUserId: account._id, userId };
    };
    const staff = async (
      name: string,
      organizationId: Id<'organizations'>,
      membership: {
        role: 'orgAdmin' | 'leagueOrganizer';
        leagueIds?: Id<'leagues'>[];
        programIds?: Id<'programs'>[];
      },
    ) => {
      const who = await person(name);
      await ctx.db.insert('memberships', {
        userId: who.userId,
        organizationId,
        role: membership.role,
        leagueIds: membership.leagueIds ?? [],
        ...(membership.programIds && { programIds: membership.programIds }),
      });
      return who;
    };
    const programOf = async (id: Id<'tournaments'>) =>
      (await ctx.db.get('tournaments', id))!.programId;
    const league = (await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', a).eq('slug', 'coed-4s'),
      )
      .unique())!;
    const season = await insertSeason(
      ctx,
      league,
      {
        name: 'Summer 2030',
        slug: 'summer-2030',
        startDate: '2030-06-01',
        endDate: '2030-08-30',
        registrationDeadline: '2030-05-20',
        playersPerSide: 4,
        minimumRosterSize: 4,
      },
      'published',
    );
    const gulf = await tournament('Gulf Coast Beach Open', 'gulf-coast-beach-open');
    const second = await tournament('Second Open', 'second-open');
    return {
      a,
      b,
      season,
      gulf,
      second,
      draft: await tournament('Draft Open', 'draft-open', 'draft'),
      captain: await person('captain'),
      player: await person('player'),
      rival: await person('rival'),
      rivalPlayer: await person('rival-player'),
      guardian: await person('guardian'),
      stranger: await person('stranger'),
      traveller: await person('traveller'),
      admin: await staff('admin-a', a, { role: 'orgAdmin' }),
      foreignAdmin: await staff('admin-b', b, { role: 'orgAdmin' }),
      assignedOrganizer: await staff('organizer-assigned', a, {
        role: 'leagueOrganizer',
        programIds: [await programOf(gulf)],
      }),
      otherOrganizer: await staff('organizer-other', a, {
        role: 'leagueOrganizer',
        programIds: [await programOf(second)],
      }),
      leagueOrganizer: await staff('organizer-league', a, {
        role: 'leagueOrganizer',
        leagueIds: [league._id],
        programIds: [],
      }),
    };
  });
  const as = (who: Pick<Person, 'authUserId' | 'name'>) =>
    t.withIdentity(identityOf(who.authUserId, who.name));
  return { t, as, ...ids };
}

export type TournamentWorld = Awaited<ReturnType<typeof tournamentWorld>>;

/** The people who may not invite to or remove from the Gulf Coast Beach Open's teams, besides the signed-out caller. */
export const NOT_MANAGERS = [
  'stranger',
  'rival',
  'foreignAdmin',
  'otherOrganizer',
  'leagueOrganizer',
] as const;
