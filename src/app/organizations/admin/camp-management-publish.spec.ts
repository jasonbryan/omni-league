import { By } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { ConvexError } from 'convex/values';
import { CAMP_SESSION_MESSAGES } from '../../../../convex/lib/campSessionInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { COASTAL, openAdmin, text } from './testing/admin-harness';
import {
  AS_ORGANIZER,
  CAMP,
  CAMP_ROUTES,
  CAMP_URL,
  GET_CAMP,
  LIST_SESSIONS,
  PUBLISHED_CAMP,
  PUBLISH_CAMP,
  REMOVE_SESSION,
  SESSIONS,
  session,
} from './testing/camp-harness';

const tokens = (value: string) => value.split(' ').sort();
const PUBLIC_PATH = `/organizations/${COASTAL.slug}/camps/junior-beach-volleyball-camp`;

describe('CampManagement publishing', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(result: unknown, sessions: unknown[] | undefined = SESSIONS) {
    o = await openAdmin(CAMP_ROUTES, CAMP_URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET_CAMP)!.emit(result);
    await o.flush();
    if (sessions) o.subscription(LIST_SESSIONS)!.emit(sessions);
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
  const badge = () => text(main().querySelector('[data-slot="badge"]'));

  const deleteButtons = (within: ParentNode) =>
    [...within.querySelectorAll<HTMLButtonElement>('button')].filter((button) =>
      text(button)?.startsWith('Delete'),
    );

  async function pressPublish() {
    publishButton()!.click();
    await o.flush();
  }

  async function confirmAndPublish() {
    dialogButton('Publish camp').click();
    await o.flush();
    o.convex.calls[0].resolve(null);
    o.subscription(GET_CAMP)!.emit(PUBLISHED_CAMP);
    await o.flush();
  }

  describe('a draft with sessions', () => {
    beforeEach(() => open(CAMP));

    it('offers Publish as a primary button that opens a dialog, and no public page link', () => {
      const button = publishButton()!;
      expect(text(button)).toBe('Publish');
      expect(button.type).toBe('button');
      expect(button.getAttribute('data-slot')).toBe('button');
      expect(button.getAttribute('aria-disabled')).toBeNull();
      expect(tokens(button.className)).toEqual(tokens(PRIMARY_BUTTON));
      expect(button.querySelector('ng-icon')?.getAttribute('name')).toBe('lucideGlobe');
      expect(buttonLink('View public page')).toBeNull();
    });

    it('says it is a draft that only staff see', () => {
      const alert = main().querySelector('[data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe('This camp is a draft');
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Only your staff can see it. Publish it to put its page online.',
      );
    });
  });

  describe('an assigned league organizer', () => {
    beforeEach(() => open(AS_ORGANIZER));

    it('publishes with the same call an org admin makes', async () => {
      await pressPublish();
      dialogButton('Publish camp').click();
      await o.flush();
      expect(calls()).toEqual([[PUBLISH_CAMP, { campId: 'cp_junior' }]]);
    });
  });

  describe('a draft with no session', () => {
    beforeEach(() => open(CAMP, []));

    it('keeps Publish disabled but focusable, and says to add a session first', () => {
      const button = publishButton()!;
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.hasAttribute('disabled')).toBe(false);
      expect(button.classList).toContain('opacity-50');
      const hint = main().querySelector<HTMLElement>(`#${button.getAttribute('aria-describedby')}`);
      expect(text(hint)).toBe('Add a session first.');
    });

    it('a press opens no dialog and sends nothing', async () => {
      await pressPublish();
      expect(dialog()).toBeNull();
      expect(calls()).toEqual([]);
    });

    it('is enabled once a session is added', async () => {
      o.subscription(LIST_SESSIONS)!.emit([session()]);
      await o.flush();
      expect(publishButton()!.getAttribute('aria-disabled')).toBeNull();
      expect(main().textContent).not.toContain('Add a session first.');
    });
  });

  describe('while the sessions load', () => {
    it('leaves Publish enabled, because the server checks for a session', async () => {
      await open(CAMP, undefined);
      expect(publishButton()!.getAttribute('aria-disabled')).toBeNull();
    });
  });

  describe('a published camp', () => {
    beforeEach(() => open(PUBLISHED_CAMP));

    it('shows Published, no Publish button and no draft note', () => {
      expect(badge()).toBe('Published');
      expect(main().querySelector('[data-slot="badge"]')!.getAttribute('data-variant')).toBe(
        'default',
      );
      expect(publishButton()).toBeNull();
      expect(main().querySelector('[data-slot="alert"]')).toBeNull();
    });

    it('links to the public page, an outline button that carries the names for the page’s skeleton', () => {
      const link = buttonLink('View public page')!;
      expect(link.getAttribute('href')).toBe(PUBLIC_PATH);
      expect(tokens(link.className)).toEqual(tokens(OUTLINE_BUTTON));
      const names = o.harness.fixture.debugElement
        .query(By.css('main a[href^="/organizations/"]'))
        .injector.get(RouterLink).state;
      expect(names).toEqual({
        organization: { slug: COASTAL.slug, name: COASTAL.name },
        camp: { slug: 'junior-beach-volleyball-camp', name: 'Junior Beach Volleyball Camp' },
      });
    });

    it('replaces Delete on the last session with a note that it keeps the camp published', async () => {
      o.subscription(LIST_SESSIONS)!.emit([session()]);
      await o.flush();
      const row = page.querySelector<HTMLElement>('#sessions-list > li')!;
      expect(deleteButtons(row)).toEqual([]);
      expect(text(row.querySelector('[data-slot="session-required"]'))).toBe(
        'Required while published',
      );
    });

    it('keeps Delete on every session while there is more than one', () => {
      expect(deleteButtons(page).map(text)).toEqual(['Delete Week 1', 'Delete Week 3']);
    });

    it('shows a refusal of the last session’s delete in the sessions alert', async () => {
      o.subscription(LIST_SESSIONS)!.emit(
        SESSIONS.slice(0, 2).map((row) => ({ ...row, registeredCount: 0 })),
      );
      await o.flush();
      deleteButtons(page)[0].click();
      await o.flush();
      o.convex.calls[0].reject(
        new ConvexError({ code: 'lastSession', message: CAMP_SESSION_MESSAGES.lastSession }),
      );
      await o.flush();
      expect(calls()[0][0]).toBe(REMOVE_SESSION);
      const alert = page.querySelector<HTMLElement>('#sessions [role="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        CAMP_SESSION_MESSAGES.lastSession,
      );
    });
  });

  describe('the confirmation', () => {
    beforeEach(() => open(CAMP));

    it('opens an alert dialog titled for the camp, with focus on Cancel and nothing sent', async () => {
      await pressPublish();
      const box = dialog()!;
      expect(box.getAttribute('aria-modal')).toBe('true');
      expect(text(box.querySelector('h2'))).toBe('Publish Junior Beach Volleyball Camp?');
      expect(text(box.querySelector('[data-slot="alert-dialog-description"]'))).toBe(
        'Its page will be public. Camps can’t be unpublished yet.',
      );
      const [cancel, publish] = [...box.querySelectorAll('button')];
      expect([text(cancel), text(publish)]).toEqual(['Cancel', 'Publish camp']);
      expect(tokens(cancel.className)).toEqual(tokens(OUTLINE_BUTTON));
      expect(tokens(publish.className)).toEqual(tokens(PRIMARY_BUTTON));
      expect(document.activeElement).toBe(cancel);
      expect(calls()).toEqual([]);
      expect(page.querySelector('app-camp-management')?.hasAttribute('inert')).toBe(true);
    });

    it('Cancel closes it, sends nothing, keeps the draft, and returns focus to Publish', async () => {
      await pressPublish();
      dialogButton('Cancel').click();
      await o.flush();
      expect(dialog()).toBeNull();
      expect(calls()).toEqual([]);
      expect(document.activeElement).toBe(publishButton());
      expect(notice()).toBeNull();
      expect(badge()).toBe('Draft');
      expect(page.querySelector('app-camp-management')?.hasAttribute('inert')).toBe(false);
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
    beforeEach(() => open(CAMP));

    it('calls camps.publish with the id; the button reads Publishing… and Cancel does nothing meanwhile', async () => {
      await pressPublish();
      dialogButton('Publish camp').click();
      await o.flush();
      expect(calls()).toEqual([[PUBLISH_CAMP, { campId: 'cp_junior' }]]);
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
      expect(badge()).toBe('Published');
      const region = notice()!;
      expect(region.getAttribute('role')).toBe('status');
      expect(text(region.querySelector('[data-slot="alert-title"]'))).toBe(
        'Junior Beach Volleyball Camp is published.',
      );
      expect(text(region.querySelector('[data-slot="alert-description"]'))).toBe(
        'Its page is public now. View public page',
      );
      expect(region.querySelector('a')!.getAttribute('href')).toBe(PUBLIC_PATH);
      expect(document.activeElement).toBe(region);
      expect(page.querySelector('app-camp-management')?.hasAttribute('inert')).toBe(false);
    });

    it('shows the server’s message when it refuses, in the open dialog with focus on it, and the draft stays', async () => {
      await pressPublish();
      dialogButton('Publish camp').click();
      await o.flush();
      o.convex.calls[0].reject(
        new ConvexError({ code: 'noSessions', message: 'Add a session first.' }),
      );
      await o.flush();
      const alert = dialog()!.querySelector<HTMLElement>('[role="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The camp could not be published.',
      );
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Add a session first.',
      );
      expect(document.activeElement).toBe(alert);
      expect(badge()).toBe('Draft');
    });

    it('any other failure shows what to do, never the error message, and Publish can be pressed again', async () => {
      await pressPublish();
      dialogButton('Publish camp').click();
      await o.flush();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = dialog()!.querySelector<HTMLElement>('[role="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
      expect(page.textContent + dialog()!.textContent).not.toContain('secret');
      dialogButton('Publish camp').click();
      await o.flush();
      expect(calls()).toHaveLength(2);
    });

    it('a refusal from the adapter at call time shows the offline alert and the camp stays a draft', async () => {
      await pressPublish();
      dialogButton('Publish camp').click();
      await o.flush();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(dialog()!.querySelector('[data-slot="alert"]'))).toBe(
        "You're offline. Nothing was sent. The camp is still a draft. Try again when you're connected.",
      );
    });

    afterEach(() => vi.restoreAllMocks());
  });
});
