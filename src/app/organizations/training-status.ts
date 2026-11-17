import { addCalendarDays, dateAtUtcMinus12, seasonPhase } from '../../../convex/lib/registration';
import type { HlmBadgeVariant } from '../ui/badge';
import { seasonDates } from './league/season-dates';
import { BADGE_TEXT, closesText } from './season-status';

export interface TrainingSeriesStatus {
  badge: string;
  badgeVariant: HlmBadgeVariant;
  registrationOpen: boolean;
  /** The deadline while registration is open, which the badge does not say. */
  closes: string | null;
}

interface Series {
  firstDate: string;
  weeks: number;
  registrationDeadline: string;
}

/** Follows the seasons' phases, with the series running from its first class to its last. */
export function trainingSeriesStatus(series: Series, nowMs: number): TrainingSeriesStatus {
  const phase = seasonPhase(
    {
      startDate: series.firstDate,
      endDate: addCalendarDays(series.firstDate, (series.weeks - 1) * 7),
      registrationDeadline: series.registrationDeadline,
    },
    nowMs,
  );
  const registrationOpen = phase === 'registrationOpen';
  return {
    badge: BADGE_TEXT[phase],
    badgeVariant: registrationOpen ? 'secondary' : 'muted',
    registrationOpen,
    closes: registrationOpen ? closesText(series.registrationDeadline) : null,
  };
}

export interface TrainingStatusLine extends TrainingSeriesStatus {
  text: string;
}

export function trainingStatusLine(
  program: Series & { lastClassDate: string },
  nowMs: number,
): TrainingStatusLine {
  const status = trainingSeriesStatus(program, nowMs);
  const dates = seasonDates(program.firstDate, program.lastClassDate);
  return { ...status, text: status.closes ? `${dates} · closes ${status.closes}` : dates };
}

/** The query keeps the classes that had not passed when it ran; the page drops those that have passed since. */
export function upcomingClasses<T extends { date: string }>(
  classes: readonly T[],
  nowMs: number,
): T[] {
  const today = dateAtUtcMinus12(nowMs);
  return classes.filter((row) => row.date >= today);
}

/** The query keeps the training programs whose last class had not passed when it ran; the page drops one that has passed since. */
export function upcomingTrainings<T extends { lastClassDate: string }>(
  trainings: readonly T[],
  nowMs: number,
): T[] {
  const today = dateAtUtcMinus12(nowMs);
  return trainings.filter((training) => training.lastClassDate >= today);
}
