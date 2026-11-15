import type { Id } from '../../../../../convex/_generated/dataModel';
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
      sessionId: 'session_week1' as Id<'campSessions'>,
      name: 'Week 1',
      startDate: '2027-07-05',
      endDate: '2027-07-09',
      dailyStartTime: '09:00',
      dailyEndTime: '12:00',
      placesLeft: 15,
      registrationDeadline: '2027-07-01',
    },
    {
      sessionId: 'session_week2' as Id<'campSessions'>,
      name: 'Week 2',
      startDate: '2027-07-12',
      endDate: '2027-07-16',
      dailyStartTime: '09:00',
      dailyEndTime: '12:00',
      placesLeft: 1,
      registrationDeadline: '2027-07-08',
    },
    {
      sessionId: 'session_week3' as Id<'campSessions'>,
      name: 'Week 3',
      startDate: '2027-07-19',
      endDate: '2027-07-23',
      placesLeft: 0,
      registrationDeadline: '2027-07-15',
    },
  ],
};

export const WEEK_1 = 'session_week1';
export const WEEK_2 = 'session_week2';
export const WEEK_3 = 'session_week3';

export const CAMP_ARGS = { orgSlug: ORG_SLUG, campSlug: CAMP_SLUG };

export function campQueryResults(
  camp: PublicCampData | null = JUNIOR_CAMP,
): Record<string, unknown> {
  return { 'camps:getPublicPage': camp };
}

// 18:00 UTC is 06:00 on that date at UTC-12.
export const at = (date: string): number => Date.parse(`${date}T18:00:00Z`);

export const ADULT_CAMP: PublicCampData = { ...JUNIOR_CAMP, minimumAge: 18, maximumAge: 99 };
