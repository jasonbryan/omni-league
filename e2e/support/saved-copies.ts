import { expect, type Page } from '@playwright/test';
import { api } from '../../convex/_generated/api';
import { savedCopyKey } from '../../src/app/core/data/convex/saved-copies';

/** The header query takes no `sport`, so every view of one organization shares this key. */
export function organizationHeaderSavedKey(slug: string): string {
  return savedCopyKey(api.organizations.getPublicPage, { slug });
}

/** The page opens offline only when these four are saved; without the facets copy it opens with no filters (`organization-page.ts`). */
export function organizationPageSavedKeys(slug: string, sport?: string): string[] {
  const sportArg = sport === undefined ? {} : { sport };
  return [
    organizationHeaderSavedKey(slug),
    savedCopyKey(api.organizations.listPublicLeagues, { slug, page: 1, ...sportArg }),
    savedCopyKey(api.organizations.listPublicLocations, { slug, page: 1, ...sportArg }),
    savedCopyKey(api.seasons.listOpenForOrganization, { orgSlug: slug, ...sportArg }),
  ];
}

function missingSavedCopies(page: Page, keys: readonly string[]): Promise<string[]> {
  return page.evaluate((all) => all.filter((key) => localStorage.getItem(key) === null), keys);
}

export async function expectSavedCopies(
  page: Page,
  keys: readonly string[],
  { timeout }: { timeout?: number } = {},
): Promise<void> {
  let missing = [...keys];
  try {
    await expect
      .poll(
        async () => {
          missing = await missingSavedCopies(page, keys);
          return missing.length;
        },
        timeout === undefined ? {} : { timeout },
      )
      .toBe(0);
  } catch (error) {
    throw new Error(`No saved copy in localStorage for: ${missing.join(', ')}`, { cause: error });
  }
}
