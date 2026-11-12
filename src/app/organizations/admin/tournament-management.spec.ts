import { TestBed } from '@angular/core/testing';
import { By, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { ConvexOfflineError } from '../../core/data/convex';
import { expectBadgeSize } from '../../ui/testing/badge';
import { expectBareCards } from '../../ui/testing/card';
import { expectSkeletonBoxes } from '../../ui/testing/skeleton-boxes';
import { AdminArea } from './admin-area';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { TournamentManagement } from './tournament-management';
import {
  adminRoutes,
  COASTAL,
  expectPageAndShellSubscriptions,
  forbiddenError,
  GET_ADMIN_CONTEXT,
  openAdmin,
  text,
} from './testing/admin-harness';

const ROUTES = adminRoutes(AdminArea, [
  { path: 'tournaments/:tournamentSlug', component: TournamentManagement },
]);
const BASE = `/app/organizations/${COASTAL.slug}/tournaments`;
const URL = `${BASE}/winter-doubles-classic`;
const GET = 'tournaments:getForManagement';
const PUBLISH = 'tournaments:publish';
const ARGS = { orgSlug: COASTAL.slug, tournamentSlug: 'winter-doubles-classic' };
const tokens = (value: string) => value.split(' ').sort();

const DRAFT = {
  tournamentId: 'tn_winter',
  status: 'draft',
  organization: { name: COASTAL.name, slug: COASTAL.slug },
  name: 'Winter Doubles Classic',
  slug: 'winter-doubles-classic',
  sportName: 'Beach volleyball',
  divisionLabel: 'Coed · 2v2 · Open',
  locations: [
    {
      name: 'Pelican Shoals Sand Courts',
      address: '2150 Pelican Shoals Dr, Corpus Christi, TX 78418',
    },
  ],
  startDate: '2027-01-16',
  endDate: '2027-01-17',
  registrationDeadline: '2027-01-09',
  minimumRosterSize: 2,
  maximumTeams: 16,
};
const PUBLISHED = { ...DRAFT, status: 'published' };

describe('TournamentManagement', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(result?: unknown, url = URL) {
    o = await openAdmin(ROUTES, url);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
    await o.flush();
    if (result !== undefined) o.subscription(GET)!.emit(result);
    await o.flush();
  }

  const main = () => page.querySelector('main')!;
  const publishButton = () =>
    main().querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
  const dialogButton = (label: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      text(b)?.startsWith(label),
    )!;
  const buttonLink = (label: string) =>
    [...main().querySelectorAll<HTMLAnchorElement>('a[data-slot="button"]')].find(
      (a) => text(a) === label,
    ) ?? null;
  const notice = () => page.querySelector<HTMLElement>('main [data-slot="alert"][role="status"]');
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);
  const details = () =>
    [...page.querySelectorAll('dl > div')].map((row) => [
      text(row.querySelector('dt')),
      [...row.querySelectorAll('dd')].map(text),
    ]);

  async function pressPublish() {
    publishButton()!.click();
    await o.flush();
  }

  async function confirmAndPublish() {
    dialogButton('Publish tournament').click();
    await o.flush();
    o.convex.calls[0].resolve(null);
    o.subscription(GET)!.emit(PUBLISHED);
    await o.flush();
  }

  describe('the page', () => {
    it('asks tournaments.getForManagement with the route’s slugs, only after the context says ready', async () => {
      o = await openAdmin(ROUTES, URL);
      o.acceptToken();
      expect(o.subscription(GET)).toBeUndefined();
      o.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
      await o.flush();
      expectPageAndShellSubscriptions(o.convex, [
        [GET_ADMIN_CONTEXT, { slug: COASTAL.slug }],
        [GET, ARGS],
      ]);
    });

    it('asks for nothing when the caller has no access to the organization', async () => {
      o = await openAdmin(ROUTES, URL);
      o.acceptToken();
      o.subscription(GET_ADMIN_CONTEXT)!.fail(forbiddenError());
      await o.flush();
      expect(o.subscription(GET)).toBeUndefined();
      expect(text(o.page.querySelector('h1'))).toBe('You can’t manage this organization');
    });

    it('loading: skeleton shapes and a polite status, in the admin shell', async () => {
      await open();
      expect(text(main().querySelector('[role="status"]'))).toBe('Loading the tournament.');
      expect(main().querySelector('h1')).toBeNull();
      expectSkeletonBoxes(main(), { 'rounded-md': 12 });
    });

    it('a null answer shows the not-found view', async () => {
      await open(null);
      expect(text(main().querySelector('h1'))).toBe('Page not found');
      expect(page.querySelector('app-not-found-view')).not.toBeNull();
    });

    it('a forbidden answer shows the no-access view', async () => {
      await open();
      o.subscription(GET)!.fail(forbiddenError());
      await o.flush();
      expect(text(main().querySelector('h1'))).toBe('You can’t manage this organization');
    });

    it('a failed query shows the server-error view, never the error message, and Try again keeps the page', async () => {
      await open();
      o.subscription(GET)!.fail(new Error('Server Error: secret'));
      await o.flush();
      expect(page.querySelector('app-server-error-view')).not.toBeNull();
      expect(page.textContent).not.toContain('secret');
      expect(main().querySelector('a')?.getAttribute('href')).toBe(URL);
    });
  });

  describe('a draft', () => {
    beforeEach(() => open(DRAFT));

    it('has the breadcrumb organization, Tournaments, and the tournament as the current page, and one h1', () => {
      const links = [...main().querySelectorAll('nav[aria-label="Breadcrumb"] a')];
      expect(links.map(text)).toEqual([COASTAL.name, 'Tournaments', 'Winter Doubles Classic']);
      expect(links.map((a) => a.getAttribute('href'))).toEqual([
        `/app/organizations/${COASTAL.slug}`,
        BASE,
        URL,
      ]);
      expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, null, 'page']);
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(text(main().querySelector('h1'))).toBe('Winter Doubles Classic');
    });

    it('sets the title', () => {
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Winter Doubles Classic | Coastal Bend Rec Club | Omni League',
      );
    });

    it('shows Draft and the sport as badges, then the division', () => {
      const badges = [...main().querySelectorAll('h1 + div [data-slot="badge"]')];
      expect(badges.map((b) => [b.getAttribute('data-variant'), text(b)])).toEqual([
        ['outline', 'Draft'],
        ['secondary', 'Beach volleyball'],
      ]);
      for (const badge of badges) expectBadgeSize(badge, 'default');
      expect(text(main().querySelector('[data-slot="tournament-division"]'))).toBe(
        'Coed · 2v2 · Open',
      );
    });

    it('lists the dates, deadline, team limits, and location with its address in a details card', () => {
      expect(text(page.querySelector('#details-heading'))).toBe('Details');
      expect(details()).toEqual([
        ['Dates', ['Jan 16 – Jan 17, 2027']],
        ['Registration closes', ['Jan 9, 2027']],
        ['Teams', ['Up to 16 teams', 'Teams of at least 2 players']],
        [
          'Location',
          ['Pelican Shoals Sand Courts2150 Pelican Shoals Dr, Corpus Christi, TX 78418'],
        ],
      ]);
      expectBareCards(main(), ['mt-6 max-w-2xl overflow-hidden']);
    });

    it('offers Publish as a primary button that opens a dialog, and no public page link', () => {
      const button = publishButton()!;
      expect(text(button)).toBe('Publish');
      expect(button.type).toBe('button');
      expect(button.getAttribute('data-slot')).toBe('button');
      expect(tokens(button.className)).toEqual(tokens(PRIMARY_BUTTON));
      expect(button.querySelector('ng-icon')?.getAttribute('name')).toBe('lucideGlobe');
      expect(buttonLink('View public page')).toBeNull();
    });

    it('offers Copy to a new tournament, an outline link to the Tournaments form with this web address in copyOf', () => {
      const link = buttonLink('Copy to a new tournament')!;
      expect(link.getAttribute('href')).toBe(
        `${BASE}?copyOf=winter-doubles-classic#create-tournament`,
      );
      expect(tokens(link.className)).toEqual(tokens(OUTLINE_BUTTON));
      expect(link.querySelector('ng-icon')?.getAttribute('name')).toBe('lucideCopy');
    });

    it('says it is a draft that only staff see, in a note with no role', () => {
      const alert = main().querySelector('[data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'This tournament is a draft',
      );
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Only your staff can see it. Publish it to put its page online.',
      );
    });
  });

  describe('a published tournament', () => {
    beforeEach(() => open(PUBLISHED));

    it('shows Published, no Publish button and no draft note', () => {
      expect(text(main().querySelector('[data-slot="badge"]'))).toBe('Published');
      expect(main().querySelector('[data-slot="badge"]')!.getAttribute('data-variant')).toBe(
        'default',
      );
      expect(publishButton()).toBeNull();
      expect(main().querySelector('[data-slot="alert"]')).toBeNull();
    });

    it('links to the public page, an outline button that carries the names for the page’s skeleton', () => {
      const link = buttonLink('View public page')!;
      expect(link.getAttribute('href')).toBe(
        `/organizations/${COASTAL.slug}/tournaments/winter-doubles-classic`,
      );
      expect(tokens(link.className)).toEqual(tokens(OUTLINE_BUTTON));
      const names = o.harness.fixture.debugElement
        .query(By.css('main a[href^="/organizations/"]'))
        .injector.get(RouterLink).state;
      expect(names).toEqual({
        organization: { slug: COASTAL.slug, name: COASTAL.name },
        tournament: { slug: 'winter-doubles-classic', name: 'Winter Doubles Classic' },
      });
    });
  });

  describe('Copy to a new tournament on a published tournament', () => {
    it('is offered too, and goes to the same form', async () => {
      await open(PUBLISHED);
      expect(buttonLink('Copy to a new tournament')!.getAttribute('href')).toBe(
        `${BASE}?copyOf=winter-doubles-classic#create-tournament`,
      );
    });
  });

  describe('the confirmation', () => {
    beforeEach(() => open(DRAFT));

    it('opens an alert dialog titled for the tournament, with focus on Cancel and nothing sent', async () => {
      await pressPublish();
      const box = dialog()!;
      expect(box.getAttribute('aria-modal')).toBe('true');
      expect(text(box.querySelector('h2'))).toBe('Publish Winter Doubles Classic?');
      expect(text(box.querySelector('[data-slot="alert-dialog-description"]'))).toBe(
        'Its page will be public. Tournaments can’t be unpublished yet.',
      );
      const [cancel, publish] = [...box.querySelectorAll('button')];
      expect([text(cancel), text(publish)]).toEqual(['Cancel', 'Publish tournament']);
      expect(tokens(cancel.className)).toEqual(tokens(OUTLINE_BUTTON));
      expect(tokens(publish.className)).toEqual(tokens(PRIMARY_BUTTON));
      expect(document.activeElement).toBe(cancel);
      expect(calls()).toEqual([]);
      expect(page.querySelector('app-tournament-management')?.hasAttribute('inert')).toBe(true);
    });

    it('Cancel closes it, sends nothing, keeps the draft, and returns focus to Publish', async () => {
      await pressPublish();
      dialogButton('Cancel').click();
      await o.flush();
      expect(dialog()).toBeNull();
      expect(calls()).toEqual([]);
      expect(document.activeElement).toBe(publishButton());
      expect(notice()).toBeNull();
      expect(page.querySelector('app-tournament-management')?.hasAttribute('inert')).toBe(false);
    });

    it('Escape closes it the same way', async () => {
      await pressPublish();
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await o.flush();
      expect(dialog()).toBeNull();
      expect(calls()).toEqual([]);
      expect(document.activeElement).toBe(publishButton());
    });
  });

  describe('publishing', () => {
    beforeEach(() => open(DRAFT));

    it('calls tournaments.publish with the id; the button reads Publishing… and Cancel and Escape do nothing meanwhile', async () => {
      await pressPublish();
      dialogButton('Publish tournament').click();
      await o.flush();
      expect(calls()).toEqual([[PUBLISH, { tournamentId: 'tn_winter' }]]);
      const busy = dialogButton('Publishing');
      expect(text(busy)).toBe('Publishing…');
      expect(busy.getAttribute('aria-disabled')).toBe('true');
      dialogButton('Cancel').click();
      busy.click();
      await o.flush();
      expect(calls()).toHaveLength(1);
      expect(dialog()).not.toBeNull();
    });

    it('closes the dialog, shows Published, and announces it in a status that takes focus, with a link to the page', async () => {
      await pressPublish();
      await confirmAndPublish();
      expect(dialog()).toBeNull();
      expect(publishButton()).toBeNull();
      expect(text(main().querySelector('[data-slot="badge"]'))).toBe('Published');
      const region = notice()!;
      expect(region.getAttribute('role')).toBe('status');
      expect(text(region.querySelector('[data-slot="alert-title"]'))).toBe(
        'Winter Doubles Classic is published.',
      );
      expect(text(region.querySelector('[data-slot="alert-description"]'))).toBe(
        'Its page is public now. View public page',
      );
      expect(region.querySelector('a')!.getAttribute('href')).toBe(
        `/organizations/${COASTAL.slug}/tournaments/winter-doubles-classic`,
      );
      expect(document.activeElement).toBe(region);
      expect(page.querySelector('app-tournament-management')?.hasAttribute('inert')).toBe(false);
    });

    it('a failure shows the destructive alert in the open dialog with focus on it, and the draft stays', async () => {
      await pressPublish();
      dialogButton('Publish tournament').click();
      await o.flush();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = dialog()!.querySelector<HTMLElement>('[role="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The tournament could not be published.',
      );
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
      expect(document.activeElement).toBe(alert);
      expect(page.textContent + dialog()!.textContent).not.toContain('secret');
      expect(text(main().querySelector('[data-slot="badge"]'))).toBe('Draft');
      dialogButton('Publish tournament').click();
      await o.flush();
      expect(calls()).toHaveLength(2);
    });

    it('a refusal from the adapter at call time shows the offline alert and the tournament stays a draft', async () => {
      await pressPublish();
      dialogButton('Publish tournament').click();
      await o.flush();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(dialog()!.querySelector('[data-slot="alert"]'))).toBe(
        "You're offline. Nothing was sent. The tournament is still a draft. Try again when you're connected.",
      );
    });

    afterEach(() => vi.restoreAllMocks());

    it('offline, the button looks disabled but stays focusable, and a press sends nothing', async () => {
      await pressPublish();
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
      const button = dialogButton('Publish tournament');
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.hasAttribute('disabled')).toBe(false);
      button.click();
      await o.flush();
      expect(calls()).toEqual([]);
      expect(text(dialog()!.querySelector('[data-slot="alert"]'))).toContain(
        "You're offline. Nothing was sent.",
      );
    });
  });
});
