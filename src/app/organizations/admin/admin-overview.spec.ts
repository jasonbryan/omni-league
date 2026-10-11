import { Title } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { AdminArea } from './admin-area';
import { AdminOverview } from './admin-overview';
import {
  adminRoutes,
  COASTAL,
  COASTAL_LOCATIONS,
  GET_ADMIN_CONTEXT,
  LIST_FOR_ADMIN,
  ME,
  openAdmin,
  text,
} from './testing/admin-harness';

// Overview (#65, #66), design/mockups/65-organization-admin-locations.html states 1 and 2 and
// design/mockups/66-69-organization-leagues.html (decision 2).

const ROUTES = adminRoutes(AdminArea, [{ path: '', component: AdminOverview }]);
const URL = `/app/organizations/${COASTAL.slug}`;
// The Leagues tile and the "Get set up" rule read the organization's counter (#172), not the admin
// list, which stops at 200 rows.
const PUBLISHED_COUNT = 'leagues:publishedCount';

async function open() {
  const opened = await openAdmin(ROUTES, URL);
  opened.acceptToken();
  opened.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
  await opened.flush();
  return opened;
}

describe('AdminOverview', () => {
  it('shows the organization, the h1 "Overview", and "View public page"', async () => {
    const { page } = await open();
    const main = page.querySelector('main')!;
    expect(text(main.querySelector('p.text-sm.font-medium'))).toBe('Coastal Bend Rec Club');
    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(text(main.querySelector('h1'))).toBe('Overview');
    const link = main.querySelector<HTMLAnchorElement>(
      'a[href="/organizations/coastal-bend-rec-club"]',
    );
    expect(text(link)).toBe('View public page');
    expect(link?.getAttribute('data-slot')).toBe('button');
  });

  it('sets the title to "Overview | <organization> | Omni League"', async () => {
    await open();
    expect(TestBed.inject(Title).getTitle()).toBe('Overview | Coastal Bend Rec Club | Omni League');
  });

  it('asks the location list and the published-league counter with the organization id, and not the league list', async () => {
    const { convex, subscription } = await open();
    expect(convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([
      [GET_ADMIN_CONTEXT, { slug: COASTAL.slug }],
      [ME, {}],
      [LIST_FOR_ADMIN, { organizationId: COASTAL.organizationId }],
      [PUBLISHED_COUNT, { organizationId: COASTAL.organizationId }],
    ]);
    expect(subscription(LIST_FOR_ADMIN)).toBeDefined();
  });

  it('with no locations the Locations tile reads 0 and "None yet"', async () => {
    const { page, subscription, flush } = await open();
    subscription(LIST_FOR_ADMIN)!.emit([]);
    await flush();
    const tiles = [...page.querySelectorAll('main dl > div')];
    expect(tiles.map((tile) => text(tile.querySelector('dt')))).toEqual(['Locations', 'Leagues']);
    const [count, note] = [...tiles[0].querySelectorAll('dd')].map(text);
    expect([count, note]).toEqual(['0', 'None yet']);
  });

  it('with locations the tile reads the count and "All on your public page"', async () => {
    const { page, subscription, flush } = await open();
    subscription(LIST_FOR_ADMIN)!.emit(COASTAL_LOCATIONS.slice(0, 2));
    await flush();
    const [count, note] = [...page.querySelectorAll('main dl dd')].map(text);
    expect([count, note]).toEqual(['2', 'All on your public page']);
  });

  describe('the Leagues tile', () => {
    const tile = (page: HTMLElement) =>
      [...page.querySelectorAll('main dl > div')][1].querySelectorAll('dd');

    it('with none published, reads 0 and "None published yet"', async () => {
      const { page, subscription, flush } = await open();
      subscription(PUBLISHED_COUNT)!.emit(0);
      await flush();
      expect([...tile(page)].map(text)).toEqual(['0', 'None published yet']);
    });

    it('reads the counter, past the admin list’s 200 rows, and says they are on the public page', async () => {
      const { page, subscription, flush } = await open();
      subscription(PUBLISHED_COUNT)!.emit(450);
      await flush();
      expect([...tile(page)].map(text)).toEqual(['450', 'On your public page']);
    });

    it('follows the counter live as a league is published', async () => {
      const { page, subscription, flush } = await open();
      subscription(PUBLISHED_COUNT)!.emit(1);
      await flush();
      expect([...tile(page)].map(text)).toEqual(['1', 'On your public page']);
      subscription(PUBLISHED_COUNT)!.emit(2);
      await flush();
      expect([...tile(page)].map(text)).toEqual(['2', 'On your public page']);
    });

    it('draws a placeholder while the counter loads, and "–" with a note when it fails', async () => {
      const { page, subscription, flush } = await open();
      expect(text(tile(page)[0])).toBe('');
      expect(tile(page)[0].querySelector('[aria-hidden="true"]')).not.toBeNull();
      subscription(PUBLISHED_COUNT)!.fail(new Error('Server Error: secret'));
      await flush();
      expect([...tile(page)].map(text)).toEqual(['–', 'Could not be loaded']);
      expect(page.textContent).not.toContain('secret');
    });
  });

  it('draws a placeholder in place of the count while the list loads, and no number', async () => {
    const { page } = await open();
    const dd = page.querySelector('main dl dd')!;
    expect(text(dd)).toBe('');
    expect(dd.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('shows "–" and a note when the list fails, never the error message', async () => {
    const { page, subscription, flush } = await open();
    subscription(LIST_FOR_ADMIN)!.fail(new Error('Server Error: secret'));
    await flush();
    const [count, note] = [...page.querySelectorAll('main dl dd')].map(text);
    expect([count, note]).toEqual(['–', 'Could not be loaded']);
    expect(page.textContent).not.toContain('secret');
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

    it('with no league lists the steps: Add a location and Create a league link on, Publish the league does not', async () => {
      const { page } = await openWith(0);
      expect(text(section(page)!.querySelector('h2#setup-heading'))).toBe('Get set up');
      expect(steps(page).map((li) => text(li.querySelector('h3')))).toEqual([
        'Add a location',
        'Create a league',
        'Publish the league',
      ]);
      expect(steps(page).map((li) => text(li.querySelector('[aria-hidden="true"]')))).toEqual([
        '1',
        '2',
        '3',
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
      const links = steps(page).map((li) => {
        const a = li.querySelector('a');
        return a ? [text(a), a.getAttribute('href')] : null;
      });
      expect(links).toEqual([
        ['Add a location', `/app/organizations/${COASTAL.slug}/locations`],
        ['Create a league', `/app/organizations/${COASTAL.slug}/leagues`],
        null,
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
});
