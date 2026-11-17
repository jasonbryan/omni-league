import type { ProgramType } from '../../../convex/lib/programs';

interface ProgramTypeWords {
  readonly badge: string;
  readonly chip: string;
  readonly noun: string;
}

export const PROGRAM_TYPE_WORDS: Readonly<Record<ProgramType, ProgramTypeWords>> = {
  league: { badge: 'League', chip: 'Leagues', noun: 'league' },
  tournament: { badge: 'Tournament', chip: 'Tournaments', noun: 'tournament' },
  camp: { badge: 'Camp', chip: 'Camps', noun: 'camp' },
  training: { badge: 'Training', chip: 'Training', noun: 'training program' },
};
