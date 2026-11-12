import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/** A league's program is assigned through `leagueIds`, so it never qualifies here. */
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
