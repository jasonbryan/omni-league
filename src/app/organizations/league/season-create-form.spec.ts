import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import { SEASON_MESSAGES } from '../../../../convex/lib/seasonInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { PRIMARY_BUTTON } from '../admin/button-classes';
import { openAdmin, text } from '../admin/testing/admin-harness';
import {
  COED,
  CREATE_SEASON,
  GET_ORGANIZER_CONTEXT,
  LEAGUE_ROUTES,
  LEAGUE_URL,
  LIST_FOR_ORGANIZER,
} from './testing/league-harness';

const tokens = (value: string) => value.split(' ').sort();

describe('SeasonCreateForm', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(context: unknown = COED) {
    o = await openAdmin(LEAGUE_ROUTES, LEAGUE_URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ORGANIZER_CONTEXT)!.emit(context);
    await o.flush();
    o.subscription(LIST_FOR_ORGANIZER)!.emit([]);
    await o.flush();
  }

  const input = (id: string) => page.querySelector<HTMLInputElement>(`#${id}`)!;
  const form = () => page.querySelector<HTMLFormElement>('#create-season form')!;
  const submitButton = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const formStatus = () => form().querySelector('p[role="status"].sr-only');
  const error = (id: string) => text(page.querySelector(`#${id}-error`)) ?? null;
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);
  const format = (key: string) => input(`format-${key}`);

  async function type(id: string, value: string) {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    await o.harness.fixture.whenStable();
  }

  async function chooseFormat(key: string) {
    const radio = format(key);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await o.harness.fixture.whenStable();
  }

  async function submit() {
    submitButton().click();
    await o.flush();
  }

  async function fill() {
    await type('name', 'Fall 2026');
    await type('start-date', '2026-09-01');
    await type('end-date', '2026-11-15');
    await type('registration-deadline', '2026-08-25');
    await chooseFormat('7v7');
  }

  const FALL_2026 = {
    leagueId: COED.leagueId,
    name: 'Fall 2026',
    slug: 'fall-2026',
    startDate: '2026-09-01',
    endDate: '2026-11-15',
    registrationDeadline: '2026-08-25',
    format: '7v7',
    minimumRosterSize: 7,
  };

  describe('the fields (states 4 and "Messages and attributes")', () => {
    it('is a labelled section and form with the mockup attributes', async () => {
      await open();
      const section = page.querySelector('#create-season')!;
      expect(section.tagName).toBe('SECTION');
      expect(section.getAttribute('aria-labelledby')).toBe('create-season-heading');
      expect(form().getAttribute('aria-labelledby')).toBe('create-season-heading');
      expect(form().getAttribute('aria-describedby')).toBe('create-season-note');
      expect(form().hasAttribute('novalidate')).toBe(true);
      expect(text(page.querySelector('#create-season-note'))).toBe(
        'New seasons start as drafts, which only your staff see.',
      );
      expect(text(submitButton())).toBe('Create draft season');
      expect(tokens(submitButton().className)).toEqual(tokens(`${PRIMARY_BUTTON} mt-6 w-full`));
      expect(text(formStatus())).toBe('');
    });

    it('has Name, Slug, three native date fields, and a numeric text Minimum roster size, in focus order', async () => {
      await open();
      const fields = [
        ['name', 'Name', 'text'],
        ['slug', 'Slug', 'text'],
        ['start-date', 'Start date', 'date'],
        ['end-date', 'End date', 'date'],
        ['registration-deadline', 'Registration deadline', 'date'],
        ['minimum-roster-size', 'Minimum roster size', 'text'],
      ] as const;
      for (const [id, label, type] of fields) {
        const field = input(id);
        expect(text(page.querySelector(`label[for="${id}"]`)), id).toBe(label);
        expect([field.type, field.required, field.getAttribute('autocomplete')], id).toEqual([
          type,
          true,
          'off',
        ]);
      }
      expect(input('minimum-roster-size').getAttribute('inputmode')).toBe('numeric');
      expect([...form().querySelectorAll('input')].map((field) => field.id)).toEqual([
        'name',
        'slug',
        'start-date',
        'end-date',
        'registration-deadline',
        'format-5v5',
        'format-7v7',
        'format-11v11',
        'minimum-roster-size',
      ]);
    });

    it('describes the fields as the mockup does', async () => {
      await open();
      expect(text(page.querySelector('#name-description'))).toBe(
        'Up to 100 characters, for example Spring 2028.',
      );
      expect(text(page.querySelector('#slug-description'))).toBe(
        '3 to 60 lowercase letters and digits, with single hyphens between them. Unique within Coed 7v7 Rec.',
      );
      expect(page.querySelector('#start-date-description')).toBeNull();
      expect(input('start-date').hasAttribute('aria-describedby')).toBe(false);
      expect(text(page.querySelector('#end-date-description'))).toBe('On or after the start date.');
      expect(text(page.querySelector('#registration-deadline-description'))).toBe(
        'Teams and free agents can register until the end of this day. It must be before the start date.',
      );
      expect(text(page.querySelector('#minimum-roster-size-description'))).toBe(
        'Set when you choose a format. You can raise it, never lower it.',
      );
      await chooseFormat('11v11');
      expect(text(page.querySelector('#minimum-roster-size-description'))).toBe(
        'At least 11 for 11v11. Raise it if teams need more players.',
      );
      expect(input('end-date').getAttribute('aria-describedby')).toBe('end-date-description');
    });

    it('Format is a fieldset of the league’s sport’s formats, none chosen, each described by its minimum', async () => {
      await open();
      const set = page.querySelector<HTMLFieldSetElement>('fieldset#format')!;
      expect(text(set.querySelector('legend'))).toBe('Format');
      const radios = [...set.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
      expect(radios.map((r) => [r.id, r.name, r.value, r.checked])).toEqual([
        ['format-5v5', 'format', '5v5', false],
        ['format-7v7', 'format', '7v7', false],
        ['format-11v11', 'format', '11v11', false],
      ]);
      expect(
        radios.map((r) => [
          text(set.querySelector(`label[for="${r.id}"]`)),
          text(set.querySelector(`#${r.id}-description`)),
          r.getAttribute('aria-describedby'),
        ]),
      ).toEqual([
        ['5v5', 'At least 5 players', 'format-5v5-description'],
        ['7v7', 'At least 7 players', 'format-7v7-description'],
        ['11v11', 'At least 11 players', 'format-11v11-description'],
      ]);
    });

    it('offers beach volleyball’s formats for a beach volleyball league (state 12)', async () => {
      await open({ ...COED, sport: 'beachVolleyball' });
      expect(
        [...page.querySelectorAll<HTMLInputElement>('fieldset#format input')].map((r) => r.value),
      ).toEqual(['2v2', '4v4', '6v6']);
    });

    describe('a sport with one format (softball)', () => {
      const SOFTBALL = { ...COED, sport: 'softball' };

      it('has its only format chosen, Minimum roster size set to its minimum, and the hint naming it', async () => {
        await open(SOFTBALL);
        const radios = [...page.querySelectorAll<HTMLInputElement>('fieldset#format input')];
        expect(radios.map((r) => [r.value, r.checked])).toEqual([['10v10', true]]);
        expect(input('minimum-roster-size').value).toBe('10');
        expect(text(page.querySelector('#minimum-roster-size-description'))).toBe(
          'At least 10 for 10v10. Raise it if teams need more players.',
        );
      });

      it('is sent with that format and minimum without the user choosing it', async () => {
        await open(SOFTBALL);
        await type('name', 'Fall 2026');
        await type('start-date', '2026-09-01');
        await type('end-date', '2026-11-15');
        await type('registration-deadline', '2026-08-25');
        await submit();
        expect(calls()).toEqual([
          [
            CREATE_SEASON,
            expect.objectContaining({ format: '10v10', minimumRosterSize: 10, name: 'Fall 2026' }),
          ],
        ]);
      });

      it('still has it chosen after a season was created, for the next one', async () => {
        await open(SOFTBALL);
        await type('name', 'Fall 2026');
        await type('start-date', '2026-09-01');
        await type('end-date', '2026-11-15');
        await type('registration-deadline', '2026-08-25');
        await submit();
        o.convex.calls[0].resolve({ seasonId: 'se_new' });
        await o.flush();
        expect(input('name').value).toBe('');
        expect(format('10v10').checked).toBe(true);
        expect(input('minimum-roster-size').value).toBe('10');
      });

      it('a sport with several formats still has none chosen', async () => {
        await open({ ...COED, sport: 'beachVolleyball' });
        expect(
          [...page.querySelectorAll<HTMLInputElement>('fieldset#format input')].map(
            (r) => r.checked,
          ),
        ).toEqual([false, false, false]);
        expect(input('minimum-roster-size').value).toBe('');
      });
    });

    it('has no limits fieldset: the maximum teams and roster size come later', async () => {
      await open();
      expect(page.querySelector('fieldset#limits')).toBeNull();
      expect(page.querySelector('#maximum-teams')).toBeNull();
    });

    it('choosing a format sets Minimum roster size to its minimum, again for another format', async () => {
      await open();
      expect(input('minimum-roster-size').value).toBe('');
      await chooseFormat('7v7');
      expect(input('minimum-roster-size').value).toBe('7');
      await type('minimum-roster-size', '9');
      await chooseFormat('11v11');
      expect(input('minimum-roster-size').value).toBe('11');
    });

    it('typing a name fills Slug with slugify(name) until Slug is edited', async () => {
      await open();
      await type('name', 'Fall 2026');
      expect(input('slug').value).toBe('fall-2026');
      await type('name', 'Spring 2028 (Rain)');
      expect(input('slug').value).toBe('spring-2028-rain');
      await type('name', '   ');
      expect(input('slug').value).toBe('');
      await type('slug', 'my-own');
      await type('name', 'Something else');
      expect(input('slug').value).toBe('my-own');
    });
  });

  describe('refused values (states 5 and 6)', () => {
    it('submitted empty (state 5): every message, aria attributes, focus on Name, nothing sent', async () => {
      await open();
      await submit();
      expect(error('name')).toBe('Enter the season’s name.');
      expect(error('slug')).toBe('Enter a slug for the season.');
      expect(error('start-date')).toBe('Enter the start date.');
      expect(error('end-date')).toBe('Enter the end date.');
      expect(error('registration-deadline')).toBe('Enter the registration deadline.');
      expect(error('format')).toBe('Choose a format.');
      expect(error('minimum-roster-size')).toBe('Enter the minimum roster size.');
      for (const id of ['name', 'slug', 'start-date', 'end-date', 'registration-deadline']) {
        expect(input(id).getAttribute('aria-invalid'), id).toBe('true');
        expect(input(id).getAttribute('aria-describedby'), id).toMatch(new RegExp(`${id}-error$`));
      }
      expect(input('start-date').getAttribute('aria-describedby')).toBe('start-date-error');
      expect(input('name').getAttribute('aria-describedby')).toBe('name-description name-error');
      expect(input('minimum-roster-size').getAttribute('aria-describedby')).toBe(
        'minimum-roster-size-description minimum-roster-size-error',
      );
      expect(page.querySelector('fieldset#format')?.getAttribute('aria-describedby')).toBe(
        'format-error',
      );
      expect(page.querySelector('#format-error')?.getAttribute('role')).toBe('alert');
      expect(format('5v5').getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(input('name'));
      expect(calls()).toEqual([]);
    });

    it('focus goes to the first invalid field, in order, down to the first format and Minimum', async () => {
      await open();
      await type('name', 'Fine');
      await type('slug', '');
      await submit();
      expect(document.activeElement).toBe(input('slug'));
      await type('slug', 'fine');
      await submit();
      expect(document.activeElement).toBe(input('start-date'));
      await type('start-date', '2026-09-01');
      await submit();
      expect(document.activeElement).toBe(input('end-date'));
      await type('end-date', '2026-11-15');
      await submit();
      expect(document.activeElement).toBe(input('registration-deadline'));
      await type('registration-deadline', '2026-08-25');
      await submit();
      expect(document.activeElement).toBe(format('5v5'));
      await chooseFormat('7v7');
      await type('minimum-roster-size', '');
      await submit();
      expect(document.activeElement).toBe(input('minimum-roster-size'));
      expect(calls()).toEqual([]);
    });

    it('refused values (state 6): an end before the start, a deadline on the start, a minimum under the format’s', async () => {
      await open();
      await type('name', 'Spring 2028');
      await type('start-date', '2028-03-01');
      await type('end-date', '2028-02-23');
      await type('registration-deadline', '2028-03-01');
      await chooseFormat('7v7');
      await type('minimum-roster-size', '6');
      await submit();
      expect(error('end-date')).toBe('The end date must be on or after the start date.');
      expect(error('registration-deadline')).toBe(
        'The registration deadline must be before the start date, Mar 1, 2028.',
      );
      expect(error('minimum-roster-size')).toBe('7v7 needs at least 7 players. Enter 7 or more.');
      expect(error('start-date')).toBeNull();
      expect(document.activeElement).toBe(input('end-date'));
      expect(calls()).toEqual([]);
    });

    it('7v7 with a minimum of 6 sends nothing and names 7; with 9 it is sent with 9', async () => {
      await open();
      await fill();
      await type('minimum-roster-size', '6');
      await submit();
      expect(error('minimum-roster-size')).toContain('Enter 7 or more');
      expect(calls()).toEqual([]);
      await type('minimum-roster-size', '9');
      expect(error('minimum-roster-size')).toBeNull();
      await submit();
      expect(calls()).toEqual([[CREATE_SEASON, { ...FALL_2026, minimumRosterSize: 9 }]]);
    });

    it('a minimum that is not a whole number or is over 99 gets the range message', async () => {
      await open();
      await fill();
      for (const value of ['7.5', '100', 'seven']) {
        await type('minimum-roster-size', value);
        await submit();
        expect(error('minimum-roster-size'), value).toBe('Enter a whole number from 7 to 99.');
      }
      expect(calls()).toEqual([]);
    });

    it('101 characters get the count message, and whitespace-only counts as empty', async () => {
      await open();
      await fill();
      await type('name', 'n'.repeat(101));
      await submit();
      expect(error('name')).toBe('Use 100 characters or fewer. This name has 101.');
      await type('name', '   ');
      await submit();
      expect(error('name')).toBe('Enter the season’s name.');
    });

    it('an invalid slug shows the format message, the reserved word `new` in bold', async () => {
      await open();
      await fill();
      for (const slug of ['Bad Slug', 'ab', 'a'.repeat(61), 'new', '-x-', 'a--b']) {
        await type('slug', slug);
        await submit();
        expect(error('slug'), slug).toBe(SEASON_MESSAGES.slugInvalid);
        expect(document.activeElement).toBe(input('slug'));
      }
      expect(page.querySelector('#slug-error strong')?.textContent).toBe('new');
      expect(calls()).toEqual([]);
    });

    it('an error clears once its field is valid', async () => {
      await open();
      await submit();
      await type('name', 'Fine');
      expect(error('name')).toBeNull();
      await chooseFormat('5v5');
      expect(error('format')).toBeNull();
      expect(error('minimum-roster-size')).toBeNull();
      await type('start-date', '2026-09-01');
      expect(error('start-date')).toBeNull();
    });
  });

  describe('checking a field when the user leaves it', () => {
    async function leave(id: string) {
      input(id).dispatchEvent(new Event('blur'));
      await o.harness.fixture.whenStable();
    }

    it('shows the error with aria-invalid and aria-describedby once a changed field is left', async () => {
      await open();
      await type('start-date', '2028-03-01');
      await type('end-date', '2028-02-23');
      await leave('end-date');
      expect(error('end-date')).toBe(SEASON_MESSAGES.endBeforeStart);
      expect(input('end-date').getAttribute('aria-invalid')).toBe('true');
      expect(input('end-date').getAttribute('aria-describedby')).toContain('end-date-error');

      await type('name', 'n'.repeat(101));
      await leave('name');
      expect(error('name')).toBe('Use 100 characters or fewer. This name has 101.');
      expect(input('name').getAttribute('aria-invalid')).toBe('true');

      await chooseFormat('7v7');
      await type('minimum-roster-size', '6');
      await leave('minimum-roster-size');
      expect(error('minimum-roster-size')).toBe('7v7 needs at least 7 players. Enter 7 or more.');
    });

    it('shows nothing while the user types an invalid partial value', async () => {
      await open();
      await type('slug', 'Not-Valid');
      expect(error('slug')).toBeNull();
      expect(input('slug').hasAttribute('aria-invalid')).toBe(false);
    });

    it('shows nothing when focus passes through a field that was never changed; a submit still shows it', async () => {
      await open();
      for (const id of ['name', 'slug', 'start-date', 'end-date', 'registration-deadline']) {
        await leave(id);
        expect(error(id), id).toBeNull();
      }
      await leave('minimum-roster-size');
      expect(error('minimum-roster-size')).toBeNull();
      await submit();
      expect(error('name')).toBe(SEASON_MESSAGES.nameEmpty);
      expect(error('start-date')).toBe(SEASON_MESSAGES.dateEmpty('startDate'));
    });

    it('clears the error on the keystroke that makes the value valid', async () => {
      await open();
      await type('slug', 'Not-Valid');
      await leave('slug');
      expect(error('slug')).toBe(SEASON_MESSAGES.slugInvalid);
      await type('slug', 'fall-2026');
      expect(error('slug')).toBeNull();
      expect(input('slug').hasAttribute('aria-invalid')).toBe(false);
    });

    it('checks a slug that followed the name when Slug is left', async () => {
      await open();
      await type('name', 'ab');
      await leave('slug');
      expect(error('slug')).toBe(SEASON_MESSAGES.slugInvalid);
    });

    it('a form emptied after a create starts again: passing through its fields shows nothing', async () => {
      await open();
      await fill();
      await submit();
      o.convex.calls[0].resolve({ seasonId: 'se_new' });
      await o.flush();
      expect(input('name').value).toBe('');
      for (const id of ['name', 'slug', 'start-date', 'end-date', 'registration-deadline']) {
        await leave(id);
        expect(error(id), id).toBeNull();
      }
    });
  });

  describe('sending', () => {
    it('sends the trimmed name and the values; while in flight the button says so (state 8)', async () => {
      await open();
      await fill();
      await type('name', '  Fall 2026 ');
      await submit();
      expect(calls()).toEqual([[CREATE_SEASON, FALL_2026]]);
      expect(text(submitButton())).toBe('Creating season…');
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expect(submitButton().disabled).toBe(false);
      expect(text(formStatus())).toBe('Creating the season.');
      await submit();
      expect(o.convex.calls).toHaveLength(1);
    });

    it('on success (state 9): "<season> created as a draft." above the fields, the form cleared, focus on the button', async () => {
      await open();
      await fill();
      await submit();
      o.convex.calls[0].resolve({ seasonId: 'se_new' });
      await o.flush();
      const status = form().querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(status.getAttribute('role')).toBe('status');
      expect(text(status.querySelector('[data-slot="alert-title"]'))).toBe(
        'Fall 2026 created as a draft.',
      );
      expect(text(status.querySelector('[data-slot="alert-description"]'))).toBe(
        'Publish it when it’s ready for players to see.',
      );
      expect(
        status.compareDocumentPosition(input('name')) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      for (const id of ['name', 'slug', 'start-date', 'end-date', 'registration-deadline']) {
        expect(input(id).value, id).toBe('');
      }
      expect(input('minimum-roster-size').value).toBe('');
      expect(format('7v7').checked).toBe(false);
      expect(document.activeElement).toBe(submitButton());
      expect(text(submitButton())).toBe('Create draft season');
      expect(submitButton().hasAttribute('aria-disabled')).toBe(false);
      await type('name', 'Next One');
      expect(input('slug').value).toBe('next-one');
      await submit();
      expect(form().querySelector('[data-slot="alert"][role="status"]')).toBeNull();
    });

    it('the server saying the slug is taken (state 7) shows the message with the slug in bold, and focus on Slug', async () => {
      await open();
      await fill();
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'slug',
          code: 'slugTaken',
          message: SEASON_MESSAGES.slugTaken('fall-2026', 'Coed 7v7 Rec'),
        }),
      );
      await o.flush();
      expect(error('slug')).toBe(
        'fall-2026 is already used by another season of Coed 7v7 Rec. Choose another slug.',
      );
      expect(page.querySelector('#slug-error strong')?.textContent).toBe('fall-2026');
      expect(document.activeElement).toBe(input('slug'));
      expect(input('slug').getAttribute('aria-invalid')).toBe('true');
      expect(input('name').value).toBe('Fall 2026');
      await type('slug', 'fall-2026-b');
      expect(error('slug')).toBeNull();
    });

    it('a date the server calls unreal shows "Enter a real date." on that field', async () => {
      await open();
      await fill();
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'startDate',
          code: 'dateInvalid',
          message: SEASON_MESSAGES.dateInvalid,
        }),
      );
      await o.flush();
      expect(error('start-date')).toBe('Enter a real date.');
      expect(document.activeElement).toBe(input('start-date'));
    });

    it('any other failure shows the form alert and focuses it, keeping the values (state 10)', async () => {
      await open();
      await fill();
      await submit();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = form().querySelector<HTMLElement>('[role="alert"][data-slot="alert"]')!;
      expect(text(alert)).toBe(
        'The season could not be created. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(document.activeElement).toBe(alert);
      expect(input('name').value).toBe('Fall 2026');
      expect(text(submitButton())).toBe('Create draft season');
    });

    it('a refusal from the adapter at call time (offline) shows the offline alert', async () => {
      await open();
      await fill();
      await submit();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(form().querySelector('[data-slot="alert"]'))).toBe(
        "You're offline. Nothing was sent. Your season details are still here. Try again when you're connected.",
      );
    });

    describe('offline', () => {
      afterEach(() => vi.restoreAllMocks());

      async function goOffline() {
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
        window.dispatchEvent(new Event('offline'));
        TestBed.tick();
        await o.harness.fixture.whenStable();
      }

      it('the button looks disabled but stays focusable, and a press shows the offline alert and sends nothing', async () => {
        await open();
        await fill();
        await goOffline();
        expect(submitButton().getAttribute('aria-disabled')).toBe('true');
        expect(submitButton().classList.contains('opacity-50')).toBe(true);
        expect(submitButton().hasAttribute('disabled')).toBe(false);
        await submit();
        expect(o.convex.calls).toEqual([]);
        const box = form().querySelector<HTMLElement>('[data-slot="alert"]')!;
        expect(text(box.querySelector('[data-slot="alert-title"]'))).toBe(
          "You're offline. Nothing was sent.",
        );
        expect(text(box.querySelector('[data-slot="alert-description"]'))).toBe(
          "Your season details are still here. Try again when you're connected.",
        );
        expect(document.activeElement).toBe(box);
        expect(input('name').value).toBe('Fall 2026');
      });

      it('validation comes first: an empty form offline shows the field errors, not the alert', async () => {
        await open();
        await goOffline();
        await submit();
        expect(error('name')).toBe('Enter the season’s name.');
        expect(form().querySelector('[data-slot="alert"]')).toBeNull();
      });
    });
  });
});
