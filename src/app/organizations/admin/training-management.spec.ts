import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { ConvexError } from 'convex/values';
import { TRAINING_PATTERN_MESSAGES } from '../../../../convex/lib/trainingPattern';
import { ConvexOfflineError } from '../../core/data/convex';
import { expectBar } from '../../shell/testing/bar-title';
import { expectBadgeSize } from '../../ui/testing/badge';
import { expectBareCards } from '../../ui/testing/card';
import { expectSkeletonBoxes } from '../../ui/testing/skeleton-boxes';
import { PRIMARY_BUTTON } from './button-classes';
import {
  COASTAL,
  expectPageAndShellSubscriptions,
  forbiddenError,
  openAdmin,
  text,
} from './testing/admin-harness';
import {
  AS_ORGANIZER,
  CANCEL_CLASS,
  CLASSES,
  CLASSES_ARGS,
  GET_TRAINING,
  LIST_CLASSES,
  LIST_MINE,
  RESTORE_CLASS,
  SCHEDULED_TRAINING,
  SCHEDULE_CLASSES,
  TRAINING,
  TRAINING_ARGS,
  TRAINING_BASE,
  TRAINING_ROUTES,
  TRAINING_URL,
  trainingClass,
} from './testing/training-harness';

const tokens = (value: string) => value.split(' ').sort();

describe('TrainingManagement', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 10, 15, 12, 0, 0) }));
  afterEach(() => vi.useRealTimers());

  async function open(result?: unknown, classes?: unknown[], url = TRAINING_URL) {
    o = await openAdmin(TRAINING_ROUTES, url);
    page = o.page;
    o.acceptToken();
    await o.flush();
    if (result !== undefined) o.subscription(GET_TRAINING)!.emit(result);
    await o.flush();
    if (classes) o.subscription(LIST_CLASSES)!.emit(classes);
    await o.flush();
  }

  const main = () => page.querySelector('main')!;
  const classesCard = () => page.querySelector<HTMLElement>('#classes')!;
  const items = () => [...page.querySelectorAll<HTMLElement>('#classes-list > li')];
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);
  const status = () => page.querySelector<HTMLElement>('[data-slot="class-status"]')!;
  const rowButton = (date: string, label: string) =>
    [
      ...items()
        .find((li) => text(li.querySelector('[data-slot="class-date"]')) === date)!
        .querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => text(button)?.startsWith(label))!;
  const undoButton = () =>
    [...status().querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === 'Undo')!;
  const details = () =>
    [...page.querySelectorAll('#details dl > div')].map((row) => [
      text(row.querySelector('dt')),
      [...row.querySelectorAll('dd')].map(text),
    ]);

  describe('the page', () => {
    it('asks trainings.getForManagement with the route’s slugs once the token is accepted, and the classes only once it has answered, with its id', async () => {
      o = await openAdmin(TRAINING_ROUTES, TRAINING_URL);
      expect(o.subscription(GET_TRAINING)).toBeUndefined();
      o.acceptToken();
      await o.flush();
      expect(o.subscription(GET_TRAINING)!.args).toEqual(TRAINING_ARGS);
      expect(o.subscription(LIST_CLASSES)).toBeUndefined();
      o.subscription(GET_TRAINING)!.emit(TRAINING);
      await o.flush();
      expect(o.subscription(LIST_CLASSES)!.args).toEqual(CLASSES_ARGS);
    });

    it('an org admin gets the admin sidebar, with Training marked, and the admin counts', async () => {
      await open(TRAINING, []);
      expectPageAndShellSubscriptions(o.convex, [
        [GET_TRAINING, TRAINING_ARGS],
        [LIST_CLASSES, CLASSES_ARGS],
      ]);
      const nav = page.querySelector('nav[aria-label="Coastal Bend Rec Club admin"]')!;
      expect(
        [...nav.querySelectorAll('a[aria-current]')].map((a) => [
          text(a),
          a.getAttribute('aria-current'),
        ]),
      ).toEqual([['Training', 'true']]);
      expect(o.convex.activeSubscriptions.map((s) => s.name)).not.toContain(LIST_MINE);
    });

    it('loading: skeleton shapes and a polite status, in the shell', async () => {
      await open();
      expect(text(main().querySelector('[role="status"]'))).toBe('Loading the training program.');
      expect(main().querySelector('h1')).toBeNull();
      expectSkeletonBoxes(main(), { 'rounded-md': 8 });
    });

    it('a null answer shows the not-found view', async () => {
      await open(null);
      expect(text(main().querySelector('h1'))).toBe('Page not found');
      expect(page.querySelector('app-not-found-view')).not.toBeNull();
      expect(o.subscription(LIST_CLASSES)).toBeUndefined();
    });

    it('a forbidden answer shows the no-access view, with no sidebar and no training data, and asks for no classes', async () => {
      await open();
      o.subscription(GET_TRAINING)!.fail(forbiddenError());
      await o.flush();
      expect(text(main().querySelector('h1'))).toBe('You can’t manage this training program');
      expect(text(main().querySelector('h1 + p'))).toBe(
        'Only org admins and the league organizers assigned to it can open it. If you should have access, ask an org admin to assign it to you.',
      );
      const link = main().querySelector<HTMLAnchorElement>('a[data-slot="button"]')!;
      expect([text(link), link.getAttribute('href')]).toEqual(['Go to your organizations', '/app']);
      expect(tokens(link.className)).toEqual(tokens(PRIMARY_BUTTON + ' mt-8'));
      expect(page.querySelector('app-admin-sidebar, app-league-sidebar')).toBeNull();
      expect(page.textContent).not.toContain('Tuesday Serving Clinic');
      expect(TestBed.inject(Title).getTitle()).toBe('No access | Omni League');
      expect(o.subscription(LIST_CLASSES)).toBeUndefined();
    });

    it('a failed query shows the server-error view, never the error message, and Try again keeps the page', async () => {
      await open();
      o.subscription(GET_TRAINING)!.fail(new Error('Server Error: secret'));
      await o.flush();
      expect(page.querySelector('app-server-error-view')).not.toBeNull();
      expect(page.textContent).not.toContain('secret');
      expect(main().querySelector('a')?.getAttribute('href')).toBe(TRAINING_URL);
    });
  });

  describe('an assigned organizer', () => {
    beforeEach(() => open(AS_ORGANIZER, []));

    it('manages the training program, and the breadcrumb leads to Your organizations', () => {
      const links = [...main().querySelectorAll('nav[aria-label="Breadcrumb"] a')];
      expect(links.map(text)).toEqual(['Your organizations', 'Tuesday Serving Clinic']);
      expect(links.map((a) => a.getAttribute('href'))).toEqual(['/app', TRAINING_URL]);
      expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page']);
      expect(page.querySelector('#schedule')).not.toBeNull();
    });

    it('gets the organizer sidebar, listing their training programs as links with this one marked, and none of the admin counts', async () => {
      const nav = page.querySelector('nav[aria-label="Coastal Bend Rec Club training programs"]')!;
      expect(nav).not.toBeNull();
      expect(page.querySelector('app-admin-sidebar')).toBeNull();
      expect(o.subscription(LIST_MINE)?.args).toEqual({});
      o.subscription(LIST_MINE)!.emit([
        {
          name: COASTAL.name,
          slug: COASTAL.slug,
          role: 'leagueOrganizer',
          leagues: [],
          trainings: [
            { name: 'Adult Passing Clinic', slug: 'adult-passing-clinic' },
            { name: 'Tuesday Serving Clinic', slug: 'tuesday-serving-clinic' },
          ],
        },
      ]);
      await o.flush();
      expect(
        [...nav.querySelectorAll('ul[aria-label="Your training programs"] a')].map((a) => [
          text(a),
          a.getAttribute('href'),
          a.getAttribute('aria-current'),
        ]),
      ).toEqual([
        ['Adult Passing Clinic', `${TRAINING_BASE}/adult-passing-clinic`, null],
        ['Tuesday Serving Clinic', TRAINING_URL, 'page'],
      ]);
      expect(nav.textContent).not.toContain('Your leagues');
    });

    it('schedules the classes with the same call an org admin makes', async () => {
      const form = page.querySelector<HTMLFormElement>('#schedule form')!;
      const set = (id: string, value: string) => {
        const input = form.querySelector<HTMLInputElement>(`#${id}`)!;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      form.querySelector<HTMLInputElement>('#weekday-2')!.click();
      set('start-time', '18:00');
      set('end-time', '19:00');
      set('first-date', '2027-01-05');
      set('weeks', '8');
      set('places-per-class', '12');
      set('registration-deadline', '2027-01-01');
      await o.harness.fixture.whenStable();
      form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await o.flush();
      expect(calls()).toEqual([
        [
          SCHEDULE_CLASSES,
          {
            trainingId: 'tr_serving',
            weekday: 2,
            startTime: '18:00',
            endTime: '19:00',
            firstDate: '2027-01-05',
            weeks: 8,
            placesPerClass: 12,
            registrationDeadline: '2027-01-01',
            allowSingleRegistration: false,
          },
        ],
      ]);
    });
  });

  describe('the training program', () => {
    beforeEach(() => open(TRAINING, []));

    it('has the breadcrumb organization, Training, and the program as the current page, and one h1', () => {
      const links = [...main().querySelectorAll('nav[aria-label="Breadcrumb"] a')];
      expect(links.map(text)).toEqual([COASTAL.name, 'Training', 'Tuesday Serving Clinic']);
      expect(links.map((a) => a.getAttribute('href'))).toEqual([
        `/app/organizations/${COASTAL.slug}`,
        TRAINING_BASE,
        TRAINING_URL,
      ]);
      expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, null, 'page']);
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(text(main().querySelector('h1'))).toBe('Tuesday Serving Clinic');
    });

    it('sets the title', () => {
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Tuesday Serving Clinic | Coastal Bend Rec Club | Omni League',
      );
    });

    it('shows Draft and the sport as badges, and Published for a published program', async () => {
      const badges = () => [...main().querySelectorAll('h1 + div [data-slot="badge"]')];
      expect(badges().map((b) => [b.getAttribute('data-variant'), text(b)])).toEqual([
        ['outline', 'Draft'],
        ['secondary', 'Beach volleyball'],
      ]);
      for (const badge of badges()) expectBadgeSize(badge, 'default');
      o.subscription(GET_TRAINING)!.emit({ ...TRAINING, status: 'published' });
      await o.flush();
      expect(badges().map((b) => [b.getAttribute('data-variant'), text(b)])).toEqual([
        ['default', 'Published'],
        ['secondary', 'Beach volleyball'],
      ]);
    });

    it('says a draft is for staff only', () => {
      expect(text(main().querySelector('app-admin-alert'))).toContain(
        'This training program is a draft',
      );
    });

    it('lists the coach, the ages, and the location with its address, and no schedule before the classes', () => {
      expect(text(page.querySelector('#details-heading'))).toBe('Details');
      expect(details()).toEqual([
        ['Coach', ['Dana Ruiz']],
        ['Ages', ['All ages']],
        [
          'Location',
          ['Pelican Shoals Sand Courts2150 Pelican Shoals Dr, Corpus Christi, TX 78418'],
        ],
      ]);
    });

    it('draws the details, the classes, and the schedule form as bare helm cards', () => {
      expectBareCards(main(), [
        'mt-6 max-w-2xl overflow-hidden',
        'mt-4 max-w-2xl overflow-hidden md:mt-6',
        'mt-4 max-w-2xl overflow-clip focus:outline-none md:mt-6',
      ]);
    });
  });

  describe('once the classes are scheduled', () => {
    it('adds the weekly pattern, the series deadline, and the single-class choice to the details, and reads the ages as stored', async () => {
      await open(SCHEDULED_TRAINING, CLASSES);
      expect(details().slice(1)).toEqual([
        ['Ages', ['16 or older']],
        [
          'Location',
          ['Pelican Shoals Sand Courts2150 Pelican Shoals Dr, Corpus Christi, TX 78418'],
        ],
        ['Weekly classes', ['Tuesdays, 6 PM to 7 PM, for 8 weeks, 12 places per class']],
        ['Series registration closes', ['Jan 1, 2027', 'Single-class registration is allowed.']],
      ]);
    });

    it('says single-class registration is not allowed, and reads one week and one place in the singular', async () => {
      await open(
        {
          ...SCHEDULED_TRAINING,
          pattern: {
            ...SCHEDULED_TRAINING.pattern,
            weeks: 1,
            placesPerClass: 1,
            allowSingleRegistration: false,
          },
        },
        CLASSES,
      );
      expect(text(page.querySelector('[data-slot="pattern"]'))).toBe(
        'Tuesdays, 6 PM to 7 PM, for 1 week, 1 place per class',
      );
      expect(text(page.querySelector('[data-slot="pattern-single"]'))).toBe(
        'Single-class registration is not allowed.',
      );
    });

    it('takes the schedule form away once there are classes', async () => {
      await open(TRAINING, CLASSES);
      expect(page.querySelector('#schedule')).toBeNull();
    });
  });

  describe('the classes', () => {
    it('loading: a skeleton and a polite status inside the card, with the details already there and a skeleton for the form', async () => {
      await open(TRAINING);
      expect(text(classesCard().querySelector('[role="status"]:not([data-slot])'))).toBe(
        'Loading the classes.',
      );
      expect(classesCard().querySelector('#classes-list')).toBeNull();
      expect(page.querySelector('#details')).not.toBeNull();
      expect(text(page.querySelector('#schedule [role="status"]'))).toBe('Loading the schedule.');
      expect(page.querySelector('#schedule form')).toBeNull();
    });

    it('empty: says what will appear and has the link to the form, which moves focus to the first weekday', async () => {
      await open(TRAINING, []);
      expect(text(classesCard())).toContain('No classes yet');
      const schedule = [...classesCard().querySelectorAll<HTMLAnchorElement>('a')].find(
        (a) => text(a) === 'Schedule classes',
      )!;
      expect(schedule).toBeDefined();
      expect(schedule.getAttribute('href')).toBe(`${TRAINING_URL}#schedule`);
      expect(schedule.getAttribute('data-slot')).toBe('button');
      page.querySelector<HTMLElement>('#schedule')!.scrollIntoView = vi.fn();
      schedule.click();
      await o.flush();
      expect(document.activeElement).toBe(page.querySelector('#schedule #weekday input'));
    });

    it('a failed list shows the destructive alert, never the error message, and leaves out the form', async () => {
      await open(TRAINING);
      o.subscription(LIST_CLASSES)!.fail(new Error('Server Error: secret'));
      await o.flush();
      const alert = classesCard().querySelector('[role="alert"][data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The classes could not be loaded.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(page.querySelector('#schedule')).toBeNull();
      expect(page.querySelector('#details')).not.toBeNull();
    });

    it('populated: a row per class in the order given, with its date, times, and registrations', async () => {
      await open(TRAINING, CLASSES);
      const slot = (li: HTMLElement, name: string) =>
        text(li.querySelector(`[data-slot="class-${name}"]`)) ?? null;
      expect(
        items().map((li) => [slot(li, 'date'), slot(li, 'times'), slot(li, 'registered')]),
      ).toEqual([
        ['Tue, Jan 5, 2027', '6 PM to 7 PM', '0 of 12 registered'],
        ['Tue, Jan 12, 2027', '6 PM to 7 PM', '3 of 12 registered'],
        ['Tue, Jan 19, 2027', '6 PM to 7 PM', '0 of 12 registered'],
      ]);
    });

    it('shows a cancelled class struck through with a Cancelled badge and a Restore button', async () => {
      await open(TRAINING, CLASSES);
      const [, , cancelled] = items();
      expect(cancelled.getAttribute('data-status')).toBe('cancelled');
      expect(
        cancelled.querySelector('[data-slot="class-date"]')!.classList.contains('line-through'),
      ).toBe(true);
      expect(text(cancelled.querySelector('[data-slot="badge"]'))).toBe('Cancelled');
      expect(rowButton('Tue, Jan 19, 2027', 'Restore')).toBeDefined();
      expect(rowButton('Tue, Jan 5, 2027', 'Restore')).toBeUndefined();
    });

    it('follows the live list: a class changed elsewhere appears at once', async () => {
      await open(TRAINING, [CLASSES[0]]);
      expect(items()).toHaveLength(1);
      o.subscription(LIST_CLASSES)!.emit(CLASSES);
      await o.flush();
      expect(items()).toHaveLength(3);
    });

    it('offers Cancel on a class with no registrations, and only a note on one with some', async () => {
      await open(TRAINING, CLASSES);
      expect(
        items().map((li) => [
          text(li.querySelector('[data-slot="class-date"]')),
          [...li.querySelectorAll('button')].map((button) => text(button)),
          text(li.querySelector('[data-slot="class-required"]')) ?? null,
        ]),
      ).toEqual([
        ['Tue, Jan 5, 2027', ['Cancel Tue, Jan 5, 2027'], null],
        ['Tue, Jan 12, 2027', [], 'Has registrations'],
        ['Tue, Jan 19, 2027', ['Restore Tue, Jan 19, 2027'], null],
      ]);
      expect(rowButton('Tue, Jan 5, 2027', 'Cancel').type).toBe('button');
      expect(rowButton('Tue, Jan 5, 2027', 'Cancel').getAttribute('data-slot')).toBe('button');
    });

    describe('Cancel and Undo', () => {
      async function cancel(date = 'Tue, Jan 5, 2027') {
        rowButton(date, 'Cancel').click();
        await o.flush();
      }

      async function cancelled() {
        await cancel();
        o.convex.calls[0].resolve(null);
        o.subscription(LIST_CLASSES)!.emit([
          trainingClass({ status: 'cancelled' }),
          ...CLASSES.slice(1),
        ]);
        await o.flush();
      }

      beforeEach(() => open(TRAINING, CLASSES));

      it('cancels at once with no dialog, the button saying so while it is in flight', async () => {
        await cancel();
        expect(calls()).toEqual([[CANCEL_CLASS, { trainingClassId: 'tc_1' }]]);
        expect(document.querySelector('[role="alertdialog"]')).toBeNull();
        expect(text(rowButton('Tue, Jan 5, 2027', 'Cancelling'))).toBe('Cancelling…');
        expect(rowButton('Tue, Jan 5, 2027', 'Cancelling').getAttribute('aria-disabled')).toBe(
          'true',
        );
        rowButton('Tue, Jan 5, 2027', 'Cancelling').click();
        await o.flush();
        expect(o.convex.calls).toHaveLength(1);
      });

      it('says "<date> cancelled." with Undo, and moves focus to the status', async () => {
        await cancelled();
        expect(text(status())).toBe('Tue, Jan 5, 2027 cancelled.Undo');
        expect(status().querySelector('[tabindex="-1"]')).toBe(document.activeElement);
        expect(items()[0].getAttribute('data-status')).toBe('cancelled');
      });

      it('Undo restores the same class, and says it was restored', async () => {
        await cancelled();
        undoButton().click();
        await o.flush();
        expect(calls().at(-1)).toEqual([RESTORE_CLASS, { trainingClassId: 'tc_1' }]);
        o.convex.calls[1].resolve(null);
        o.subscription(LIST_CLASSES)!.emit(CLASSES);
        await o.flush();
        expect(text(status())).toBe('Tue, Jan 5, 2027 restored.');
        expect(items()[0].getAttribute('data-status')).toBe('scheduled');
        expect(status().querySelector('[tabindex="-1"]')).toBe(document.activeElement);
      });

      it('a failed Undo says so under the status and keeps Undo', async () => {
        await cancelled();
        undoButton().click();
        await o.flush();
        o.convex.calls[1].reject(new Error('Server Error: secret'));
        await o.flush();
        expect(text(status())).toBe(
          'Tue, Jan 5, 2027 cancelled.Undo Tue, Jan 5, 2027 could not be restored. Try again.',
        );
        expect(page.textContent).not.toContain('secret');
        expect(undoButton()).toBeDefined();
      });

      it('Restore on a cancelled row restores it', async () => {
        rowButton('Tue, Jan 19, 2027', 'Restore').click();
        await o.flush();
        expect(calls()).toEqual([[RESTORE_CLASS, { trainingClassId: 'tc_3' }]]);
        o.convex.calls[0].resolve(null);
        await o.flush();
        expect(text(status())).toBe('Tue, Jan 19, 2027 restored.');
      });

      it('a failed Restore shows the alert with its date and what to do', async () => {
        rowButton('Tue, Jan 19, 2027', 'Restore').click();
        await o.flush();
        o.convex.calls[0].reject(new Error('Server Error: secret'));
        await o.flush();
        const alert = classesCard().querySelector<HTMLElement>('[role="alert"]')!;
        expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
          'Tue, Jan 19, 2027 could not be restored. Try again.',
        );
        expect(page.textContent).not.toContain('secret');
      });

      it('shows the server’s own message when it refuses to cancel a class with registrations, and keeps the row', async () => {
        await cancel();
        o.convex.calls[0].reject(
          new ConvexError({
            code: 'hasRegistrations',
            message: TRAINING_PATTERN_MESSAGES.hasRegistrations(2),
          }),
        );
        await o.flush();
        const alert = classesCard().querySelector<HTMLElement>('[role="alert"]')!;
        expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
          'Tue, Jan 5, 2027 could not be cancelled.',
        );
        expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
          TRAINING_PATTERN_MESSAGES.hasRegistrations(2),
        );
        expect(document.activeElement).toBe(alert);
        expect(text(rowButton('Tue, Jan 5, 2027', 'Cancel'))).toBe('Cancel Tue, Jan 5, 2027');
      });

      it('any other failure shows the alert with what to do, never the error message', async () => {
        await cancel();
        o.convex.calls[0].reject(new Error('Server Error: secret'));
        await o.flush();
        const alert = classesCard().querySelector<HTMLElement>('[role="alert"]')!;
        expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
          'Check your connection and try again.',
        );
        expect(page.textContent).not.toContain('secret');
      });

      it('offline: a refusal from the adapter says nothing was removed, and the class stays', async () => {
        await cancel();
        o.convex.calls[0].reject(new ConvexOfflineError());
        await o.flush();
        const alert = classesCard().querySelector<HTMLElement>('[role="alert"]')!;
        expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
          "You're offline. Nothing was removed.",
        );
      });

      it('a later cancel replaces the status and clears an earlier alert', async () => {
        await cancel();
        o.convex.calls[0].reject(new Error('Server Error'));
        await o.flush();
        await cancel();
        expect(classesCard().querySelector('[role="alert"]')).toBeNull();
      });
    });
  });

  describe('scheduling', () => {
    it('shows the form while there are no classes, and its success replaces the form with "<n> classes scheduled." and focuses the status', async () => {
      await open(TRAINING, []);
      expect(page.querySelector('#schedule form')).not.toBeNull();
      const form = page.querySelector<HTMLFormElement>('#schedule form')!;
      const set = (id: string, value: string) => {
        const input = form.querySelector<HTMLInputElement>(`#${id}`)!;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      form.querySelector<HTMLInputElement>('#weekday-2')!.click();
      set('start-time', '18:00');
      set('end-time', '19:00');
      set('first-date', '2027-01-05');
      set('weeks', '8');
      set('places-per-class', '12');
      set('registration-deadline', '2027-01-01');
      await o.harness.fixture.whenStable();
      form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await o.flush();
      o.convex.calls[0].resolve({ classCount: 8 });
      o.subscription(LIST_CLASSES)!.emit(
        Array.from({ length: 8 }, (_, week) =>
          trainingClass({
            trainingClassId: `tc_${week}`,
            date: `2027-01-${String(5 + week * 7).padStart(2, '0')}`,
          }),
        ),
      );
      await o.flush();
      expect(text(status())).toBe('8 classes scheduled.');
      expect(status().querySelector('[tabindex="-1"]')).toBe(document.activeElement);
      expect(page.querySelector('#schedule')).toBeNull();
      expect(items()).toHaveLength(8);
    });
  });

  describe('slim bar', () => {
    it('reads "Training program" while the query is held, then the program name', async () => {
      await open();
      expectBar(page, 'Training program');
      o.subscription(GET_TRAINING)!.emit(TRAINING);
      await o.flush();
      expectBar(page, 'Tuesday Serving Clinic');
    });

    it('names the not-found, no-access and server-error views', async () => {
      await open(TRAINING);
      o.subscription(GET_TRAINING)!.emit(null);
      await o.flush();
      expectBar(page, 'Page not found');
      o.subscription(GET_TRAINING)!.fail(forbiddenError());
      await o.flush();
      expectBar(page, 'No access');
      o.subscription(GET_TRAINING)!.fail(new Error('Server Error: secret'));
      await o.flush();
      expectBar(page, 'Temporarily unavailable');
    });

    it('keeps the program name through a navigation to the same path with a new fragment', async () => {
      await open(TRAINING, []);
      await TestBed.inject(Router).navigateByUrl(`${TRAINING_URL}#schedule`);
      await o.flush();
      expectBar(page, 'Tuesday Serving Clinic');
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Tuesday Serving Clinic | Coastal Bend Rec Club | Omni League',
      );
    });
  });
});
