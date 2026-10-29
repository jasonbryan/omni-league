import { LIST_PAGE_SIZE } from '../../core/list-page';
import type { FindOrganizationRow, FindOrganizations } from '../find-path';

export const GULF_ROW: FindOrganizationRow = {
  name: 'Gulf Coast Sport & Social',
  slug: 'gulf-coast-sport-social',
  sportNames: ['Beach volleyball', 'Soccer', 'Softball'],
  cityState: 'Corpus Christi, TX',
};

export const FRONT_RANGE_ROW: FindOrganizationRow = {
  name: 'Front Range Rec Sports',
  slug: 'front-range-rec-sports',
  sportNames: ['Soccer', 'Softball'],
  cityState: 'Denver, CO',
};

export const NO_CITY_ROW: FindOrganizationRow = {
  name: 'Saguaro Valley Softball',
  slug: 'saguaro-valley-softball',
  sportNames: ['Softball'],
};

export const ORGANIZATIONS: FindOrganizations = {
  rows: [FRONT_RANGE_ROW, GULF_ROW, NO_CITY_ROW],
  page: 1,
  pageCount: 1,
  total: 3,
};

export const NO_ORGANIZATIONS: FindOrganizations = { rows: [], page: 1, pageCount: 0, total: 0 };

export const ORGANIZATION_TOTAL = LIST_PAGE_SIZE + 2;

export function organizationsPage(page: number): FindOrganizations {
  const all: FindOrganizationRow[] = Array.from({ length: ORGANIZATION_TOTAL }, (_, i) => ({
    name: `Club ${i + 1}`,
    slug: `club-${i + 1}`,
    sportNames: ['Soccer'],
  }));
  return {
    rows: all.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE),
    page,
    pageCount: Math.ceil(ORGANIZATION_TOTAL / LIST_PAGE_SIZE),
    total: ORGANIZATION_TOTAL,
  };
}
