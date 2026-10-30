import { addCalendarDays, dateAtUtcMinus12 } from '../../convex/lib/registration';
import { slugify } from '../../convex/lib/slugs';
import { sportName } from '../../convex/lib/sports';
import { DEMO, DEMO_RUN_SEASONS, DEMO_SEASONS } from '../../convex/seed';
import type { PublicOpenSeasonRows } from '../../src/app/organizations/organization-path';
import { openSeasonsBySoonestDeadline } from '../../src/app/organizations/season-status';

export interface ExpectedOpenCard {
  leagueName: string;
  seasonName: string;
}

type OpenSeasonRow = PublicOpenSeasonRows[number];
type SeasonFields = Pick<
  OpenSeasonRow,
  'name' | 'slug' | 'startDate' | 'endDate' | 'registrationDeadline' | 'minimumRosterSize'
>;

/**
 * The Registration open cards that `seed:demo` gives an organization's page at `nowMs`, in page
 * order. The run seasons are dated from `nowMs`, as if the seed ran on the same day.
 */
export function expectedOpenCards(orgSlug: string, nowMs: number): ExpectedOpenCard[] {
  const tenant = DEMO.find((t) => t.organization.slug === orgSlug);
  if (tenant === undefined) throw new Error(`No demo organization has the slug ${orgSlug}`);
  const publishedLeagues = new Map(
    tenant.leagues
      .filter((league) => (league.status ?? 'published') === 'published')
      .map((league) => [slugify(league.name), league]),
  );
  const rows: OpenSeasonRow[] = [];
  const addRow = (leagueSlug: string, season: SeasonFields) => {
    const league = publishedLeagues.get(leagueSlug);
    if (league === undefined) return;
    rows.push({
      ...season,
      league: {
        name: league.name,
        slug: leagueSlug,
        sportName: sportName(league.sport),
        locationNames: [...league.locations],
      },
    });
  };
  for (const { organizationSlug, leagueSlug, season, status } of DEMO_SEASONS) {
    if (organizationSlug !== orgSlug || status !== 'published') continue;
    addRow(leagueSlug, season);
  }
  const today = dateAtUtcMinus12(nowMs);
  for (const run of DEMO_RUN_SEASONS) {
    if (run.organizationSlug !== orgSlug) continue;
    addRow(run.leagueSlug, {
      name: run.name,
      slug: run.slug,
      startDate: addCalendarDays(today, run.startDaysFromRun),
      endDate: addCalendarDays(today, run.endDaysFromRun),
      registrationDeadline: addCalendarDays(today, run.deadlineDaysFromRun),
      minimumRosterSize: run.playersPerSide,
    });
  }
  return openSeasonsBySoonestDeadline(rows, nowMs).map((row) => ({
    leagueName: row.league.name,
    seasonName: row.name,
  }));
}
