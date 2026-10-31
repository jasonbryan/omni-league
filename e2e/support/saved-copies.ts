import { expect, type Page } from '@playwright/test';

type SavedCopyArgs = Record<string, string | number>;

/** Matches `savedCopyKey` in `src/app/core/data/convex/saved-copies.ts`, which imports Angular and so cannot load here. */
function savedCopyKey(functionName: string, args: SavedCopyArgs): string {
  const sorted = Object.fromEntries(
    Object.keys(args)
      .sort()
      .map((key) => [key, args[key]]),
  );
  return `cvx-saved:${functionName}:${JSON.stringify(sorted)}`;
}

/** The header query takes no `sport`, so every view of one organization shares this key. */
export function organizationHeaderSavedKey(slug: string): string {
  return savedCopyKey('organizations:getPublicPage', { slug });
}

/** The page opens offline only when all four are saved (`ORGANIZATION_PAGE_QUERIES` in `src/app/core/data/convex/offline-saved-queries.ts`). */
export function organizationPageSavedKeys(slug: string, sport?: string): string[] {
  const sportArg: SavedCopyArgs = sport === undefined ? {} : { sport };
  return [
    organizationHeaderSavedKey(slug),
    savedCopyKey('organizations:listPublicLeagues', { slug, page: 1, ...sportArg }),
    savedCopyKey('organizations:listPublicLocations', { slug, page: 1, ...sportArg }),
    savedCopyKey('seasons:listOpenForOrganization', { orgSlug: slug, ...sportArg }),
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
