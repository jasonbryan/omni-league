import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/** The programs an organizer can be assigned: the organization's own, and not a league's, which `leagueIds` assigns. In the order given, each once; an id that is gone or does not qualify is left out. */
export async function assignablePrograms(
  ctx: Pick<QueryCtx, 'db'>,
  organizationId: Id<'organizations'>,
  programIds: readonly Id<'programs'>[] | undefined,
): Promise<Doc<'programs'>[]> {
  const programs: Doc<'programs'>[] = [];
  for (const id of new Set(programIds ?? [])) {
    const program = await ctx.db.get('programs', id);
    if (program?.organizationId === organizationId && program.type !== 'league') {
      programs.push(program);
    }
  }
  return programs;
}
