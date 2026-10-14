import { TestBed } from '@angular/core/testing';
import { ConvexOfflineError } from '../../core/data/convex';
import { AdminArea } from './admin-area';
import { AdminLeagues } from './admin-leagues';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import {
  adminRoutes,
  COASTAL,
  COASTAL_LOCATIONS,
  GET_ADMIN_CONTEXT,
  LIST_FOR_ADMIN,
  openAdmin,
  text,
} from './testing/admin-harness';

const ROUTES = adminRoutes(AdminArea, [{ path: 'leagues', component: AdminLeagues }]);
const URL = `/app/organizations/${COASTAL.slug}/leagues`;
const LIST_LEAGUES = 'leagues:listForAdmin';
const PUBLISH = 'leagues:publish';

const DRAFT = {
  leagueId: 'lg_4s',
  name: 'Sunday Reverse Coed 4s',
  slug: 'sunday-reverse-coed-4s',
  sportName: 'Beach volleyball',
  status: 'draft',
  locationNames: ['Pelican Shoals Sand Courts'],
};
const OTHER_DRAFT = {
  leagueId: 'lg_slow',
  name: 'Wednesday Coed Slow-Pitch',
  slug: 'wednesday-coed-slow-pitch',
  sportName: 'Softball',
  status: 'draft',
  locationNames: ['Tern Point Softball Complex'],
};
const PUBLISHED = {
  leagueId: 'lg_7v7',
  name: 'Coed 7v7 Rec',
  slug: 'coed-7v7-rec',
  sportName: 'Soccer',
  status: 'published',
  locationNames: ['Redfish Flats Fields'],
};
const LEAGUES = [PUBLISHED, DRAFT, OTHER_DRAFT];
const tokens = (value: string) => value.split(' ').sort();

describe('AdminLeagues: publishing (#69)', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(leagues: unknown[] = LEAGUES) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
    await o.flush();
    o.subscription(LIST_LEAGUES)!.emit(leagues);
    o.subscription(LIST_FOR_ADMIN)!.emit(COASTAL_LOCATIONS);
    await o.flush();
  }

  const rows = () => [...page.querySelectorAll<HTMLElement>('#leagues-list > li')];
  const publishButton = (n: number) =>
    rows()[n].querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
  const dialogButton = (label: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      text(b)?.startsWith(label),
    )!;
  const notice = () =>
    page.querySelector<HTMLElement>('section[aria-labelledby="leagues-heading"] [role="status"]');
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);

  async function pressPublish(n: number) {
    publishButton(n)!.click();
    await o.flush();
  }

  async function confirmAndPublish(league = DRAFT) {
    dialogButton('Publish league').click();
    await o.flush();
    o.convex.calls[0].resolve(null);
    o.subscription(LIST_LEAGUES)!.emit(
      LEAGUES.map((l) => (l.leagueId === league.leagueId ? { ...l, status: 'published' } : l)),
    );
    await o.flush();
  }

  describe('the Publish button (state 3)', () => {
    it('is on each Draft row only, named for its league, an outline button that opens a dialog', async () => {
      await open();
      expect(publishButton(0)).toBeNull();
      for (const n of [1, 2]) {
        const button = publishButton(n)!;
        expect(text(button)).toBe(`Publish ${LEAGUES[n].name}`);
        expect(button.querySelector('.sr-only')?.textContent).toBe(` ${LEAGUES[n].name}`);
        expect(button.type).toBe('button');
        expect(button.getAttribute('data-slot')).toBe('button');
        expect(tokens(button.className)).toEqual(tokens(OUTLINE_BUTTON));
        expect(button.querySelector('ng-icon')?.getAttribute('name')).toBe('lucideGlobe');
      }
    });

    it('is not on a draft whose list row is still loading, and a page with no drafts has none', async () => {
      await open([PUBLISHED]);
      expect(page.querySelector('#leagues-list button')).toBeNull();
    });
  });

  describe('the confirmation (state 9)', () => {
    it('opens an alert dialog titled for the league, with the two sentences and focus on Cancel', async () => {
      await open();
      await pressPublish(1);
      const box = dialog()!;
      expect(box).not.toBeNull();
      expect(box.getAttribute('aria-modal')).toBe('true');
      expect(text(box.querySelector('h2'))).toBe('Publish Sunday Reverse Coed 4s?');
      expect(text(box.querySelector('[data-slot="alert-dialog-description"]'))).toBe(
        'It will appear on your public page. Leagues can’t be unpublished yet.',
      );
      expect(box.getAttribute('aria-labelledby')).toBe(box.querySelector('h2')!.id);
      expect(box.getAttribute('aria-describedby')).toContain(
        box.querySelector('[data-slot="alert-dialog-description"]')!.id,
      );
      const [cancel, publish] = [...box.querySelectorAll('button')];
      expect([text(cancel), text(publish)]).toEqual(['Cancel', 'Publish league']);
      expect(tokens(cancel.className)).toEqual(tokens(OUTLINE_BUTTON));
      expect(tokens(publish.className)).toEqual(tokens(PRIMARY_BUTTON));
      expect(document.activeElement).toBe(cancel);
      expect(calls()).toEqual([]);
    });

    it('sets the scrim to the sheet’s bg-foreground/50 with no blur, and makes the page behind inert', async () => {
      await open();
      await pressPublish(1);
      const backdrop = document.querySelector<HTMLElement>('.cdk-overlay-backdrop')!;
      expect(backdrop.classList.contains('bg-foreground/50')).toBe(true);
      expect(backdrop.className).not.toMatch(/blur|bg-black/);
      expect(page.querySelector('app-admin-leagues')?.hasAttribute('inert')).toBe(true);
    });

    it('Cancel closes it, writes nothing, leaves the league Draft, and returns focus to that row’s Publish button', async () => {
      await open();
      await pressPublish(2);
      dialogButton('Cancel').click();
      await o.flush();
      expect(dialog()).toBeNull();
      expect(calls()).toEqual([]);
      expect(page.querySelector('app-admin-leagues')?.hasAttribute('inert')).toBe(false);
      expect(document.activeElement).toBe(publishButton(2));
      expect(notice()).toBeNull();
    });

    it('Escape closes it the same way', async () => {
      await open();
      await pressPublish(1);
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await o.flush();
      expect(dialog()).toBeNull();
      expect(calls()).toEqual([]);
      expect(document.activeElement).toBe(publishButton(1));
    });

    it('a press outside it does not close it', async () => {
      await open();
      await pressPublish(1);
      document.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
      await o.flush();
      expect(dialog()).not.toBeNull();
    });
  });

  describe('publishing (state 10)', () => {
    it('Publish league calls leagues.publish with the league id; the button reads "Publishing…", it and Cancel are aria-disabled, and the dialog stays open', async () => {
      await open();
      await pressPublish(1);
      dialogButton('Publish league').click();
      await o.flush();
      expect(calls()).toEqual([[PUBLISH, { leagueId: 'lg_4s' }]]);
      const busy = dialogButton('Publishing');
      expect(text(busy)).toBe('Publishing…');
      expect(busy.getAttribute('aria-disabled')).toBe('true');
      expect(busy.hasAttribute('disabled')).toBe(false);
      expect(dialog()).not.toBeNull();
      const cancel = dialogButton('Cancel');
      expect(cancel.getAttribute('aria-disabled')).toBe('true');
      expect(cancel.hasAttribute('disabled')).toBe(false);
      cancel.click();
      busy.click();
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await o.flush();
      expect(calls()).toHaveLength(1);
      expect(dialog()).not.toBeNull();
    });
  });

  describe('the result (state 11)', () => {
    it('closes the dialog, shows Published on the row without a button, and announces it in a status above the list with focus on it', async () => {
      await open();
      await pressPublish(1);
      await confirmAndPublish();
      expect(dialog()).toBeNull();
      expect(publishButton(1)).toBeNull();
      expect(text(rows()[1].querySelector('[data-slot="badge"]'))).toBe('Published');
      const region = notice()!;
      expect(region).not.toBeNull();
      expect(region.getAttribute('role')).toBe('status');
      expect(text(region.querySelector('[data-slot="alert-title"]'))).toBe(
        'Sunday Reverse Coed 4s is published.',
      );
      expect(text(region.querySelector('[data-slot="alert-description"]'))).toBe(
        'It’s on your public page now. View public page',
      );
      const link = region.querySelector('a')!;
      expect(link.getAttribute('href')).toBe('/organizations/coastal-bend-rec-club');
      expect(text(link)).toBe('View public page');
      const list = page.querySelector('#leagues-list')!;
      expect(region.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(document.activeElement).toBe(region);
      expect(page.querySelector('app-admin-leagues')?.hasAttribute('inert')).toBe(false);
    });

    it('the status goes when the next dialog opens, and names the next league', async () => {
      await open();
      await pressPublish(1);
      await confirmAndPublish();
      await pressPublish(2);
      expect(notice()).toBeNull();
      dialogButton('Publish league').click();
      await o.flush();
      o.convex.calls[1].resolve(null);
      o.subscription(LIST_LEAGUES)!.emit(LEAGUES.map((l) => ({ ...l, status: 'published' })));
      await o.flush();
      expect(text(notice()!.querySelector('[data-slot="alert-title"]'))).toBe(
        'Wednesday Coed Slow-Pitch is published.',
      );
    });
  });

  describe('a failure (state 12)', () => {
    it('shows the destructive alert inside the open dialog, gives it focus, and leaves the league Draft', async () => {
      await open();
      await pressPublish(1);
      dialogButton('Publish league').click();
      await o.flush();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const box = dialog()!;
      expect(box).not.toBeNull();
      const alert = box.querySelector<HTMLElement>('[role="alert"]')!;
      expect(text(alert)).toBe(
        'The league could not be published. Check your connection and try again.',
      );
      expect(document.activeElement).toBe(alert);
      expect(page.textContent + box.textContent).not.toContain('secret');
      expect(text(dialogButton('Publish league'))).toBe('Publish league');
      expect(text(rows()[1].querySelector('[data-slot="badge"]'))).toBe('Draft');
      expect(notice()).toBeNull();
    });

    it('Publish league tries again; a second success finishes as usual', async () => {
      await open();
      await pressPublish(1);
      dialogButton('Publish league').click();
      await o.flush();
      o.convex.calls[0].reject(new Error('boom'));
      await o.flush();
      dialogButton('Publish league').click();
      await o.flush();
      expect(dialog()!.querySelector('[role="alert"]')).toBeNull();
      expect(calls()).toHaveLength(2);
      o.convex.calls[1].resolve(null);
      await o.flush();
      expect(dialog()).toBeNull();
      expect(text(notice()!.querySelector('[data-slot="alert-title"]'))).toBe(
        'Sunday Reverse Coed 4s is published.',
      );
    });

    it('Cancel after a failure closes it, returns focus to the Publish button, and the league stays Draft', async () => {
      await open();
      await pressPublish(1);
      dialogButton('Publish league').click();
      await o.flush();
      o.convex.calls[0].reject(new Error('boom'));
      await o.flush();
      dialogButton('Cancel').click();
      await o.flush();
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(publishButton(1));
      expect(notice()).toBeNull();
    });
  });

  describe('offline (design/mockups/88-offline-note.html states 2 and 3)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('the button looks disabled but stays focusable; a press shows the offline alert and sends nothing', async () => {
      await open();
      await pressPublish(1);
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
      const button = dialogButton('Publish league');
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.classList.contains('opacity-50')).toBe(true);
      expect(button.hasAttribute('disabled')).toBe(false);
      button.click();
      await o.flush();
      expect(calls()).toEqual([]);
      const alert = dialog()!.querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(text(alert)).toBe(
        "You're offline. Nothing was sent. The league is still a draft. Try again when you're connected.",
      );
      expect(document.activeElement).toBe(alert);
    });

    it('a refusal from the adapter at call time shows the offline alert', async () => {
      await open();
      await pressPublish(1);
      dialogButton('Publish league').click();
      await o.flush();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(dialog()!.querySelector('[data-slot="alert"]'))).toBe(
        "You're offline. Nothing was sent. The league is still a draft. Try again when you're connected.",
      );
    });
  });
});
