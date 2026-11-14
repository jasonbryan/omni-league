import type { Locator } from '@playwright/test';
import { axeScan, checkReflow, describeViolations, expectAccessible, tabKey } from './support/a11y';
import { seedBestOfThree, seedBracket, seedResult, type SeededResult } from './support/bracket';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { screenshot } from './support/screenshot';
import { dateFromToday, seedTenant, type Tenant } from './support/tenant';
import { seedTournament } from './support/tournament';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
/** Netlify removes the spaces after the commas. */
const noSpaces = (value: string | undefined) => value?.replace(/\s+/g, '');
const textOf = (html: string | undefined) =>
  (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&middot;|&#183;/g, '·')
    .replace(/\s+/g, ' ')
    .trim();

const ADDRESS = '3500 Sandcourt Ln, Corpus Christi, TX 78402';
const OPEN_DEADLINE = dateFromToday(20);

async function seed(): Promise<{ tenant: Tenant; open: string; closed: string; draft: string }> {
  const tenant = await seedTenant({
    name: 'E2E Tournament Page',
    locations: [{ name: 'North Beach Sand Courts', address: ADDRESS }],
  });
  const common = { locations: ['North Beach Sand Courts'] };
  const open = await seedTournament(tenant, {
    ...common,
    name: 'Gulf Coast Beach Open',
    slug: 'gulf-coast-beach-open',
    division: { gender: 'coed', playersPerSide: 2, level: 'open', ageGroup: 'adult' },
    startDate: dateFromToday(30),
    endDate: dateFromToday(31),
    registrationDeadline: OPEN_DEADLINE,
  });
  const closed = await seedTournament(tenant, {
    ...common,
    name: 'Past Deadline Classic',
    slug: 'past-deadline-classic',
    startDate: dateFromToday(30),
    endDate: dateFromToday(30),
    registrationDeadline: dateFromToday(-2),
  });
  const draft = await seedTournament(tenant, {
    ...common,
    name: 'Secret Draft Open',
    slug: 'secret-draft-open',
    startDate: dateFromToday(60),
    endDate: dateFromToday(61),
    registrationDeadline: dateFromToday(50),
    status: 'draft',
  });
  return { tenant, open, closed, draft };
}

const BRACKET_TEAMS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
/** Five teams make eight places: seeds 1 to 3 have byes and 4 plays 5. */
const BRACKET_GAMES = [
  'Game 1: (1) Alpha against Bye',
  'Game 2: (4) Delta against (5) Echo',
  'Game 3: (2) Bravo against Bye',
  'Game 4: (3) Charlie against Bye',
  'Game 1: (1) Alpha against To be decided',
  'Game 2: (2) Bravo against (3) Charlie',
  'Game 1: To be decided against To be decided',
];

const SEVENTEEN_TEAMS = Array.from({ length: 17 }, (_, index) => `Team ${index + 1}`);

const cornersOf = (sections: Locator) =>
  sections.evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y } = element.getBoundingClientRect();
      return { x, y };
    }),
  );

const THREE_SETS = [
  { a: 21, b: 15 },
  { a: 18, b: 21 },
  { a: 15, b: 10 },
];
const THREE_SET_LINE = 'Score: 21–15, 18–21, 15–10';
const DELTA_V_ECHO = { round: 1, slot: 2 };

async function seedBracketTournament(
  teamNames: readonly string[],
  results: { game: { round: number; slot: number }; result: SeededResult }[] = [],
): Promise<string> {
  const tenant = await seedTenant({
    name: 'E2E Tournament Bracket',
    locations: [{ name: 'North Beach Sand Courts', address: ADDRESS }],
  });
  const path = await seedTournament(tenant, {
    locations: ['North Beach Sand Courts'],
    name: 'Labor Day Sand Slam',
    slug: 'labor-day-sand-slam',
    startDate: dateFromToday(30),
    endDate: dateFromToday(31),
    maximumTeams: 32,
  });
  await seedBestOfThree(tenant, 'labor-day-sand-slam');
  await seedBracket(tenant, 'labor-day-sand-slam', teamNames);
  for (const { game, result } of results) {
    await seedResult(tenant, 'labor-day-sand-slam', game, result);
  }
  return path;
}

test.describe('public tournament page: raw server HTML', () => {
  test(
    'a published tournament: 200, the public Cache-Control, the h1, division, dates, address, and the registration card before the details',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, open } = await seed();
      for (const query of ['', '?ott=SECRETtoken&page=2']) {
        const { status, headers, html } = await fetchRawHtml(request, `${open}${query}`);
        expect(status, query).toBe(200);
        expect(noSpaces(headers['cache-control']), query).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(headers['content-type'], query).toContain('text/html');
        expect(headers['netlify-vary'], query).toBe('query');
        expect(html.match(/<h1\b/g), query).toHaveLength(1);
        expect(textOf(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]), query).toBe(
          'Gulf Coast Beach Open',
        );
        expect(html, query).toContain('Coed · 2v2 · Open');
        expect(html, query).toContain(ADDRESS);
        expect(html, query).toMatch(/<time\b[^>]*datetime="\d{4}-\d{2}-\d{2}"/);
        const order = ['<h1', 'id="registration"', 'id="details-heading"', ADDRESS].map((marker) =>
          html.indexOf(marker),
        );
        expect(
          order.every((position) => position > 0),
          query,
        ).toBe(true);
        expect(order, query).toEqual([...order].sort((a, b) => a - b));
        const card = /<section\b[^>]*id="registration"[\s\S]*?<\/section>/.exec(html)?.[0];
        expect(textOf(card), query).toContain('Registration open · closes');
        expect(html, query).toContain(`href="${tenant.path}"`);
        expect(html, query).toContain(`<link rel="canonical" href="`);
        expect(html, query).toContain(`${open}"`);
        expect(html, query).not.toContain('SECRETtoken');
        expect(html, query).not.toContain('ott=');
      }
    },
  );

  test(
    'a tournament past its deadline: the card reads Registration closed',
    RAW_HTTP,
    async ({ request }) => {
      const { closed } = await seed();
      const { status, html } = await fetchRawHtml(request, closed);
      expect(status).toBe(200);
      const card = /<section\b[^>]*id="registration"[\s\S]*?<\/section>/.exec(html)?.[0];
      expect(textOf(card)).toContain('Registration closed');
      expect(textOf(card)).not.toContain('Registration open');
    },
  );

  test(
    'a tournament with a bracket: each round heading and every game with its seeds and teams are in the HTML, after the details',
    RAW_HTTP,
    async ({ request }) => {
      const { html } = await fetchRawHtml(request, await seedBracketTournament(BRACKET_TEAMS));
      const start = html.indexOf('id="bracket"');
      expect(start).toBeGreaterThan(html.indexOf('id="details-heading"'));
      const bracket = html.slice(start);
      const headings = [...bracket.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map(([, heading]) =>
        textOf(heading),
      );
      expect(headings).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
      const games = [
        ...bracket.matchAll(/<li\b[^>]*data-testid="bracket-game"[\s\S]*?<\/li>/g),
      ].map(([game]) => textOf(game));
      expect(games).toEqual(BRACKET_GAMES);
      expect(bracket).toContain('role="region"');
      expect(bracket).toContain('aria-label="Bracket rounds"');
      expect(bracket).toMatch(/tabindex="0"/);
    },
  );

  test(
    'a played game: its score line, with the screen-reader label, is in the HTML after both teams',
    RAW_HTTP,
    async ({ request }) => {
      const { html } = await fetchRawHtml(
        request,
        await seedBracketTournament(BRACKET_TEAMS, [
          { game: DELTA_V_ECHO, result: { score: { kind: 'sets', sets: THREE_SETS } } },
        ]),
      );
      const bracket = html.slice(html.indexOf('id="bracket"'));
      expect(bracket).toContain('21–15');
      expect(bracket).toContain('18–21');
      expect(bracket).toContain('Score:');
      const games = [
        ...bracket.matchAll(/<li\b[^>]*data-testid="bracket-game"[\s\S]*?<\/li>/g),
      ].map(([game]) => textOf(game));
      expect(games[1]).toBe(`Game 2: (4) Delta Won against (5) Echo ${THREE_SET_LINE}`);
      expect(games.filter((game) => game.includes('Score:'))).toHaveLength(1);
    },
  );

  test(
    'a forfeit: the line names the team that forfeited and no score is in the HTML',
    RAW_HTTP,
    async ({ request }) => {
      const { html } = await fetchRawHtml(
        request,
        await seedBracketTournament(BRACKET_TEAMS, [
          { game: DELTA_V_ECHO, result: { forfeitSide: 1 } },
        ]),
      );
      const bracket = html.slice(html.indexOf('id="bracket"'));
      const games = [
        ...bracket.matchAll(/<li\b[^>]*data-testid="bracket-game"[\s\S]*?<\/li>/g),
      ].map(([game]) => textOf(game));
      expect(games[1]).toBe('Game 2: (4) Delta Won against (5) Echo Echo forfeited');
      expect(bracket).not.toContain('Score:');
    },
  );

  test(
    'a bracket of two teams is one Final with both seeds and no bye in the HTML',
    RAW_HTTP,
    async ({ request }) => {
      const { html } = await fetchRawHtml(
        request,
        await seedBracketTournament(BRACKET_TEAMS.slice(0, 2)),
      );
      const bracket = html.slice(html.indexOf('id="bracket"'));
      const headings = [...bracket.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map(([, heading]) =>
        textOf(heading),
      );
      expect(headings).toEqual(['Final']);
      const games = [
        ...bracket.matchAll(/<li\b[^>]*data-testid="bracket-game"[\s\S]*?<\/li>/g),
      ].map(([game]) => textOf(game));
      expect(games).toEqual(['Game 1: (1) Alpha against (2) Bravo']);
    },
  );

  test(
    'a bracket of 17 teams has five rounds, 31 games, 15 byes, and one first-round game in the HTML',
    RAW_HTTP,
    async ({ request }) => {
      const { html } = await fetchRawHtml(request, await seedBracketTournament(SEVENTEEN_TEAMS));
      const bracket = html.slice(html.indexOf('id="bracket"'));
      const headings = [...bracket.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map(([, heading]) =>
        textOf(heading),
      );
      expect(headings).toEqual([
        'Round of 32',
        'Round of 16',
        'Quarterfinals',
        'Semifinals',
        'Final',
      ]);
      const games = [
        ...bracket.matchAll(/<li\b[^>]*data-testid="bracket-game"[\s\S]*?<\/li>/g),
      ].map(([game]) => textOf(game));
      expect(games).toHaveLength(31);
      expect(games.filter((game) => game.endsWith('against Bye'))).toHaveLength(15);
      expect(games).toContain('Game 2: (16) Team 16 against (17) Team 17');
    },
  );

  test(
    'a tournament without a bracket says where it will appear',
    RAW_HTTP,
    async ({ request }) => {
      const { open } = await seed();
      const { html } = await fetchRawHtml(request, open);
      const bracket = html.slice(html.indexOf('id="bracket"'));
      expect(textOf(bracket)).toContain('The bracket appears here once the organizer creates it.');
      expect(bracket).not.toContain('data-testid="bracket-game"');
    },
  );

  test(
    'a draft tournament, an unknown web address, and an unknown organization answer 404 with the not-found view and nothing about the draft',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, draft } = await seed();
      for (const path of [
        draft,
        `${tenant.path}/tournaments/no-such-tournament`,
        `/organizations/no-such-org-${tenant.slug}/tournaments/gulf-coast-beach-open`,
      ]) {
        const { status, headers, html } = await fetchRawHtml(request, path);
        expect(status, path).toBe(404);
        expect(noSpaces(headers['cache-control']), path).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(html, path).toMatch(/<h1\b[^>]*>\s*Page not found\s*<\/h1>/);
        expect(html, path).not.toMatch(/<link\b[^>]*rel="canonical"|property="og:/);
        expect(html, path).not.toContain('Secret Draft Open');
      }
    },
  );
});

test.describe('public tournament page: in the browser', () => {
  test('an open tournament shows the card first, passes the axe helper, and has no horizontal scroll', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { open } = await seed();
    const response = await page.goto(`${open}#registration`);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Gulf Coast Beach Open' }),
    ).toBeVisible();
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page.locator('#registration')).toContainText('Registration open · closes');
    await expect(page.locator('#registration').getByRole('link')).toHaveText(['Register a team']);
    await expect(page.getByText(ADDRESS)).toBeVisible();
    await expect(page).toHaveTitle(
      /^Gulf Coast Beach Open \| E2E Tournament Page [0-9a-f]+ \| Omni League$/,
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, 'tournament-open');
  });

  test('a tournament past its deadline shows Registration closed', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { closed } = await seed();
    await page.goto(closed);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page.locator('#registration')).toContainText('Registration closed');
    await expect(page.locator('#registration')).not.toContainText('Registration open');
    await expect(page.locator('#registration').getByRole('link')).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, 'tournament-closed');
  });

  test('a tournament without a bracket says where it will appear, and passes the axe helper', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { open } = await seed();
    await page.goto(open);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const section = page.locator('section#bracket');
    await expect(section.getByRole('heading', { level: 2, name: 'Bracket' })).toBeVisible();
    await expect(section).toContainText('The bracket appears here once the organizer creates it.');
    await expect(section.getByRole('region', { name: 'Bracket rounds' })).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, 'tournament-bracket-empty');
  });

  test('a bracket of five teams lists every game, and passes the axe helper', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    await page.goto(await seedBracketTournament(BRACKET_TEAMS));
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page.locator('section#bracket h3')).toHaveText([
      'Quarterfinals',
      'Semifinals',
      'Final',
    ]);
    const games = page.getByTestId('bracket-game');
    await expect(games).toHaveCount(BRACKET_GAMES.length);
    for (const [index, game] of BRACKET_GAMES.entries()) {
      expect(textOf(await games.nth(index).innerHTML()), game).toBe(game);
    }
    await expect(page.getByTestId('bracket-winner')).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, 'tournament-bracket');
  });

  test('a played game shows its three-set score, passes the axe helper, and does not scroll sideways at 320px', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    await page.goto(
      await seedBracketTournament(BRACKET_TEAMS, [
        { game: DELTA_V_ECHO, result: { score: { kind: 'sets', sets: THREE_SETS } } },
      ]),
    );
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const line = page.getByTestId('bracket-score');
    await expect(line).toHaveCount(1);
    await expect(line).toBeVisible();
    expect(textOf(await line.innerHTML())).toBe(THREE_SET_LINE);
    await expect(page.getByTestId('bracket-game').nth(1)).toHaveText(
      /Echo\s+Score: 21–15, 18–21, 15–10\s*$/,
    );
    await expectAccessible(page);
    expect(await checkReflow(page)).toMatchObject({ passed: true });
    await screenshot(page, testInfo, 'tournament-bracket-score');
  });

  // A bracket this tall fails the helper's focus-in-view walk, which asks for the focused region's centre on screen.
  test('17 teams make five rounds: at 1280px they are columns in a labelled scroller a keyboard scrolls, with the hint shown', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'a 1280px layout');
    await page.goto(await seedBracketTournament(SEVENTEEN_TEAMS));
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const scroller = page.getByRole('region', { name: 'Bracket rounds' });
    const rounds = scroller.locator('section');
    await expect(rounds).toHaveCount(5);
    await expect(scroller).toHaveAttribute('tabindex', '0');

    const columns = await cornersOf(rounds);
    expect(new Set(columns.map(({ y }) => y)).size).toBe(1);
    expect(columns.map(({ x }) => x)).toEqual([...columns.map(({ x }) => x)].sort((a, b) => a - b));
    expect(new Set(columns.map(({ x }) => x)).size).toBe(5);

    const hint = page.getByTestId('bracket-scroll-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('Scroll sideways for more rounds.');
    const sizes = await scroller.evaluate((el) => ({
      wide: el.scrollWidth,
      shown: el.clientWidth,
    }));
    expect(sizes.wide).toBeGreaterThan(sizes.shown);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1280,
    );

    await scroller.focus();
    await expect(scroller).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await scroller.evaluate((el) => {
      el.scrollLeft = 0;
    });
    await screenshot(page, testInfo, 'tournament-bracket-1280');
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
  });

  test('17 teams make five rounds: at 360px they stack, and the page does not scroll sideways at 320px', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'a 360px layout');
    await page.goto(await seedBracketTournament(SEVENTEEN_TEAMS));
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const rounds = page.getByRole('region', { name: 'Bracket rounds' }).locator('section');
    await expect(rounds).toHaveCount(5);
    await expect(page.getByTestId('bracket-scroll-hint')).toBeHidden();

    const stacked = await cornersOf(rounds);
    expect(new Set(stacked.map(({ x }) => x)).size).toBe(1);
    expect(stacked.map(({ y }) => y)).toEqual([...stacked.map(({ y }) => y)].sort((a, b) => a - b));
    expect(new Set(stacked.map(({ y }) => y)).size).toBe(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
    expect(await checkReflow(page)).toMatchObject({ passed: true });
    await screenshot(page, testInfo, 'tournament-bracket-360');
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
  });

  test('a bracket of two teams is one Final and passes the axe helper', async ({
    page,
    consoleGuard,
  }) => {
    await page.goto(await seedBracketTournament(BRACKET_TEAMS.slice(0, 2)));
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page.locator('section#bracket h3')).toHaveText(['Final']);
    const games = page.getByTestId('bracket-game');
    await expect(games).toHaveCount(1);
    expect(textOf(await games.first().innerHTML())).toBe('Game 1: (1) Alpha against (2) Bravo');
    await expect(page.getByText('Bye', { exact: true })).toHaveCount(0);
    await expectAccessible(page);
  });

  test('Tab reaches the labelled rounds, with a visible focus ring, and arrow keys never move the page sideways', async ({
    page,
    consoleGuard,
  }) => {
    await page.goto(await seedBracketTournament(BRACKET_TEAMS));
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const scroller = page.getByRole('region', { name: 'Bracket rounds' });
    const tab = tabKey(page);
    for (let press = 0; press < 80; press += 1) {
      if (await scroller.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press(tab);
    }
    await expect(scroller).toBeFocused();
    expect(await scroller.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(scroller).toBeFocused();
    const pageWidth = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      pageWidth,
    );
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });

  test('a small bracket fits the page, so the hint keeps its line and hides', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'a 1280px layout');
    await page.goto(await seedBracketTournament(BRACKET_TEAMS.slice(0, 3)));
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const hint = page.getByTestId('bracket-scroll-hint');
    await expect(hint).toHaveCSS('visibility', 'hidden');
    expect((await hint.boundingBox())?.height).toBeGreaterThan(0);
  });

  test.describe('a draft tournament', () => {
    test.use({ expectedDocumentStatus: 404 });

    test(
      'is the not-found view with a 404, and hydrates with no console error',
      VIEWPORT_AGNOSTIC,
      async ({ page, consoleGuard }) => {
        const { draft } = await seed();
        const response = await page.goto(draft);
        expect(response?.status()).toBe(404);
        await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
        await expect.poll(() => consoleGuard.hydrated).toBe(true);
      },
    );
  });
});
