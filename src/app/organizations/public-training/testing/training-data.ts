import type { PublicTrainingData } from '../public-training-view';

export const ORG_SLUG = 'gulf-coast-sport-social';
export const TRAINING_SLUG = 'tuesday-serving-clinic';
export const TRAINING_PATH = `/organizations/${ORG_SLUG}/training/${TRAINING_SLUG}`;

// 2027-02-02 is a Tuesday.
export const TUESDAY_CLINIC: PublicTrainingData = {
  organization: { name: 'Gulf Coast Sport & Social', slug: ORG_SLUG },
  name: 'Tuesday Serving Clinic',
  slug: TRAINING_SLUG,
  sportName: 'Beach volleyball',
  coachName: 'Dana Ruiz',
  minimumAge: 16,
  locations: [
    { name: 'North Beach Sand Courts', address: '3500 Sandcourt Ln, Corpus Christi, TX 78402' },
  ],
  pattern: {
    weekday: 2,
    startTime: '18:00',
    endTime: '19:00',
    firstDate: '2027-02-02',
    weeks: 3,
    registrationDeadline: '2027-02-01',
  },
  classes: [
    { date: '2027-02-02', startTime: '18:00', endTime: '19:00', placesLeft: 12 },
    { date: '2027-02-09', startTime: '18:00', endTime: '19:00', placesLeft: 1 },
    { date: '2027-02-16', startTime: '18:00', endTime: '19:00', placesLeft: 0 },
  ],
};

export const TRAINING_ARGS = { orgSlug: ORG_SLUG, trainingSlug: TRAINING_SLUG };

export function trainingQueryResults(
  training: PublicTrainingData | null = TUESDAY_CLINIC,
): Record<string, unknown> {
  return { 'trainings:getPublicPage': training };
}

// 18:00 UTC is 06:00 on that date at UTC-12.
export const at = (date: string): number => Date.parse(`${date}T18:00:00Z`);
