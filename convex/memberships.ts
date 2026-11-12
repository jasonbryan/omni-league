import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { query } from './_generated/server';
import { requireOrgAdmin } from './lib/access';
import { assignablePrograms } from './lib/assignedPrograms';
import { authEmailsOf } from './lib/authUsers';
import { recountMemberships } from './lib/memberships';
import { roleValidator } from './lib/roles';

export const MEMBERS_LIMIT = 200;

export const staffCount = query({
  args: { organizationId: v.id('organizations') },
  returns: v.number(),
  handler: async (ctx, { organizationId }) => {
    await requireOrgAdmin(ctx, organizationId);
    const organization = await ctx.db.get('organizations', organizationId);
    return organization?.staffCount ?? (await recountMemberships(ctx, organizationId));
  },
});

export const listForOrganization = query({
  args: { organizationId: v.id('organizations') },
  returns: v.array(
    v.object({
      membershipId: v.id('memberships'),
      name: v.string(),
      email: v.string(),
      role: roleValidator,
      leagueNames: v.array(v.string()),
      // Absent when the member runs no tournament.
      tournamentNames: v.optional(v.array(v.string())),
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
    const users = await Promise.all(
      memberships.map((membership) => ctx.db.get('users', membership.userId)),
    );
    const emails = await authEmailsOf(
      ctx,
      users.flatMap((user) => (user ? [user.authUserId] : [])),
    );
    const rows = [];
    for (const [index, membership] of memberships.entries()) {
      const user = users[index];
      if (!user) continue;
      const leagueNames: string[] = [];
      for (const id of membership.leagueIds) {
        const name = await nameOf(id);
        if (name !== null) leagueNames.push(name);
      }
      const tournamentNames = (
        await assignablePrograms(ctx, organizationId, membership.programIds)
      ).map((program) => program.name);
      rows.push({
        membershipId: membership._id,
        name: user.name,
        email: emails.get(user.authUserId) ?? '',
        role: membership.role,
        leagueNames,
        ...(tournamentNames.length > 0 && { tournamentNames }),
        isYou: user._id === caller._id,
      });
    }
    return rows.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  },
});
