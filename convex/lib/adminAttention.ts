import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/** Rows each kind reads; a kind that finds more reports `capped` and the app shows its total as "100+". */
export const ATTENTION_READ_LIMIT = 100;
export const ATTENTION_ITEM_LIMIT = 20;
export const ATTENTION_INVITE_LINES = 3;

// One row past the limit tells a capped kind from one that holds exactly the limit.
const READ_ONE_PAST_LIMIT = ATTENTION_READ_LIMIT + 1;

const totalFields = { total: v.number(), capped: v.boolean() };

export const attentionValidator = v.object({
  draftSeasons: v.object({
    items: v.array(
      v.object({
        seasonId: v.id('seasons'),
        name: v.string(),
        leagueName: v.string(),
        leagueSlug: v.string(),
      }),
    ),
    ...totalFields,
  }),
  leaguesWithoutSeason: v.object({
    items: v.array(v.object({ leagueId: v.id('leagues'), name: v.string(), slug: v.string() })),
    ...totalFields,
  }),
  pendingInvites: v.object({
    soonest: v.array(v.object({ email: v.string(), expiresAt: v.number() })),
    ...totalFields,
  }),
});

type Ctx = Pick<QueryCtx, 'db'>;

function totalOf(rows: readonly unknown[]) {
  return {
    total: Math.min(rows.length, ATTENTION_READ_LIMIT),
    capped: rows.length > ATTENTION_READ_LIMIT,
  };
}

async function draftSeasons(ctx: Ctx, organizationId: Id<'organizations'>) {
  const rows = await ctx.db
    .query('seasons')
    .withIndex('by_organizationId_and_status_and_registrationDeadline', (q) =>
      q.eq('organizationId', organizationId).eq('status', 'draft'),
    )
    .take(READ_ONE_PAST_LIMIT);
  const items = [];
  for (const season of rows.slice(0, ATTENTION_ITEM_LIMIT)) {
    const league = await ctx.db.get('leagues', season.leagueId);
    if (league?.organizationId !== organizationId) continue;
    items.push({
      seasonId: season._id,
      name: season.name,
      leagueName: league.name,
      leagueSlug: league.slug,
    });
  }
  return { items, ...totalOf(rows) };
}

async function leaguesWithoutSeason(ctx: Ctx, organizationId: Id<'organizations'>) {
  const leagues = await ctx.db
    .query('leagues')
    .withIndex('by_organizationId_and_status_and_sortName', (q) =>
      q.eq('organizationId', organizationId).eq('status', 'published'),
    )
    .take(READ_ONE_PAST_LIMIT);
  const without: Doc<'leagues'>[] = [];
  for (const league of leagues.slice(0, ATTENTION_READ_LIMIT)) {
    const season = await ctx.db
      .query('seasons')
      .withIndex('by_leagueId_and_startDate', (q) => q.eq('leagueId', league._id))
      .first();
    if (season === null) without.push(league);
  }
  return {
    items: without
      .slice(0, ATTENTION_ITEM_LIMIT)
      .map(({ _id, name, slug }) => ({ leagueId: _id, name, slug })),
    total: without.length,
    capped: leagues.length > ATTENTION_READ_LIMIT,
  };
}

async function pendingInvites(ctx: Ctx, organizationId: Id<'organizations'>) {
  const rows = await ctx.db
    .query('invites')
    .withIndex('by_organizationId_and_status', (q) =>
      q.eq('organizationId', organizationId).eq('status', 'pending'),
    )
    .take(READ_ONE_PAST_LIMIT);
  const soonest = rows
    .slice(0, ATTENTION_READ_LIMIT)
    .sort((a, b) => a.expiresAt - b.expiresAt)
    .slice(0, ATTENTION_INVITE_LINES)
    .map(({ email, expiresAt }) => ({ email, expiresAt }));
  return { soonest, ...totalOf(rows) };
}

export async function getAttention(ctx: Ctx, organizationId: Id<'organizations'>) {
  return {
    draftSeasons: await draftSeasons(ctx, organizationId),
    leaguesWithoutSeason: await leaguesWithoutSeason(ctx, organizationId),
    pendingInvites: await pendingInvites(ctx, organizationId),
  };
}
