import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { query } from './_generated/server';
import { requireOrgAdmin } from './lib/access';
import { authEmailOf } from './lib/authUsers';
import { roleValidator } from './lib/roles';

/**
 * Members `listForOrganization` returns at most. The staff screen is one page with no paging (#67).
 * Never taken from args.
 */
export const MEMBERS_LIMIT = 200;

/**
 * The organization's staff for its staff screen (#67): `{ name, email, role, leagueNames, isYou }`
 * sorted by name ignoring case. `email` is the account's address (kept by Better Auth), and
 * `leagueNames` are a league organizer's leagues in their own order, leaving out an id of another
 * organization's league. `isYou` marks the caller's own row, for "(you)". Org admins of the
 * organization only, because the rows hold email addresses.
 */
export const listForOrganization = query({
  args: { organizationId: v.id('organizations') },
  returns: v.array(
    v.object({
      name: v.string(),
      email: v.string(),
      role: roleValidator,
      leagueNames: v.array(v.string()),
      isYou: v.boolean(),
    }),
  ),
  handler: async (ctx, { organizationId }) => {
    const { user: caller } = await requireOrgAdmin(ctx, organizationId);
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_organizationId', (q) => q.eq('organizationId', organizationId))
      .take(MEMBERS_LIMIT);
    const names = new Map<Id<'leagues'>, string | null>();
    const nameOf = async (id: Id<'leagues'>): Promise<string | null> => {
      if (!names.has(id)) {
        const league = await ctx.db.get('leagues', id);
        names.set(id, league?.organizationId === organizationId ? league.name : null);
      }
      return names.get(id) ?? null;
    };
    const rows = [];
    for (const membership of memberships) {
      const user: Doc<'users'> | null = await ctx.db.get('users', membership.userId);
      if (!user) continue;
      const leagueNames: string[] = [];
      for (const id of membership.leagueIds) {
        const name = await nameOf(id);
        if (name !== null) leagueNames.push(name);
      }
      rows.push({
        name: user.name,
        email: (await authEmailOf(ctx, user.authUserId)) ?? '',
        role: membership.role,
        leagueNames,
        isYou: user._id === caller._id,
      });
    }
    return rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  },
});
