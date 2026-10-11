import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ConvexError } from 'convex/values';
import { LEAGUE_MESSAGES } from '../../../../convex/lib/leagueInput';
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
  ME,
  openAdmin,
  text,
} from './testing/admin-harness';

// Leagues (#66), design/mockups/66-69-organization-leagues.html states 1 to 8 (without the Publish
// buttons) and "League messages" and "League attributes", plus design/mockups/88-offline-note.html
// states 2 and 3.

const ROUTES = adminRoutes(AdminArea, [{ path: 'leagues', component: AdminLeagues }]);
const URL = `/app/organizations/${COASTAL.slug}/leagues`;
const LIST_LEAGUES = 'leagues:listForAdmin';
const CREATE = 'leagues:create';
const tokens = (value: string) => value.split(' ').sort();

/** What `leagues.listForAdmin` returns for the mockup's populated state, sorted by name. */
const LEAGUES = [
  {
    leagueId: 'lg_7v7',
    name: 'Coed 7v7 Rec',
    slug: 'coed-7v7-rec',
    sportName: 'Soccer',
    status: 'published',
    locationNames: ['Redfish Flats Fields'],
  },
  {
    leagueId: 'lg_4s',
    name: 'Sunday Reverse Coed 4s',
    slug: 'sunday-reverse-coed-4s',
    sportName: 'Beach volleyball',
    status: 'draft',
    locationNames: ['Pelican Shoals Sand Courts'],
  },
  {
    leagueId: 'lg_slow',
    name: 'Wednesday Coed Slow-Pitch',
    slug: 'wednesday-coed-slow-pitch',
    sportName: 'Softball',
    status: 'draft',
    locationNames: ['Tern Point Softball Complex', 'Redfish Flats Fields'],
  },
];

describe('AdminLeagues', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  /**
   * Opens the page as an org admin. `leagues` and `locations` answer the two lists (undefined
   * leaves a list loading).
   */
  async function open(leagues?: unknown[], locations: unknown[] | null = COASTAL_LOCATIONS) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
    await o.flush();
    if (leagues) o.subscription(LIST_LEAGUES)!.emit(leagues);
    if (locations) o.subscription(LIST_FOR_ADMIN)!.emit(locations);
    await o.flush();
  }

  const input = (id: string) => page.querySelector<HTMLInputElement>(`#${id}`)!;
  const form = () => page.querySelector<HTMLFormElement>('#create-league form')!;
  const submitButton = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const formStatus = () => form().querySelector('p[role="status"].sr-only');
  const items = () => [...page.querySelectorAll<HTMLElement>('#leagues-list > li')];
  const error = (id: string) => text(page.querySelector(`#${id}-error`)) ?? null;
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);
  const sport = (key: string) => input(`sport-${key}`);
  const location = (n: number) => page.querySelector<HTMLButtonElement>(`#location-${n}`)!;

  async function type(id: string, value: string) {
    const element = input(id);
    element.value = value;
    element.dispatchEvent(new Event('input'));
    await o.harness.fixture.whenStable();
  }

  async function chooseSport(key: string) {
    const radio = sport(key);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await o.harness.fixture.whenStable();
  }

  async function toggleLocation(n: number) {
    location(n).click();
    await o.harness.fixture.whenStable();
  }

  async function submit() {
    submitButton().click();
    await o.flush();
  }

  /** Fills every field validly: the mockup's "Create, filled" state with Pelican Shoals chosen. */
  async function fill() {
    await type('name', 'Sunday Reverse Coed 4s');
    await chooseSport('beachVolleyball');
    await toggleLocation(1);
  }

  describe('the page (states 1 to 3)', () => {
    it('asks leagues.listForAdmin and locations.listForAdmin with the organization id, only after the context says ready', async () => {
      await open();
      expect(o.convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([
        [GET_ADMIN_CONTEXT, { slug: COASTAL.slug }],
        [ME, {}],
        [LIST_LEAGUES, { organizationId: COASTAL.organizationId }],
        [LIST_FOR_ADMIN, { organizationId: COASTAL.organizationId }],
      ]);
    });

    it('has the organization, the h1, the sentence, and the title', async () => {
      await open([]);
      const main = page.querySelector('main')!;
      expect(text(main.querySelector('p.text-sm.font-medium'))).toBe('Coastal Bend Rec Club');
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(text(main.querySelector('h1'))).toBe('Leagues');
      expect(text(main.querySelector('h1 + p'))).toBe(
        'Drafts are visible only to your staff. Publish a league to put it on your public page.',
      );
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Leagues | Coastal Bend Rec Club | Omni League',
      );
    });

    it('loading: placeholder rows and a polite status, with the create panel already there', async () => {
      await open(undefined, null);
      const panel = page.querySelector('section[aria-labelledby="leagues-heading"]')!;
      expect(text(panel.querySelector('[role="status"]'))).toBe('Loading the leagues.');
      expect(panel.querySelector('ul')).toBeNull();
      expect(panel.querySelectorAll('[aria-hidden="true"].divide-y > div')).toHaveLength(3);
      expect(text(page.querySelector('#create-league h2'))).toBe('Create a league');
      expect(page.querySelector('#create-league form')).toBeNull();
    });

    it('none yet (state 2): the empty state', async () => {
      await open([]);
      const panel = page.querySelector('section[aria-labelledby="leagues-heading"]')!;
      expect(text(panel.querySelector('p.font-medium'))).toBe('No leagues yet');
      expect(text(panel)).toContain(
        'Leagues you create appear here as drafts until you publish them.',
      );
      expect(panel.querySelector('ul')).toBeNull();
    });

    it('populated (state 3): a row per league with name, status, sport, and locations, and no Publish button', async () => {
      await open(LEAGUES);
      expect(items().map((li) => text(li.querySelector('h3')))).toEqual(LEAGUES.map((l) => l.name));
      const badges = (li: HTMLElement) =>
        [...li.querySelectorAll('[data-slot="badge"]')].map((b) => [
          b.getAttribute('data-variant'),
          text(b),
        ]);
      expect(badges(items()[0])).toEqual([
        ['default', 'Published'],
        ['secondary', 'Soccer'],
      ]);
      expect(badges(items()[1])).toEqual([
        ['outline', 'Draft'],
        ['secondary', 'Beach volleyball'],
      ]);
      expect(text(items()[0].querySelector('p'))).toBe('Location: Redfish Flats Fields');
      expect(text(items()[2].querySelector('p'))).toBe(
        'Locations: Tern Point Softball Complex, Redfish Flats Fields',
      );
      expect(items()[0].querySelector('.sr-only')?.textContent).toBe('Location: ');
      expect(page.querySelector('#leagues-list button')).toBeNull();
    });

    it('a failed list shows the destructive alert, never the error message', async () => {
      await open(undefined, COASTAL_LOCATIONS);
      o.subscription(LIST_LEAGUES)!.fail(new Error('Server Error: secret'));
      await o.flush();
      const alert = page.querySelector('section[aria-labelledby="leagues-heading"] [role="alert"]');
      expect(text(alert)).toBe(
        'The leagues could not be loaded. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
    });

    it('lists a league created elsewhere at once (the list is live)', async () => {
      await open(LEAGUES.slice(0, 1));
      o.subscription(LIST_LEAGUES)!.emit(LEAGUES);
      await o.flush();
      expect(items()).toHaveLength(3);
    });
  });

  describe('no locations (state 1)', () => {
    it('replaces the form with "Add a location first" and a link to Locations, and still lists the leagues', async () => {
      await open(LEAGUES, []);
      const panel = page.querySelector('#create-league')!;
      expect(text(panel.querySelector('p.font-medium'))).toBe('Add a location first');
      expect(text(panel)).toContain('Every league is held at one or more of your locations.');
      const link = panel.querySelector<HTMLAnchorElement>('a')!;
      expect(text(link)).toBe('Go to Locations');
      expect(link.getAttribute('href')).toBe(`/app/organizations/${COASTAL.slug}/locations`);
      expect(link.getAttribute('data-slot')).toBe('button');
      expect(tokens(link.className)).toEqual(tokens(OUTLINE_BUTTON));
      expect(page.querySelector('form')).toBeNull();
      expect(items()).toHaveLength(3);
    });

    it('the form appears when the first location arrives', async () => {
      await open([], []);
      expect(page.querySelector('#create-league form')).toBeNull();
      o.subscription(LIST_FOR_ADMIN)!.emit(COASTAL_LOCATIONS);
      await o.flush();
      expect(page.querySelector('#create-league form')).not.toBeNull();
    });
  });

  describe('the "Create a league" jump link (phones)', () => {
    it('is hidden from 1024px, targets the form, and moves focus and scroll to it', async () => {
      await open([]);
      const link = page.querySelector<HTMLAnchorElement>('main a[data-slot="button"]')!;
      expect(text(link)).toBe('Create a league');
      expect(link.getAttribute('href')).toBe(`${URL}#create-league`);
      expect(link.classList.contains('lg:hidden')).toBe(true);
      expect(tokens(link.className.replace(' lg:hidden', ''))).toEqual(tokens(OUTLINE_BUTTON));
      const section = page.querySelector<HTMLElement>('#create-league')!;
      const scrolled = vi.fn();
      section.scrollIntoView = scrolled;
      link.click();
      await o.flush();
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(input('name'));
    });
  });

  describe('the form (states 4 to 8)', () => {
    it('is a labelled section and form with the mockup attributes', async () => {
      await open([]);
      const section = page.querySelector('#create-league')!;
      expect(section.tagName).toBe('SECTION');
      expect(section.getAttribute('aria-labelledby')).toBe('create-league-heading');
      expect(form().getAttribute('aria-labelledby')).toBe('create-league-heading');
      expect(form().getAttribute('aria-describedby')).toBe('create-league-note');
      expect(form().hasAttribute('novalidate')).toBe(true);
      expect(text(page.querySelector('#create-league-note'))).toBe(
        'New leagues start as drafts, which only your staff see.',
      );
      expect(text(page.querySelector('label[for="name"]'))).toBe('Name');
      expect(text(page.querySelector('label[for="slug"]'))).toBe('Slug');
      for (const id of ['name', 'slug']) {
        const field = input(id);
        expect([field.type, field.required, field.getAttribute('autocomplete')]).toEqual([
          'text',
          true,
          'off',
        ]);
        expect(field.getAttribute('aria-describedby')).toBe(`${id}-description`);
      }
      expect(text(page.querySelector('#name-description'))).toBe('Up to 100 characters.');
      expect(text(page.querySelector('#slug-description'))).toBe(
        '3 to 60 lowercase letters and digits, with single hyphens between them. Unique within Coastal Bend Rec Club.',
      );
      expect(text(submitButton())).toBe('Create draft league');
      expect(tokens(submitButton().className)).toEqual(tokens(`${PRIMARY_BUTTON} mt-6 w-full`));
      expect(text(formStatus())).toBe('');
    });

    it('Sport is a fieldset with a legend and three radios in sport order, none chosen', async () => {
      await open([]);
      const set = page.querySelector<HTMLFieldSetElement>('fieldset#sport')!;
      expect(text(set.querySelector('legend'))).toBe('Sport');
      const radios = [...set.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
      expect(radios.map((r) => [r.id, r.name, r.value, r.checked])).toEqual([
        ['sport-beachVolleyball', 'sport', 'beachVolleyball', false],
        ['sport-soccer', 'sport', 'soccer', false],
        ['sport-softball', 'sport', 'softball', false],
      ]);
      expect(radios.map((r) => text(page.querySelector(`label[for="${r.id}"]`)))).toEqual([
        'Beach volleyball',
        'Soccer',
        'Softball',
      ]);
    });

    it('Locations is a fieldset with a legend, a description, and a checkbox per location', async () => {
      await open([]);
      const set = page.querySelector<HTMLFieldSetElement>('fieldset#locations')!;
      expect(text(set.querySelector('legend'))).toBe('Locations');
      expect(text(set.querySelector('#locations-description'))).toBe('Choose one or more.');
      expect(set.getAttribute('aria-describedby')).toBe('locations-description');
      const boxes = [...set.querySelectorAll<HTMLElement>('[role="checkbox"]')];
      expect(boxes.map((b) => [b.id, b.getAttribute('aria-checked')])).toEqual([
        ['location-1', 'false'],
        ['location-2', 'false'],
        ['location-3', 'false'],
      ]);
      expect(boxes.map((b) => text(page.querySelector(`label[for="${b.id}"]`)))).toEqual(
        COASTAL_LOCATIONS.map((l) => l.name),
      );
    });

    it('typing a name fills Slug with slugify(name) until Slug is edited (decision 3)', async () => {
      await open([]);
      await type('name', 'Sunday Reverse Coed 4s');
      expect(input('slug').value).toBe('sunday-reverse-coed-4s');
      await type('name', "Men's D Division");
      expect(input('slug').value).toBe('men-s-d-division');
      await type('name', '   ');
      expect(input('slug').value).toBe('');
      await type('slug', 'my-own');
      await type('name', 'Something else');
      expect(input('slug').value).toBe('my-own');
    });

    it('submitted empty (state 5): every message, aria attributes, focus on Name, nothing sent', async () => {
      await open([]);
      await submit();
      expect(error('name')).toBe(LEAGUE_MESSAGES.nameEmpty);
      expect(error('slug')).toBe(LEAGUE_MESSAGES.slugEmpty);
      expect(error('sport')).toBe('Choose a sport.');
      expect(error('locations')).toBe('Choose at least one location.');
      for (const id of ['name', 'slug']) {
        expect(input(id).getAttribute('aria-invalid')).toBe('true');
        expect(input(id).getAttribute('aria-describedby')).toBe(`${id}-description ${id}-error`);
      }
      expect(page.querySelector('fieldset#sport')?.getAttribute('aria-describedby')).toBe(
        'sport-error',
      );
      expect(page.querySelector('fieldset#locations')?.getAttribute('aria-describedby')).toBe(
        'locations-description locations-error',
      );
      expect(page.querySelector('#sport-error')?.getAttribute('role')).toBe('alert');
      expect(page.querySelector('#locations-error')?.getAttribute('role')).toBe('alert');
      expect(sport('soccer').getAttribute('aria-invalid')).toBe('true');
      expect(location(1).getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(input('name'));
      expect(calls()).toEqual([]);
    });

    it('focus goes to the first invalid field: Slug, then the first sport, then the first location', async () => {
      await open([]);
      await type('name', 'Fine');
      await type('slug', '');
      await submit();
      expect(document.activeElement).toBe(input('slug'));
      await type('slug', 'fine');
      await submit();
      expect(error('slug')).toBeNull();
      expect(document.activeElement).toBe(sport('beachVolleyball'));
      await chooseSport('soccer');
      await submit();
      expect(error('sport')).toBeNull();
      expect(document.activeElement).toBe(location(1));
      expect(calls()).toEqual([]);
    });

    it('101 characters get the count message, and whitespace-only counts as empty', async () => {
      await open([]);
      await type('name', 'n'.repeat(101));
      await submit();
      expect(error('name')).toBe('Use 100 characters or fewer. This name has 101.');
      await type('name', '   ');
      await submit();
      expect(error('name')).toBe(LEAGUE_MESSAGES.nameEmpty);
    });

    it('an invalid slug shows the format message, the reserved word `new` in bold (#64)', async () => {
      await open([]);
      await fill();
      for (const slug of ['Bad Slug', 'ab', 'a'.repeat(61), 'new', '-x-', 'a--b']) {
        await type('slug', slug);
        await submit();
        expect(error('slug'), slug).toBe(LEAGUE_MESSAGES.slugInvalid);
        expect(document.activeElement).toBe(input('slug'));
      }
      expect(page.querySelector('#slug-error strong')?.textContent).toBe('new');
      expect(calls()).toEqual([]);
    });

    it('an error clears once its field is valid', async () => {
      await open([]);
      await submit();
      await type('name', 'Fine');
      expect(error('name')).toBeNull();
      await chooseSport('softball');
      expect(error('sport')).toBeNull();
      await toggleLocation(2);
      expect(error('locations')).toBeNull();
      await toggleLocation(2);
      expect(error('locations')).toBeNull();
    });

    it('sends the trimmed name, the slug, the sport, and the chosen location ids; while in flight the button says so (state 7)', async () => {
      await open([]);
      await type('name', '  Sunday Reverse Coed 4s ');
      await chooseSport('beachVolleyball');
      await toggleLocation(3);
      await toggleLocation(1);
      await submit();
      expect(calls()).toEqual([
        [
          CREATE,
          {
            organizationId: COASTAL.organizationId,
            name: 'Sunday Reverse Coed 4s',
            slug: 'sunday-reverse-coed-4s',
            sport: 'beachVolleyball',
            locationIds: ['loc_pelican', 'loc_tern'],
          },
        ],
      ]);
      expect(text(submitButton())).toBe('Creating league…');
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expect(submitButton().disabled).toBe(false);
      expect(text(formStatus())).toBe('Creating the league.');
      await submit();
      expect(o.convex.calls).toHaveLength(1);
    });

    it('on success (state 8): "<league> created as a draft." in a status above the form, the form cleared, focus on the button', async () => {
      await open([]);
      await fill();
      await submit();
      o.convex.calls[0].resolve({ leagueId: 'lg_new' });
      await o.flush();
      const status = form().querySelector<HTMLElement>('[data-slot="alert"]')!;
      expect(status.getAttribute('role')).toBe('status');
      expect(text(status.querySelector('[data-slot="alert-title"]'))).toBe(
        'Sunday Reverse Coed 4s created as a draft.',
      );
      expect(text(status.querySelector('[data-slot="alert-description"]'))).toBe(
        'Publish it when it’s ready for players to see.',
      );
      expect(
        status.compareDocumentPosition(input('name')) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(input('name').value).toBe('');
      expect(input('slug').value).toBe('');
      expect(sport('beachVolleyball').checked).toBe(false);
      expect(location(1).getAttribute('aria-checked')).toBe('false');
      expect(document.activeElement).toBe(submitButton());
      expect(text(submitButton())).toBe('Create draft league');
      expect(submitButton().hasAttribute('aria-disabled')).toBe(false);
      // Slug follows the name again after the form cleared.
      await type('name', 'Next One');
      expect(input('slug').value).toBe('next-one');
      // The next press clears the message.
      await submit();
      expect(form().querySelector('[data-slot="alert"][role="status"]')).toBeNull();
    });

    it('the server saying the slug is taken (state 6) shows the message with the slug in bold, and focus on Slug', async () => {
      await open([]);
      await fill();
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'slug',
          code: 'slugTaken',
          message: LEAGUE_MESSAGES.slugTaken('sunday-reverse-coed-4s'),
        }),
      );
      await o.flush();
      expect(error('slug')).toBe(
        'sunday-reverse-coed-4s is already used by another league here. Choose another slug.',
      );
      expect(page.querySelector('#slug-error strong')?.textContent).toBe('sunday-reverse-coed-4s');
      expect(document.activeElement).toBe(input('slug'));
      expect(input('slug').getAttribute('aria-invalid')).toBe('true');
      // The values stay, and the error goes once the slug changes.
      expect(input('name').value).toBe('Sunday Reverse Coed 4s');
      await type('slug', 'sunday-reverse-coed-4s-b');
      expect(error('slug')).toBeNull();
    });

    it('any other failure shows the form alert and focuses it, keeping the values', async () => {
      await open([]);
      await fill();
      await submit();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = form().querySelector<HTMLElement>('[role="alert"][data-slot="alert"]')!;
      expect(text(alert)).toBe(
        'The league could not be created. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(document.activeElement).toBe(alert);
      expect(input('name').value).toBe('Sunday Reverse Coed 4s');
      expect(text(submitButton())).toBe('Create draft league');
    });

    describe('offline (design/mockups/88-offline-note.html states 2 and 3)', () => {
      afterEach(() => vi.restoreAllMocks());

      async function goOffline() {
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
        window.dispatchEvent(new Event('offline'));
        TestBed.tick();
        await o.harness.fixture.whenStable();
      }

      it('the button looks disabled but stays focusable, and a press shows the offline alert and sends nothing', async () => {
        await open([]);
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
          "Your details are still here. Try again when you're connected.",
        );
        expect(document.activeElement).toBe(box);
        expect(input('name').value).toBe('Sunday Reverse Coed 4s');
      });

      it('validation comes first: an empty form offline shows the field errors, not the alert', async () => {
        await open([]);
        await goOffline();
        await submit();
        expect(error('name')).toBe(LEAGUE_MESSAGES.nameEmpty);
        expect(form().querySelector('[data-slot="alert"]')).toBeNull();
      });
    });

    it('a refusal from the adapter at call time (offline) shows the offline alert', async () => {
      await open([]);
      await fill();
      await submit();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(form().querySelector('[data-slot="alert"]'))).toBe(
        "You're offline. Nothing was sent. Your details are still here. Try again when you're connected.",
      );
      expect(input('name').value).toBe('Sunday Reverse Coed 4s');
    });
  });
});
