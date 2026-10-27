import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { customLevelLabel, divisionLabel, levelLabel } from './divisions';

// A league not yet backfilled with a division has no label.
export async function leagueDivisionLabel(
  ctx: Pick<QueryCtx, 'db'>,
  league: Doc<'leagues'>,
): Promise<string | undefined> {
  const { gender, playersPerSide, level, ageGroup, customLevelId } = league;
  if (gender === undefined || playersPerSide === undefined || level === undefined) {
    return undefined;
  }
  const customLevel =
    customLevelId === undefined ? null : await ctx.db.get('customLevels', customLevelId);
  // A level of another organization or sport falls back to the standard level, so bad data cannot fail the page.
  const ownCustomLevel =
    customLevel?.organizationId === league.organizationId && customLevel.sport === league.sport
      ? customLevel
      : null;
  return divisionLabel({
    gender,
    playersPerSide,
    levelLabel: ownCustomLevel
      ? customLevelLabel(ownCustomLevel.name, ownCustomLevel.standardLevel, league.sport)
      : levelLabel(level),
    ...(ageGroup !== undefined && { ageGroup }),
  });
}
