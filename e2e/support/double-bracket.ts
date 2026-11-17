import { seedBracket, seedResult, type SeededResult } from './bracket';
import { convexRun } from './convex';
import { dateFromToday, seedTenant } from './tenant';

const FIRST_WINS: SeededResult = { score: { kind: 'sets', sets: [{ a: 21, b: 15 }] } };
const SECOND_WINS: SeededResult = { score: { kind: 'sets', sets: [{ a: 15, b: 21 }] } };

const WINNERS_GAMES = [
  [1, 2],
  [1, 4],
  [2, 1],
  [2, 2],
  [3, 1],
] as const;
const LOSERS_GAMES = [
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
] as const;

export const DOUBLE_TEAMS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];

export type DoubleProgress = 'none' | 'waiting' | 'notNeeded' | 'deciding' | 'decided';

export const DOUBLE_SLUG = 'double-trouble-doubles';

export async function seedDoubleTournament({
  progress,
  teamNames = DOUBLE_TEAMS,
  grandFinal,
}: {
  progress: DoubleProgress;
  teamNames?: readonly string[];
  grandFinal?: 'ifNecessary' | 'single';
}): Promise<string> {
  const tenant = await seedTenant({
    name: 'E2E Double Bracket',
    locations: [
      { name: 'North Beach Sand Courts', address: '3500 Sandcourt Ln, Corpus Christi, TX 78402' },
    ],
  });
  await convexRun('testing:seedTournament', {
    organizationSlug: tenant.slug,
    name: 'Double Trouble Doubles',
    slug: DOUBLE_SLUG,
    sport: 'beachVolleyball',
    locationNames: ['North Beach Sand Courts'],
    startDate: dateFromToday(30),
    endDate: dateFromToday(31),
    registrationDeadline: '2025-12-01',
    maximumTeams: 16,
    status: 'published',
    bracketType: 'double',
    ...(grandFinal && { grandFinal }),
  });
  const path = `${tenant.path}/tournaments/${DOUBLE_SLUG}`;
  await seedBracket(tenant, DOUBLE_SLUG, teamNames);
  if (progress === 'none') return path;
  for (const [round, slot] of WINNERS_GAMES) {
    await seedResult(tenant, DOUBLE_SLUG, { round, slot }, FIRST_WINS);
  }
  for (const [round, slot] of LOSERS_GAMES) {
    await seedResult(tenant, DOUBLE_SLUG, { stage: 'losers', round, slot }, FIRST_WINS);
  }
  if (progress === 'waiting') return path;
  const grandFinalGame = { stage: 'grandFinal', round: 1, slot: 1 } as const;
  await seedResult(
    tenant,
    DOUBLE_SLUG,
    grandFinalGame,
    progress === 'notNeeded' ? FIRST_WINS : SECOND_WINS,
  );
  if (progress === 'decided') {
    await seedResult(tenant, DOUBLE_SLUG, { ...grandFinalGame, round: 2 }, FIRST_WINS);
  }
  return path;
}
