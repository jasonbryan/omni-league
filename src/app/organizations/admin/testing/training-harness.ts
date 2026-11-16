import type { Routes } from '@angular/router';
import { appRouteTitle } from '../../../shell/testing/app-route-title';
import { TrainingPage } from '../training-page';
import { COASTAL, Elsewhere } from './admin-harness';

export const TRAINING_ROUTES: Routes = [
  {
    path: 'app/organizations/:orgSlug/training/:trainingSlug',
    title: appRouteTitle('organizations/:orgSlug/training/:trainingSlug'),
    component: TrainingPage,
  },
  { path: 'app/organizations/:slug', component: Elsewhere },
  { path: 'app', component: Elsewhere },
  { path: 'organizations/:orgSlug', component: Elsewhere },
];

export const TRAINING_BASE = `/app/organizations/${COASTAL.slug}/training`;
export const TRAINING_URL = `${TRAINING_BASE}/tuesday-serving-clinic`;
export const GET_TRAINING = 'trainings:getForManagement';
export const LIST_CLASSES = 'trainingClasses:listForTraining';
export const SCHEDULE_CLASSES = 'trainingClasses:schedule';
export const CANCEL_CLASS = 'trainingClasses:cancel';
export const RESTORE_CLASS = 'trainingClasses:restore';
export const LIST_MINE = 'organizations:listMine';
export const TRAINING_ARGS = { orgSlug: COASTAL.slug, trainingSlug: 'tuesday-serving-clinic' };
export const CLASSES_ARGS = { trainingId: 'tr_serving' };

export const TRAINING = {
  trainingId: 'tr_serving',
  organizationId: COASTAL.organizationId,
  organization: { name: COASTAL.name, slug: COASTAL.slug },
  role: 'orgAdmin',
  name: 'Tuesday Serving Clinic',
  slug: 'tuesday-serving-clinic',
  status: 'draft',
  sportName: 'Beach volleyball',
  coachName: 'Dana Ruiz',
  locations: [
    {
      name: 'Pelican Shoals Sand Courts',
      address: '2150 Pelican Shoals Dr, Corpus Christi, TX 78418',
    },
  ],
};

export const SCHEDULED_TRAINING = {
  ...TRAINING,
  minimumAge: 16,
  pattern: {
    weekday: 2,
    startTime: '18:00',
    endTime: '19:00',
    firstDate: '2027-01-05',
    weeks: 8,
    placesPerClass: 12,
    registrationDeadline: '2027-01-01',
    allowSingleRegistration: true,
  },
};

export const AS_ORGANIZER = { ...TRAINING, role: 'leagueOrganizer' };

export function trainingClass(change: Record<string, unknown> = {}) {
  return {
    trainingClassId: 'tc_1',
    date: '2027-01-05',
    startTime: '18:00',
    endTime: '19:00',
    places: 12,
    registeredCount: 0,
    status: 'scheduled',
    ...change,
  };
}

export const CLASSES = [
  trainingClass(),
  trainingClass({ trainingClassId: 'tc_2', date: '2027-01-12', registeredCount: 3 }),
  trainingClass({ trainingClassId: 'tc_3', date: '2027-01-19', status: 'cancelled' }),
];
