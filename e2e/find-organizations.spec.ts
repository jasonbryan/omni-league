import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { screenshot } from './support/screenshot';
import { seedTenant, type Tenant } from './support/tenant';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LIST_PROJECT = 'chromium-desktop';
const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
/** Netlify removes the spaces after the commas. */
const noSpaces = (value: string | undefined) => value?.replace(/\s+/g, '');

const COURTS = { name: 'Sand Courts', address: '1 Beach Rd, Corpus Christi, TX 78401' };

/**
 * The list is global and ordered by name, so the tests that count pages seed seven organizations whose names start with a digit,
 * which sorts before every other name, and only the desktop project does it.
 */
const WORDS = ['echo', 'Delta', 'charlie', 'Bravo', 'alpha', 'Foxtrot', 'Golf'];
const SORTED_WORDS = ['alpha', 'Bravo', 'charlie', 'Delta', 'echo', 'Foxtrot', 'Golf'];

const SPORTS_BY_WORD: Record<string, 'beachVolleyball' | 'soccer' | 'softball'> = {
  alpha: 'softball',
};

interface Seeded {
  byWord: Map<string, Tenant>;
  draftsOnly: Tenant;
  noLeagues: Tenant;
}

let seeded: Seeded;

async function seedSeven(): Promise<Seeded> {
  const byWord = new Map<string, Tenant>();
  for (const word of WORDS) {
    byWord.set(
      word,
      await seedTenant({
        name: `00 Browse ${word}`,
        ...(word === 'alpha' && { cityState: 'Austin, TX' }),
        locations: [COURTS],
        leagues: [
          {
            name: 'Coed League',
            sport: SPORTS_BY_WORD[word] ?? 'soccer',
            locations: [COURTS.name],
          },
        ],
      }),
    );
  }
  const draftsOnly = await seedTenant({
    name: '00 Browse Drafts',
    locations: [COURTS],
    leagues: [{ name: 'Draft League', sport: 'soccer', locations: [COURTS.name], status: 'draft' }],
  });
  const noLeagues = await seedTenant({ name: '00 Browse Empty' });
  return { byWord, draftsOnly, noLeagues };
}

const nameOf = (word: string) => seeded.byWord.get(word)!.name;

function organizationsSection(html: string): string {
  return (
    /<section\b[^>]*aria-labelledby="organizations-heading"[^>]*>([\s\S]*?)<\/section>/.exec(
      html,
    )?.[1] ?? ''
  );
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function listedNames(html: string): string[] {
  return [...organizationsSection(html).matchAll(/<h3\b[^>]*>\s*<a\b[^>]*>([^<]*)<\/a>/g)].map(
    ([, name]) => name.trim(),
  );
}

function canonicals(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/g)].map(
    ([tag]) => /\bhref="([^"]*)"/.exec(tag)?.[1] ?? '',
  );
}

const rows = (page: Page) =>
  page.locator('section[aria-labelledby="organizations-heading"] ul > li h3');

test.describe('find a league: the organizations list', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    if (test.info().project.name === LIST_PROJECT) seeded = await seedSeven();
  });

  test(
    '/leagues without JavaScript lists the organizations with a published league by name ignoring case, with their sports and City, state',
    RAW_HTTP,
    async ({ request }) => {
      const response = await fetchRawHtml(request, '/leagues');
      expect(response.status).toBe(200);
      expect(noSpaces(response.headers['cache-control'])).toBe(noSpaces(PUBLIC_PAGE_CACHE));
      expect(response.headers['location']).toBeUndefined();
      expect(listedNames(response.html)).toEqual(SORTED_WORDS.slice(0, 5).map(nameOf));
      expect(response.html).toMatch(
        /<h2\b[^>]*id="organizations-heading"[^>]*>\s*Organizations\s*<\/h2>/,
      );

      const section = organizationsSection(response.html);
      const alpha = plainText(section.split('</li>').find((row) => row.includes(nameOf('alpha')))!);
      expect(alpha).toContain('Softball · Austin, TX');
      const bravo = plainText(section.split('</li>').find((row) => row.includes(nameOf('Bravo')))!);
      expect(bravo).toContain('Soccer');
      expect(bravo).not.toContain('·');
      expect(response.html).toContain(`href="${seeded.byWord.get('alpha')!.path}"`);
      expect(response.html).not.toContain(seeded.draftsOnly.name);
      expect(response.html).not.toContain(seeded.noLeagues.name);
      expect(canonicals(response.html)).toHaveLength(1);
      expect(canonicals(response.html)[0].endsWith('/leagues')).toBe(true);
    },
  );

  test(
    '?page=2 holds the 6th and 7th organization with the canonical /leagues?page=2, and no organization with only drafts or none',
    RAW_HTTP,
    async ({ request }) => {
      const response = await fetchRawHtml(request, '/leagues?page=2');
      expect(response.status).toBe(200);
      // Organizations other specs seed follow the seven, so the page holds more than the 6th and 7th.
      expect(listedNames(response.html).slice(0, 2)).toEqual(['Foxtrot', 'Golf'].map(nameOf));
      expect(canonicals(response.html)).toHaveLength(1);
      expect(canonicals(response.html)[0].endsWith('/leagues?page=2')).toBe(true);
      expect(plainText(organizationsSection(response.html))).toMatch(/6–\d+ of \d+ organizations/);
      expect(response.html).not.toContain(seeded.draftsOnly.name);
      expect(response.html).not.toContain(seeded.noLeagues.name);
    },
  );

  for (const query of ['?page=0', '?page=abc', '?page=2&page=3']) {
    test(`${query} renders page 1 with 200 and no Location`, RAW_HTTP, async ({ request }) => {
      const response = await fetchRawHtml(request, `/leagues${query}`);
      expect(response.status).toBe(200);
      expect(response.headers['location']).toBeUndefined();
      expect(listedNames(response.html)).toEqual(SORTED_WORDS.slice(0, 5).map(nameOf));
      expect(canonicals(response.html)[0].endsWith('/leagues')).toBe(true);
    });
  }

  test('Next works from the keyboard: the URL becomes ?page=2, focus is on the heading, and Back restores page 1', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== LIST_PROJECT, 'one browser project only');
    await page.goto('/leagues');
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(rows(page)).toHaveText(SORTED_WORDS.slice(0, 5).map(nameOf));

    const next = page.getByRole('navigation', { name: 'Organizations pages' }).getByRole('link', {
      name: 'Next page',
    });
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${baseURL}/leagues?page=2`);
    await expect(rows(page).nth(0)).toHaveText(nameOf('Foxtrot'));
    await expect(rows(page).nth(1)).toHaveText(nameOf('Golf'));
    await expect(page.getByRole('heading', { level: 2, name: 'Organizations' })).toBeFocused();

    await page.goBack();
    await expect(page).toHaveURL(`${baseURL}/leagues`);
    await expect(rows(page)).toHaveText(SORTED_WORDS.slice(0, 5).map(nameOf));
  });
});

interface Modification {
  type: string;
  queryId: number;
  udfPath?: string;
}

/** Other specs seed organizations while this one runs, and a live update between the read and the Tab walk would change the list under the check. */
async function freezeOrganizations(page: Page): Promise<void> {
  const queryIds = new Set<number>();
  const answered = new Set<number>();
  await page.routeWebSocket(/\/api\/[^/]+\/sync$/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const { modifications = [] } = JSON.parse(String(message)) as {
        modifications?: Modification[];
      };
      for (const { type, queryId, udfPath } of modifications) {
        if (type === 'Add' && udfPath === 'search:organizations') queryIds.add(queryId);
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message)) as { modifications?: Modification[] };
      if (!frame.modifications) {
        ws.send(message);
        return;
      }
      const kept = frame.modifications.filter(({ type, queryId }) => {
        if (type !== 'QueryUpdated' || !queryIds.has(queryId)) return true;
        if (answered.has(queryId)) return false;
        answered.add(queryId);
        return true;
      });
      ws.send(JSON.stringify({ ...frame, modifications: kept }));
    });
  });
}

test.describe('find a league: the organizations list screens', () => {
  test('the list passes the accessibility checks', async ({ page, consoleGuard }, testInfo) => {
    await seedTenant({
      locations: [COURTS],
      leagues: [{ name: 'Coed League', sport: 'soccer', locations: [COURTS.name] }],
    });
    await freezeOrganizations(page);
    await page.goto('/leagues');
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(rows(page).first()).toBeVisible();
    await screenshot(page, testInfo, '300-find-organizations');
    await expectAccessible(page);
  });

  test('a viewed page of organizations opens offline from its saved copy with the saved-copy note', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    // Six organizations make a second page whatever else the shared backend holds.
    for (let i = 0; i < 6; i++) {
      await seedTenant({
        locations: [COURTS],
        leagues: [{ name: 'Coed League', sport: 'soccer', locations: [COURTS.name] }],
      });
    }
    await page.goto('/leagues?page=2');
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(rows(page).first()).toBeVisible();
    const saved = await rows(page).allTextContents();

    // Back is a client-side navigation, so the page opens from the app's saved copy and not from the network. The earlier visit's
    // subscription is dropped while online, so the client holds no result for it.
    await page.locator('main').getByRole('link', { name: saved[0] }).click();
    await expect(page).toHaveURL(/\/organizations\/e2e-[0-9a-f]+$/);
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Find a league');
    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`${baseURL}/leagues?page=2`);
    await expect(page.locator('app-saved-copy-note')).toBeVisible();
    await expect(rows(page)).toHaveText(saved);
    await context.setOffline(false);
  });
});
