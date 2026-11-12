import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ConvexError } from 'convex/values';
import { TOURNAMENT_MESSAGES } from '../../../../convex/lib/tournamentInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { AVAILABILITY_PAUSE_MS } from '../../core/forms/slug-availability';
import { expectBadgeSize } from '../../ui/testing/badge';
import { expectBareCards } from '../../ui/testing/card';
import { expectSkeletonBoxes } from '../../ui/testing/skeleton-boxes';
import { expectPendingSpinner } from '../../ui/testing/spinner';
import { AdminArea } from './admin-area';
import { AdminTournaments } from './admin-tournaments';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import {
  adminRoutes,
  COASTAL,
  COASTAL_LOCATIONS,
  GET_ADMIN_CONTEXT,
  LIST_FOR_ADMIN,
  openAdmin,
  text,
  expectPageAndShellSubscriptions,
  forbiddenError,
} from './testing/admin-harness';

const ROUTES = adminRoutes(AdminArea, [{ path: 'tournaments', component: AdminTournaments }]);
const URL = `/app/organizations/${COASTAL.slug}/tournaments`;
const LIST_TOURNAMENTS = 'tournaments:listForOrganization';
const CREATE = 'tournaments:create';
const IS_AVAILABLE = 'tournaments:isSlugAvailable';
const tokens = (value: string) => value.split(' ').sort();

const TOURNAMENTS = [
  {
    tournamentId: 'tn_spring',
    name: 'Spring Open',
    slug: 'spring-open',
    startDate: '2027-04-10',
    endDate: '2027-04-10',
    status: 'published',
  },
  {
    tournamentId: 'tn_winter',
    name: 'Winter Doubles Classic',
    slug: 'winter-doubles-classic',
    startDate: '2027-01-16',
    endDate: '2027-01-17',
    status: 'draft',
  },
];

describe('AdminTournaments', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(
    tournaments?: unknown[],
    locations: unknown[] | null = COASTAL_LOCATIONS,
    url = URL,
  ) {
    o = await openAdmin(ROUTES, url);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
    await o.flush();
    if (tournaments) o.subscription(LIST_TOURNAMENTS)!.emit(tournaments);
    if (locations) o.subscription(LIST_FOR_ADMIN)!.emit(locations);
    await o.flush();
  }

  const input = (id: string) => page.querySelector<HTMLInputElement>(`#${id}`)!;
  const form = () => page.querySelector<HTMLFormElement>('#create-tournament form')!;
  const submitButton = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const items = () => [...page.querySelectorAll<HTMLElement>('#tournaments-list > li')];
  const error = (id: string) => text(page.querySelector(`#${id}-error`)) ?? null;
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);
  const location = (n: number) => page.querySelector<HTMLButtonElement>(`#location-${n}`)!;

  async function type(id: string, value: string) {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    await o.harness.fixture.whenStable();
  }

  async function leave(id: string) {
    input(id).dispatchEvent(new Event('blur'));
    await o.harness.fixture.whenStable();
  }

  async function choose(id: string) {
    const radio = input(id);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await o.harness.fixture.whenStable();
  }

  async function submit() {
    submitButton().click();
    await o.flush();
  }

  async function fill() {
    await type('name', 'Winter Doubles Classic');
    await choose('sport-beachVolleyball');
    await choose('format-2');
    await choose('level-open');
    location(1).click();
    await type('start-date', '2027-01-16');
    await type('end-date', '2027-01-17');
    await type('registration-deadline', '2027-01-09');
    await type('maximum-teams', '16');
  }

  const VALID_ARGS = {
    organizationId: COASTAL.organizationId,
    name: 'Winter Doubles Classic',
    slug: 'winter-doubles-classic',
    sport: 'beachVolleyball',
    locationIds: ['loc_pelican'],
    gender: 'coed',
    playersPerSide: 2,
    level: 'open',
    ageGroup: 'adult',
    startDate: '2027-01-16',
    endDate: '2027-01-17',
    registrationDeadline: '2027-01-09',
    maximumTeams: 16,
  };

  describe('the page', () => {
    it('asks tournaments.listForOrganization and locations.listForAdmin with the organization id, only after the context says ready', async () => {
      await open();
      expectPageAndShellSubscriptions(o.convex, [
        [GET_ADMIN_CONTEXT, { slug: COASTAL.slug }],
        [LIST_TOURNAMENTS, { organizationId: COASTAL.organizationId }],
        [LIST_FOR_ADMIN, { organizationId: COASTAL.organizationId }],
      ]);
    });

    it('asks for nothing when the caller has no access', async () => {
      o = await openAdmin(ROUTES, URL);
      o.acceptToken();
      o.subscription(GET_ADMIN_CONTEXT)!.fail(forbiddenError());
      await o.flush();
      expect(o.convex.activeSubscriptions.map((s) => s.name)).not.toContain(LIST_TOURNAMENTS);
      expect(o.page.querySelector('#tournaments-list')).toBeNull();
      expect(o.page.querySelector('#create-tournament')).toBeNull();
    });

    it('has the organization, the h1, the sentence, and the title', async () => {
      await open([]);
      const main = page.querySelector('main')!;
      expect(text(main.querySelector('p.text-sm.font-medium'))).toBe('Coastal Bend Rec Club');
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(text(main.querySelector('h1'))).toBe('Tournaments');
      expect(text(main.querySelector('h1 + p'))).toBe(
        'A tournament is a one-time event with a bracket. Drafts are visible only to your staff.',
      );
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Tournaments | Coastal Bend Rec Club | Omni League',
      );
    });

    it('draws the list and the create panel as bare helm cards, the create panel still focusable and outline-free', async () => {
      await open([]);
      const main = page.querySelector('main')!;
      expectBareCards(main, ['overflow-hidden lg:col-span-2', 'overflow-clip focus:outline-none']);
      expect(main.querySelector('#create-tournament')!.getAttribute('tabindex')).toBe('-1');
    });

    it('loading: skeleton rows and a polite status, with the create panel already there', async () => {
      await open(undefined, null);
      const panel = page.querySelector('section[aria-labelledby="tournaments-heading"]')!;
      expect(text(panel.querySelector('[role="status"]'))).toBe('Loading the tournaments.');
      expect(panel.querySelector('ul')).toBeNull();
      expect(panel.querySelectorAll('[aria-hidden="true"].divide-y > div')).toHaveLength(3);
      expectSkeletonBoxes(panel, { 'rounded-md': 6 });
      expect(text(page.querySelector('#create-tournament h2'))).toBe('Create a tournament');
      expect(page.querySelector('#create-tournament form')).toBeNull();
    });

    it('empty: says what will appear, and the form is below', async () => {
      await open([]);
      const panel = page.querySelector('section[aria-labelledby="tournaments-heading"]')!;
      expect(text(panel.querySelector('p.font-medium'))).toBe('No tournaments yet');
      expect(text(panel)).toContain('Create a tournament to run a one-time event with a bracket.');
      expect(panel.querySelector('ul')).toBeNull();
      expect(page.querySelector('#create-tournament form')).not.toBeNull();
    });

    it('populated: a row per tournament with its name, dates, and Draft or Published', async () => {
      await open(TOURNAMENTS);
      expect(items().map((li) => text(li.querySelector('h3')))).toEqual([
        'Spring Open',
        'Winter Doubles Classic',
      ]);
      const badges = (li: HTMLElement) =>
        [...li.querySelectorAll('[data-slot="badge"]')].map((b) => [
          b.getAttribute('data-variant'),
          text(b),
        ]);
      expect(badges(items()[0])).toEqual([['default', 'Published']]);
      expect(badges(items()[1])).toEqual([['outline', 'Draft']]);
      for (const badge of page.querySelectorAll('[data-slot="badge"]')) {
        expectBadgeSize(badge, 'default');
      }
      expect(text(items()[0].querySelector('p'))).toBe('Dates: Apr 10, 2027');
      expect(text(items()[1].querySelector('p'))).toBe('Dates: Jan 16 – Jan 17, 2027');
    });

    it('links each row’s name to its management page', async () => {
      await open(TOURNAMENTS);
      expect(
        items().map((li) => [
          text(li.querySelector('h3 a')),
          li.querySelector('h3 a')!.getAttribute('href'),
        ]),
      ).toEqual([
        ['Spring Open', `/app/organizations/${COASTAL.slug}/tournaments/spring-open`],
        [
          'Winter Doubles Classic',
          `/app/organizations/${COASTAL.slug}/tournaments/winter-doubles-classic`,
        ],
      ]);
    });

    it('a failed list shows the destructive alert, never the error message', async () => {
      await open(undefined, COASTAL_LOCATIONS);
      o.subscription(LIST_TOURNAMENTS)!.fail(new Error('Server Error: secret'));
      await o.flush();
      const alert = page.querySelector(
        'section[aria-labelledby="tournaments-heading"] [role="alert"]',
      );
      expect(text(alert)).toBe(
        'The tournaments could not be loaded. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
    });

    it('lists a tournament created elsewhere at once (the list is live)', async () => {
      await open(TOURNAMENTS.slice(0, 1));
      o.subscription(LIST_TOURNAMENTS)!.emit(TOURNAMENTS);
      await o.flush();
      expect(items()).toHaveLength(2);
    });

    it('replaces the form with "Add a location first" and a link to Locations when there is none', async () => {
      await open(TOURNAMENTS, []);
      const panel = page.querySelector('#create-tournament')!;
      expect(text(panel.querySelector('p.font-medium'))).toBe('Add a location first');
      expect(text(panel)).toContain('Every tournament is held at one or more of your locations.');
      const link = panel.querySelector<HTMLAnchorElement>('a')!;
      expect(link.getAttribute('href')).toBe(`/app/organizations/${COASTAL.slug}/locations`);
      expect(tokens(link.className)).toEqual(tokens(OUTLINE_BUTTON));
      expect(page.querySelector('form')).toBeNull();
      expect(items()).toHaveLength(2);
    });

    it('has a jump link to the form for phones, which moves focus to Name', async () => {
      await open([]);
      const link = page.querySelector<HTMLAnchorElement>('main a[data-slot="button"]')!;
      expect(text(link)).toBe('Create a tournament');
      expect(link.getAttribute('href')).toBe(`${URL}#create-tournament`);
      expect(link.classList.contains('lg:hidden')).toBe(true);
      page.querySelector<HTMLElement>('#create-tournament')!.scrollIntoView = vi.fn();
      link.click();
      await o.flush();
      expect(document.activeElement).toBe(input('name'));
    });
  });

  describe('the form', () => {
    it('has Name, Web address, Sport, the division, Locations, the dates, and Maximum teams, and no minimum roster size', async () => {
      await open([]);
      await choose('sport-beachVolleyball');
      const labels = [...form().querySelectorAll('label, legend')].map((element) => text(element));
      for (const label of [
        'Name',
        'Web address',
        'Sport',
        'Gender',
        'Format',
        'Level',
        'Age group',
        'Locations',
        'Start date',
        'End date',
        'Registration deadline',
        'Maximum teams',
      ]) {
        expect(labels, label).toContain(label);
      }
      expect(form().textContent).not.toContain('Minimum roster size');
      expect(form().textContent).not.toContain('Raise the minimum');
    });

    it('names the tournament, not the league, in the division fields', async () => {
      await open([]);
      await choose('sport-beachVolleyball');
      const division = text(form().querySelector('app-league-division-fields'));
      expect(division).toContain('Adult unless the tournament is for an age bracket');
      expect(division).not.toContain('league');
    });

    it('shows the only location checked, so a valid form needs no tick', async () => {
      await open([], COASTAL_LOCATIONS.slice(0, 1));
      expect(location(1).getAttribute('aria-checked')).toBe('true');
    });

    it('with two or more locations none is checked', async () => {
      await open([]);
      expect(location(1).getAttribute('aria-checked')).toBe('false');
    });

    it('typing a name fills Web address from it until Web address is edited', async () => {
      await open([]);
      await type('name', 'Winter Doubles Classic');
      expect(input('slug').value).toBe('winter-doubles-classic');
      await type('slug', 'winter-classic');
      await type('name', 'Winter Doubles Classic 2027');
      expect(input('slug').value).toBe('winter-classic');
    });

    describe('checking a field when the user leaves it', () => {
      it('shows an end date before the start, under the end date, with the shared message', async () => {
        await open([]);
        await type('start-date', '2027-01-16');
        await type('end-date', '2027-01-15');
        expect(error('end-date')).toBeNull();
        await leave('end-date');
        expect(error('end-date')).toBe(TOURNAMENT_MESSAGES.endBeforeStart);
        expect(input('end-date').getAttribute('aria-invalid')).toBe('true');
        expect(input('end-date').getAttribute('aria-describedby')).toContain('end-date-error');
        await type('end-date', '2027-01-17');
        expect(error('end-date')).toBeNull();
      });

      it('shows a deadline after the start, naming the start date', async () => {
        await open([]);
        await type('start-date', '2027-01-16');
        await type('registration-deadline', '2027-01-17');
        await leave('registration-deadline');
        expect(error('registration-deadline')).toBe(
          'The registration deadline must be on or before the start date, Jan 16, 2027.',
        );
      });

      it('accepts a deadline on the start date, and a blank end date', async () => {
        await open([]);
        await type('start-date', '2027-01-16');
        await type('registration-deadline', '2027-01-16');
        await leave('registration-deadline');
        await leave('end-date');
        expect(error('registration-deadline')).toBeNull();
        expect(error('end-date')).toBeNull();
      });

      it.each(['1', '129', '2.5', 'many'])(
        'shows %s as a maximum outside 2 to 128',
        async (value) => {
          await open([]);
          await type('maximum-teams', value);
          await leave('maximum-teams');
          expect(error('maximum-teams')).toBe(TOURNAMENT_MESSAGES.maximumTeamsInvalid);
        },
      );

      it('accepts 2 and 128', async () => {
        await open([]);
        for (const value of ['2', '128']) {
          await type('maximum-teams', value);
          await leave('maximum-teams');
          expect(error('maximum-teams')).toBeNull();
        }
      });

      it('shows nothing while the user types a partial value, and nothing for a field never changed', async () => {
        await open([]);
        await type('maximum-teams', '1');
        expect(error('maximum-teams')).toBeNull();
        await leave('start-date');
        expect(error('start-date')).toBeNull();
      });

      it('clears the error on the keystroke that makes the value valid', async () => {
        await open([]);
        await type('maximum-teams', '1');
        await leave('maximum-teams');
        expect(error('maximum-teams')).not.toBeNull();
        await type('maximum-teams', '12');
        expect(error('maximum-teams')).toBeNull();
      });
    });

    it('submitted empty: every message, focus on Name, nothing sent', async () => {
      await open([]);
      await submit();
      expect(o.convex.calls).toEqual([]);
      expect(error('name')).toBe(TOURNAMENT_MESSAGES.nameEmpty);
      expect(error('slug')).toBe(TOURNAMENT_MESSAGES.slugEmpty);
      expect(page.querySelector('#sport-error')).not.toBeNull();
      expect(error('start-date')).toBe('Enter the start date.');
      expect(error('registration-deadline')).toBe('Enter the registration deadline.');
      expect(error('maximum-teams')).toBe(TOURNAMENT_MESSAGES.maximumTeamsEmpty);
      expect(document.activeElement).toBe(input('name'));
    });

    it('focus goes to the first invalid field: the web address, the sport, then the start date', async () => {
      await open([]);
      await type('name', 'Winter Doubles Classic');
      await type('slug', '');
      await submit();
      expect(document.activeElement).toBe(input('slug'));
      await type('slug', 'winter-doubles-classic');
      await submit();
      expect(document.activeElement).toBe(input('sport-beachVolleyball'));
      await choose('sport-beachVolleyball');
      await choose('format-2');
      location(1).click();
      await submit();
      expect(document.activeElement).toBe(input('start-date'));
    });

    it('sends the values, with no end date when it is blank, as a number for the maximum; while in flight the button says so', async () => {
      await open([]);
      await fill();
      await type('name', '  Winter Doubles Classic ');
      await type('end-date', '');
      await submit();
      const oneDay: Partial<typeof VALID_ARGS> = { ...VALID_ARGS };
      delete oneDay.endDate;
      expect(calls()).toEqual([[CREATE, oneDay]]);
      expect(text(submitButton())).toBe('Creating tournament…');
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expect(submitButton().disabled).toBe(false);
      expectPendingSpinner(submitButton());
      expect(text(form().querySelector('p[role="status"].sr-only'))).toBe(
        'Creating the tournament.',
      );
      await submit();
      expect(o.convex.calls).toHaveLength(1);
      expect(tokens(submitButton().className)).toEqual(
        expect.arrayContaining(tokens(PRIMARY_BUTTON)),
      );
    });

    it('sends the end date when there is one', async () => {
      await open([]);
      await fill();
      await submit();
      expect(calls()).toEqual([[CREATE, VALID_ARGS]]);
    });

    const createdStatus = () => form().querySelector<HTMLElement>('[data-slot="created-status"]');

    async function created() {
      await fill();
      submitButton().focus();
      await submit();
      o.convex.calls[0].resolve({ tournamentId: 'tn_new' });
      await o.flush();
    }

    it('on success: "<name> created. It stays a draft until you publish it." above the button, the form cleared, focus kept on the button', async () => {
      await open([]);
      await created();
      const status = createdStatus()!;
      expect(text(status)).toBe(
        'Winter Doubles Classic created. It stays a draft until you publish it.Open Winter Doubles Classic',
      );
      const openLink = status.querySelector('a')!;
      expect(text(openLink)).toBe('Open Winter Doubles Classic');
      expect(openLink.getAttribute('href')).toBe(
        `/app/organizations/${COASTAL.slug}/tournaments/winter-doubles-classic`,
      );
      expect(status.getAttribute('role')).toBe('status');
      expect(status.nextElementSibling).toBe(submitButton());
      for (const id of [
        'name',
        'slug',
        'start-date',
        'end-date',
        'registration-deadline',
        'maximum-teams',
      ]) {
        expect(input(id).value, id).toBe('');
      }
      expect(input('sport-beachVolleyball').checked).toBe(false);
      expect(location(1).getAttribute('aria-checked')).toBe('false');
      expect(document.activeElement).toBe(submitButton());
      expect(text(submitButton())).toBe('Create draft tournament');
    });

    it('clears the created status on the next edit of the cleared form, and when a location is ticked', async () => {
      await open([]);
      await created();
      input('name').value = 'N';
      input('name').dispatchEvent(new Event('input', { bubbles: true }));
      await o.harness.fixture.whenStable();
      expect(text(createdStatus())).toBe('');
      expect(createdStatus()).not.toBeNull();
      await created();
      location(2).click();
      await o.harness.fixture.whenStable();
      expect(text(createdStatus())).toBe('');
    });

    it('the server refusing the address shows the shared message with the address in bold, focus on Web address, and every value kept', async () => {
      await open([]);
      await fill();
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'slug',
          code: 'slugTaken',
          message: TOURNAMENT_MESSAGES.slugTaken('winter-doubles-classic'),
        }),
      );
      await o.flush();
      expect(error('slug')).toBe(
        'winter-doubles-classic is already taken. Choose another web address.',
      );
      expect(page.querySelector('#slug-error strong')?.textContent).toBe('winter-doubles-classic');
      expect(document.activeElement).toBe(input('slug'));
      expect(input('name').value).toBe('Winter Doubles Classic');
      expect(input('start-date').value).toBe('2027-01-16');
      expect(input('maximum-teams').value).toBe('16');
      await type('slug', 'winter-doubles-classic-b');
      expect(error('slug')).toBeNull();
    });

    it('the server refusing a date shows its message under that field, focus on it, values kept', async () => {
      await open([]);
      await fill();
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'endDate',
          code: 'endBeforeStart',
          message: TOURNAMENT_MESSAGES.endBeforeStart,
        }),
      );
      await o.flush();
      expect(error('end-date')).toBe(TOURNAMENT_MESSAGES.endBeforeStart);
      expect(document.activeElement).toBe(input('end-date'));
      expect(input('name').value).toBe('Winter Doubles Classic');
    });

    it('any other failure shows the form alert, titled and with what to do, focuses it, and keeps every value', async () => {
      await open([]);
      await fill();
      await submit();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = form().querySelector<HTMLElement>('[role="alert"][data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The tournament could not be created.',
      );
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(document.activeElement).toBe(alert);
      expect(input('name').value).toBe('Winter Doubles Classic');
      expect(input('end-date').value).toBe('2027-01-17');
      expect(input('maximum-teams').value).toBe('16');
      expect(text(submitButton())).toBe('Create draft tournament');
    });

    it('a refusal from the adapter at call time (offline) shows the offline alert and keeps every value', async () => {
      await open([]);
      await fill();
      await submit();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(form().querySelector('[data-slot="alert"]'))).toBe(
        "You're offline. Nothing was sent. Your details are still here. Try again when you're connected.",
      );
      expect(input('name').value).toBe('Winter Doubles Classic');
      expect(input('maximum-teams').value).toBe('16');
    });

    describe('offline', () => {
      afterEach(() => vi.restoreAllMocks());

      it('the button looks disabled but stays focusable, and a press shows the offline alert and sends nothing', async () => {
        await open([]);
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
        expect(input('name').value).toBe('Winter Doubles Classic');
      });
    });
  });

  describe('Web address availability', () => {
    const asked = () => o.convex.subscriptions.filter((s) => s.name === IS_AVAILABLE);
    const pause = async () => {
      await new Promise((resolve) => setTimeout(resolve, AVAILABILITY_PAUSE_MS + 50));
      await o.flush();
    };

    it('asks tournaments.isSlugAvailable with the organization id, and says Available', async () => {
      await open([]);
      await type('name', 'Winter Doubles Classic');
      await pause();
      expect(asked().at(-1)!.args).toEqual({
        organizationId: COASTAL.organizationId,
        slug: 'winter-doubles-classic',
      });
      asked().at(-1)!.emit(true);
      await o.flush();
      expect(text(page.querySelector('#slug-availability'))).toBe('Available');
    });

    it('says the address is taken, with the shared message, before a submit', async () => {
      await open([]);
      await type('name', 'Winter Doubles Classic');
      await pause();
      asked().at(-1)!.emit(false);
      await o.flush();
      expect(error('slug')).toBe(
        'winter-doubles-classic is already taken. Choose another web address.',
      );
      expect(calls()).toEqual([]);
    });
  });
});
