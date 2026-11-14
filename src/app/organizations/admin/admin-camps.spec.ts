import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ConvexError } from 'convex/values';
import { CAMP_MESSAGES } from '../../../../convex/lib/campInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { AVAILABILITY_PAUSE_MS } from '../../core/forms/slug-availability';
import { expectBadgeSize } from '../../ui/testing/badge';
import { expectBareCards } from '../../ui/testing/card';
import { expectSkeletonBoxes } from '../../ui/testing/skeleton-boxes';
import { expectPendingSpinner } from '../../ui/testing/spinner';
import { AdminArea } from './admin-area';
import { AdminCamps } from './admin-camps';
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

const ROUTES = adminRoutes(AdminArea, [{ path: 'camps', component: AdminCamps }]);
const URL = `/app/organizations/${COASTAL.slug}/camps`;
const LIST_CAMPS = 'camps:listForOrganization';
const CREATE = 'camps:create';
const IS_AVAILABLE = 'camps:isSlugAvailable';
const tokens = (value: string) => value.split(' ').sort();

const CAMPS = [
  {
    campId: 'cp_fall',
    programId: 'pg_fall',
    name: 'Fall Break Camp',
    slug: 'fall-break-camp',
    minimumAge: 10,
    maximumAge: 16,
    status: 'published',
  },
  {
    campId: 'cp_junior',
    programId: 'pg_junior',
    name: 'Junior Beach Volleyball Camp',
    slug: 'junior-beach-volleyball-camp',
    minimumAge: 9,
    maximumAge: 14,
    status: 'draft',
  },
  {
    campId: 'cp_twelve',
    programId: 'pg_twelve',
    name: 'Twelve Camp',
    slug: 'twelve-camp',
    minimumAge: 12,
    maximumAge: 12,
    status: 'draft',
  },
];

describe('AdminCamps', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(camps?: unknown[], locations: unknown[] | null = COASTAL_LOCATIONS) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
    await o.flush();
    if (camps) o.subscription(LIST_CAMPS)!.emit(camps);
    if (locations) o.subscription(LIST_FOR_ADMIN)!.emit(locations);
    await o.flush();
  }

  const input = (id: string) => page.querySelector<HTMLInputElement>(`#${id}`)!;
  const form = () => page.querySelector<HTMLFormElement>('#create-camp form')!;
  const submitButton = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const items = () => [...page.querySelectorAll<HTMLElement>('#camps-list > li')];
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
    input(id).click();
    await o.harness.fixture.whenStable();
  }

  async function submit() {
    submitButton().click();
    await o.flush();
  }

  async function fill() {
    await type('name', 'Junior Beach Volleyball Camp');
    await choose('sport-beachVolleyball');
    location(1).click();
    await type('minimum-age', '9');
    await type('maximum-age', '14');
  }

  const VALID_ARGS = {
    organizationId: COASTAL.organizationId,
    name: 'Junior Beach Volleyball Camp',
    slug: 'junior-beach-volleyball-camp',
    sport: 'beachVolleyball',
    locationIds: ['loc_pelican'],
    minimumAge: 9,
    maximumAge: 14,
  };

  describe('the page', () => {
    it('asks camps.listForOrganization and locations.listForAdmin with the organization id, only after the context says ready', async () => {
      await open();
      expectPageAndShellSubscriptions(o.convex, [
        [GET_ADMIN_CONTEXT, { slug: COASTAL.slug }],
        [LIST_CAMPS, { organizationId: COASTAL.organizationId }],
        [LIST_FOR_ADMIN, { organizationId: COASTAL.organizationId }],
      ]);
    });

    it('asks for nothing when the caller has no access', async () => {
      o = await openAdmin(ROUTES, URL);
      o.acceptToken();
      o.subscription(GET_ADMIN_CONTEXT)!.fail(forbiddenError());
      await o.flush();
      expect(o.convex.activeSubscriptions.map((s) => s.name)).not.toContain(LIST_CAMPS);
      expect(o.page.querySelector('#camps-list')).toBeNull();
      expect(o.page.querySelector('#create-camp')).toBeNull();
    });

    it('has the organization, the h1, the sentence, and the title', async () => {
      await open([]);
      const main = page.querySelector('main')!;
      expect(text(main.querySelector('p.text-sm.font-medium'))).toBe('Coastal Bend Rec Club');
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(text(main.querySelector('h1'))).toBe('Camps');
      expect(text(main.querySelector('h1 + p'))).toBe(
        'A camp is run in dated sessions, for an age range. Drafts are visible only to your staff.',
      );
      expect(TestBed.inject(Title).getTitle()).toBe('Camps | Coastal Bend Rec Club | Omni League');
    });

    it('draws the list and the create panel as bare helm cards, the create panel still focusable and outline-free', async () => {
      await open([]);
      const main = page.querySelector('main')!;
      expectBareCards(main, ['overflow-hidden lg:col-span-2', 'overflow-clip focus:outline-none']);
      expect(main.querySelector('#create-camp')!.getAttribute('tabindex')).toBe('-1');
    });

    it('loading: skeleton rows and a polite status, with the create panel already there', async () => {
      await open(undefined, null);
      const panel = page.querySelector('section[aria-labelledby="camps-heading"]')!;
      expect(text(panel.querySelector('[role="status"]'))).toBe('Loading the camps.');
      expect(panel.querySelector('ul')).toBeNull();
      expect(panel.querySelectorAll('[aria-hidden="true"].divide-y > div')).toHaveLength(3);
      expectSkeletonBoxes(panel, { 'rounded-md': 6 });
      expect(text(page.querySelector('#create-camp h2'))).toBe('Create a camp');
      expect(page.querySelector('#create-camp form')).toBeNull();
    });

    it('empty: says what will appear and what to do next, and the form is below', async () => {
      await open([]);
      const panel = page.querySelector('section[aria-labelledby="camps-heading"]')!;
      expect(text(panel.querySelector('p.font-medium'))).toBe('No camps yet');
      expect(text(panel)).toContain('Create a camp, then add its sessions.');
      expect(panel.querySelector('ul')).toBeNull();
      expect(page.querySelector('#create-camp form')).not.toBeNull();
    });

    it('populated: a row per camp with its name, ages, and Draft or Published', async () => {
      await open(CAMPS);
      expect(items().map((li) => text(li.querySelector('h3')))).toEqual([
        'Fall Break Camp',
        'Junior Beach Volleyball Camp',
        'Twelve Camp',
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
      expect(items().map((li) => text(li.querySelector('p')))).toEqual([
        'Ages 10 to 16',
        'Ages 9 to 14',
        'Age 12',
      ]);
    });

    it('a failed list shows the destructive alert, never the error message', async () => {
      await open(undefined, COASTAL_LOCATIONS);
      o.subscription(LIST_CAMPS)!.fail(new Error('Server Error: secret'));
      await o.flush();
      const alert = page.querySelector('section[aria-labelledby="camps-heading"] [role="alert"]');
      expect(text(alert)).toBe(
        'The camps could not be loaded. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
    });

    it('lists a camp created elsewhere at once (the list is live)', async () => {
      await open(CAMPS.slice(0, 1));
      o.subscription(LIST_CAMPS)!.emit(CAMPS);
      await o.flush();
      expect(items()).toHaveLength(3);
    });

    it('replaces the form with "Add a location first" and a link to Locations when there is none', async () => {
      await open(CAMPS, []);
      const panel = page.querySelector('#create-camp')!;
      expect(text(panel.querySelector('p.font-medium'))).toBe('Add a location first');
      expect(text(panel)).toContain('Every camp is held at one or more of your locations.');
      const link = panel.querySelector<HTMLAnchorElement>('a')!;
      expect(link.getAttribute('href')).toBe(`/app/organizations/${COASTAL.slug}/locations`);
      expect(tokens(link.className)).toEqual(tokens(OUTLINE_BUTTON));
      expect(page.querySelector('form')).toBeNull();
      expect(items()).toHaveLength(3);
    });

    it('has a jump link to the form for phones, which moves focus to Name', async () => {
      await open([]);
      const link = page.querySelector<HTMLAnchorElement>('main a[data-slot="button"]')!;
      expect(text(link)).toBe('Create a camp');
      expect(link.getAttribute('href')).toBe(`${URL}#create-camp`);
      expect(link.classList.contains('lg:hidden')).toBe(true);
      page.querySelector<HTMLElement>('#create-camp')!.scrollIntoView = vi.fn();
      link.click();
      await o.flush();
      expect(document.activeElement).toBe(input('name'));
    });
  });

  describe('the form', () => {
    it('has Name, Web address, Sport, Locations, and the ages, and no division or dates', async () => {
      await open([]);
      const labels = [...form().querySelectorAll('label, legend')].map((element) => text(element));
      for (const label of ['Name', 'Web address', 'Sport', 'Locations', 'Ages from', 'Ages to']) {
        expect(labels, label).toContain(label);
      }
      for (const absent of ['Gender', 'Format', 'Level', 'Age group', 'Start date']) {
        expect(form().textContent).not.toContain(absent);
      }
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
      await type('name', 'Junior Beach Volleyball Camp');
      expect(input('slug').value).toBe('junior-beach-volleyball-camp');
      await type('slug', 'junior-camp');
      await type('name', 'Junior Beach Volleyball Camp 2027');
      expect(input('slug').value).toBe('junior-camp');
    });

    describe('web address availability', () => {
      const asked = () => o.convex.subscriptions.filter((s) => s.name === IS_AVAILABLE);
      const pause = async () => {
        await new Promise((resolve) => setTimeout(resolve, AVAILABILITY_PAUSE_MS + 50));
        await o.flush();
      };

      it('asks camps.isSlugAvailable with the organization id, and says Available', async () => {
        await open([]);
        await type('name', 'Junior Beach Volleyball Camp');
        await pause();
        expect(asked().at(-1)!.args).toEqual({
          organizationId: COASTAL.organizationId,
          slug: 'junior-beach-volleyball-camp',
        });
        asked().at(-1)!.emit(true);
        await o.flush();
        expect(text(page.querySelector('#slug-availability'))).toBe('Available');
      });

      it('says the address is taken, with the shared message, before a submit', async () => {
        await open([]);
        await type('name', 'Junior Beach Volleyball Camp');
        await pause();
        asked().at(-1)!.emit(false);
        await o.flush();
        expect(error('slug')).toBe(
          'junior-beach-volleyball-camp is already taken. Choose another web address.',
        );
        expect(calls()).toEqual([]);
      });
    });

    describe('checking a field when the user leaves it', () => {
      it('shows ages from 12 to 9 under the age to, with the shared message, once the user leaves it', async () => {
        await open([]);
        await type('minimum-age', '12');
        await leave('minimum-age');
        await type('maximum-age', '9');
        expect(error('maximum-age')).toBeNull();
        await leave('maximum-age');
        expect(error('maximum-age')).toBe(CAMP_MESSAGES.agesReversed(12));
        expect(input('maximum-age').getAttribute('aria-invalid')).toBe('true');
        expect(input('maximum-age').getAttribute('aria-describedby')).toContain(
          'maximum-age-error',
        );
        expect(error('minimum-age')).toBeNull();
        await type('maximum-age', '12');
        expect(error('maximum-age')).toBeNull();
      });

      it('shows the order when the age from is the one changed last', async () => {
        await open([]);
        await type('maximum-age', '9');
        await leave('maximum-age');
        await type('minimum-age', '12');
        await leave('minimum-age');
        expect(error('maximum-age')).toBe(CAMP_MESSAGES.agesReversed(12));
      });

      it('does not scold the age to for being empty when only the age from was left', async () => {
        await open([]);
        await type('minimum-age', '12');
        await leave('minimum-age');
        expect(error('maximum-age')).toBeNull();
        expect(error('minimum-age')).toBeNull();
      });

      it.each(['3', '100', '9.5', 'many'])(
        'shows %s as an age from outside 4 to 99',
        async (value) => {
          await open([]);
          await type('minimum-age', value);
          await leave('minimum-age');
          expect(error('minimum-age')).toBe(CAMP_MESSAGES.ageInvalid);
        },
      );

      it('shows 3 as an age to outside 4 to 99', async () => {
        await open([]);
        await type('maximum-age', '3');
        await leave('maximum-age');
        expect(error('maximum-age')).toBe(CAMP_MESSAGES.ageInvalid);
      });

      it('accepts 4 and 99, and equal ages', async () => {
        await open([]);
        for (const [from, to] of [
          ['4', '99'],
          ['12', '12'],
        ]) {
          await type('minimum-age', from);
          await type('maximum-age', to);
          await leave('minimum-age');
          await leave('maximum-age');
          expect(error('minimum-age')).toBeNull();
          expect(error('maximum-age')).toBeNull();
        }
      });

      it('shows nothing while the user types a partial value, and nothing for a field never changed', async () => {
        await open([]);
        await type('minimum-age', '1');
        expect(error('minimum-age')).toBeNull();
        await leave('maximum-age');
        expect(error('maximum-age')).toBeNull();
      });

      it('clears the error on the keystroke that makes the value valid', async () => {
        await open([]);
        await type('minimum-age', '1');
        await leave('minimum-age');
        expect(error('minimum-age')).not.toBeNull();
        await type('minimum-age', '12');
        expect(error('minimum-age')).toBeNull();
      });
    });

    it('submitted empty: every message, focus on Name, nothing sent', async () => {
      await open([]);
      await submit();
      expect(o.convex.calls).toEqual([]);
      expect(error('name')).toBe(CAMP_MESSAGES.nameEmpty);
      expect(error('slug')).toBe(CAMP_MESSAGES.slugEmpty);
      expect(page.querySelector('#sport-error')).not.toBeNull();
      expect(error('locations')).toBe(CAMP_MESSAGES.locationsEmpty);
      expect(error('minimum-age')).toBe(CAMP_MESSAGES.minimumAgeEmpty);
      expect(error('maximum-age')).toBe(CAMP_MESSAGES.maximumAgeEmpty);
      expect(document.activeElement).toBe(input('name'));
    });

    it('focus goes to the first invalid field: the web address, the sport, the location, then the ages', async () => {
      await open([]);
      await type('name', 'Junior Beach Volleyball Camp');
      await type('slug', '');
      await submit();
      expect(document.activeElement).toBe(input('slug'));
      await type('slug', 'junior-beach-volleyball-camp');
      await submit();
      expect(document.activeElement).toBe(input('sport-beachVolleyball'));
      await choose('sport-beachVolleyball');
      await submit();
      expect(document.activeElement).toBe(location(1));
      location(1).click();
      await submit();
      expect(document.activeElement).toBe(input('minimum-age'));
    });

    it('sends the values with the ages as numbers; while in flight the button says so', async () => {
      await open([]);
      await fill();
      await type('name', '  Junior Beach Volleyball Camp ');
      await submit();
      expect(calls()).toEqual([[CREATE, VALID_ARGS]]);
      expect(text(submitButton())).toBe('Creating camp…');
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expect(submitButton().disabled).toBe(false);
      expectPendingSpinner(submitButton());
      expect(text(form().querySelector('p[role="status"].sr-only'))).toBe('Creating the camp.');
      await submit();
      expect(o.convex.calls).toHaveLength(1);
      expect(tokens(submitButton().className)).toEqual(
        expect.arrayContaining(tokens(PRIMARY_BUTTON)),
      );
    });

    it('sends the preselected only location without a tick', async () => {
      await open([], COASTAL_LOCATIONS.slice(0, 1));
      await type('name', 'Junior Beach Volleyball Camp');
      await choose('sport-beachVolleyball');
      await type('minimum-age', '9');
      await type('maximum-age', '14');
      await submit();
      expect(calls()).toEqual([[CREATE, VALID_ARGS]]);
    });

    const createdStatus = () => form().querySelector<HTMLElement>('[data-slot="created-status"]');

    async function created() {
      await fill();
      submitButton().focus();
      await submit();
      o.convex.calls[0].resolve({ campId: 'cp_new' });
      await o.flush();
    }

    it('on success: "<name> created." above the button, the form cleared, focus kept on the button', async () => {
      await open([]);
      await created();
      const status = createdStatus()!;
      expect(text(status)).toBe('Junior Beach Volleyball Camp created.');
      expect(status.getAttribute('role')).toBe('status');
      expect(status.nextElementSibling).toBe(submitButton());
      for (const id of ['name', 'slug', 'minimum-age', 'maximum-age']) {
        expect(input(id).value, id).toBe('');
      }
      expect(input('sport-beachVolleyball').checked).toBe(false);
      expect(location(1).getAttribute('aria-checked')).toBe('false');
      expect(document.activeElement).toBe(submitButton());
      expect(text(submitButton())).toBe('Create draft camp');
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
          message: CAMP_MESSAGES.slugTaken('junior-beach-volleyball-camp'),
        }),
      );
      await o.flush();
      expect(error('slug')).toBe(
        'junior-beach-volleyball-camp is already taken. Choose another web address.',
      );
      expect(page.querySelector('#slug-error strong')?.textContent).toBe(
        'junior-beach-volleyball-camp',
      );
      expect(document.activeElement).toBe(input('slug'));
      expect(input('name').value).toBe('Junior Beach Volleyball Camp');
      expect(input('minimum-age').value).toBe('9');
      expect(input('maximum-age').value).toBe('14');
      await type('slug', 'junior-beach-volleyball-camp-b');
      expect(error('slug')).toBeNull();
    });

    it('the server refusing the ages shows its message under that field, focus on it, values kept, and the message clears when either age changes', async () => {
      await open([]);
      await fill();
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'maximumAge',
          code: 'agesReversed',
          message: CAMP_MESSAGES.agesReversed(9),
        }),
      );
      await o.flush();
      expect(error('maximum-age')).toBe(CAMP_MESSAGES.agesReversed(9));
      expect(document.activeElement).toBe(input('maximum-age'));
      expect(input('name').value).toBe('Junior Beach Volleyball Camp');
      expect(input('minimum-age').value).toBe('9');
      await type('minimum-age', '8');
      expect(error('maximum-age')).toBeNull();
    });

    it('any other failure shows the form alert, titled and with what to do, focuses it, and keeps every value', async () => {
      await open([]);
      await fill();
      await submit();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = form().querySelector<HTMLElement>('[role="alert"][data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The camp could not be created.',
      );
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(document.activeElement).toBe(alert);
      expect(input('name').value).toBe('Junior Beach Volleyball Camp');
      expect(input('minimum-age').value).toBe('9');
      expect(input('maximum-age').value).toBe('14');
      expect(text(submitButton())).toBe('Create draft camp');
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
      expect(input('name').value).toBe('Junior Beach Volleyball Camp');
      expect(input('maximum-age').value).toBe('14');
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
        expect(input('name').value).toBe('Junior Beach Volleyball Camp');
      });
    });
  });
});
