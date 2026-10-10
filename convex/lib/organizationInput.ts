// What a user may type when creating an organization (#64), checked in the browser and again by
// `organizations.create` with the same rules and messages (design/mockups/64-create-organization.html,
// "Messages and attributes"). Imports only convex/lib/slugs.ts, so the app can import it
// (convex.md, Functions).
import { isChoosableSlug, MAX_SLUG_LENGTH, MIN_SLUG_LENGTH } from './slugs';

/** Longest organization name, counted after trimming. */
export const MAX_ORGANIZATION_NAME_LENGTH = 100;

export type OrganizationInputCode =
  'nameEmpty' | 'nameTooLong' | 'slugEmpty' | 'slugInvalid' | 'slugTaken';

/** A refusal about one field: the `data` of the `ConvexError` that `organizations.create` throws. */
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

/** The name to store (trimmed), or the refusal. */
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

/**
 * The refusal for a slug typed for a new organization, or `null` when it is valid and not reserved.
 * Whether it is taken is the server's to say (`ORGANIZATION_MESSAGES.slugTaken`).
 */
export function checkOrganizationSlug(slug: string): OrganizationInputError | null {
  if (slug === '') {
    return { field: 'slug', code: 'slugEmpty', message: ORGANIZATION_MESSAGES.slugEmpty };
  }
  if (!isChoosableSlug(slug)) {
    return { field: 'slug', code: 'slugInvalid', message: ORGANIZATION_MESSAGES.slugInvalid };
  }
  return null;
}
