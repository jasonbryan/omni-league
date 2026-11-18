import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { ConvexError } from 'convex/values';
import { TRAINING_MESSAGES } from '../../../../convex/lib/trainingInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { AVAILABILITY_PAUSE_MS } from '../../core/forms/slug-availability';
import { expectBar } from '../../shell/testing/bar-title';
import { expectBadgeSize } from '../../ui/testing/badge';
import { expectBareCards } from '../../ui/testing/card';
import { expectSkeletonBoxes } from '../../ui/testing/skeleton-boxes';
import { expectPendingSpinner } from '../../ui/testing/spinner';
import { AdminArea } from './admin-area';
import { AdminTraining } from './admin-training';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { TrainingForm } from './training-form';
import { WEB_ADDRESS_CLEARANCE } from './sticky-footer';
import { ROW_TITLE_LINK } from './link-classes';
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

const ROUTES = adminRoutes(AdminArea, [{ path: 'training', component: AdminTraining }]);
const URL = `/app/organizations/${COASTAL.slug}/training`;
const LIST_TRAINING = 'trainings:listForOrganization';
const CREATE = 'trainings:create';
const IS_AVAILABLE = 'trainings:isSlugAvailable';
const tokens = (value: string) => value.split(' ').sort();

const TRAINING = [
  {
    trainingId: 'tr_passing',
    programId: 'pg_passing',
    name: 'Adult Passing Clinic',
    slug: 'adult-passing-clinic',
    coachName: 'Lee Park',
    minimumAge: 16,
    status: 'published',
  },
  {
    trainingId: 'tr_serving',
    programId: 'pg_serving',
    name: 'Tuesday Serving Clinic',
    slug: 'tuesday-serving-clinic',
    coachName: 'Dana Ruiz',
    status: 'draft',
  },
  {
    trainingId: 'tr_juniors',
    programId: 'pg_juniors',
    name: 'Juniors Drills',
    slug: 'juniors-drills',
    coachName: 'Sam Ortiz',
    minimumAge: 9,
    maximumAge: 14,
    status: 'draft',
  },
  {
    trainingId: 'tr_under',
    programId: 'pg_under',
    name: 'Under 12 Passing',
    slug: 'under-12-passing',
    coachName: 'Jo Kim',
    maximumAge: 12,
    status: 'draft',
  },
];

describe('AdminTraining', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(training?: unknown[], locations: unknown[] | null = COASTAL_LOCATIONS) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
    await o.flush();
    if (training) o.subscription(LIST_TRAINING)!.emit(training);
    if (locations) o.subscription(LIST_FOR_ADMIN)!.emit(locations);
    await o.flush();
  }

  const input = (id: string) => page.querySelector<HTMLInputElement>(`#${id}`)!;
  const form = () => page.querySelector<HTMLFormElement>('#create-training form')!;
  const submitButton = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const items = () => [...page.querySelectorAll<HTMLElement>('#training-list > li')];
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
    await type('name', 'Tuesday Serving Clinic');
    await choose('sport-beachVolleyball');
    location(1).click();
    await type('coach-name', 'Dana Ruiz');
  }

  async function fillWithAges() {
    await fill();
    await type('minimum-age', '9');
    await type('maximum-age', '14');
  }

  const VALID_ARGS = {
    organizationId: COASTAL.organizationId,
    name: 'Tuesday Serving Clinic',
    slug: 'tuesday-serving-clinic',
    sport: 'beachVolleyball',
    locationIds: ['loc_pelican'],
    coachName: 'Dana Ruiz',
  };

  describe('the page', () => {
    it('asks trainings.listForOrganization and locations.listForAdmin with the organization id, only after the context says ready', async () => {
      await open();
      expectPageAndShellSubscriptions(o.convex, [
        [GET_ADMIN_CONTEXT, { slug: COASTAL.slug }],
        [LIST_TRAINING, { organizationId: COASTAL.organizationId }],
        [LIST_FOR_ADMIN, { organizationId: COASTAL.organizationId }],
      ]);
    });

    it('asks for nothing when the caller has no access', async () => {
      o = await openAdmin(ROUTES, URL);
      o.acceptToken();
      o.subscription(GET_ADMIN_CONTEXT)!.fail(forbiddenError());
      await o.flush();
      expect(o.convex.activeSubscriptions.map((s) => s.name)).not.toContain(LIST_TRAINING);
      expect(o.page.querySelector('#training-list')).toBeNull();
      expect(o.page.querySelector('#create-training')).toBeNull();
    });

    it('has the organization, the h1, the sentence, and the title', async () => {
      await open([]);
      const main = page.querySelector('main')!;
      expect(text(main.querySelector('p.text-sm.font-medium'))).toBe('Coastal Bend Rec Club');
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(text(main.querySelector('h1'))).toBe('Training');
      expect(text(main.querySelector('h1 + p'))).toBe(
        'A training program runs weekly classes led by a coach. Drafts are visible only to your staff.',
      );
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Training | Coastal Bend Rec Club | Omni League',
      );
      expectBar(page, 'Training');
    });

    it('draws the list and the create panel as bare helm cards, the create panel still focusable and outline-free', async () => {
      await open([]);
      const main = page.querySelector('main')!;
      expectBareCards(main, ['overflow-hidden lg:col-span-2', 'overflow-clip focus:outline-none']);
      expect(main.querySelector('#create-training')!.getAttribute('tabindex')).toBe('-1');
    });

    it('loading: skeleton rows and a polite status, with the create panel already there', async () => {
      await open(undefined, null);
      const panel = page.querySelector('section[aria-labelledby="training-heading"]')!;
      expect(text(panel.querySelector('[role="status"]'))).toBe('Loading the training programs.');
      expect(panel.querySelector('ul')).toBeNull();
      expect(panel.querySelectorAll('[aria-hidden="true"].divide-y > div')).toHaveLength(3);
      expectSkeletonBoxes(panel, { 'rounded-md': 6 });
      expect(text(page.querySelector('#create-training h2'))).toBe('Create a training program');
      expect(page.querySelector('#create-training form')).toBeNull();
    });

    it('empty: says what will appear and what to do next, and the form is below', async () => {
      await open([]);
      const panel = page.querySelector('section[aria-labelledby="training-heading"]')!;
      expect(text(panel.querySelector('p.font-medium'))).toBe('No training yet');
      expect(text(panel)).toContain('Create a training program, then schedule its classes.');
      expect(panel.querySelector('ul')).toBeNull();
      expect(page.querySelector('#create-training form')).not.toBeNull();
    });

    it('populated: a row per training program with its name and Draft or Published', async () => {
      await open(TRAINING);
      expect(items().map((li) => text(li.querySelector('h3')))).toEqual([
        'Adult Passing Clinic',
        'Tuesday Serving Clinic',
        'Juniors Drills',
        'Under 12 Passing',
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
    });

    it('reads the ages of each row: one bound, both, or none', async () => {
      await open(TRAINING);
      expect(items().map((li) => text(li.querySelector('[data-slot="ages"]')))).toEqual([
        '16 or older',
        'All ages',
        '9 to 14',
        '12 or younger',
      ]);
    });

    it('names the coach of each row', async () => {
      await open(TRAINING);
      expect(items().map((li) => text(li.querySelector('[data-slot="coach"]')))).toEqual([
        'Coach: Lee Park',
        'Coach: Dana Ruiz',
        'Coach: Sam Ortiz',
        'Coach: Jo Kim',
      ]);
    });

    it('links each name to its page', async () => {
      await open(TRAINING);
      const base = `/app/organizations/${COASTAL.slug}/training`;
      expect(
        items().map((li) => {
          const link = li.querySelector<HTMLAnchorElement>('h3 a')!;
          return [text(link), link.getAttribute('href')];
        }),
      ).toEqual([
        ['Adult Passing Clinic', `${base}/adult-passing-clinic`],
        ['Tuesday Serving Clinic', `${base}/tuesday-serving-clinic`],
        ['Juniors Drills', `${base}/juniors-drills`],
        ['Under 12 Passing', `${base}/under-12-passing`],
      ]);
    });

    it('draws the name link as the Tournaments list does, underlined at rest with a 44px touch target', async () => {
      await open(TRAINING);
      expect(tokens(items()[0].querySelector('h3 a')!.className)).toEqual(tokens(ROW_TITLE_LINK));
    });

    it('a failed list shows the destructive alert, never the error message', async () => {
      await open(undefined, COASTAL_LOCATIONS);
      o.subscription(LIST_TRAINING)!.fail(new Error('Server Error: secret'));
      await o.flush();
      const alert = page.querySelector(
        'section[aria-labelledby="training-heading"] [role="alert"]',
      );
      expect(text(alert)).toBe(
        'The training programs could not be loaded. Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
    });

    it('lists a training program created elsewhere at once (the list is live)', async () => {
      await open(TRAINING.slice(0, 1));
      o.subscription(LIST_TRAINING)!.emit(TRAINING);
      await o.flush();
      expect(items()).toHaveLength(4);
    });

    it('replaces the form with "Add a location first" and a link to Locations when there is none', async () => {
      await open(TRAINING, []);
      const panel = page.querySelector('#create-training')!;
      expect(text(panel.querySelector('p.font-medium'))).toBe('Add a location first');
      expect(text(panel)).toContain(
        'Every training program is held at one or more of your locations.',
      );
      const link = panel.querySelector<HTMLAnchorElement>('a')!;
      expect(link.getAttribute('href')).toBe(`/app/organizations/${COASTAL.slug}/locations`);
      expect(tokens(link.className)).toEqual(tokens(OUTLINE_BUTTON));
      expect(page.querySelector('form')).toBeNull();
      expect(items()).toHaveLength(4);
    });

    it('has a jump link to the form for phones, which moves focus to Name', async () => {
      await open([]);
      const link = page.querySelector<HTMLAnchorElement>('main a[data-slot="button"]')!;
      expect(text(link)).toBe('Create a training program');
      expect(link.getAttribute('href')).toBe(`${URL}#create-training`);
      expect(link.classList.contains('lg:hidden')).toBe(true);
      page.querySelector<HTMLElement>('#create-training')!.scrollIntoView = vi.fn();
      link.click();
      await o.flush();
      expect(document.activeElement).toBe(input('name'));
    });
  });

  describe('the form', () => {
    it('has Name, Web address, Sport, Locations, Coach, and the ages, and no division or dates', async () => {
      await open([]);
      const labels = [...form().querySelectorAll('label, legend')].map((element) => text(element));
      for (const label of [
        'Name',
        'Web address',
        'Sport',
        'Locations',
        'Coach',
        'Ages from',
        'Ages to',
      ]) {
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
      await type('name', 'Tuesday Serving Clinic');
      expect(input('slug').value).toBe('tuesday-serving-clinic');
      await type('slug', 'serving-clinic');
      await type('name', 'Tuesday Serving Clinic 2027');
      expect(input('slug').value).toBe('serving-clinic');
    });

    describe('web address availability', () => {
      const asked = () => o.convex.subscriptions.filter((s) => s.name === IS_AVAILABLE);
      const pause = async () => {
        await new Promise((resolve) => setTimeout(resolve, AVAILABILITY_PAUSE_MS + 50));
        await o.flush();
      };

      it('asks trainings.isSlugAvailable with the organization id, and says Available', async () => {
        await open([]);
        await type('name', 'Tuesday Serving Clinic');
        await pause();
        expect(asked().at(-1)!.args).toEqual({
          organizationId: COASTAL.organizationId,
          slug: 'tuesday-serving-clinic',
        });
        asked().at(-1)!.emit(true);
        await o.flush();
        expect(text(page.querySelector('#slug-availability'))).toBe('Available');
      });

      it('says the address is taken, with the shared message, before a submit', async () => {
        await open([]);
        await type('name', 'Tuesday Serving Clinic');
        await pause();
        asked().at(-1)!.emit(false);
        await o.flush();
        expect(error('slug')).toBe(
          'tuesday-serving-clinic is already taken. Choose another web address.',
        );
        expect(calls()).toEqual([]);
      });

      it('keeps the Web address children in the order label, input, status, error, description', async () => {
        await open([]);
        const order = () =>
          [...input('slug').closest('[data-slot="field"]')!.children].map(
            (child) => child.getAttribute('data-slot') ?? child.tagName.toLowerCase(),
          );
        expect(order()).toEqual(['field-label', 'input', 'field-status', 'field-description']);
        await submit();
        expect(order()).toEqual([
          'field-label',
          'input',
          'field-status',
          'field-error',
          'field-description',
        ]);
        expect(page.querySelector('#slug-availability')?.getAttribute('role')).toBe('status');
      });

      it('ties the Web address input to its error first, then its description', async () => {
        await open([]);
        expect(input('slug').getAttribute('aria-describedby')).toBe('slug-description');
        await submit();
        expect(input('slug').getAttribute('aria-describedby')).toBe('slug-error slug-description');
      });

      it('adds the web address clearance to the field group so a focus scroll leaves the status above the footer', async () => {
        await open([]);
        const classes = form().querySelector('[data-slot="field-group"]')!.className;
        expect(classes.split(' ')).toEqual(expect.arrayContaining(tokens(WEB_ADDRESS_CLEARANCE)));
      });

      it('says the address is unique across leagues, tournaments, camps, and training programs', async () => {
        await open([]);
        expect(text(page.querySelector('#slug-description'))).toBe(
          '3 to 60 lowercase letters and digits, with single hyphens between them. Unique within Coastal Bend Rec Club, across its leagues, tournaments, camps, and training programs.',
        );
      });

      it('keeps the taken message, the same element with the same text, through the flight and the refusal', async () => {
        await open([]);
        await fill();
        await pause();
        asked().at(-1)!.emit(false);
        await o.flush();
        const shown = page.querySelector('#slug-error');
        const message = 'tuesday-serving-clinic is already taken. Choose another web address.';
        expect(error('slug')).toBe(message);
        await submit();
        expect(o.convex.calls).toHaveLength(1);
        expect(page.querySelector('#slug-error')).toBe(shown);
        expect(error('slug')).toBe(message);
        o.convex.calls[0].reject(
          new ConvexError({
            field: 'slug',
            code: 'slugTaken',
            message: TRAINING_MESSAGES.slugTaken('tuesday-serving-clinic'),
          }),
        );
        await o.flush();
        expect(page.querySelector('#slug-error')).toBe(shown);
        expect(error('slug')).toBe(message);
      });

      it('keeps Available through the flight', async () => {
        await open([]);
        await fill();
        await pause();
        asked().at(-1)!.emit(true);
        await o.flush();
        expect(text(page.querySelector('#slug-availability'))).toBe('Available');
        await submit();
        expect(o.convex.calls).toHaveLength(1);
        expect(text(page.querySelector('#slug-availability'))).toBe('Available');
      });

      it('ignores an answer that turns taken in flight, in flight and after a success', async () => {
        await open([]);
        await fill();
        await pause();
        asked().at(-1)!.emit(true);
        await o.flush();
        await submit();
        asked().at(-1)!.emit(false);
        await o.flush();
        expect(page.querySelector('#slug-error')).toBeNull();
        expect(text(page.querySelector('#slug-availability'))).toBe('Available');
        o.convex.calls[0].resolve({ trainingId: 'tr_new' });
        await o.flush();
        expect(page.querySelector('#slug-error')).toBeNull();
      });

      it('shows no taken message at the moment the page clears the form after a success', async () => {
        await open([]);
        await fill();
        await pause();
        asked().at(-1)!.emit(true);
        await o.flush();
        await submit();
        asked().at(-1)!.emit(false);
        await o.flush();
        const clear = Object.getOwnPropertyDescriptor(TrainingForm.prototype, 'clear')!.value as (
          this: TrainingForm,
        ) => void;
        const seen: (string | null)[] = [];
        const spy = vi.spyOn(TrainingForm.prototype, 'clear').mockImplementation(function (
          this: TrainingForm,
        ) {
          seen.push(this.errors.slug());
          clear.call(this);
        });
        try {
          o.convex.calls[0].resolve({ trainingId: 'tr_new' });
          await o.flush();
        } finally {
          spy.mockRestore();
        }
        expect(seen).toEqual([null]);
      });

      it('shows the live answer again once the create fails with the failed alert', async () => {
        await open([]);
        await fill();
        await pause();
        asked().at(-1)!.emit(true);
        await o.flush();
        await submit();
        asked().at(-1)!.emit(false);
        await o.flush();
        expect(page.querySelector('#slug-error')).toBeNull();
        o.convex.calls[0].reject(new Error('Server Error: secret'));
        await o.flush();
        expect(error('slug')).toBe(
          'tuesday-serving-clinic is already taken. Choose another web address.',
        );
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
        expect(error('maximum-age')).toBe(TRAINING_MESSAGES.agesReversed(12));
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
        expect(error('maximum-age')).toBe(TRAINING_MESSAGES.agesReversed(12));
      });

      it('accepts either age alone, and neither, without a message, also after leaving both', async () => {
        await open([]);
        await type('minimum-age', '16');
        await leave('minimum-age');
        await leave('maximum-age');
        expect(error('minimum-age')).toBeNull();
        expect(error('maximum-age')).toBeNull();
        await type('minimum-age', '');
        await type('maximum-age', '12');
        await leave('minimum-age');
        await leave('maximum-age');
        expect(error('minimum-age')).toBeNull();
        expect(error('maximum-age')).toBeNull();
      });

      it('shows a coach name over 100 characters, or missing once left', async () => {
        await open([]);
        await type('coach-name', 'x'.repeat(101));
        await leave('coach-name');
        expect(error('coach-name')).toBe(TRAINING_MESSAGES.coachTooLong(101));
        await type('coach-name', '   ');
        await leave('coach-name');
        expect(error('coach-name')).toBe(TRAINING_MESSAGES.coachEmpty);
        await type('coach-name', 'Dana Ruiz');
        expect(error('coach-name')).toBeNull();
      });

      it.each(['3', '100', '9.5', 'many'])(
        'shows %s as an age from outside 4 to 99',
        async (value) => {
          await open([]);
          await type('minimum-age', value);
          await leave('minimum-age');
          expect(error('minimum-age')).toBe(TRAINING_MESSAGES.ageInvalid);
        },
      );

      it('shows 3 as an age to outside 4 to 99', async () => {
        await open([]);
        await type('maximum-age', '3');
        await leave('maximum-age');
        expect(error('maximum-age')).toBe(TRAINING_MESSAGES.ageInvalid);
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
      expect(error('name')).toBe(TRAINING_MESSAGES.nameEmpty);
      expect(error('slug')).toBe(TRAINING_MESSAGES.slugEmpty);
      expect(page.querySelector('#sport-error')).not.toBeNull();
      expect(error('locations')).toBe(TRAINING_MESSAGES.locationsEmpty);
      expect(error('coach-name')).toBe(TRAINING_MESSAGES.coachEmpty);
      expect(error('minimum-age')).toBeNull();
      expect(error('maximum-age')).toBeNull();
      expect(document.activeElement).toBe(input('name'));
    });

    it('focus goes to the first invalid field: the web address, the sport, the location, then the coach', async () => {
      await open([]);
      await type('name', 'Tuesday Serving Clinic');
      await type('slug', '');
      await submit();
      expect(document.activeElement).toBe(input('slug'));
      await type('slug', 'tuesday-serving-clinic');
      await submit();
      expect(document.activeElement).toBe(input('sport-beachVolleyball'));
      await choose('sport-beachVolleyball');
      await submit();
      expect(document.activeElement).toBe(location(1));
      location(1).click();
      await submit();
      expect(document.activeElement).toBe(input('coach-name'));
      await type('coach-name', 'Dana Ruiz');
      await type('minimum-age', '3');
      await submit();
      expect(document.activeElement).toBe(input('minimum-age'));
    });

    it('sends the values, the coach trimmed; while in flight the button says so', async () => {
      await open([]);
      await fill();
      await type('name', '  Tuesday Serving Clinic ');
      await type('coach-name', ' Dana Ruiz ');
      await submit();
      expect(calls()).toEqual([[CREATE, VALID_ARGS]]);
      expect(text(submitButton())).toBe('Creating training program…');
      expect(submitButton().getAttribute('aria-disabled')).toBe('true');
      expect(submitButton().disabled).toBe(false);
      expectPendingSpinner(submitButton());
      expect(text(form().querySelector('p[role="status"].sr-only'))).toBe(
        'Creating the training program.',
      );
      await submit();
      expect(o.convex.calls).toHaveLength(1);
      expect(tokens(submitButton().className)).toEqual(
        expect.arrayContaining(tokens(PRIMARY_BUTTON)),
      );
    });

    it('sends the preselected only location without a tick', async () => {
      await open([], COASTAL_LOCATIONS.slice(0, 1));
      await type('name', 'Tuesday Serving Clinic');
      await choose('sport-beachVolleyball');
      await type('coach-name', 'Dana Ruiz');
      await submit();
      expect(calls()).toEqual([[CREATE, VALID_ARGS]]);
    });

    it.each([
      ['a minimum alone', ['16', ''], { minimumAge: 16 }],
      ['a maximum alone', ['', '12'], { maximumAge: 12 }],
      ['both', ['9', '14'], { minimumAge: 9, maximumAge: 14 }],
    ])('sends %s of the ages and omits the blank one', async (_label, [minimum, maximum], sent) => {
      await open([]);
      await fill();
      await type('minimum-age', minimum);
      await type('maximum-age', maximum);
      await submit();
      expect(calls()).toEqual([[CREATE, { ...VALID_ARGS, ...sent }]]);
    });

    const createdStatus = () => form().querySelector<HTMLElement>('[data-slot="created-status"]');

    async function created() {
      await fill();
      submitButton().focus();
      await submit();
      o.convex.calls[0].resolve({ trainingId: 'tr_new' });
      await o.flush();
    }

    it('on success: "<name> created." above the button, the form cleared, focus kept on the button', async () => {
      await open([]);
      await created();
      const status = createdStatus()!;
      expect(text(status)).toBe('Tuesday Serving Clinic created.Schedule classes');
      const next = status.querySelector<HTMLAnchorElement>('a')!;
      expect([text(next), next.getAttribute('href')]).toEqual([
        'Schedule classes',
        `/app/organizations/${COASTAL.slug}/training/tuesday-serving-clinic#schedule`,
      ]);
      expect(status.getAttribute('role')).toBe('status');
      expect(status.nextElementSibling).toBe(submitButton());
      for (const id of ['name', 'slug', 'coach-name', 'minimum-age', 'maximum-age']) {
        expect(input(id).value, id).toBe('');
      }
      expect(input('sport-beachVolleyball').checked).toBe(false);
      expect(location(1).getAttribute('aria-checked')).toBe('false');
      expect(document.activeElement).toBe(submitButton());
      expect(text(submitButton())).toBe('Create draft training program');
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
      await fillWithAges();
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'slug',
          code: 'slugTaken',
          message: TRAINING_MESSAGES.slugTaken('tuesday-serving-clinic'),
        }),
      );
      await o.flush();
      expect(error('slug')).toBe(
        'tuesday-serving-clinic is already taken. Choose another web address.',
      );
      expect(page.querySelector('#slug-error strong')?.textContent).toBe('tuesday-serving-clinic');
      expect(document.activeElement).toBe(input('slug'));
      expect(input('name').value).toBe('Tuesday Serving Clinic');
      expect(input('minimum-age').value).toBe('9');
      expect(input('maximum-age').value).toBe('14');
      await type('slug', 'tuesday-serving-clinic-b');
      expect(error('slug')).toBeNull();
    });

    it('the server refusing the ages shows its message under that field, focus on it, values kept, and the message clears when either age changes', async () => {
      await open([]);
      await fillWithAges();
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'maximumAge',
          code: 'agesReversed',
          message: TRAINING_MESSAGES.agesReversed(9),
        }),
      );
      await o.flush();
      expect(error('maximum-age')).toBe(TRAINING_MESSAGES.agesReversed(9));
      expect(document.activeElement).toBe(input('maximum-age'));
      expect(input('name').value).toBe('Tuesday Serving Clinic');
      expect(input('minimum-age').value).toBe('9');
      await type('minimum-age', '8');
      expect(error('maximum-age')).toBeNull();
    });

    it('any other failure shows the form alert, titled and with what to do, focuses it, and keeps every value', async () => {
      await open([]);
      await fillWithAges();
      await submit();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = form().querySelector<HTMLElement>('[role="alert"][data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The training program could not be created.',
      );
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
      expect(page.textContent).not.toContain('secret');
      expect(document.activeElement).toBe(alert);
      expect(input('name').value).toBe('Tuesday Serving Clinic');
      expect(input('minimum-age').value).toBe('9');
      expect(input('maximum-age').value).toBe('14');
      expect(text(submitButton())).toBe('Create draft training program');
    });

    it('a refusal from the adapter at call time (offline) shows the offline alert and keeps every value', async () => {
      await open([]);
      await fillWithAges();
      await submit();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(form().querySelector('[data-slot="alert"]'))).toBe(
        "You're offline. Nothing was sent. Your details are still here. Try again when you're connected.",
      );
      expect(input('name').value).toBe('Tuesday Serving Clinic');
      expect(input('maximum-age').value).toBe('14');
    });

    describe('offline', () => {
      afterEach(() => vi.restoreAllMocks());

      it('the button looks disabled but stays focusable, and a press shows the offline alert and sends nothing', async () => {
        await open([]);
        await fillWithAges();
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
        expect(input('name').value).toBe('Tuesday Serving Clinic');
      });
    });
  });
});
