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

// Overview (#65), design/mockups/65-organization-admin-locations.html states 1 and 2.

const ROUTES = adminRoutes(AdminArea, [{ path: '', component: AdminOverview }]);
const URL = `/app/organizations/${COASTAL.slug}`;

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

  it('counts locations from locations.listForAdmin, asked with the organization id and no new query', async () => {
    const { convex, subscription } = await open();
    expect(convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([
      [GET_ADMIN_CONTEXT, { slug: COASTAL.slug }],
      [ME, {}],
      [LIST_FOR_ADMIN, { organizationId: COASTAL.organizationId }],
    ]);
    expect(subscription(LIST_FOR_ADMIN)).toBeDefined();
  });

  it('with no locations the Locations tile reads 0 and "None yet"', async () => {
    const { page, subscription, flush } = await open();
    subscription(LIST_FOR_ADMIN)!.emit([]);
    await flush();
    const tiles = [...page.querySelectorAll('main dl > div')];
    expect(tiles).toHaveLength(1);
    expect(text(tiles[0].querySelector('dt'))).toBe('Locations');
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
    it('lists the step whose page exists, linking Add a location to Locations', async () => {
      const { page, subscription, flush } = await open();
      subscription(LIST_FOR_ADMIN)!.emit([]);
      await flush();
      const section = page.querySelector('section[aria-labelledby="setup-heading"]')!;
      expect(text(section.querySelector('h2#setup-heading'))).toBe('Get set up');
      const steps = [...section.querySelectorAll('ol > li')];
      expect(steps).toHaveLength(1);
      expect(text(steps[0].querySelector('h3'))).toBe('Add a location');
      expect(text(steps[0].querySelector('p'))).toBe(
        'Where your leagues play. Visitors see it on your public page.',
      );
      const link = steps[0].querySelector('a')!;
      expect(text(link)).toBe('Add a location');
      expect(link.getAttribute('href')).toBe(`/app/organizations/${COASTAL.slug}/locations`);
      expect(text(steps[0].querySelector('[aria-hidden="true"]'))).toBe('1');
    });

    it('is shown with locations too: #66 adds the rule that hides it', async () => {
      const { page, subscription, flush } = await open();
      subscription(LIST_FOR_ADMIN)!.emit(COASTAL_LOCATIONS);
      await flush();
      expect(page.querySelector('section[aria-labelledby="setup-heading"]')).not.toBeNull();
    });
  });
});
