// Imports only `./slugs`, so the app can import it.
import { isChoosableSlug, MAX_SLUG_LENGTH, MIN_SLUG_LENGTH } from './slugs';

export const MAX_ORGANIZATION_NAME_LENGTH = 100;
export const MIN_CITY_STATE_LENGTH = 2;
export const MAX_CITY_STATE_LENGTH = 60;
export const CITY_STATE_HINT = 'Such as Corpus Christi, TX';

export type OrganizationInputCode =
  'nameEmpty' | 'nameTooLong' | 'slugEmpty' | 'slugInvalid' | 'slugTaken' | 'cityStateInvalid';

export interface OrganizationInputError {
  field: 'name' | 'slug' | 'cityState';
  code: OrganizationInputCode;
  message: string;
}

export const ORGANIZATION_MESSAGES = {
  nameEmpty: 'Enter your organization’s name.',
  nameTooLong: (length: number) =>
    `Use ${MAX_ORGANIZATION_NAME_LENGTH} characters or fewer. This name has ${length}.`,
  slugEmpty: 'Enter a slug for your public page’s address.',
  slugInvalid: `Use ${MIN_SLUG_LENGTH} to ${MAX_SLUG_LENGTH} lowercase letters and digits, with single hyphens between them. Some slugs, like new, are reserved.`,
  cityStateInvalid: `Use ${MIN_CITY_STATE_LENGTH} to ${MAX_CITY_STATE_LENGTH} characters, such as Corpus Christi, TX.`,
  slugTaken: (slug: string) => `${slug} is already taken. Choose another slug.`,
} as const;

export function checkOrganizationName(
  name: string,
): { ok: true; name: string } | { ok: false; error: OrganizationInputError } {
  const trimmed = name.trim();
  if (trimmed === '') {
    return {
      ok: false,
      error: { field: 'name', code: 'nameEmpty', message: ORGANIZATION_MESSAGES.nameEmpty },
    };
  }
  if (trimmed.length > MAX_ORGANIZATION_NAME_LENGTH) {
    return {
      ok: false,
      error: {
        field: 'name',
        code: 'nameTooLong',
        message: ORGANIZATION_MESSAGES.nameTooLong(trimmed.length),
      },
    };
  }
  return { ok: true, name: trimmed };
}

export function checkOrganizationSlug(slug: string): OrganizationInputError | null {
  if (slug === '') {
    return { field: 'slug', code: 'slugEmpty', message: ORGANIZATION_MESSAGES.slugEmpty };
  }
  if (!isChoosableSlug(slug)) {
    return { field: 'slug', code: 'slugInvalid', message: ORGANIZATION_MESSAGES.slugInvalid };
  }
  return null;
}

export function checkCityState(
  raw: string,
): { ok: true; value: string | null } | { ok: false; error: OrganizationInputError } {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value === '') return { ok: true, value: null };
  if (value.length < MIN_CITY_STATE_LENGTH || value.length > MAX_CITY_STATE_LENGTH) {
    return {
      ok: false,
      error: {
        field: 'cityState',
        code: 'cityStateInvalid',
        message: ORGANIZATION_MESSAGES.cityStateInvalid,
      },
    };
  }
  return { ok: true, value };
}
