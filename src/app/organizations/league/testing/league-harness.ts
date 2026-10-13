import type { Routes } from '@angular/router';
import { Elsewhere } from '../../admin/testing/admin-harness';
import { LeaguePage } from '../league-page';

/** Test-only: what the league management page specs share (#125). */

export const GULF = { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' };

/** What `leagues.getOrganizerContext` returns for an org admin of the mockup's published league. */
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

/** The same league for its assigned league organizer. */
export const COED_AS_ORGANIZER = { ...COED, role: 'leagueOrganizer' };

/** What `seasons.listForOrganizer` returns for it (the mockup's populated state, newest first). */
export const SEASONS = [
  {
    seasonId: 'se_fall27',
    name: 'Fall 2027',
    slug: 'fall-2027',
    startDate: '2027-09-08',
    endDate: '2027-11-10',
    registrationDeadline: '2027-08-25',
    formatName: '7 v 7',
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
    formatName: '7 v 7',
    minimumRosterSize: 7,
    status: 'published',
  },
];

export const GET_ORGANIZER_CONTEXT = 'leagues:getOrganizerContext';
export const LIST_FOR_ORGANIZER = 'seasons:listForOrganizer';
export const CREATE_SEASON = 'seasons:create';
export const PUBLISH_SEASON = 'seasons:publish';

export const LEAGUE_URL = `/app/organizations/${GULF.slug}/leagues/${COED.slug}`;

/** Routes that serve `LeaguePage` as the app does, and stubs for the places its links go. */
export const LEAGUE_ROUTES: Routes = [
  { path: 'app/organizations/:orgSlug/leagues/:leagueSlug', component: LeaguePage },
  { path: 'app/organizations/:slug', component: Elsewhere },
  { path: 'app', component: Elsewhere },
  { path: 'organizations/:orgSlug', component: Elsewhere },
];
