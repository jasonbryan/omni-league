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

  async function type(id: string, value: string) {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event('input'));
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
  }

  const FALL_2026 = {
    leagueId: COED.leagueId,
    name: 'Fall 2026',
    slug: 'fall-2026',
    startDate: '2026-09-01',
    endDate: '2026-11-15',
    registrationDeadline: '2026-08-25',
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
      expect(tokens(submitButton().className)).toEqual(
        tokens(`${PRIMARY_BUTTON} w-full sm:w-auto`),
      );
      expect(text(formStatus())).toBe('');
    });

    it('has Name, Slug, and three native date fields, in focus order', async () => {
      await open();
      const fields = [
        ['name', 'Name', 'text'],
        ['slug', 'Slug', 'text'],
        ['start-date', 'Start date', 'date'],
        ['end-date', 'End date', 'date'],
        ['registration-deadline', 'Registration deadline', 'date'],
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
      expect([...form().querySelectorAll('input')].map((field) => field.id)).toEqual([
        'name',
        'slug',
        'start-date',
        'end-date',
        'registration-deadline',
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
      expect(input('end-date').getAttribute('aria-describedby')).toBe('end-date-description');
    });

    it('has no Format or Minimum roster size field', async () => {
      await open();
      expect(page.querySelector('fieldset#format')).toBeNull();
      expect(form().querySelector('input[type="radio"]')).toBeNull();
      expect(page.querySelector('#minimum-roster-size')).toBeNull();
      expect(text(form())).not.toContain('Minimum roster size:');
    });

    it('has no limits fieldset: the maximum teams and roster size come later', async () => {
      await open();
      expect(page.querySelector('fieldset#limits')).toBeNull();
      expect(page.querySelector('#maximum-teams')).toBeNull();
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
      for (const id of ['name', 'slug', 'start-date', 'end-date', 'registration-deadline']) {
        expect(input(id).getAttribute('aria-invalid'), id).toBe('true');
        expect(input(id).getAttribute('aria-describedby'), id).toMatch(new RegExp(`${id}-error$`));
      }
      expect(input('start-date').getAttribute('aria-describedby')).toBe('start-date-error');
      expect(input('name').getAttribute('aria-describedby')).toBe('name-description name-error');
      expect(document.activeElement).toBe(input('name'));
      expect(calls()).toEqual([]);
    });

    it('focus goes to the first invalid field, in order', async () => {
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
      expect(calls()).toHaveLength(1);
    });

    it('refused values (state 6): an end before the start and a deadline on the start', async () => {
      await open();
      await type('name', 'Spring 2028');
      await type('start-date', '2028-03-01');
      await type('end-date', '2028-02-23');
      await type('registration-deadline', '2028-03-01');
      await submit();
      expect(error('end-date')).toBe('The end date must be on or after the start date.');
      expect(error('registration-deadline')).toBe(
        'The registration deadline must be before the start date, Mar 1, 2028.',
      );
      expect(error('start-date')).toBeNull();
      expect(document.activeElement).toBe(input('end-date'));
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

  describe('the division from the league (state 7)', () => {
    const block = () =>
      page.querySelector<HTMLElement>('section[aria-labelledby="from-league-heading"]')!;
    const division = () => text(block().querySelector('[data-slot="season-division"]'));
    const minimum = () => text(block().querySelector('[data-slot="season-minimum"]'));
    const NO_DIVISION = { ...COED, division: undefined };

    it('shows the league’s division and the minimum its format sets, read-only', async () => {
      await open();
      expect(text(block().querySelector('h3'))).toBe('From the league');
      expect(division()).toBe('Coed · 7v7 · Rec');
      expect(minimum()).toBe('7 players, set by the 7v7 format');
      expect(block().querySelector('input, select, textarea, button')).toBeNull();
    });

    it('says the minimum is raised when the league sets a higher one', async () => {
      await open({
        ...COED,
        division: {
          ...COED.division,
          playersPerSide: 6,
          minimumRosterSize: 8,
          label: 'Coed · 6v6 · Rec',
        },
      });
      expect(division()).toBe('Coed · 6v6 · Rec');
      expect(minimum()).toBe('8 players, raised for this league');
    });

    it('says the format sets the minimum when the league states the same number', async () => {
      await open({ ...COED, division: { ...COED.division, minimumRosterSize: 7 } });
      expect(minimum()).toBe('7 players, set by the 7v7 format');
    });

    it('says Not set yet for a league with no division', async () => {
      await open(NO_DIVISION);
      expect(division()).toBe('Not set yet');
      expect(minimum()).toBe('Not set yet');
    });

    it('links to the league details and keeps the published seasons note', async () => {
      await open();
      const link = block().querySelector<HTMLAnchorElement>('a')!;
      expect(text(link)).toBe('edit the league details');
      expect(link.getAttribute('href')).toBe(`${LEAGUE_URL}#details`);
      expect(text(block().querySelector('p'))).toBe(
        'To change them, edit the league details. Seasons already published keep theirs.',
      );
    });

    it('a click on the link scrolls to the league details and moves focus into the form', async () => {
      await open();
      const scrolled = vi.fn();
      page.querySelector<HTMLElement>('#details')!.scrollIntoView = scrolled;
      block().querySelector<HTMLAnchorElement>('a')!.click();
      await o.harness.fixture.whenStable();
      expect(scrolled).toHaveBeenCalledOnce();
      expect(page.querySelector('#details')!.contains(document.activeElement)).toBe(true);
    });

    it('sends only the name, slug, and dates', async () => {
      await open();
      await fill();
      await submit();
      expect(calls()).toEqual([[CREATE_SEASON, FALL_2026]]);
    });

    describe('a league with no format yet', () => {
      const refuse = () =>
        o.convex.calls[0].reject(
          new ConvexError({
            code: 'leagueFormatMissing',
            message: SEASON_MESSAGES.leagueFormatMissing,
          }),
        );

      const alert = () => form().querySelector<HTMLElement>('[role="alert"][data-slot="alert"]');

      it('shows the message above the action and the details link before anything is pressed', async () => {
        await open(NO_DIVISION);
        expect(text(alert())).toBe('Set this league’s format in its details first.');
        expect(
          alert()!.compareDocumentPosition(submitButton()) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(block().querySelector('a')!.getAttribute('href')).toBe(`${LEAGUE_URL}#details`);
      });

      it('shows no message for a league that has a division', async () => {
        await open();
        expect(alert()).toBeNull();
      });

      it('focuses the message when the server refuses, and keeps the input', async () => {
        await open(NO_DIVISION);
        await fill();
        await submit();
        refuse();
        await o.flush();
        expect(document.activeElement).toBe(alert());
        expect(input('name').value).toBe('Fall 2026');
        expect(form().querySelectorAll('[data-slot="field-error"]')).toHaveLength(0);
      });

      it('goes away once the league has a division', async () => {
        await open(NO_DIVISION);
        o.subscription(GET_ORGANIZER_CONTEXT)!.emit(COED);
        await o.flush();
        expect(alert()).toBeNull();
        expect(division()).toBe('Coed · 7v7 · Rec');
      });
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
