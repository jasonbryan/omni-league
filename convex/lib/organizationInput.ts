// Imports only `./slugs`, so the app can import it.
import { isChoosableSlug, MAX_SLUG_LENGTH, MIN_SLUG_LENGTH } from './slugs';

export const MAX_ORGANIZATION_NAME_LENGTH = 100;

export type OrganizationInputCode =
  'nameEmpty' | 'nameTooLong' | 'slugEmpty' | 'slugInvalid' | 'slugTaken';

export interface OrganizationInputError {
  field: 'name' | 'slug';
  code: OrganizationInputCode;
  message: string;
}

export const ORGANIZATION_MESSAGES = {
  nameEmpty: 'Enter your organization’s name.',
  nameTooLong: (length: number) =>
    `Use ${MAX_ORGANIZATION_NAME_LENGTH} characters or fewer. This name has ${length}.`,
  slugEmpty: 'Enter a slug for your public page’s address.',
  slugInvalid: `Use ${MIN_SLUG_LENGTH} to ${MAX_SLUG_LENGTH} lowercase letters and digits, with single hyphens between them. Some slugs, like new, are reserved.`,
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
