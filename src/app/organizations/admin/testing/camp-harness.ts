import type { Routes } from '@angular/router';
import { CampPage } from '../camp-page';
import { COASTAL, Elsewhere } from './admin-harness';

export const CAMP_ROUTES: Routes = [
  { path: 'app/organizations/:orgSlug/camps/:campSlug', component: CampPage },
  { path: 'app/organizations/:slug', component: Elsewhere },
  { path: 'app', component: Elsewhere },
  { path: 'organizations/:orgSlug', component: Elsewhere },
];

export const CAMPS_BASE = `/app/organizations/${COASTAL.slug}/camps`;
export const CAMP_URL = `${CAMPS_BASE}/junior-beach-volleyball-camp`;
export const GET_CAMP = 'camps:getForManagement';
export const LIST_SESSIONS = 'campSessions:listForCamp';
export const ADD_SESSION = 'campSessions:add';
export const REMOVE_SESSION = 'campSessions:remove';
export const LIST_MINE = 'organizations:listMine';
export const CAMP_ARGS = { orgSlug: COASTAL.slug, campSlug: 'junior-beach-volleyball-camp' };
export const SESSIONS_ARGS = { campId: 'cp_junior' };

export const CAMP = {
  campId: 'cp_junior',
  organizationId: COASTAL.organizationId,
  organization: { name: COASTAL.name, slug: COASTAL.slug },
  role: 'orgAdmin',
  name: 'Junior Beach Volleyball Camp',
  slug: 'junior-beach-volleyball-camp',
  status: 'draft',
  sportName: 'Beach volleyball',
  minimumAge: 9,
  maximumAge: 14,
  locations: [
    {
      name: 'Pelican Shoals Sand Courts',
      address: '2150 Pelican Shoals Dr, Corpus Christi, TX 78418',
    },
  ],
};

export const AS_ORGANIZER = { ...CAMP, role: 'leagueOrganizer' };

export function session(change: Record<string, unknown> = {}) {
  return {
    campSessionId: 'cs_week1',
    name: 'Week 1',
    startDate: '2027-07-05',
    endDate: '2027-07-09',
    dailyStartTime: '09:00',
    dailyEndTime: '12:00',
    places: 20,
    registrationDeadline: '2027-07-01',
    registeredCount: 0,
    ...change,
  };
}

export const SESSIONS = [
  session(),
  session({
    campSessionId: 'cs_week2',
    name: 'Week 2',
    startDate: '2027-07-12',
    endDate: '2027-07-16',
    registrationDeadline: '2027-07-08',
    places: 1,
    registeredCount: 1,
  }),
  session({
    campSessionId: 'cs_week3',
    name: 'Week 3',
    startDate: '2027-07-19',
    endDate: '2027-07-19',
    dailyStartTime: undefined,
    dailyEndTime: undefined,
    registrationDeadline: '2027-07-19',
  }),
];
