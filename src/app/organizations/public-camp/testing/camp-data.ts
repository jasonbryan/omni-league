import type { PublicCampData } from '../public-camp-view';

export const ORG_SLUG = 'gulf-coast-sport-social';
export const CAMP_SLUG = 'junior-beach-volleyball-camp';
export const CAMP_PATH = `/organizations/${ORG_SLUG}/camps/${CAMP_SLUG}`;

export const JUNIOR_CAMP: PublicCampData = {
  organization: { name: 'Gulf Coast Sport & Social', slug: ORG_SLUG },
  name: 'Junior Beach Volleyball Camp',
  slug: CAMP_SLUG,
  sportName: 'Beach volleyball',
  minimumAge: 9,
  maximumAge: 14,
  locations: [
    { name: 'North Beach Sand Courts', address: '3500 Sandcourt Ln, Corpus Christi, TX 78402' },
  ],
  sessions: [
    {
      name: 'Week 1',
      startDate: '2027-07-05',
      endDate: '2027-07-09',
      dailyStartTime: '09:00',
      dailyEndTime: '12:00',
      placesLeft: 15,
      registrationDeadline: '2027-07-01',
    },
    {
      name: 'Week 2',
      startDate: '2027-07-12',
      endDate: '2027-07-16',
      dailyStartTime: '09:00',
      dailyEndTime: '12:00',
      placesLeft: 1,
      registrationDeadline: '2027-07-08',
    },
    {
      name: 'Week 3',
      startDate: '2027-07-19',
      endDate: '2027-07-23',
      placesLeft: 0,
      registrationDeadline: '2027-07-15',
    },
  ],
};

export const CAMP_ARGS = { orgSlug: ORG_SLUG, campSlug: CAMP_SLUG };

export function campQueryResults(
  camp: PublicCampData | null = JUNIOR_CAMP,
): Record<string, unknown> {
  return { 'camps:getPublicPage': camp };
}

// 18:00 UTC is 06:00 on that date at UTC-12.
export const at = (date: string): number => Date.parse(`${date}T18:00:00Z`);
