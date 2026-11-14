import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import { CAMP_SESSION_MESSAGES } from '../../../../convex/lib/campSessionInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { expectPendingSpinner } from '../../ui/testing/spinner';
import { PRIMARY_BUTTON } from './button-classes';
import { openAdmin, text } from './testing/admin-harness';
import {
  ADD_SESSION,
  CAMP,
  CAMP_ROUTES,
  CAMP_URL,
  GET_CAMP,
  LIST_SESSIONS,
} from './testing/camp-harness';

const tokens = (value: string) => value.split(' ').sort();

const VALID_ARGS = {
  campId: 'cp_junior',
  name: 'Week 1',
  startDate: '2027-07-05',
  endDate: '2027-07-09',
  dailyStartTime: '09:00',
  dailyEndTime: '12:00',
  places: 20,
  registrationDeadline: '2027-07-01',
};

describe('CampSessionForm', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open() {
    o = await openAdmin(CAMP_ROUTES, CAMP_URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET_CAMP)!.emit(CAMP);
    await o.flush();
    o.subscription(LIST_SESSIONS)!.emit([]);
    await o.flush();
  }

  const input = (id: string) => page.querySelector<HTMLInputElement>(`#add-session #${id}`)!;
  const form = () => page.querySelector<HTMLFormElement>('#add-session form')!;
  const submitButton = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const error = (id: string) => text(page.querySelector(`#add-session #${id}-error`)) ?? null;
  const addedStatus = () => form().querySelector<HTMLElement>('[data-slot="added-status"]')!;

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

  async function submit() {
    submitButton().click();
    await o.flush();
  }

  async function fill() {
    await type('name', 'Week 1');
    await type('start-date', '2027-07-05');
    await type('end-date', '2027-07-09');
    await type('registration-deadline', '2027-07-01');
    await type('daily-start-time', '09:00');
    await type('daily-end-time', '12:00');
    await type('places', '20');
  }

  beforeEach(() => open());

  describe('the fields', () => {
    it('has Name, Start date, End date, the two daily times, Places, and Registration deadline, each labelled', () => {
      const labels = [...form().querySelectorAll('label')].map((l) => [
        text(l),
        l.getAttribute('for'),
      ]);
      expect(labels).toEqual([
        ['Name', 'name'],
        ['Start date', 'start-date'],
        ['End date', 'end-date'],
        ['Registration deadline', 'registration-deadline'],
        ['Daily start time', 'daily-start-time'],
        ['Daily end time', 'daily-end-time'],
        ['Places', 'places'],
      ]);
      expect(
        ['start-date', 'end-date', 'registration-deadline'].map((id) => input(id).type),
      ).toEqual(['date', 'date', 'date']);
      expect(['daily-start-time', 'daily-end-time'].map((id) => input(id).type)).toEqual([
        'time',
        'time',
      ]);
      expect(input('places').getAttribute('inputmode')).toBe('numeric');
    });

    it('says the times are optional and what the places and deadline mean', () => {
      expect(text(page.querySelector('#daily-start-time-description'))).toBe(
        'Optional. Shown as entered, with no time zone.',
      );
      expect(text(page.querySelector('#places-description'))).toBe('From 1 to 500.');
      expect(text(page.querySelector('#registration-deadline-description'))).toBe(
        'On or before the start date.',
      );
    });
  });

  describe('checking a field when the user leaves it', () => {
    it('shows an end before the start under the end date, with the shared message, and clears it when fixed', async () => {
      await type('start-date', '2027-07-05');
      await type('end-date', '2027-07-04');
      expect(error('end-date')).toBeNull();
      await leave('end-date');
      expect(error('end-date')).toBe(CAMP_SESSION_MESSAGES.endBeforeStart);
      expect(input('end-date').getAttribute('aria-invalid')).toBe('true');
      await type('end-date', '2027-07-06');
      expect(error('end-date')).toBeNull();
    });

    it('shows a deadline after the start under the deadline, naming the start date', async () => {
      await type('start-date', '2027-07-05');
      await type('registration-deadline', '2027-07-06');
      await leave('registration-deadline');
      expect(error('registration-deadline')).toBe(
        CAMP_SESSION_MESSAGES.deadlineAfterStart('2027-07-05'),
      );
    });

    it('shows the deadline error when the start date is the one changed last', async () => {
      await type('registration-deadline', '2027-07-06');
      await leave('registration-deadline');
      expect(error('registration-deadline')).toBeNull();
      await type('start-date', '2027-07-05');
      await leave('start-date');
      expect(error('registration-deadline')).toBe(
        CAMP_SESSION_MESSAGES.deadlineAfterStart('2027-07-05'),
      );
    });

    it('shows 0 and 501 as places outside the range, and accepts 1 and 500', async () => {
      for (const places of ['0', '501']) {
        await type('places', places);
        await leave('places');
        expect(error('places'), places).toBe(CAMP_SESSION_MESSAGES.placesInvalid);
      }
      for (const places of ['1', '500']) {
        await type('places', places);
        expect(error('places'), places).toBeNull();
      }
    });

    it('asks for the end time when only the start time is entered', async () => {
      await type('daily-start-time', '09:00');
      await leave('daily-start-time');
      expect(error('daily-start-time')).toBeNull();
      await submit();
      expect(error('daily-end-time')).toBe(CAMP_SESSION_MESSAGES.endTimeMissing);
    });

    it('shows an end time that is not after the start time under the end time', async () => {
      await type('daily-start-time', '09:00');
      await type('daily-end-time', '08:00');
      await leave('daily-end-time');
      expect(error('daily-end-time')).toBe(CAMP_SESSION_MESSAGES.endTimeNotAfterStart('09:00'));
    });

    it('shows nothing for a field never changed, and nothing while the user is still typing a valid value', async () => {
      await leave('name');
      await leave('places');
      expect(error('name')).toBeNull();
      expect(error('places')).toBeNull();
    });
  });

  describe('submitting', () => {
    it('submitted empty: every message, focus on Name, nothing sent', async () => {
      await submit();
      expect(error('name')).toBe(CAMP_SESSION_MESSAGES.nameEmpty);
      expect(error('start-date')).toBe(CAMP_SESSION_MESSAGES.dateEmpty('startDate'));
      expect(error('end-date')).toBe(CAMP_SESSION_MESSAGES.dateEmpty('endDate'));
      expect(error('places')).toBe(CAMP_SESSION_MESSAGES.placesEmpty);
      expect(error('registration-deadline')).toBe(
        CAMP_SESSION_MESSAGES.dateEmpty('registrationDeadline'),
      );
      expect(error('daily-start-time')).toBeNull();
      expect(document.activeElement).toBe(input('name'));
      expect(o.convex.calls).toEqual([]);
    });

    it('focuses the first invalid field in the order of the page', async () => {
      await fill();
      await type('places', '0');
      await type('end-date', '2027-07-01');
      await submit();
      expect(document.activeElement).toBe(input('end-date'));
      await type('end-date', '2027-07-09');
      await submit();
      expect(document.activeElement).toBe(input('places'));
    });

    it('sends the values with the places as a number, and the times when both are entered', async () => {
      await fill();
      await submit();
      expect(o.convex.calls.map((c) => [c.name, c.args])).toEqual([[ADD_SESSION, VALID_ARGS]]);
    });

    it('sends no times when both are empty, and trims the name', async () => {
      await fill();
      await type('name', '  Week 1  ');
      await type('daily-start-time', '');
      await type('daily-end-time', '');
      await submit();
      expect(o.convex.calls[0].args).toEqual({
        campId: 'cp_junior',
        name: 'Week 1',
        startDate: '2027-07-05',
        endDate: '2027-07-09',
        places: 20,
        registrationDeadline: '2027-07-01',
      });
    });

    it('while in flight the button says so, stays focusable, and a second press sends nothing', async () => {
      await fill();
      await submit();
      expect(text(submitButton())).toBe('Adding session…');
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expect(submitButton().disabled).toBe(false);
      expectPendingSpinner(submitButton());
      expect(text(form().querySelector('p[role="status"].sr-only'))).toBe('Adding the session.');
      await submit();
      expect(o.convex.calls).toHaveLength(1);
      expect(tokens(submitButton().className)).toEqual(
        expect.arrayContaining(tokens(PRIMARY_BUTTON)),
      );
    });
  });

  describe('after a session is added', () => {
    async function added() {
      await fill();
      submitButton().focus();
      await submit();
      o.convex.calls[0].resolve({ campSessionId: 'cs_new' });
      await o.flush();
    }

    it('says "Session added." above the button, with focus kept on the button', async () => {
      await added();
      expect(text(addedStatus())).toBe('Session added.');
      expect(addedStatus().getAttribute('role')).toBe('status');
      expect(addedStatus().nextElementSibling).toBe(submitButton());
      expect(document.activeElement).toBe(submitButton());
      expect(text(submitButton())).toBe('Add session');
    });

    it('clears the name and the dates, and keeps the times and places the next session probably shares', async () => {
      await added();
      for (const id of ['name', 'start-date', 'end-date', 'registration-deadline']) {
        expect(input(id).value, id).toBe('');
      }
      expect(input('daily-start-time').value).toBe('09:00');
      expect(input('daily-end-time').value).toBe('12:00');
      expect(input('places').value).toBe('20');
      expect(error('name')).toBeNull();
      expect(error('registration-deadline')).toBeNull();
    });

    it('clears the status on the next edit', async () => {
      await added();
      await type('name', 'W');
      expect(text(addedStatus())).toBe('');
    });
  });

  describe('when the add fails', () => {
    it('shows the server’s refusal under the field it is about, focuses it, keeps every value, and clears it when that field changes', async () => {
      await fill();
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'endDate',
          code: 'endBeforeStart',
          message: CAMP_SESSION_MESSAGES.endBeforeStart,
        }),
      );
      await o.flush();
      expect(error('end-date')).toBe(CAMP_SESSION_MESSAGES.endBeforeStart);
      expect(document.activeElement).toBe(input('end-date'));
      expect(input('name').value).toBe('Week 1');
      expect(input('places').value).toBe('20');
      expect(input('registration-deadline').value).toBe('2027-07-01');
      await type('end-date', '2027-07-10');
      expect(error('end-date')).toBeNull();
    });

    it('shows the refusal of a camp with its sessions at the limit under Name, and keeps every value', async () => {
      await fill();
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'name',
          code: 'sessionLimit',
          message: CAMP_SESSION_MESSAGES.sessionLimit,
        }),
      );
      await o.flush();
      expect(error('name')).toBe(CAMP_SESSION_MESSAGES.sessionLimit);
      expect(document.activeElement).toBe(input('name'));
      expect(input('places').value).toBe('20');
      expect(input('registration-deadline').value).toBe('2027-07-01');
    });

    it('any other failure shows the form alert, titled and with what to do, focuses it, and keeps every value', async () => {
      await fill();
      await submit();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = form().querySelector<HTMLElement>('[role="alert"][data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The session could not be added.',
      );
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(document.activeElement).toBe(alert);
      for (const [id, value] of [
        ['name', 'Week 1'],
        ['start-date', '2027-07-05'],
        ['end-date', '2027-07-09'],
        ['daily-start-time', '09:00'],
        ['daily-end-time', '12:00'],
        ['places', '20'],
        ['registration-deadline', '2027-07-01'],
      ]) {
        expect(input(id).value, id).toBe(value);
      }
      expect(text(submitButton())).toBe('Add session');
    });

    it('a refusal from the adapter at call time (offline) shows the offline alert and keeps every value', async () => {
      await fill();
      await submit();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(form().querySelector('[data-slot="alert"]'))).toBe(
        "You're offline. Nothing was sent. Your details are still here. Try again when you're connected.",
      );
      expect(input('name').value).toBe('Week 1');
      expect(input('places').value).toBe('20');
    });

    describe('offline', () => {
      afterEach(() => vi.restoreAllMocks());

      it('the button looks disabled but stays focusable, and a press shows the offline alert, sends nothing, and keeps every value', async () => {
        await fill();
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
        window.dispatchEvent(new Event('offline'));
        TestBed.tick();
        await o.harness.fixture.whenStable();
        expect(submitButton().getAttribute('aria-disabled')).toBe('true');
        expect(submitButton().classList.contains('opacity-50')).toBe(true);
        expect(submitButton().hasAttribute('disabled')).toBe(false);
        await submit();
        expect(o.convex.calls).toEqual([]);
        const box = form().querySelector<HTMLElement>('[data-slot="alert"]')!;
        expect(text(box.querySelector('[data-slot="alert-title"]'))).toBe(
          "You're offline. Nothing was sent.",
        );
        expect(input('name').value).toBe('Week 1');
        expect(input('registration-deadline').value).toBe('2027-07-01');
      });
    });
  });
});
