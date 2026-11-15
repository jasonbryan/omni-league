import { ConvexError } from 'convex/values';
import { TRAINING_PATTERN_MESSAGES, WEEKDAY_NAMES } from '../../../../convex/lib/trainingPattern';
import { ConvexOfflineError } from '../../core/data/convex';
import { expectPendingSpinner } from '../../ui/testing/spinner';
import { PRIMARY_BUTTON } from './button-classes';
import { openAdmin, text } from './testing/admin-harness';
import {
  GET_TRAINING,
  LIST_CLASSES,
  SCHEDULE_CLASSES,
  TRAINING,
  TRAINING_ROUTES,
  TRAINING_URL,
} from './testing/training-harness';

const tokens = (value: string) => value.split(' ').sort();

const A_TUESDAY = '2027-01-05';
const TUESDAY = WEEKDAY_NAMES.indexOf('Tuesday');
const WEDNESDAY = WEEKDAY_NAMES.indexOf('Wednesday');

const VALID_ARGS = {
  trainingId: 'tr_serving',
  weekday: TUESDAY,
  startTime: '18:00',
  endTime: '19:00',
  firstDate: A_TUESDAY,
  weeks: 8,
  placesPerClass: 12,
  registrationDeadline: '2027-01-01',
  allowSingleRegistration: false,
};

describe('TrainingScheduleForm', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open() {
    o = await openAdmin(TRAINING_ROUTES, TRAINING_URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET_TRAINING)!.emit(TRAINING);
    await o.flush();
    o.subscription(LIST_CLASSES)!.emit([]);
    await o.flush();
  }

  const input = (id: string) => page.querySelector<HTMLInputElement>(`#schedule #${id}`)!;
  const form = () => page.querySelector<HTMLFormElement>('#schedule form')!;
  const submitButton = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const error = (id: string) => text(page.querySelector(`#schedule #${id}-error`)) ?? null;
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);

  async function type(id: string, value: string) {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await o.harness.fixture.whenStable();
  }

  async function leave(id: string) {
    input(id).dispatchEvent(new Event('blur'));
    await o.harness.fixture.whenStable();
  }

  async function weekday(day: number) {
    input(`weekday-${day}`).click();
    await o.harness.fixture.whenStable();
  }

  async function submit() {
    submitButton().click();
    await o.flush();
  }

  async function fill() {
    await weekday(TUESDAY);
    await type('start-time', '18:00');
    await type('end-time', '19:00');
    await type('first-date', '2027-01-05');
    await type('weeks', '8');
    await type('places-per-class', '12');
    await type('registration-deadline', '2027-01-01');
  }

  beforeEach(() => open());

  describe('the fields', () => {
    it('has Weekday, the two times, First date, Number of weeks, Places per class, the deadline, and the single-class choice, each labelled', () => {
      expect(
        [...form().querySelectorAll('legend, label')]
          .map((l) => [text(l), l.getAttribute('for')])
          .filter(([label]) => !WEEKDAYS.includes(label!)),
      ).toEqual([
        ['Weekday', null],
        ['Start time', 'start-time'],
        ['End time', 'end-time'],
        ['First date', 'first-date'],
        ['Number of weeks', 'weeks'],
        ['Places per class', 'places-per-class'],
        ['Series registration deadline', 'registration-deadline'],
        ['Allow single-class registration', 'allow-single'],
      ]);
      expect(['first-date', 'registration-deadline'].map((id) => input(id).type)).toEqual([
        'date',
        'date',
      ]);
      expect(['start-time', 'end-time'].map((id) => input(id).type)).toEqual(['time', 'time']);
      expect(input('weeks').getAttribute('inputmode')).toBe('numeric');
    });

    it('offers the seven weekdays, Monday first', () => {
      expect(
        [...page.querySelectorAll('#schedule #weekday label')].map((label) => text(label)),
      ).toEqual(WEEKDAYS);
    });

    it('says what the times, weeks, places, and deadline mean', () => {
      expect(text(page.querySelector('#start-time-description'))).toBe(
        'Shown as entered, with no time zone.',
      );
      expect(text(page.querySelector('#weeks-description'))).toBe('From 1 to 52.');
      expect(text(page.querySelector('#places-per-class-description'))).toBe('From 1 to 200.');
      expect(text(page.querySelector('#registration-deadline-description'))).toBe(
        'On or before the first class.',
      );
    });

    it('starts with single-class registration off', () => {
      expect(input('allow-single').getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('checking a field when the user leaves it', () => {
    it('shows an end time that is not after the start time under the end time, and clears it when fixed', async () => {
      await type('start-time', '18:00');
      await type('end-time', '17:00');
      expect(error('end-time')).toBeNull();
      await leave('end-time');
      expect(error('end-time')).toBe(TRAINING_PATTERN_MESSAGES.endTimeNotAfterStart('18:00'));
      expect(input('end-time').getAttribute('aria-invalid')).toBe('true');
      expect(input('end-time').getAttribute('aria-describedby')).toContain('end-time-error');
      await type('end-time', '19:00');
      expect(error('end-time')).toBeNull();
    });

    it('shows the end time error when the start time is the one changed last', async () => {
      await type('end-time', '17:00');
      await leave('end-time');
      await type('start-time', '18:00');
      await leave('start-time');
      expect(error('end-time')).toBe(TRAINING_PATTERN_MESSAGES.endTimeNotAfterStart('18:00'));
    });

    it.each(['0', '53', '1.5', 'many'])(
      'shows %s as a number of weeks outside 1 to 52',
      async (v) => {
        await type('weeks', v);
        await leave('weeks');
        expect(error('weeks')).toBe(TRAINING_PATTERN_MESSAGES.weeksInvalid);
      },
    );

    it.each(['0', '201', '2.5', 'lots'])('shows %s as places outside 1 to 200', async (v) => {
      await type('places-per-class', v);
      await leave('places-per-class');
      expect(error('places-per-class')).toBe(TRAINING_PATTERN_MESSAGES.placesInvalid);
    });

    it('accepts 1 and 52 weeks and 1 and 200 places', async () => {
      for (const [weeks, places] of [
        ['1', '1'],
        ['52', '200'],
      ]) {
        await type('weeks', weeks);
        await type('places-per-class', places);
        await leave('weeks');
        await leave('places-per-class');
        expect(error('weeks')).toBeNull();
        expect(error('places-per-class')).toBeNull();
      }
    });

    it('shows a first date off the weekday under the first date, naming both days', async () => {
      await weekday(TUESDAY);
      await type('first-date', '2027-01-06');
      await leave('first-date');
      expect(error('first-date')).toBe(
        'The first class must be on a Tuesday. Jan 6, 2027 is a Wednesday.',
      );
      await type('first-date', '2027-01-05');
      expect(error('first-date')).toBeNull();
    });

    it('shows the first date error when the weekday is the one changed last, and clears it when the weekday fits', async () => {
      await type('first-date', '2027-01-06');
      await leave('first-date');
      expect(error('first-date')).toBeNull();
      await weekday(TUESDAY);
      await leave('first-date');
      expect(error('first-date')).not.toBeNull();
      await weekday(WEDNESDAY);
      expect(error('first-date')).toBeNull();
    });

    it('shows a first date in the year 26 under the first date, with the shared wording', async () => {
      await weekday(TUESDAY);
      await type('first-date', '0026-11-17');
      await leave('first-date');
      expect(error('first-date')).toBe(TRAINING_PATTERN_MESSAGES.yearOutOfRange);
      await type('first-date', A_TUESDAY);
      expect(error('first-date')).toBeNull();
    });

    it('shows a series that ends after the year 9999 under the number of weeks, and clears it when the first date moves earlier', async () => {
      await weekday(WEDNESDAY);
      await type('first-date', '9999-12-01');
      await type('weeks', '6');
      await leave('weeks');
      expect(error('weeks')).toBe(TRAINING_PATTERN_MESSAGES.lastClassTooLate);
      await type('first-date', '9999-11-24');
      await leave('first-date');
      expect(error('weeks')).toBeNull();
    });

    it('shows a deadline after the first class under the deadline, naming the date', async () => {
      await type('first-date', '2027-01-05');
      await type('registration-deadline', '2027-01-06');
      await leave('registration-deadline');
      expect(error('registration-deadline')).toBe(
        TRAINING_PATTERN_MESSAGES.deadlineAfterFirstClass('2027-01-05'),
      );
    });

    it('shows the deadline error when the first date is the one changed last', async () => {
      await type('registration-deadline', '2027-01-06');
      await leave('registration-deadline');
      await type('first-date', '2027-01-05');
      await leave('first-date');
      expect(error('registration-deadline')).toBe(
        TRAINING_PATTERN_MESSAGES.deadlineAfterFirstClass('2027-01-05'),
      );
    });

    it('shows nothing while the user types a partial value, and nothing for a field never changed', async () => {
      await type('weeks', '5');
      expect(error('weeks')).toBeNull();
      await leave('places-per-class');
      expect(error('places-per-class')).toBeNull();
    });

    it('clears the error on the keystroke that makes the value valid', async () => {
      await type('weeks', '0');
      await leave('weeks');
      expect(error('weeks')).not.toBeNull();
      await type('weeks', '8');
      expect(error('weeks')).toBeNull();
    });
  });

  describe('submitting', () => {
    it('submitted empty: every message, focus on the weekday, nothing sent', async () => {
      await submit();
      expect(o.convex.calls).toEqual([]);
      expect(text(page.querySelector('#weekday-error'))).toBe(
        TRAINING_PATTERN_MESSAGES.weekdayEmpty,
      );
      expect(error('start-time')).toBe(TRAINING_PATTERN_MESSAGES.startTimeEmpty);
      expect(error('end-time')).toBe(TRAINING_PATTERN_MESSAGES.endTimeEmpty);
      expect(error('first-date')).toBe(TRAINING_PATTERN_MESSAGES.firstDateEmpty);
      expect(error('weeks')).toBe(TRAINING_PATTERN_MESSAGES.weeksEmpty);
      expect(error('places-per-class')).toBe(TRAINING_PATTERN_MESSAGES.placesEmpty);
      expect(error('registration-deadline')).toBe(TRAINING_PATTERN_MESSAGES.deadlineEmpty);
      expect(document.activeElement).toBe(page.querySelector('#schedule #weekday input'));
    });

    it('focus goes to the first invalid field, in page order', async () => {
      await weekday(TUESDAY);
      await submit();
      expect(document.activeElement).toBe(input('start-time'));
      await type('start-time', '18:00');
      await type('end-time', '19:00');
      await submit();
      expect(document.activeElement).toBe(input('first-date'));
      await type('first-date', '2027-01-05');
      await submit();
      expect(document.activeElement).toBe(input('weeks'));
      await type('weeks', '8');
      await submit();
      expect(document.activeElement).toBe(input('places-per-class'));
      await type('places-per-class', '12');
      await submit();
      expect(document.activeElement).toBe(input('registration-deadline'));
    });

    it('sends the values with the counts as numbers; while in flight the button says so', async () => {
      await fill();
      await submit();
      expect(calls()).toEqual([[SCHEDULE_CLASSES, VALID_ARGS]]);
      expect(text(submitButton())).toBe('Scheduling classes…');
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expect(submitButton().disabled).toBe(false);
      expectPendingSpinner(submitButton());
      expect(text(form().querySelector('p[role="status"].sr-only'))).toBe(
        'Scheduling the classes.',
      );
      await submit();
      expect(o.convex.calls).toHaveLength(1);
      expect(tokens(submitButton().className)).toEqual(
        expect.arrayContaining(tokens(PRIMARY_BUTTON)),
      );
    });

    it('sends allowSingleRegistration true once the box is checked', async () => {
      await fill();
      input('allow-single').click();
      await o.harness.fixture.whenStable();
      await submit();
      expect(calls()).toEqual([
        [SCHEDULE_CLASSES, { ...VALID_ARGS, allowSingleRegistration: true }],
      ]);
    });

    it('the server refusing a field shows its message under that field, focus on it, and every value kept', async () => {
      await fill();
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'weekday',
          code: 'alreadyScheduled',
          message: TRAINING_PATTERN_MESSAGES.alreadyScheduled,
        }),
      );
      await o.flush();
      expect(text(page.querySelector('#weekday-error'))).toBe(
        TRAINING_PATTERN_MESSAGES.alreadyScheduled,
      );
      expect(document.activeElement).toBe(page.querySelector('#schedule #weekday input'));
      expect(input('weeks').value).toBe('8');
      expect(input('start-time').value).toBe('18:00');
    });

    it('any other failure shows the form alert, titled and with what to do, focuses it, and keeps every value', async () => {
      await fill();
      await submit();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = form().querySelector<HTMLElement>('[role="alert"][data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The classes could not be scheduled.',
      );
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(document.activeElement).toBe(alert);
      expect(input('weeks').value).toBe('8');
      expect(text(submitButton())).toBe('Schedule classes');
    });

    it('a refusal from the adapter at call time (offline) shows the offline alert and keeps every value', async () => {
      await fill();
      await submit();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(form().querySelector('[data-slot="alert"]'))).toBe(
        "You're offline. Nothing was sent. Your details are still here. Try again when you're connected.",
      );
      expect(input('places-per-class').value).toBe('12');
    });

    it('the button looks disabled while offline but stays focusable, and a press shows the offline alert and sends nothing', async () => {
      await fill();
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      await o.harness.fixture.whenStable();
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expect(submitButton().classList.contains('opacity-50')).toBe(true);
      expect(submitButton().hasAttribute('disabled')).toBe(false);
      await submit();
      expect(o.convex.calls).toEqual([]);
      expect(text(form().querySelector('[data-slot="alert-title"]'))).toBe(
        "You're offline. Nothing was sent.",
      );
      vi.restoreAllMocks();
    });
  });
});

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
