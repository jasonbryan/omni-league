import { By } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { ConvexError } from 'convex/values';
import { ConvexOfflineError } from '../../core/data/convex';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { COASTAL, openAdmin, text } from './testing/admin-harness';
import {
  CLASSES,
  GET_TRAINING,
  LIST_CLASSES,
  PUBLISHED_TRAINING,
  PUBLISH_TRAINING,
  SCHEDULED_AS_ORGANIZER,
  SCHEDULED_TRAINING,
  TRAINING,
  TRAINING_ROUTES,
  TRAINING_URL,
  trainingClass,
} from './testing/training-harness';

const tokens = (value: string) => value.split(' ').sort();
const PUBLIC_PATH = `/organizations/${COASTAL.slug}/training/tuesday-serving-clinic`;

describe('TrainingManagement publishing', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(result: unknown, classes: unknown[] | undefined = CLASSES) {
    o = await openAdmin(TRAINING_ROUTES, TRAINING_URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET_TRAINING)!.emit(result);
    await o.flush();
    if (classes) o.subscription(LIST_CLASSES)!.emit(classes);
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

  async function pressPublish() {
    publishButton()!.click();
    await o.flush();
  }

  async function confirmAndPublish() {
    dialogButton('Publish training program').click();
    await o.flush();
    o.convex.calls[0].resolve(null);
    o.subscription(GET_TRAINING)!.emit(PUBLISHED_TRAINING);
    await o.flush();
  }

  describe('a draft with classes', () => {
    beforeEach(() => open(SCHEDULED_TRAINING));

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
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'This training program is a draft',
      );
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Only your staff can see it. Publish it to put its page online.',
      );
    });
  });

  describe('an assigned league organizer', () => {
    beforeEach(() => open(SCHEDULED_AS_ORGANIZER));

    it('publishes with the same call an org admin makes', async () => {
      await pressPublish();
      dialogButton('Publish training program').click();
      await o.flush();
      expect(calls()).toEqual([[PUBLISH_TRAINING, { trainingId: 'tr_serving' }]]);
    });
  });

  describe('a draft with no scheduled class', () => {
    beforeEach(() => open(TRAINING, []));

    it('keeps Publish disabled but focusable, and says to schedule the classes first', () => {
      const button = publishButton()!;
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.hasAttribute('disabled')).toBe(false);
      expect(button.classList).toContain('opacity-50');
      const hint = main().querySelector<HTMLElement>(`#${button.getAttribute('aria-describedby')}`);
      expect(text(hint)).toBe('Schedule the classes first.');
    });

    it('a press opens no dialog and sends nothing', async () => {
      await pressPublish();
      expect(dialog()).toBeNull();
      expect(calls()).toEqual([]);
    });

    it('is enabled once a class is scheduled', async () => {
      o.subscription(LIST_CLASSES)!.emit([trainingClass()]);
      await o.flush();
      expect(publishButton()!.getAttribute('aria-disabled')).toBeNull();
      expect(main().textContent).not.toContain('Schedule the classes first.');
    });

    it('stays disabled while every class is cancelled', async () => {
      o.subscription(LIST_CLASSES)!.emit([trainingClass({ status: 'cancelled' })]);
      await o.flush();
      expect(publishButton()!.getAttribute('aria-disabled')).toBe('true');
    });
  });

  describe('while the classes load', () => {
    it('leaves Publish enabled, because the server checks for a class', async () => {
      await open(TRAINING, undefined);
      expect(publishButton()!.getAttribute('aria-disabled')).toBeNull();
    });
  });

  describe('a published training program', () => {
    beforeEach(() => open(PUBLISHED_TRAINING));

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
        training: { slug: 'tuesday-serving-clinic', name: 'Tuesday Serving Clinic' },
      });
    });
  });

  describe('the confirmation', () => {
    beforeEach(() => open(SCHEDULED_TRAINING));

    it('opens an alert dialog titled for the training program, with focus on Cancel and nothing sent', async () => {
      await pressPublish();
      const box = dialog()!;
      expect(box.getAttribute('aria-modal')).toBe('true');
      expect(text(box.querySelector('h2'))).toBe('Publish Tuesday Serving Clinic?');
      expect(text(box.querySelector('[data-slot="alert-dialog-description"]'))).toBe(
        'Its page will be public. Training programs can’t be unpublished yet.',
      );
      const [cancel, publish] = [...box.querySelectorAll('button')];
      expect([text(cancel), text(publish)]).toEqual(['Cancel', 'Publish training program']);
      expect(tokens(cancel.className)).toEqual(tokens(OUTLINE_BUTTON));
      expect(tokens(publish.className)).toEqual(tokens(PRIMARY_BUTTON));
      expect(document.activeElement).toBe(cancel);
      expect(calls()).toEqual([]);
      expect(page.querySelector('app-training-management')?.hasAttribute('inert')).toBe(true);
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
      expect(page.querySelector('app-training-management')?.hasAttribute('inert')).toBe(false);
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
    beforeEach(() => open(SCHEDULED_TRAINING));

    it('calls trainings.publish with the id; the button reads Publishing… and Cancel does nothing meanwhile', async () => {
      await pressPublish();
      dialogButton('Publish training program').click();
      await o.flush();
      expect(calls()).toEqual([[PUBLISH_TRAINING, { trainingId: 'tr_serving' }]]);
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
        'Tuesday Serving Clinic is published.',
      );
      expect(text(region.querySelector('[data-slot="alert-description"]'))).toBe(
        'Its page is public now. View public page',
      );
      expect(region.querySelector('a')!.getAttribute('href')).toBe(PUBLIC_PATH);
      expect(document.activeElement).toBe(region);
      expect(page.querySelector('app-training-management')?.hasAttribute('inert')).toBe(false);
    });

    it('shows the server’s message when it refuses, in the open dialog with focus on it, and the draft stays', async () => {
      await pressPublish();
      dialogButton('Publish training program').click();
      await o.flush();
      o.convex.calls[0].reject(
        new ConvexError({ code: 'noClasses', message: 'Schedule the classes first.' }),
      );
      await o.flush();
      const alert = dialog()!.querySelector<HTMLElement>('[role="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The training program could not be published.',
      );
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Schedule the classes first.',
      );
      expect(document.activeElement).toBe(alert);
      expect(badge()).toBe('Draft');
    });

    it('any other failure shows what to do, never the error message, and Publish can be pressed again', async () => {
      await pressPublish();
      dialogButton('Publish training program').click();
      await o.flush();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = dialog()!.querySelector<HTMLElement>('[role="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
      expect(page.textContent + dialog()!.textContent).not.toContain('secret');
      dialogButton('Publish training program').click();
      await o.flush();
      expect(calls()).toHaveLength(2);
    });

    it('a refusal from the adapter at call time shows the offline alert and the training program stays a draft', async () => {
      await pressPublish();
      dialogButton('Publish training program').click();
      await o.flush();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(dialog()!.querySelector('[data-slot="alert"]'))).toBe(
        "You're offline. Nothing was sent. The training program is still a draft. Try again when you're connected.",
      );
    });

    afterEach(() => vi.restoreAllMocks());
  });
});
