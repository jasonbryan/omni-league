import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';
import { campSessionTimes } from '../../../convex/lib/campSessionInput';
import { dateAtUtcMinus12 } from '../../../convex/lib/registration';
import { trainingClassDate, trainingHours } from '../../../convex/lib/trainingPattern';
import { publicCampPath } from '../organizations/public-camp/public-camp-path';
import { publicTrainingPath } from '../organizations/public-training/public-training-path';
import { seasonRange } from './season-range';

export type HomeCampRow = FunctionReturnType<typeof api.campRegistrations.listMine>[number];
export type HomeTrainingRow = FunctionReturnType<typeof api.trainingRegistrations.listMine>[number];

export interface HomeProgramCard {
  key: string;
  title: string;
  path: string;
  detail: string;
  whenLabel: string;
  when: string;
  times: string | null;
  where: string | null;
  who: string;
  waitlist: string | null;
  date: string;
}

const TRAINING_KINDS = {
  series: { detail: 'Series', whenLabel: 'Next class' },
  class: { detail: 'Single class', whenLabel: 'Class' },
} as const;

const whoOf = (participant: HomeCampRow['participant']) =>
  participant.kind === 'self' ? 'You' : participant.minorName;

const whereOf = (locations: readonly string[]) =>
  locations.length > 0 ? locations.join(', ') : null;

const waitlistOf = ({ status, position }: { status: string; position?: number | undefined }) =>
  status === 'waiting' && position !== undefined ? `Waitlist, position ${position}` : null;

function campCard(row: HomeCampRow): HomeProgramCard {
  return {
    key: `camp:${row.rowId}`,
    title: row.campName,
    path: publicCampPath(row.organizationSlug, row.campSlug),
    detail: `${row.organizationName} · ${row.sessionName}`,
    whenLabel: 'Dates',
    when: seasonRange(row.startDate, row.endDate),
    times: campSessionTimes(row.dailyStartTime, row.dailyEndTime),
    where: whereOf(row.locations),
    who: whoOf(row.participant),
    waitlist: waitlistOf(row),
    date: row.startDate,
  };
}

function trainingCard(row: HomeTrainingRow): HomeProgramCard {
  const { detail, whenLabel } = TRAINING_KINDS[row.kind];
  return {
    key: `training:${row.rowId}`,
    title: row.trainingName,
    path: publicTrainingPath(row.organizationSlug, row.trainingSlug),
    detail: `${row.organizationName} · ${detail}`,
    whenLabel,
    when: trainingClassDate(row.classDate),
    times: trainingHours(row.startTime, row.endTime),
    where: whereOf(row.locations),
    who: whoOf(row.participant),
    waitlist: waitlistOf(row),
    date: row.classDate,
  };
}

// A series stays once its next class has passed: that date moves on only when the server answers again.
export function homeProgramCards(
  camps: readonly HomeCampRow[],
  trainings: readonly HomeTrainingRow[],
  now: number,
): HomeProgramCard[] {
  const today = dateAtUtcMinus12(now);
  return [
    ...camps.filter((row) => row.endDate >= today).map(campCard),
    ...trainings.filter((row) => row.kind === 'series' || row.classDate >= today).map(trainingCard),
  ].sort((a, b) => a.date.localeCompare(b.date));
}
