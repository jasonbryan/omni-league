import type { Routes } from '@angular/router';
import { Elsewhere } from '../../admin/testing/admin-harness';
import { LeaguePage } from '../league-page';

export const GULF = { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' };

export const COED = {
  leagueId: 'lg_coed',
  name: 'Coed 7v7 Rec',
  slug: 'coed-7v7-rec',
  sport: 'soccer',
  status: 'published',
  locationNames: ['Bayside Athletic Complex'],
  role: 'orgAdmin',
  organization: GULF,
};

export const COED_AS_ORGANIZER = { ...COED, role: 'leagueOrganizer' };

export const SEASONS = [
  {
    seasonId: 'se_fall27',
    name: 'Fall 2027',
    slug: 'fall-2027',
    startDate: '2027-09-08',
    endDate: '2027-11-10',
    registrationDeadline: '2027-08-25',
    formatName: '7v7',
    minimumRosterSize: 9,
    status: 'draft',
  },
  {
    seasonId: 'se_summer27',
    name: 'Summer 2027',
    slug: 'summer-2027',
    startDate: '2027-06-02',
    endDate: '2027-08-25',
    registrationDeadline: '2027-05-19',
    formatName: '7v7',
    minimumRosterSize: 7,
    status: 'published',
  },
];

export const GET_ORGANIZER_CONTEXT = 'leagues:getOrganizerContext';
export const LIST_FOR_ORGANIZER = 'seasons:listForOrganizer';
export const CREATE_SEASON = 'seasons:create';
export const PUBLISH_SEASON = 'seasons:publish';
export const LIST_MINE = 'organizations:listMine';

export const MINE_AS_ORGANIZER = [
  {
    name: GULF.name,
    slug: GULF.slug,
    role: 'leagueOrganizer',
    leagues: [
      { name: 'Coed 7v7 Rec', slug: COED.slug },
      { name: 'Friday Night Coed 6s', slug: 'friday-night-coed-6s' },
      { name: 'Thursday Night Coed 2s', slug: 'thursday-night-coed-2s' },
    ],
  },
  {
    name: 'Lakeside Softball',
    slug: 'lakeside-softball',
    role: 'leagueOrganizer',
    leagues: [{ name: 'Tuesday Slowpitch', slug: 'tuesday-slowpitch' }],
  },
];

export const LEAGUE_URL = `/app/organizations/${GULF.slug}/leagues/${COED.slug}`;

export const LEAGUE_ROUTES: Routes = [
  { path: 'app/organizations/:orgSlug/leagues/:leagueSlug', component: LeaguePage },
  { path: 'app/organizations/:slug', component: Elsewhere },
  { path: 'app', component: Elsewhere },
  { path: 'organizations/:orgSlug', component: Elsewhere },
];
