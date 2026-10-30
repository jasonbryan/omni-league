import { TestBed } from '@angular/core/testing';
import { ConvexOfflineError } from '../../core/data/convex';
import { overlayPanes, removePopoverApi, stubPopoverApi } from '../../ui/testing/overlay-panes';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../admin/button-classes';
import { openAdmin, text } from '../admin/testing/admin-harness';
import {
  COED,
  COED_AS_ORGANIZER,
  GET_ORGANIZER_CONTEXT,
  LEAGUE_ROUTES,
  LEAGUE_URL,
  LIST_FOR_ORGANIZER,
  PUBLISH_SEASON,
  SEASONS,
} from './testing/league-harness';

const FALL = SEASONS[0];
const SUMMER = SEASONS[1];
const SPRING_DRAFT = {
  ...SEASONS[1],
  seasonId: 'se_spring27',
  name: 'Spring 2027',
  slug: 'spring-2027',
  startDate: '2027-03-03',
  endDate: '2027-05-12',
  registrationDeadline: '2027-02-17',
  status: 'draft',
};
const LIST = [FALL, SUMMER, SPRING_DRAFT];
const tokens = (value: string) => value.split(' ').sort();

describe('LeagueManagement: publishing a season', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(context: unknown = COED, seasons: unknown[] = LIST) {
    o = await openAdmin(LEAGUE_ROUTES, LEAGUE_URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ORGANIZER_CONTEXT)!.emit(context);
    await o.flush();
    o.subscription(LIST_FOR_ORGANIZER)!.emit(seasons);
    await o.flush();
  }

  const rows = () => [...page.querySelectorAll<HTMLElement>('#seasons-list > li')];
  const publishButton = (n: number) =>
    rows()[n].querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
  const dialogButton = (label: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      text(b)?.startsWith(label),
    )!;
  const notice = () =>
    page.querySelector<HTMLElement>('section[aria-labelledby="seasons-heading"] [role="status"]');
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);

  async function pressPublish(n: number) {
    publishButton(n)!.click();
    await o.flush();
  }

  async function confirmAndPublish(season = FALL) {
    dialogButton('Publish season').click();
    await o.flush();
    o.convex.calls[0].resolve(null);
    o.subscription(LIST_FOR_ORGANIZER)!.emit(
      LIST.map((s) => (s.seasonId === season.seasonId ? { ...s, status: 'published' } : s)),
    );
    await o.flush();
  }

  describe('the Publish button (state 16)', () => {
    it('is on each Draft row only, named for its season, an outline button that opens a dialog', async () => {
      await open();
      expect(publishButton(1)).toBeNull();
      for (const n of [0, 2]) {
        const button = publishButton(n)!;
        expect(text(button)).toBe(`Publish ${LIST[n].name}`);
        expect(button.querySelector('.sr-only')?.textContent).toBe(` ${LIST[n].name}`);
        expect(button.type).toBe('button');
        expect(button.getAttribute('data-slot')).toBe('button');
        expect(tokens(button.className)).toEqual(tokens(OUTLINE_BUTTON));
        expect(button.querySelector('ng-icon')?.getAttribute('name')).toBe('lucideGlobe');
      }
    });

    it('is the same for the league organizer assigned to the league', async () => {
      await open(COED_AS_ORGANIZER);
      expect(publishButton(0)).not.toBeNull();
      expect(publishButton(1)).toBeNull();
    });

    it('is not on a page whose seasons are all published, and the list asks nothing more', async () => {
      await open(COED, [SUMMER]);
      expect(page.querySelector('#seasons-list button')).toBeNull();
      expect(calls()).toEqual([]);
    });

    it('a season’s name stays plain text: its page comes later', async () => {
      await open();
      expect(page.querySelector('#seasons-list a')).toBeNull();
    });
  });

  describe('the confirmation (state 17)', () => {
    describe('in a browser with the popover API', () => {
      beforeEach(stubPopoverApi);
      afterEach(removePopoverApi);

      it('opens in the overlay container, not the popover top layer', async () => {
        await open();
        await pressPublish(0);
        expect(overlayPanes()).toEqual([{ inContainer: true, inPopover: false }]);
      });
    });

    it('opens an alert dialog titled for the season that names the league and the registration deadline, with focus on Cancel', async () => {
      await open();
      await pressPublish(0);
      const box = dialog()!;
      expect(box).not.toBeNull();
      expect(box.getAttribute('aria-modal')).toBe('true');
      expect(text(box.querySelector('h2'))).toBe('Publish Fall 2027?');
      expect(text(box.querySelector('[data-slot="alert-dialog-description"]'))).toBe(
        'It will appear on Coed 7v7 Rec’s public page, and players can register until Aug 25, 2027. Seasons can’t be unpublished yet.',
      );
      expect(box.getAttribute('aria-labelledby')).toBe(box.querySelector('h2')!.id);
      expect(box.getAttribute('aria-describedby')).toContain(
        box.querySelector('[data-slot="alert-dialog-description"]')!.id,
      );
      const [cancel, publish] = [...box.querySelectorAll('button')];
      expect([text(cancel), text(publish)]).toEqual(['Cancel', 'Publish season']);
      expect(tokens(cancel.className)).toEqual(tokens(OUTLINE_BUTTON));
      expect(tokens(publish.className)).toEqual(tokens(PRIMARY_BUTTON));
      expect(document.activeElement).toBe(cancel);
      expect(calls()).toEqual([]);
    });

    it('names the deadline of the season whose button was pressed', async () => {
      await open();
      await pressPublish(2);
      expect(text(dialog()!.querySelector('h2'))).toBe('Publish Spring 2027?');
      expect(text(dialog()!.querySelector('[data-slot="alert-dialog-description"]'))).toContain(
        'register until Feb 17, 2027.',
      );
    });

    it('sets the scrim to bg-foreground/50 with no blur, and makes the page behind inert', async () => {
      await open();
      await pressPublish(0);
      const backdrop = document.querySelector<HTMLElement>('.cdk-overlay-backdrop')!;
      expect(backdrop.classList.contains('bg-foreground/50')).toBe(true);
      expect(backdrop.className).not.toMatch(/blur|bg-black/);
      expect(page.querySelector('app-league-management')?.hasAttribute('inert')).toBe(true);
    });

    it('Cancel closes it, writes nothing, leaves the season Draft, and returns focus to that row’s Publish button', async () => {
      await open();
      await pressPublish(2);
      dialogButton('Cancel').click();
      await o.flush();
      expect(dialog()).toBeNull();
      expect(calls()).toEqual([]);
      expect(page.querySelector('app-league-management')?.hasAttribute('inert')).toBe(false);
      expect(document.activeElement).toBe(publishButton(2));
      expect(text(rows()[2].querySelector('[data-slot="badge"]'))).toBe('Draft');
      expect(notice()).toBeNull();
    });

    it('Escape closes it the same way', async () => {
      await open();
      await pressPublish(0);
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await o.flush();
      expect(dialog()).toBeNull();
      expect(calls()).toEqual([]);
      expect(document.activeElement).toBe(publishButton(0));
    });

    it('a press outside it does not close it', async () => {
      await open();
      await pressPublish(0);
      document.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
      await o.flush();
      expect(dialog()).not.toBeNull();
    });
  });

  describe('publishing (state 18)', () => {
    it('Publish season calls seasons.publish with the season id; the button reads "Publishing…", it and Cancel are aria-disabled, and the dialog stays open', async () => {
      await open();
      await pressPublish(0);
      dialogButton('Publish season').click();
      await o.flush();
      expect(calls()).toEqual([[PUBLISH_SEASON, { seasonId: 'se_fall27' }]]);
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

  describe('the result (state 19)', () => {
    it('closes the dialog, shows Published on the row without a button, and announces it in a status above the list with focus on it', async () => {
      await open();
      await pressPublish(0);
      await confirmAndPublish();
      expect(dialog()).toBeNull();
      expect(publishButton(0)).toBeNull();
      expect(text(rows()[0].querySelector('[data-slot="badge"]'))).toBe('Published');
      const region = notice()!;
      expect(region).not.toBeNull();
      expect(region.getAttribute('role')).toBe('status');
      expect(text(region.querySelector('[data-slot="alert-title"]'))).toBe(
        'Fall 2027 is published.',
      );
      expect(text(region.querySelector('[data-slot="alert-description"]'))).toBe(
        'It’s on the league’s public page now. View public page',
      );
      const link = region.querySelector('a')!;
      expect(text(link)).toBe('View public page');
      expect(link.getAttribute('href')).toBe(
        '/organizations/gulf-coast-sport-social/leagues/coed-7v7-rec',
      );
      const list = page.querySelector('#seasons-list')!;
      expect(region.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(document.activeElement).toBe(region);
      expect(page.querySelector('app-league-management')?.hasAttribute('inert')).toBe(false);
    });

    it('the status goes when the next dialog opens, and names the next season', async () => {
      await open();
      await pressPublish(0);
      await confirmAndPublish();
      await pressPublish(2);
      expect(notice()).toBeNull();
      dialogButton('Publish season').click();
      await o.flush();
      o.convex.calls[1].resolve(null);
      o.subscription(LIST_FOR_ORGANIZER)!.emit(LIST.map((s) => ({ ...s, status: 'published' })));
      await o.flush();
      expect(text(notice()!.querySelector('[data-slot="alert-title"]'))).toBe(
        'Spring 2027 is published.',
      );
    });
  });

  describe('a failure (state 20)', () => {
    it('shows the destructive alert inside the open dialog, gives it focus, and leaves the season Draft', async () => {
      await open();
      await pressPublish(0);
      dialogButton('Publish season').click();
      await o.flush();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const box = dialog()!;
      expect(box).not.toBeNull();
      const alert = box.querySelector<HTMLElement>('[role="alert"]')!;
      expect(text(alert)).toBe(
        'The season could not be published. Check your connection and try again.',
      );
      expect(document.activeElement).toBe(alert);
      expect(page.textContent + box.textContent).not.toContain('secret');
      expect(text(dialogButton('Publish season'))).toBe('Publish season');
      expect(text(rows()[0].querySelector('[data-slot="badge"]'))).toBe('Draft');
      expect(notice()).toBeNull();
    });

    it('titles the failure alert with its heading above its description', async () => {
      await open();
      await pressPublish(0);
      dialogButton('Publish season').click();
      await o.flush();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = dialog()!.querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The season could not be published.',
      );
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
    });

    it('Publish season tries again; a second success finishes as usual', async () => {
      await open();
      await pressPublish(0);
      dialogButton('Publish season').click();
      await o.flush();
      o.convex.calls[0].reject(new Error('boom'));
      await o.flush();
      dialogButton('Publish season').click();
      await o.flush();
      expect(dialog()!.querySelector('[role="alert"]')).toBeNull();
      expect(calls()).toHaveLength(2);
      o.convex.calls[1].resolve(null);
      await o.flush();
      expect(dialog()).toBeNull();
      expect(text(notice()!.querySelector('[data-slot="alert-title"]'))).toBe(
        'Fall 2027 is published.',
      );
    });

    it('Cancel after a failure closes it, returns focus to the Publish button, and the season stays Draft', async () => {
      await open();
      await pressPublish(0);
      dialogButton('Publish season').click();
      await o.flush();
      o.convex.calls[0].reject(new Error('boom'));
      await o.flush();
      dialogButton('Cancel').click();
      await o.flush();
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(publishButton(0));
      expect(notice()).toBeNull();
    });
  });

  describe('offline', () => {
    afterEach(() => vi.restoreAllMocks());

    it('the button looks disabled but stays focusable; a press shows the offline alert and sends nothing', async () => {
      await open();
      await pressPublish(0);
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await o.harness.fixture.whenStable();
      const button = dialogButton('Publish season');
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.classList.contains('opacity-50')).toBe(true);
      expect(button.hasAttribute('disabled')).toBe(false);
      button.click();
      await o.flush();
      expect(calls()).toEqual([]);
      const alert = dialog()!.querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(text(alert)).toBe(
        "You're offline. Nothing was sent. Fall 2027 is still a draft. Try again when you're connected.",
      );
      expect(document.activeElement).toBe(alert);
    });

    it('a refusal from the adapter at call time shows the offline alert', async () => {
      await open();
      await pressPublish(0);
      dialogButton('Publish season').click();
      await o.flush();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(dialog()!.querySelector('[data-slot="alert"]'))).toBe(
        "You're offline. Nothing was sent. Fall 2027 is still a draft. Try again when you're connected.",
      );
    });
  });

  describe('a draft league (states 22 and 23)', () => {
    const DRAFT_LEAGUE = { ...COED, status: 'draft' };
    const DRAFT_LIST = [SPRING_DRAFT];

    it('an org admin sees "Publish the league first" with the link to the Leagues page, and no Publish buttons', async () => {
      await open(DRAFT_LEAGUE, DRAFT_LIST);
      const note = page.querySelector<HTMLElement>(
        'section[aria-labelledby="seasons-heading"] [data-slot="alert"]',
      )!;
      expect(note.getAttribute('role')).toBe('note');
      expect(text(note.querySelector('[data-slot="alert-title"]'))).toBe(
        'Publish the league first',
      );
      expect(text(note.querySelector('[data-slot="alert-description"]'))).toBe(
        'Seasons of a draft league can’t be published. Publish Coed 7v7 Rec in Leagues, then come back to publish its seasons.',
      );
      const link = note.querySelector('a')!;
      expect(link.getAttribute('href')).toBe('/app/organizations/gulf-coast-sport-social/leagues');
      expect(text(link)).toBe('Publish Coed 7v7 Rec in Leagues');
      expect(link.classList.contains('inline-block')).toBe(false);
      expect(page.querySelector('#seasons-list button')).toBeNull();
      expect(page.querySelector('app-publish-season-dialog')).toBeNull();
    });

    it('a league organizer sees "Ask an org admin to publish the league" with no link, and no Publish buttons', async () => {
      await open({ ...COED_AS_ORGANIZER, status: 'draft' }, DRAFT_LIST);
      const note = page.querySelector<HTMLElement>(
        'section[aria-labelledby="seasons-heading"] [data-slot="alert"]',
      )!;
      expect(note.getAttribute('role')).toBe('note');
      expect(text(note.querySelector('[data-slot="alert-title"]'))).toBe(
        'Ask an org admin to publish the league',
      );
      expect(text(note.querySelector('[data-slot="alert-description"]'))).toBe(
        'Seasons of a draft league can’t be published. You can create and prepare seasons until the league is published.',
      );
      expect(note.querySelector('a')).toBeNull();
      expect(page.querySelector('#seasons-list button')).toBeNull();
    });

    it('shows the note above the list, also while the list loads and when it is empty', async () => {
      o = await openAdmin(LEAGUE_ROUTES, LEAGUE_URL);
      page = o.page;
      o.acceptToken();
      o.subscription(GET_ORGANIZER_CONTEXT)!.emit(DRAFT_LEAGUE);
      await o.flush();
      const note = () =>
        page.querySelector('section[aria-labelledby="seasons-heading"] [data-slot="alert"]');
      expect(note()).not.toBeNull();
      o.subscription(LIST_FOR_ORGANIZER)!.emit([]);
      await o.flush();
      expect(note()).not.toBeNull();
    });

    it('a published league shows no note', async () => {
      await open();
      expect(
        page.querySelector('section[aria-labelledby="seasons-heading"] [data-slot="alert"]'),
      ).toBeNull();
    });
  });
});
