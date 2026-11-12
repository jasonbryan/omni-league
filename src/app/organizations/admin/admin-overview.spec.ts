import { Title } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { expectBareCards } from '../../ui/testing/card';
import { expectSkeletonBoxes } from '../../ui/testing/skeleton-boxes';
import { AdminArea } from './admin-area';
import { AdminOverview } from './admin-overview';
import {
  adminRoutes,
  COASTAL,
  GET_ADMIN_CONTEXT,
  LIST_FOR_ADMIN,
  openAdmin,
  text,
  expectPageAndShellSubscriptions,
} from './testing/admin-harness';

const ROUTES = adminRoutes(AdminArea, [{ path: '', component: AdminOverview }]);
const URL = `/app/organizations/${COASTAL.slug}`;
// The "Get set up" rule and the header counts read the organization's counters, not the admin list, which stops at 200 rows.
const PUBLISHED_COUNT = 'leagues:publishedCount';
const DRAFT_COUNT = 'leagues:draftCount';
const STAFF_COUNT = 'memberships:staffCount';
const ATTENTION = 'organizations:getAttention';
const OPEN_SEASONS = 'seasons:listOpenForOrganization';

async function open() {
  const opened = await openAdmin(ROUTES, URL);
  opened.acceptToken();
  opened.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
  await opened.flush();
  return opened;
}

describe('AdminOverview', () => {
  // A saved copy of an earlier test's answer would fill a section that is still loading.
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('shows the h1 "Overview" and no count tile', async () => {
    const { page } = await open();
    const main = page.querySelector('main')!;
    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(text(main.querySelector('h1'))).toBe('Overview');
    expect(main.querySelector('dl')).toBeNull();
    expect(main.textContent).not.toContain('Locations');
  });

  it('sets the title to "Overview | <organization> | Omni League"', async () => {
    await open();
    expect(TestBed.inject(Title).getTitle()).toBe('Overview | Coastal Bend Rec Club | Omni League');
  });

  it('asks the counters, the attention list, and the open seasons, and no pending-invite counter', async () => {
    const { convex, subscription } = await open();
    expectPageAndShellSubscriptions(convex, [
      [GET_ADMIN_CONTEXT, { slug: COASTAL.slug }],
      [LIST_FOR_ADMIN, { organizationId: COASTAL.organizationId }],
      [PUBLISHED_COUNT, { organizationId: COASTAL.organizationId }],
      [DRAFT_COUNT, { organizationId: COASTAL.organizationId }],
      [STAFF_COUNT, { organizationId: COASTAL.organizationId }],
      [ATTENTION, { organizationId: COASTAL.organizationId }],
      [OPEN_SEASONS, { orgSlug: COASTAL.slug }],
    ]);
    expect(subscription(ATTENTION)).toBeDefined();
    expect(convex.activeSubscriptions.map((s) => s.name)).not.toContain('invites:pendingCount');
  });

  it('draws the setup, attention, and open-seasons panels as bare helm cards', async () => {
    const { page, subscription, flush } = await open();
    subscription(LIST_FOR_ADMIN)!.emit([]);
    subscription(PUBLISHED_COUNT)!.emit(0);
    await flush();
    expectBareCards(page.querySelector('main')!, [
      'overflow-hidden',
      'overflow-hidden',
      'overflow-hidden',
    ]);
  });

  describe('the header', () => {
    it('draws the counts placeholder through the skeleton, rounded-md', async () => {
      const { page } = await open();
      expectSkeletonBoxes(page.querySelector('[data-slot="overview-counts"]')!, {
        'rounded-md': 1,
      });
    });

    const summary = (page: HTMLElement) => page.querySelector('[data-slot="overview-counts"]');
    const links = (page: HTMLElement) =>
      [...summary(page)!.querySelectorAll('a')].map((a) => [text(a), a.getAttribute('href')]);

    async function openWithCounts(
      published: number,
      drafts: number,
      locations: number,
      staff: number,
    ) {
      const opened = await open();
      opened.subscription(PUBLISHED_COUNT)!.emit(published);
      opened.subscription(DRAFT_COUNT)!.emit(drafts);
      opened.subscription(LIST_FOR_ADMIN)!.emit(
        Array.from({ length: locations }, (_, i) => ({
          locationId: `loc_${i}`,
          name: `Location ${i}`,
          address: '1 Main St',
        })),
      );
      opened.subscription(STAFF_COUNT)!.emit(staff);
      await opened.flush();
      return opened;
    }

    it('links the league, location, and staff counts to their pages', async () => {
      const { page } = await openWithCounts(3, 2, 3, 4);
      expect(links(page)).toEqual([
        ['5 leagues', `/app/organizations/${COASTAL.slug}/leagues`],
        ['3 locations', `/app/organizations/${COASTAL.slug}/locations`],
        ['4 staff', `/app/organizations/${COASTAL.slug}/staff`],
      ]);
    });

    it('counts a draft league with the published ones, from the counters', async () => {
      const { page } = await openWithCounts(450, 320, 1, 1);
      expect(links(page).map(([label]) => label)).toEqual(['770 leagues', '1 location', '1 staff']);
    });

    it('draws a placeholder of the loaded height until every count has loaded', async () => {
      const { page, subscription, flush } = await open();
      expect(summary(page)!.querySelector('a')).toBeNull();
      expect(summary(page)!.querySelector('[aria-hidden="true"]')).not.toBeNull();
      subscription(PUBLISHED_COUNT)!.emit(1);
      subscription(DRAFT_COUNT)!.emit(0);
      subscription(STAFF_COUNT)!.emit(2);
      await flush();
      expect(summary(page)!.querySelector('a')).toBeNull();
      subscription(LIST_FOR_ADMIN)!.emit([]);
      await flush();
      expect(links(page)).toHaveLength(3);
    });

    it('leaves out a count that could not be loaded, never showing the error message', async () => {
      const { page, subscription, flush } = await openWithCounts(1, 0, 1, 1);
      subscription(STAFF_COUNT)!.fail(new Error('Server Error: secret'));
      await flush();
      expect(links(page).map(([label]) => label)).toEqual(['1 league', '1 location']);
      expect(page.textContent).not.toContain('secret');
    });

    it('has "Create a league" as the one primary action, linking to the create form on Leagues', async () => {
      const { page } = await open();
      const main = page.querySelector('main')!;
      const primary = [...main.querySelectorAll<HTMLAnchorElement>('a[data-slot="button"]')].filter(
        (a) => a.className.includes('bg-primary'),
      );
      expect(primary.map(text)).toEqual(['Create a league']);
      expect(primary[0].getAttribute('href')).toBe(
        `/app/organizations/${COASTAL.slug}/leagues#create-league`,
      );
    });
  });

  describe('"Get set up" (state 2)', () => {
    const section = (page: HTMLElement) =>
      page.querySelector('section[aria-labelledby="setup-heading"]');
    const steps = (page: HTMLElement) => [...section(page)!.querySelectorAll('ol > li')];

    async function openWith(published: number | undefined) {
      const opened = await open();
      opened.subscription(LIST_FOR_ADMIN)!.emit([]);
      if (published !== undefined) opened.subscription(PUBLISHED_COUNT)!.emit(published);
      await opened.flush();
      return opened;
    }

    it('with no league lists the steps: Add a location, Create a league, and Invite staff link on, Publish the league does not', async () => {
      const { page } = await openWith(0);
      expect(text(section(page)!.querySelector('h2#setup-heading'))).toBe('Get set up');
      expect(steps(page).map((li) => text(li.querySelector('h3')))).toEqual([
        'Add a location',
        'Create a league',
        'Publish the league',
        'Invite staff (optional)',
      ]);
      expect(steps(page).map((li) => text(li.querySelector('[aria-hidden="true"]')))).toEqual([
        '1',
        '2',
        '3',
        '4',
      ]);
      expect(text(steps(page)[0].querySelector('p'))).toBe(
        'Where your leagues play. Visitors see it on your public page.',
      );
      expect(text(steps(page)[1].querySelector('p'))).toBe(
        'Choose its sport and locations. It starts as a draft, so only your staff see it.',
      );
      expect(text(steps(page)[2].querySelector('p'))).toBe(
        'Publishing puts it on your public page.',
      );
      expect(text(steps(page)[3].querySelector('p'))).toBe(
        'Add another org admin, or a league organizer for the leagues you choose.',
      );
      const links = steps(page).map((li) => {
        const a = li.querySelector('a');
        return a ? [text(a), a.getAttribute('href')] : null;
      });
      expect(links).toEqual([
        ['Add a location', `/app/organizations/${COASTAL.slug}/locations`],
        ['Create a league', `/app/organizations/${COASTAL.slug}/leagues#create-league`],
        null,
        ['Invite staff', `/app/organizations/${COASTAL.slug}/staff`],
      ]);
    });

    it('with only drafts (none published) the list is still shown', async () => {
      const { page } = await openWith(0);
      expect(section(page)).not.toBeNull();
    });

    it('hides once any league is published', async () => {
      const { page } = await openWith(1);
      expect(section(page)).toBeNull();
    });

    it('hides on the counter alone, however many leagues the admin list could hold', async () => {
      const { page } = await openWith(450);
      expect(section(page)).toBeNull();
    });

    it('hides as a league is published (live)', async () => {
      const { page, subscription, flush } = await openWith(0);
      expect(section(page)).not.toBeNull();
      subscription(PUBLISHED_COUNT)!.emit(1);
      await flush();
      expect(section(page)).toBeNull();
    });

    it('is not drawn while the counter loads, so an established organization never flashes it', async () => {
      const { page } = await openWith(undefined);
      expect(section(page)).toBeNull();
    });

    it('is shown when the counter fails to load', async () => {
      const { page, subscription, flush } = await openWith(undefined);
      subscription(PUBLISHED_COUNT)!.fail(new Error('x'));
      await flush();
      expect(section(page)).not.toBeNull();
    });
  });

  describe('Needs your attention', () => {
    const NOW = Date.parse('2027-08-10T18:00:00Z');
    const BASE = `/app/organizations/${COASTAL.slug}`;
    const NONE = { total: 0, capped: false };

    const draft = (seasonId: string, name: string, leagueName: string, leagueSlug: string) => ({
      seasonId,
      name,
      leagueName,
      leagueSlug,
    });
    const FALL_SUNDAY = draft(
      's1',
      'Fall 2027',
      'Sunday Reverse Coed 4s',
      'sunday-reverse-coed-4s',
    );
    const FALL_COED = draft('s2', 'Fall 2027', 'Coed 7v7 Rec', 'coed-7v7-rec');
    const OVER_30 = { leagueId: 'l1', name: "Men's Over-30 11v11", slug: 'mens-over-30-11v11' };

    const FOUR_ITEMS = {
      draftSeasons: { items: [FALL_SUNDAY, FALL_COED], total: 2, capped: false },
      leaguesWithoutSeason: { items: [OVER_30], total: 1, capped: false },
      pendingInvites: {
        soonest: [
          { email: 'jamie.ortiz@example.test', expiresAt: Date.parse('2027-10-17T18:00:00Z') },
        ],
        total: 1,
        capped: false,
      },
    };
    const EMPTY = {
      draftSeasons: { items: [], ...NONE },
      leaguesWithoutSeason: { items: [], ...NONE },
      pendingInvites: { soonest: [], ...NONE },
    };

    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: NOW }));
    afterEach(() => vi.useRealTimers());

    async function openWith(attention: unknown) {
      const opened = await open();
      if (attention !== undefined) opened.subscription(ATTENTION)!.emit(attention);
      await opened.flush();
      return opened;
    }

    const section = (page: HTMLElement) =>
      page.querySelector<HTMLElement>('section[aria-labelledby="attention-heading"]')!;
    const items = (page: HTMLElement) => [...section(page).querySelectorAll(':scope > ul > li')];

    it('lists draft seasons, then leagues with no season, then the invites item, each with its action', async () => {
      const { page } = await openWith(FOUR_ITEMS);
      expect(items(page).map((li) => [...li.querySelectorAll('p')].map(text))).toEqual([
        [
          'Fall 2027 is a draft',
          "Sunday Reverse Coed 4s · players can't see it until you publish it",
        ],
        ['Fall 2027 is a draft', "Coed 7v7 Rec · players can't see it until you publish it"],
        ["Men's Over-30 11v11 has no season", 'Create one so players can register'],
        ['1 staff invite is pending', 'jamie.ortiz@example.test · expires Oct 17'],
      ]);
      expect(
        items(page).map((li) => {
          const a = li.querySelector('a')!;
          return [text(a), a.getAttribute('href'), a.getAttribute('data-slot')];
        }),
      ).toEqual([
        [
          'Review Fall 2027, Sunday Reverse Coed 4s',
          `${BASE}/leagues/sunday-reverse-coed-4s`,
          'button',
        ],
        ['Review Fall 2027, Coed 7v7 Rec', `${BASE}/leagues/coed-7v7-rec`, 'button'],
        [
          "Create a season for Men's Over-30 11v11",
          `${BASE}/leagues/mens-over-30-11v11#create-season`,
          'button',
        ],
        ['Open Staff', `${BASE}/staff`, 'button'],
      ]);
    });

    it('names each repeated action by its season and league, so two reviews differ', async () => {
      const { page } = await openWith(FOUR_ITEMS);
      const names = [...section(page).querySelectorAll('a')].map(text);
      expect(new Set(names).size).toBe(names.length);
      expect(items(page)[0].querySelector('a .sr-only')?.textContent).toBe(
        ' Fall 2027, Sunday Reverse Coed 4s',
      );
    });

    it('has an h2 heading whose count is read as "4 items"', async () => {
      const { page } = await openWith(FOUR_ITEMS);
      const heading = section(page).querySelector('h2')!;
      expect(text(heading)).toBe('Needs your attention');
      const count = heading.parentElement!.querySelector('[data-slot="attention-count"]')!;
      expect(text(count.querySelector('[aria-hidden="true"]'))).toBe('4');
      expect(text(count.querySelector('.sr-only'))).toBe('4 items');
    });

    it('reads the count as "100+" and "more than 100 items" when a kind passes its cap', async () => {
      const { page } = await openWith({
        ...EMPTY,
        draftSeasons: { items: [FALL_SUNDAY], total: 100, capped: true },
      });
      const count = section(page).querySelector('[data-slot="attention-count"]')!;
      expect(text(count.querySelector('[aria-hidden="true"]'))).toBe('100+');
      expect(text(count.querySelector('.sr-only'))).toBe('more than 100 items');
    });

    it('says "and 5 more" after 20 of 25 draft seasons, and "and 80+ more" past the cap', async () => {
      const twenty = Array.from({ length: 20 }, (_, i) =>
        draft(`s${i}`, `Season ${i}`, 'League', 'league'),
      );
      const { page, subscription, flush } = await openWith({
        ...EMPTY,
        draftSeasons: { items: twenty, total: 25, capped: false },
      });
      expect(items(page)).toHaveLength(21);
      expect(text(items(page)[20])).toBe('and 5 more');
      subscription(ATTENTION)!.emit({
        ...EMPTY,
        draftSeasons: { items: twenty, total: 100, capped: true },
      });
      await flush();
      expect(text(items(page)[20])).toBe('and 80+ more');
    });

    it('puts the "and N more" line after its own kind', async () => {
      const twenty = Array.from({ length: 20 }, (_, i) => ({
        leagueId: `l${i}`,
        name: `League ${i}`,
        slug: `league-${i}`,
      }));
      const { page } = await openWith({
        ...FOUR_ITEMS,
        leaguesWithoutSeason: { items: twenty, total: 23, capped: false },
      });
      const rows = items(page).map(text);
      expect(rows[22]).toBe('and 3 more');
      expect(rows[23]).toContain('1 staff invite is pending');
    });

    it('says only the first 100 published leagues are checked when the leagues are capped and every found one is shown', async () => {
      const found = Array.from({ length: 5 }, (_, i) => ({
        leagueId: `l${i}`,
        name: `League ${i}`,
        slug: `league-${i}`,
      }));
      const { page } = await openWith({
        ...EMPTY,
        leaguesWithoutSeason: { items: found, total: 5, capped: true },
      });
      expect(text(items(page)[5])).toBe('Only the first 100 published leagues are checked.');
      const count = section(page).querySelector('[data-slot="attention-count"]')!;
      expect(text(count.querySelector('[aria-hidden="true"]'))).toBe('5+');
      expect(text(count.querySelector('.sr-only'))).toBe('5 or more items');
    });

    it('lists the invites with "expired" for one past its expiry, and the plural for more than one', async () => {
      const { page } = await openWith({
        ...EMPTY,
        pendingInvites: {
          soonest: [
            { email: 'old@example.test', expiresAt: Date.parse('2027-08-01T18:00:00Z') },
            { email: 'new@example.test', expiresAt: Date.parse('2027-10-17T18:00:00Z') },
          ],
          total: 5,
          capped: false,
        },
      });
      expect(text(items(page)[0].querySelector('p'))).toBe('5 staff invites are pending');
      expect([...items(page)[0].querySelectorAll('p')].slice(1).map(text)).toEqual([
        'old@example.test · expired Aug 1',
        'new@example.test · expires Oct 17',
      ]);
    });

    it('says "Nothing needs your attention." with no count when there is nothing to do', async () => {
      const { page } = await openWith(EMPTY);
      expect([...section(page).children].map(text)).toEqual([
        'Needs your attention',
        'Nothing needs your attention.',
      ]);
      expect(section(page).querySelector('[data-slot="attention-count"]')).toBeNull();
      expect(section(page).querySelector('ul')).toBeNull();
    });

    it('draws the loading rows through the skeleton, each with its own radius', async () => {
      const { page } = await openWith(undefined);
      expectSkeletonBoxes(section(page), { 'rounded-lg': 4, 'rounded-md': 4 });
    });

    it('draws a skeleton with a status for the loading section and no count', async () => {
      const { page } = await openWith(undefined);
      expect(text(section(page).querySelector('[role="status"]'))).toBe(
        'Loading what needs your attention.',
      );
      expect(section(page).querySelector('[data-slot="attention-count"]')).toBeNull();
      expect(text(section(page))).not.toContain('Nothing needs your attention.');
    });

    it('shows an alert with "Try again" in this section when the list fails, never the error message, and the other section stays', async () => {
      const { page, subscription, flush } = await openWith(undefined);
      subscription(OPEN_SEASONS)!.emit([]);
      subscription(ATTENTION)!.fail(new Error('Server Error: secret'));
      await flush();
      const alert = section(page).querySelector('[role="alert"]')!;
      expect(text(alert)).toContain('Needs your attention could not be loaded.');
      expect(alert.querySelector('a')?.getAttribute('href')).toBe(BASE);
      expect(text(alert.querySelector('a'))).toBe('Try again');
      expect(page.textContent).not.toContain('secret');
      expect(page.textContent).toContain('No season is open for registration.');
    });

    it('follows a published league live: the "no season" item goes when its season is created', async () => {
      const { page, subscription, flush } = await openWith(FOUR_ITEMS);
      subscription(ATTENTION)!.emit({
        ...FOUR_ITEMS,
        leaguesWithoutSeason: { items: [], ...NONE },
      });
      await flush();
      expect(items(page)).toHaveLength(3);
    });
  });

  describe('Registration open', () => {
    // 18:00 UTC is 06:00 the same date at UTC-12.
    const at = (date: string) => Date.parse(`${date}T18:00:00Z`);
    const BASE = `/app/organizations/${COASTAL.slug}`;
    const row = (
      leagueName: string,
      leagueSlug: string,
      name: string,
      slug: string,
      deadline: string,
    ) => ({
      name,
      slug,
      startDate: '2027-06-01',
      endDate: '2027-08-30',
      registrationDeadline: deadline,
      minimumRosterSize: 4,
      isFull: false,
      league: { name: leagueName, slug: leagueSlug, sportName: 'Soccer', locationNames: [] },
    });
    const SUNDAY = row(
      'Sunday Reverse Coed 4s',
      'sunday-reverse-coed-4s',
      'Summer 2027',
      'summer-2027',
      '2027-05-23',
    );
    const COED = row('Coed 7v7 Rec', 'coed-7v7-rec', 'Summer 2027', 'summer-2027', '2027-05-19');

    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: at('2027-05-01') }));
    afterEach(() => vi.useRealTimers());

    const section = (page: HTMLElement) =>
      page.querySelector<HTMLElement>('section[aria-labelledby="open-heading"]')!;

    async function openWith(rows: unknown) {
      const opened = await open();
      if (rows !== undefined) opened.subscription(OPEN_SEASONS)!.emit(rows);
      await opened.flush();
      return opened;
    }

    it('lists each open season soonest deadline first as "<league> · <season>" with "Closes <date>"', async () => {
      const { page } = await openWith([SUNDAY, COED]);
      expect(text(section(page).querySelector('h2'))).toBe('Registration open');
      const rows = [...section(page).querySelectorAll('li')];
      expect(rows.map((li) => [...li.querySelectorAll('p')].map(text))).toEqual([
        ['Coed 7v7 Rec · Summer 2027', 'Closes May 19, 2027'],
        ['Sunday Reverse Coed 4s · Summer 2027', 'Closes May 23, 2027'],
      ]);
      expect(rows.map((li) => li.querySelector('a')!.getAttribute('href'))).toEqual([
        `${BASE}/leagues/coed-7v7-rec/seasons/summer-2027`,
        `${BASE}/leagues/sunday-reverse-coed-4s/seasons/summer-2027`,
      ]);
    });

    it('leaves out a season whose registration has closed at the viewer time', async () => {
      vi.setSystemTime(at('2027-05-20'));
      const { page } = await openWith([SUNDAY, COED]);
      const rows = [...section(page).querySelectorAll('li')];
      expect(rows.map((li) => text(li.querySelector('p')))).toEqual([
        'Sunday Reverse Coed 4s · Summer 2027',
      ]);
    });

    it('says "No season is open for registration." when none is', async () => {
      const { page } = await openWith([]);
      expect([...section(page).children].map(text)).toEqual([
        'Registration open',
        'No season is open for registration.',
      ]);
      expect(section(page).querySelector('ul')).toBeNull();
    });

    it('draws the loading rows through the skeleton, rounded-md', async () => {
      const { page } = await openWith(undefined);
      expectSkeletonBoxes(section(page), { 'rounded-md': 4 });
    });

    it('draws a skeleton with a status while loading, and no empty text', async () => {
      const { page } = await openWith(undefined);
      expect(text(section(page).querySelector('[role="status"]'))).toBe(
        'Loading the seasons open for registration.',
      );
      expect(text(section(page))).not.toContain('No season is open');
    });

    it('shows an alert with "Try again" in this section when the query fails, and the other section stays', async () => {
      const { page, subscription, flush } = await openWith(undefined);
      subscription(ATTENTION)!.emit({
        draftSeasons: { items: [], total: 0, capped: false },
        leaguesWithoutSeason: { items: [], total: 0, capped: false },
        pendingInvites: { soonest: [], total: 0, capped: false },
      });
      subscription(OPEN_SEASONS)!.fail(new Error('Server Error: secret'));
      await flush();
      const alert = section(page).querySelector('[role="alert"]')!;
      expect(text(alert)).toContain('Registration open could not be loaded.');
      expect(text(alert.querySelector('a'))).toBe('Try again');
      expect(page.textContent).not.toContain('secret');
      expect(page.textContent).toContain('Nothing needs your attention.');
    });

    it('has an h2 heading, as do Get set up and Needs your attention', async () => {
      const { page, subscription, flush } = await open();
      subscription(PUBLISHED_COUNT)!.emit(0);
      await flush();
      expect([...page.querySelectorAll('main h2')].map((h) => h.tagName + text(h))).toEqual([
        'H2Get set up',
        'H2Needs your attention',
        'H2Registration open',
      ]);
    });
  });
});
