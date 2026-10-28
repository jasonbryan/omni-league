import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  customLevelLabel,
  divisionLabel,
  divisionLabelParts,
  genderWithoutApostrophe,
  levelLabel,
  type DivisionLabelInput,
} from './divisions';
import { sportName } from './sports';

export type LeagueDivisionFields = Pick<
  Doc<'leagues'>,
  'organizationId' | 'sport' | 'gender' | 'playersPerSide' | 'level' | 'ageGroup' | 'customLevelId'
>;

// A league not yet backfilled with a division has none.
async function leagueDivisionInput(
  ctx: Pick<QueryCtx, 'db'>,
  league: LeagueDivisionFields,
): Promise<DivisionLabelInput | undefined> {
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
  return {
    gender,
    playersPerSide,
    levelLabel: ownCustomLevel
      ? customLevelLabel(ownCustomLevel.name, ownCustomLevel.standardLevel, league.sport)
      : levelLabel(level),
    ...(ageGroup !== undefined && { ageGroup }),
  };
}

export async function leagueDivisionLabel(
  ctx: Pick<QueryCtx, 'db'>,
  league: LeagueDivisionFields,
): Promise<string | undefined> {
  const input = await leagueDivisionInput(ctx, league);
  return input && divisionLabel(input);
}

/** The words of a league's search text that name its sport and division, from the same parts as the label a result row shows. */
export async function leagueDivisionSearchWords(
  ctx: Pick<QueryCtx, 'db'>,
  league: LeagueDivisionFields,
): Promise<string[]> {
  const input = await leagueDivisionInput(ctx, league);
  if (!input) return [sportName(league.sport)];
  const alias = genderWithoutApostrophe(input.gender, input.ageGroup);
  return [sportName(league.sport), ...divisionLabelParts(input), ...(alias ? [alias] : [])];
}
