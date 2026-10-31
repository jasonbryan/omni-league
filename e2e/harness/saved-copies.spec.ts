import { remoteBaseUrl } from '../support/env';
import { expect, test } from '../support/fixtures';
import { holdQueries } from '../support/hold-queries';
import {
  expectSavedCopies,
  organizationHeaderSavedKey,
  organizationPageSavedKeys,
} from '../support/saved-copies';
import { seedTenant } from '../support/tenant';
import { VIEWPORT_AGNOSTIC } from '../support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

test.describe('organization page saved-copy keys', VIEWPORT_AGNOSTIC, () => {
  test('the header key holds the slug only', () => {
    expect(organizationHeaderSavedKey('gulf-coast')).toBe(
      'cvx-saved:organizations:getPublicPage:{"slug":"gulf-coast"}',
    );
  });

  test('the All sports view has the header, both lists on page 1, and the open seasons', () => {
    expect(organizationPageSavedKeys('gulf-coast')).toEqual([
      'cvx-saved:organizations:getPublicPage:{"slug":"gulf-coast"}',
      'cvx-saved:organizations:listPublicLeagues:{"page":1,"slug":"gulf-coast"}',
      'cvx-saved:organizations:listPublicLocations:{"page":1,"slug":"gulf-coast"}',
      'cvx-saved:seasons:listOpenForOrganization:{"orgSlug":"gulf-coast"}',
    ]);
  });

  test('a sport view adds the sport to every key but the header, in sorted order', () => {
    expect(organizationPageSavedKeys('gulf-coast', 'soccer')).toEqual([
      'cvx-saved:organizations:getPublicPage:{"slug":"gulf-coast"}',
      'cvx-saved:organizations:listPublicLeagues:{"page":1,"slug":"gulf-coast","sport":"soccer"}',
      'cvx-saved:organizations:listPublicLocations:{"page":1,"slug":"gulf-coast","sport":"soccer"}',
      'cvx-saved:seasons:listOpenForOrganization:{"orgSlug":"gulf-coast","sport":"soccer"}',
    ]);
  });
});

test.describe('expectSavedCopies', VIEWPORT_AGNOSTIC, () => {
  test('fails naming the key of a held query, then passes once the hold is released', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await seedTenant({
      name: 'E2E Saved Copies',
      locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
      leagues: [{ name: 'Alpha League', sport: 'soccer', locations: ['Alpha Field'] }],
    });
    const held = await holdQueries(page, ['organizations:listPublicLeagues']);
    await page.goto(tenant.path);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect.poll(() => held.isHolding()).toBe(true);

    const keys = organizationPageSavedKeys(tenant.slug);
    const leaguesKey = keys.find((key) =>
      key.startsWith('cvx-saved:organizations:listPublicLeagues:'),
    );
    expect(leaguesKey).toBeDefined();
    const failure = await expectSavedCopies(page, keys, { timeout: 1_000 }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(leaguesKey);

    held.release();
    await expectSavedCopies(page, keys);
  });
});
