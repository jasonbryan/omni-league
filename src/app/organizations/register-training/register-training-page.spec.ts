import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConvexError } from 'convex/values';
import { AuthService } from '../../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../../core/data/convex';
import { FakeConvexClient } from '../../core/data/convex/testing/fake-convex-client';
import { appRouteTitle } from '../../shell/testing/app-route-title';
import { BAR_TITLE_PROVIDER, expectBar } from '../../shell/testing/bar-title';
import { expectAlertClasses, expectAlertSlots } from '../../ui/testing/alert';
import { expectPendingSpinner } from '../../ui/testing/spinner';
import { RegisterTrainingPage } from './register-training-page';

@Component({ template: 'elsewhere' })
class Elsewhere {}

const SLUGS = { orgSlug: 'gulf-coast-sport-social', trainingSlug: 'tuesday-serving-clinic' };
const PATH = `/app/organizations/${SLUGS.orgSlug}/training/${SLUGS.trainingSlug}/register`;
const TRAINING_PATH = `/organizations/${SLUGS.orgSlug}/training/${SLUGS.trainingSlug}`;
const GET = 'trainingRegistrations:getForRegistration';
const REGISTER = 'trainingRegistrations:register';
const JOIN = 'trainingWaitlist:join';
const TRAINING_ID = 'training_1';
const NO_AGES = {
  trainingId: TRAINING_ID,
  organizationName: 'Gulf Coast Sport & Social',
  name: 'Tuesday Serving Clinic',
  pattern: {
    weekday: 2,
    startTime: '18:00',
    endTime: '19:00',
    firstDate: '2027-02-02',
    weeks: 8,
    registrationDeadline: '2027-02-01',
  },
  classCount: 8,
  placesLeft: 12,
  registered: false,
  waitlisted: false,
};
const OPEN = { ...NO_AGES, minimumAge: 18, maximumAge: 99 };
const REGISTERED = { ...OPEN, registered: true };
const FULL = { ...OPEN, placesLeft: 0, fullClassDate: '2027-02-16' };
const YOUTH = { ...OPEN, minimumAge: 9, maximumAge: 17 };
const BOTH = { ...OPEN, minimumAge: 14, maximumAge: 30 };
const MINIMUM_ONLY = { ...NO_AGES, minimumAge: 16 };
const MAXIMUM_ONLY = { ...NO_AGES, maximumAge: 12 };
const CLASS_ID = 'class_2';
const CLASS_PATH = `${PATH}?class=${CLASS_ID}`;
const SINGLE = {
  classId: CLASS_ID,
  date: '2027-02-09',
  startTime: '18:00',
  endTime: '19:00',
  placesLeft: 12,
  allowed: true,
};
const OPEN_CLASS = { ...OPEN, singleClass: SINGLE };
const BEFORE = '2027-01-30T12:00:00Z';
const AFTER_CLASS = '2027-02-10T12:00:00Z';
const AFTER_DEADLINE = '2027-02-03T12:00:00Z';

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim();
/** The title and the description are blocks, so a reader hears them apart. */
const alertText = (element: Element | null | undefined) =>
  [
    element?.querySelector('[data-slot="alert-title"]'),
    element?.querySelector('[data-slot="alert-description"]'),
  ]
    .map(text)
    .join(' ');

describe('RegisterTrainingPage', () => {
  let convex: FakeConvexClient;
  let harness: RouterTestingHarness;
  let page: HTMLElement;

  async function open({ signedIn = true, now = BEFORE, query = '' } = {}) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(now));
    convex = new FakeConvexClient();
    const auth = new FakeAuthClient();
    if (!signedIn) auth.storedCookie = '';
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        BAR_TITLE_PROVIDER,
        provideRouter([
          {
            path: 'app/organizations/:orgSlug/training/:trainingSlug/register',
            title: appRouteTitle('organizations/:orgSlug/training/:trainingSlug/register'),
            component: RegisterTrainingPage,
          },
          { path: 'sign-in', component: Elsewhere },
          { path: '**', component: Elsewhere },
        ]),
      ],
    });
    if (signedIn) auth.emitSession({ id: 's1' });
    harness = await RouterTestingHarness.create(`${PATH}${query}`);
    page = harness.routeNativeElement!;
    await flush();
    if (signedIn) {
      TestBed.inject(AuthService).onChange(true);
      TestBed.tick();
    }
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  async function flush() {
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
  }

  const registration = () => convex.activeSubscriptions.find((s) => s.name === GET);
  async function answer(value: unknown) {
    registration()!.emit(value);
    await flush();
  }
  const url = () => TestBed.inject(Router).url;
  const ageBox = () => page.querySelector<HTMLButtonElement>('#age-confirmed');
  const registers = () => convex.calls.filter((call) => call.name === REGISTER);
  const ageLabel = () => text(page.querySelector('label[for="age-confirmed"]'));
  const backLink = () =>
    [...page.querySelectorAll('main a')].find((a) => text(a) === 'Back to the training page');

  async function tick() {
    ageBox()!.click();
    await harness.fixture.whenStable();
  }

  async function submit() {
    page.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await flush();
  }

  describe('the state order', () => {
    it('asks nothing until Convex has accepted the token, then asks with the slugs', async () => {
      await open();
      expect(registration()?.args).toEqual(SLUGS);
      expect(text(page.querySelector('main [role="status"]'))).toBe(
        'Loading the training program.',
      );
    });

    it('not found: shows the not-found view and calls no mutation, signed in or not', async () => {
      for (const signedIn of [true, false]) {
        TestBed.resetTestingModule();
        await open({ signedIn });
        await answer(null);
        expect(text(page.querySelector('main h1'))).toBe('Page not found');
        expect(ageBox()).toBeNull();
        expect(convex.calls).toEqual([]);
        expect(url()).toBe(PATH);
      }
    });

    it('signed out: goes to sign-in with this address as returnTo, in place of this entry', async () => {
      await open({ signedIn: false });
      await answer(OPEN);
      expect(url()).toBe(`/sign-in?returnTo=${encodeURIComponent(PATH)}`);
      expect(convex.calls).toEqual([]);
    });

    it('registered, even after the deadline: says so with a link back, and no form', async () => {
      await open({ now: AFTER_DEADLINE });
      await answer({ ...REGISTERED, minimumAge: 18 });
      const card = page.querySelector('[data-slot="alert"]');
      expect(card?.getAttribute('role')).toBe('status');
      expectAlertSlots(card);
      expectAlertClasses(card, 'default', 'outline-offset-2 focus:outline-2 focus:outline-ring');
      expect(alertText(card)).toBe(
        "You're registered for Tuesday Serving Clinic. Your place is held in every class. You’ll find it on the training page.",
      );
      expect(page.querySelector('form')).toBeNull();
      expect(backLink()?.getAttribute('href')).toBe(TRAINING_PATH);
    });

    it('closed: shows the deadline and no form, with a link back', async () => {
      await open({ now: AFTER_DEADLINE });
      await answer(OPEN);
      const alert = page.querySelector('[data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('status');
      expect(alertText(alert)).toBe(
        'Registration for this training program is closed. It closed on Feb 1, 2027.',
      );
      expect(page.querySelector('form')).toBeNull();
      expect(backLink()).toBeDefined();
    });

    it('full: offers the waitlist for the series, naming the full class, with the age box and a link back', async () => {
      await open();
      await answer(FULL);
      const note = page.querySelector('form [role="note"]');
      expect(alertText(note)).toBe(
        'A class is full. Join the waitlist. When every class has a place, the organizer offers the series to the first person waiting.',
      );
      expect(text(page.querySelector('button[type="submit"]'))).toBe('Join the waitlist');
      expect(ageBox()).not.toBeNull();
      expect(text(page.querySelector('main p.text-muted-foreground'))).toBe(
        'Join the waitlist for a training series',
      );
    });

    it('open: the series facts, the form, and the title', async () => {
      await open();
      await answer(OPEN);
      expect(text(page.querySelector('main h1'))).toBe('Tuesday Serving Clinic');
      const facts = [...page.querySelectorAll('main dl > div')].map((row) => [
        text(row.querySelector('dt')),
        text(row.querySelector('dd')),
      ]);
      expect(facts).toEqual([
        ['Schedule', 'Tuesdays, 6 to 7 pm, 8 weeks'],
        ['First class', 'Feb 2, 2027'],
        ['Ages', '18 to 99'],
        ['Places left', 'At least 12 places left in every class'],
        ['Registration closes', 'Feb 1, 2027'],
      ]);
      expect(document.title).toBe(
        'Register for a training series | Tuesday Serving Clinic | Omni League',
      );
    });

    it('a program with one age labels the fact Age, and one with no ages has no age fact', async () => {
      await open();
      await answer({ ...OPEN, minimumAge: 12, maximumAge: 12 });
      const labels = () =>
        [...page.querySelectorAll('main dl > div')].map((row) => [
          text(row.querySelector('dt')),
          text(row.querySelector('dd')),
        ]);
      expect(labels()).toContainEqual(['Age', '12']);
      await answer(NO_AGES);
      expect(labels().map(([label]) => label)).toEqual([
        'Schedule',
        'First class',
        'Places left',
        'Registration closes',
      ]);
    });
  });

  describe('the age box', () => {
    beforeEach(async () => {
      await open();
    });

    it('names both bounds and the first class date', async () => {
      await answer(OPEN);
      expect(ageLabel()).toBe('I am 18 to 99 years old on Feb 2, 2027');
      expect(ageBox()?.getAttribute('aria-checked')).toBe('false');
    });

    it('reads "or older" for a program with only a minimum age', async () => {
      await answer(MINIMUM_ONLY);
      expect(ageLabel()).toBe('I am 16 or older on Feb 2, 2027');
    });

    it('reads "or younger" for a program with only a maximum age, for the child only an adult cannot register', async () => {
      await answer(MAXIMUM_ONLY);
      expect(text(page.querySelector('label[for="participant-minor"]'))).toBe('My child');
      expect(page.querySelector('label[for="participant-self"]')).toBeNull();
      expect(ageLabel()).toBe('My child is 12 or younger on Feb 2, 2027.');
    });

    it('is not asked when the program has no age range, and Register sends without it', async () => {
      await answer(NO_AGES);
      expect(ageBox()).toBeNull();
      await submit();
      expect(registers().map((call) => call.args)).toEqual([
        { trainingId: TRAINING_ID, participant: { kind: 'self' }, ageConfirmed: false },
      ]);
    });

    it('an unticked submit shows "Confirm your age to continue." under the box, focuses it, and sends nothing', async () => {
      await answer(OPEN);
      await submit();
      expect(text(page.querySelector('#age-confirmed-error'))).toBe(
        'Confirm your age to continue.',
      );
      expect(ageBox()?.getAttribute('aria-invalid')).toBe('true');
      expect(ageBox()?.getAttribute('aria-describedby')).toBe('age-confirmed-error');
      expect(document.activeElement).toBe(ageBox());
      expect(registers()).toEqual([]);
    });

    it('ticking the box clears the error', async () => {
      await answer(OPEN);
      await submit();
      await tick();
      expect(page.querySelector('#age-confirmed-error')).toBeNull();
    });

    it('leaving a ticked then cleared box shows the error, and leaving an untouched box does not', async () => {
      await answer(OPEN);
      ageBox()!.dispatchEvent(new Event('blur'));
      await flush();
      expect(page.querySelector('#age-confirmed-error')).toBeNull();
      await tick();
      await tick();
      ageBox()!.dispatchEvent(new Event('blur'));
      await flush();
      expect(text(page.querySelector('#age-confirmed-error'))).toBe(
        'Confirm your age to continue.',
      );
    });
  });

  describe('registering', () => {
    beforeEach(async () => {
      await open();
      await answer(OPEN);
    });

    it('asks who is attending, with Me chosen as the only option', () => {
      expect(text(page.querySelector('fieldset legend'))).toBe("Who's attending");
      const radios = [...page.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
      expect(radios.map((radio) => [radio.value, radio.checked])).toEqual([['self', true]]);
      expect(text(page.querySelector('label[for="participant-self"]'))).toBe('Me');
    });

    it('keeps Register in a sticky footer for phones', () => {
      const footer = page.querySelector('[data-slot="form-footer"]');
      expect(footer?.classList.contains('sticky')).toBe(true);
      expect(text(footer?.querySelector('button[type="submit"]'))).toBe('Register');
    });

    it('sends the training program, the participant, and the age box, shows the pending state, then opens the training page in place of this entry', async () => {
      await tick();
      await submit();
      expect(registers().map((call) => call.args)).toEqual([
        { trainingId: TRAINING_ID, participant: { kind: 'self' }, ageConfirmed: true },
      ]);
      const button = page.querySelector('button[type="submit"]');
      expect(text(button)).toBe('Registering…');
      expect(button?.getAttribute('aria-disabled')).toBe('true');
      expectPendingSpinner(button);
      expect(text(page.querySelector('form > p[role="status"]'))).toBe(
        'Registering for Tuesday Serving Clinic.',
      );
      registers()[0].resolve({ registrationId: 'reg_1' });
      await flush();
      expect(url()).toBe(TRAINING_PATH);
    });

    it('a second press while pending sends nothing more', async () => {
      await tick();
      await submit();
      await submit();
      expect(registers()).toHaveLength(1);
    });

    it('the server’s age refusal shows under the box and keeps the box ticked', async () => {
      await tick();
      await submit();
      registers()[0].reject(
        new ConvexError({
          code: 'ageNotConfirmed',
          field: 'ageConfirmed',
          message: 'Confirm your age to continue.',
        }),
      );
      await flush();
      expect(text(page.querySelector('#age-confirmed-error'))).toBe(
        'Confirm your age to continue.',
      );
      expect(document.activeElement).toBe(ageBox());
      expect(ageBox()?.getAttribute('aria-checked')).toBe('true');
    });

    it.each([
      [
        'closed',
        { code: 'registrationClosed', message: 'x' },
        'Registration for this training program is closed.',
      ],
      ['a class full', { code: 'classFull', message: 'x' }, 'A class is full.'],
      [
        'adults not allowed',
        { code: 'adultNotAllowed', message: 'x' },
        'This training program is for ages up to 99.',
      ],
      [
        'children not allowed',
        { code: 'minorNotAllowed', message: 'x' },
        'This training program is for ages 18 and over.',
      ],
      [
        'not found',
        { code: 'trainingNotFound', message: 'x' },
        'This training program is not open for registration.',
      ],
      [
        'already registered',
        { code: 'alreadyRegistered', message: 'x' },
        "You're registered for Tuesday Serving Clinic.",
      ],
    ])('a refusal as %s shows its card, whose alert takes focus', async (_label, data, line) => {
      await tick();
      await submit();
      registers()[0].reject(new ConvexError(data));
      await flush();
      const alert = page.querySelector<HTMLElement>('[data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(text(alert)).toContain(line);
      expect(page.querySelector('form')).toBeNull();
      expect(document.activeElement).toBe(alert);
    });

    it('any other failure shows the form alert, focused, keeps the box ticked, and takes no place', async () => {
      await tick();
      await submit();
      registers()[0].reject(new Error('network'));
      await flush();
      const alert = page.querySelector<HTMLElement>('form [data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(text(alert)).toBe(
        'You could not be registered. No place was taken. Check your connection and try again.',
      );
      expect(document.activeElement).toBe(alert);
      expect(ageBox()?.getAttribute('aria-checked')).toBe('true');
      expect(text(page.querySelector('button[type="submit"]'))).toBe('Register');
    });

    it('offline: refuses with the offline alert, focused, sends nothing, and keeps the box ticked', async () => {
      await tick();
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await harness.fixture.whenStable();
      const button = page.querySelector('button[type="submit"]');
      expect(button?.getAttribute('aria-disabled')).toBe('true');
      expect(button?.classList.contains('opacity-50')).toBe(true);
      await submit();
      expect(registers()).toEqual([]);
      const alert = page.querySelector<HTMLElement>('form [data-slot="alert"]');
      expect(text(alert)).toBe(
        "You're offline. Nothing was sent. Your answers are still here. Try again when you're connected.",
      );
      expect(document.activeElement).toBe(alert);
      expect(ageBox()?.getAttribute('aria-checked')).toBe('true');
      vi.restoreAllMocks();
    });
  });

  describe('registering a child', () => {
    const radios = () => [...page.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    const nameInput = () => page.querySelector<HTMLInputElement>('#minor-name');
    const nameError = () => text(page.querySelector('#minor-name-error'));

    async function typeName(value: string) {
      const input = nameInput()!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await flush();
    }

    describe('on a program for ages under 18', () => {
      beforeEach(async () => {
        await open();
        await answer(YOUTH);
      });

      it('offers only My child, chosen, with the name field and what is stored', () => {
        expect(radios().map((radio) => [radio.value, radio.checked])).toEqual([['minor', true]]);
        expect(nameInput()).not.toBeNull();
        expect(text(page.querySelector('#minor-name-description'))).toBe(
          'Only the name is stored. It is never shown on public pages.',
        );
      });

      it('words the age box for the child, saying My child before a name is typed and the name after', async () => {
        expect(ageLabel()).toBe('My child is 9 to 17 years old on Feb 2, 2027.');
        await typeName('  Maya   R. ');
        expect(ageLabel()).toBe('Maya R. is 9 to 17 years old on Feb 2, 2027.');
      });

      it('an empty submit shows both errors, focuses the name first, and sends nothing', async () => {
        await submit();
        expect(nameError()).toBe("Enter your child's name.");
        expect(text(page.querySelector('#age-confirmed-error'))).toBe(
          "Confirm your child's age to continue.",
        );
        expect(document.activeElement).toBe(nameInput());
        expect(registers()).toEqual([]);
      });

      it('an unticked submit with a name shows "Confirm <name>\'s age to continue." under the box', async () => {
        await typeName('Maya R.');
        await submit();
        expect(text(page.querySelector('#age-confirmed-error'))).toBe(
          "Confirm Maya R.'s age to continue.",
        );
        expect(document.activeElement).toBe(ageBox());
      });

      it('sends the child under the guardian with the name trimmed and its spaces collapsed, then opens the training page', async () => {
        await typeName('  Maya   R. ');
        await tick();
        await submit();
        expect(registers().map((call) => call.args)).toEqual([
          {
            trainingId: TRAINING_ID,
            participant: { kind: 'minor', minorName: 'Maya R.' },
            ageConfirmed: true,
          },
        ]);
        registers()[0].resolve({ registrationId: 'reg_1' });
        await flush();
        expect(url()).toBe(TRAINING_PATH);
      });

      it('the server refusing the name shows under the name, focuses it, and keeps the input', async () => {
        await typeName('Maya R.');
        await tick();
        await submit();
        registers()[0].reject(
          new ConvexError({
            code: 'alreadyRegistered',
            field: 'minorName',
            message: 'Maya R. is already registered for this training program.',
          }),
        );
        await flush();
        expect(nameError()).toBe('Maya R. is already registered for this training program.');
        expect(document.activeElement).toBe(nameInput());
        expect(nameInput()?.value).toBe('Maya R.');
        expect(ageBox()?.getAttribute('aria-checked')).toBe('true');
      });
    });

    describe('on a program that admits an adult and a child', () => {
      beforeEach(async () => {
        await open();
        await answer(BOTH);
      });

      it('offers Me and My child, with Me chosen and no name field', () => {
        expect(radios().map((radio) => [radio.value, radio.checked])).toEqual([
          ['self', true],
          ['minor', false],
        ]);
        expect(nameInput()).toBeNull();
      });

      it('changing who is attending clears the ticked box, which confirmed another statement', async () => {
        await tick();
        page.querySelector<HTMLInputElement>('#participant-minor')!.click();
        await flush();
        expect(ageBox()?.getAttribute('aria-checked')).toBe('false');
        expect(nameInput()).not.toBeNull();
      });
    });

    it('offers only My child to a guardian who already holds their own place', async () => {
      await open();
      await answer({ ...BOTH, registered: true });
      expect(radios().map((radio) => [radio.value, radio.checked])).toEqual([['minor', true]]);
    });

    it('does not offer My child when the minimum age is 18 or more', async () => {
      await open();
      await answer(OPEN);
      expect(radios().map((radio) => radio.value)).toEqual(['self']);
      expect(page.querySelector('label[for="participant-minor"]')).toBeNull();
    });
  });

  describe('for one class', () => {
    const facts = () =>
      [...page.querySelectorAll('main dl > div')].map((row) => [
        text(row.querySelector('dt')),
        text(row.querySelector('dd')),
      ]);
    const card = () => page.querySelector('[data-slot="alert"]');

    beforeEach(() => {
      TestBed.resetTestingModule();
    });

    it('asks with the slugs and the class named in the address', async () => {
      await open({ query: `?class=${CLASS_ID}` });
      expect(registration()?.args).toEqual({ ...SLUGS, classId: CLASS_ID });
    });

    it('shows the class, its hours and places, and the date registration closes, with the title for a class', async () => {
      await open({ query: `?class=${CLASS_ID}` });
      await answer({ ...OPEN_CLASS, singleClass: { ...SINGLE, placesLeft: 7 } });
      expect(text(page.querySelector('main h1'))).toBe('Tuesday Serving Clinic');
      expect(text(page.querySelector('main h1')?.previousElementSibling)).toBe(
        'Register for a class',
      );
      expect(facts()).toEqual([
        ['Class', 'Tue, Feb 9, 2027'],
        ['Time', '6 to 7 pm'],
        ['Ages', '18 to 99'],
        ['Places left', '7 places left'],
        ['Registration closes', 'Feb 9, 2027'],
      ]);
      expect(document.title).toBe('Register for a class | Tuesday Serving Clinic | Omni League');
      expect(page.querySelector('form')).not.toBeNull();
    });

    it('reads one place in the singular', async () => {
      await open({ query: `?class=${CLASS_ID}` });
      await answer({ ...OPEN_CLASS, singleClass: { ...SINGLE, placesLeft: 1 } });
      expect(facts()).toContainEqual(['Places left', '1 place left']);
    });

    it('sends the class with the registration and opens the training page in place of this entry', async () => {
      await open({ query: `?class=${CLASS_ID}` });
      await answer(OPEN_CLASS);
      await tick();
      await submit();
      expect(registers().map((call) => call.args)).toEqual([
        {
          trainingId: TRAINING_ID,
          classId: CLASS_ID,
          participant: { kind: 'self' },
          ageConfirmed: true,
        },
      ]);
      registers()[0].resolve({ registrationId: 'reg_1' });
      await flush();
      expect(url()).toBe(TRAINING_PATH);
    });

    it('open on the class date and through the series deadline having passed', async () => {
      await open({ query: `?class=${CLASS_ID}`, now: '2027-02-09T23:00:00Z' });
      await answer(OPEN_CLASS);
      expect(page.querySelector('form')).not.toBeNull();
    });

    it('signed out: goes to sign-in with the class kept in returnTo', async () => {
      await open({ signedIn: false, query: `?class=${CLASS_ID}` });
      await answer(OPEN_CLASS);
      expect(url()).toBe(`/sign-in?returnTo=${encodeURIComponent(CLASS_PATH)}`);
      expect(convex.calls).toEqual([]);
    });

    it('a class that is not open: says so with a link back, and no form', async () => {
      await open({ query: '?class=elsewhere' });
      await answer(OPEN);
      expect(alertText(card())).toBe(
        'This class is not open for registration. It may have passed or been cancelled. Go back to the training page.',
      );
      expect(page.querySelector('form')).toBeNull();
      expect(backLink()?.getAttribute('href')).toBe(TRAINING_PATH);
      expect(facts().map(([label]) => label)).toEqual(['Schedule', 'Ages']);
    });

    it('a program that does not take a single class: says so and points to the series', async () => {
      await open({ query: `?class=${CLASS_ID}` });
      await answer({ ...OPEN_CLASS, singleClass: { ...SINGLE, allowed: false } });
      expect(alertText(card())).toBe(
        'This training program does not take registrations for a single class. Register for the whole series from the training page.',
      );
      expect(page.querySelector('form')).toBeNull();
      expect(backLink()?.getAttribute('href')).toBe(TRAINING_PATH);
    });

    it('closed the day after the class, with no form', async () => {
      await open({ query: `?class=${CLASS_ID}`, now: AFTER_CLASS });
      await answer(OPEN_CLASS);
      expect(alertText(card())).toBe(
        'Registration for this class is closed. It closed after Tue, Feb 9, 2027.',
      );
      expect(page.querySelector('form')).toBeNull();
    });

    it('full: names the class, with no form', async () => {
      await open({ query: `?class=${CLASS_ID}` });
      await answer({ ...OPEN_CLASS, singleClass: { ...SINGLE, placesLeft: 0 } });
      expect(alertText(card())).toBe('This class is full. Tue, Feb 9, 2027 has no place left.');
      expect(page.querySelector('form')).toBeNull();
    });

    it('registered for the class: says so, whatever the date or places', async () => {
      await open({ query: `?class=${CLASS_ID}`, now: AFTER_CLASS });
      await answer({
        ...OPEN_CLASS,
        minimumAge: 18,
        singleClass: { ...SINGLE, held: 'class' },
      });
      expect(alertText(card())).toBe(
        "You're registered for Tue, Feb 9, 2027. You’ll find your place on the training page.",
      );
    });

    it('registered for the series: says the series holds a place in this class', async () => {
      await open({ query: `?class=${CLASS_ID}` });
      await answer({
        ...OPEN_CLASS,
        minimumAge: 18,
        registered: true,
        singleClass: { ...SINGLE, held: 'series' },
      });
      expect(alertText(card())).toBe(
        "You're registered for Tuesday Serving Clinic. Your series registration holds a place in every class, this one included.",
      );
    });

    it('offers only My child to an account holder who already holds a place in the class', async () => {
      await open({ query: `?class=${CLASS_ID}` });
      await answer({ ...BOTH, singleClass: { ...SINGLE, held: 'class' } });
      const radios = [...page.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
      expect(radios.map((radio) => radio.value)).toEqual(['minor']);
    });

    it.each([
      [
        'the class not open',
        { code: 'classNotFound', message: 'x' },
        'This class is not open for registration.',
      ],
      [
        'single-class registration not allowed',
        { code: 'singleClassNotAllowed', message: 'x' },
        'This training program does not take registrations for a single class.',
      ],
      [
        'registration closed',
        { code: 'registrationClosed', message: 'x' },
        'Registration for this class is closed.',
      ],
      ['the class full', { code: 'classFull', message: 'x' }, 'This class is full.'],
      [
        'already registered',
        { code: 'alreadyRegistered', message: 'x' },
        "You're registered for Tue, Feb 9, 2027.",
      ],
    ])('a refusal as %s shows its card, whose alert takes focus', async (_label, data, line) => {
      await open({ query: `?class=${CLASS_ID}` });
      await answer(OPEN_CLASS);
      await tick();
      await submit();
      registers()[0].reject(new ConvexError(data));
      await flush();
      const alert = page.querySelector<HTMLElement>('[data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(text(alert)).toContain(line);
      expect(page.querySelector('form')).toBeNull();
      expect(document.activeElement).toBe(alert);
    });

    it('the series page is unchanged without the class', async () => {
      await open();
      await answer(OPEN);
      expect(registration()?.args).toEqual(SLUGS);
      expect(facts()[0]).toEqual(['Schedule', 'Tuesdays, 6 to 7 pm, 8 weeks']);
    });
  });

  describe('the series waitlist', () => {
    const joins = () => convex.calls.filter((call) => call.name === JOIN);
    const submitButton = () => page.querySelector('button[type="submit"]');

    beforeEach(async () => {
      await open();
      await answer(FULL);
    });

    it('titles the page for joining the waitlist', () => {
      expect(document.title).toBe(
        'Join the waitlist for a training series | Tuesday Serving Clinic | Omni League',
      );
    });

    it('sends the join with the participant and the age box, and no class, shows the pending state, then opens the training page in place of this entry', async () => {
      await tick();
      await submit();
      expect(registers()).toEqual([]);
      expect(joins().map((call) => call.args)).toEqual([
        { trainingId: TRAINING_ID, participant: { kind: 'self' }, ageConfirmed: true },
      ]);
      expect(text(submitButton())).toBe('Joining…');
      expect(submitButton()?.getAttribute('aria-disabled')).toBe('true');
      expectPendingSpinner(submitButton());
      expect(text(page.querySelector('form > p[role="status"]'))).toBe(
        'Joining the waitlist for Tuesday Serving Clinic.',
      );
      joins()[0].resolve({ trainingWaitlistEntryId: 'entry_1', position: 1 });
      await flush();
      expect(url()).toBe(TRAINING_PATH);
    });

    it('an unticked submit asks for the age box and sends nothing', async () => {
      await submit();
      expect(text(page.querySelector('#age-confirmed-error'))).toBe(
        'Confirm your age to continue.',
      );
      expect(joins()).toEqual([]);
    });

    it('a failure shows the waitlist alert, focused, keeps the box ticked, and leaves the button to try again', async () => {
      await tick();
      await submit();
      joins()[0].reject(new Error('network'));
      await flush();
      const alert = page.querySelector<HTMLElement>('form [data-slot="alert"][role="alert"]');
      expect(text(alert)).toBe(
        'You could not be added to the waitlist. You were not added. Check your connection and try again.',
      );
      expect(document.activeElement).toBe(alert);
      expect(ageBox()?.getAttribute('aria-checked')).toBe('true');
      expect(text(submitButton())).toBe('Join the waitlist');
    });

    it('a series that has a place by now says so and offers Register, which shows the registration form once the answer catches up', async () => {
      await tick();
      await submit();
      joins()[0].reject(
        new ConvexError({ code: 'seriesHasPlace', message: 'Every class has a place free.' }),
      );
      await flush();
      const card = page.querySelector<HTMLElement>('[data-slot="alert"]');
      expect(alertText(card)).toBe(
        'Every class has a place free. Register for the series instead.',
      );
      expect(card?.getAttribute('role')).toBe('alert');
      expect(document.activeElement).toBe(card);
      await answer(OPEN);
      page.querySelector<HTMLButtonElement>('[data-slot="refusal-action"]')!.click();
      await flush();
      expect(text(submitButton())).toBe('Register');
      expect(page.querySelector('form [role="note"]')).toBeNull();
    });

    it('a duplicate entry says the account holder is on the waitlist already, with a link back', async () => {
      await tick();
      await submit();
      joins()[0].reject(new ConvexError({ code: 'alreadyWaiting', message: 'x' }));
      await flush();
      expect(alertText(page.querySelector('[data-slot="alert"]'))).toBe(
        "You're on the waitlist for Tuesday Serving Clinic. The organizer offers the series to the first person waiting. Your position is on the training page.",
      );
      expect(page.querySelector('[data-slot="refusal-action"]')).toBeNull();
      expect(backLink()?.getAttribute('href')).toBe(TRAINING_PATH);
    });

    it('the server refusing a child’s name as a duplicate shows under the name', async () => {
      await answer({ ...FULL, minimumAge: 9, maximumAge: 17 });
      const input = page.querySelector<HTMLInputElement>('#minor-name')!;
      input.value = 'Maya R.';
      input.dispatchEvent(new Event('input'));
      await flush();
      await tick();
      await submit();
      joins()[0].reject(
        new ConvexError({
          code: 'alreadyWaiting',
          field: 'minorName',
          message: 'Maya R. is already on the waitlist for this training program.',
        }),
      );
      await flush();
      expect(text(page.querySelector('#minor-name-error'))).toBe(
        'Maya R. is already on the waitlist for this training program.',
      );
      expect(document.activeElement).toBe(input);
    });

    it('is offline: refuses with the offline alert and sends nothing', async () => {
      await tick();
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      await harness.fixture.whenStable();
      await submit();
      expect(joins()).toEqual([]);
      expect(text(page.querySelector('form [data-slot="alert"][role="alert"]'))).toBe(
        "You're offline. Nothing was sent. Your answers are still here. Try again when you're connected.",
      );
      vi.restoreAllMocks();
    });

    it('a registration refused for a class that filled meanwhile offers the waitlist, which opens the join form', async () => {
      await answer(OPEN);
      await tick();
      await submit();
      registers()[0].reject(new ConvexError({ code: 'classFull', message: 'x' }));
      await flush();
      expect(text(page.querySelector('[data-slot="alert"]'))).toContain('A class is full.');
      await answer(FULL);
      page.querySelector<HTMLButtonElement>('[data-slot="refusal-action"]')!.click();
      await flush();
      expect(text(submitButton())).toBe('Join the waitlist');
    });

    it('the join action puts the page into join mode, though the account’s answer still reads open', async () => {
      const BOTH_OPEN = { ...OPEN, minimumAge: 9, maximumAge: 30 };
      await answer(BOTH_OPEN);
      await tick();
      await submit();
      registers()[0].reject(new ConvexError({ code: 'classFull', message: 'x' }));
      await flush();
      expect(text(page.querySelector('[data-slot="alert"]'))).toContain('A class is full.');
      page.querySelector<HTMLButtonElement>('[data-slot="refusal-action"]')!.click();
      await flush();
      expect(text(submitButton())).toBe('Join the waitlist');
      expect(page.querySelector('form [role="note"]')).not.toBeNull();
      expect(document.title).toContain('Join the waitlist for a training series');
      expect(ageBox()?.getAttribute('aria-checked')).toBe('true');
      await submit();
      expect(joins().map((call) => call.args)).toEqual([
        { trainingId: TRAINING_ID, participant: { kind: 'self' }, ageConfirmed: true },
      ]);
      expect(registers()).toHaveLength(1);
    });

    it('a sibling refused for a place that another child holds keeps the name, and joins the waitlist as that child', async () => {
      await answer(YOUTH);
      await tick();
      const input = page.querySelector<HTMLInputElement>('#minor-name')!;
      input.value = 'Child B';
      input.dispatchEvent(new Event('input'));
      await flush();
      await submit();
      registers()[0].reject(new ConvexError({ code: 'classFull', message: 'x' }));
      await flush();
      page.querySelector<HTMLButtonElement>('[data-slot="refusal-action"]')!.click();
      await flush();
      expect(text(submitButton())).toBe('Join the waitlist');
      expect(page.querySelector<HTMLInputElement>('#minor-name')!.value).toBe('Child B');
      await submit();
      expect(joins().map((call) => call.args)).toEqual([
        {
          trainingId: TRAINING_ID,
          participant: { kind: 'minor', minorName: 'Child B' },
          ageConfirmed: true,
        },
      ]);
      expect(registers()).toHaveLength(1);
      joins()[0].resolve({ trainingWaitlistEntryId: 'entry_1', position: 1 });
      await flush();
      expect(url()).toBe(TRAINING_PATH);
    });

    it('Register after a join refused for a place gives the registration form back, and the join action does not stick', async () => {
      await answer({ ...OPEN, minimumAge: 9, maximumAge: 30 });
      await tick();
      await submit();
      registers()[0].reject(new ConvexError({ code: 'classFull', message: 'x' }));
      await flush();
      page.querySelector<HTMLButtonElement>('[data-slot="refusal-action"]')!.click();
      await flush();
      await submit();
      joins()[0].reject(new ConvexError({ code: 'seriesHasPlace', message: 'x' }));
      await flush();
      page.querySelector<HTMLButtonElement>('[data-slot="refusal-action"]')!.click();
      await flush();
      expect(text(submitButton())).toBe('Register');
      expect(page.querySelector('form [role="note"]')).toBeNull();
    });

    it('says people are waiting, not that a class is full, when only the queue makes the series full', async () => {
      await answer({ ...FULL, seriesWaitlist: true });
      expect(alertText(page.querySelector('form [role="note"]'))).toBe(
        'People are waiting for a place. Join the waitlist. When every class has a place, the organizer offers the series to the first person waiting.',
      );
    });

    it('a registration refused while people wait offers the waitlist in the same words', async () => {
      await answer(OPEN);
      await tick();
      await submit();
      await answer({ ...FULL, seriesWaitlist: true });
      registers()[0].reject(new ConvexError({ code: 'classFull', message: 'x' }));
      await flush();
      expect(alertText(page.querySelector('[data-slot="alert"]'))).toBe(
        'People are waiting for a place. A new registration waits behind them, so no place is left for the series. You can join the waitlist instead.',
      );
    });

    it('reads the places fact as full with people on the waitlist while the series has a queue', async () => {
      await answer({ ...FULL, seriesWaitlist: true });
      const places = [...page.querySelectorAll('main dl > div')].find(
        (row) => text(row.querySelector('dt')) === 'Places left',
      );
      expect(text(places?.querySelector('dd'))).toBe('Full, with people on the waitlist');
    });

    it('a waiting account holder sees their spot, with a link back, and no form', async () => {
      await answer({ ...FULL, minimumAge: 18, waitlisted: true });
      expect(alertText(page.querySelector('[data-slot="alert"]'))).toBe(
        "You're on the waitlist for Tuesday Serving Clinic. The organizer offers the series to the first person waiting. Your position is on the training page.",
      );
      expect(page.querySelector('form')).toBeNull();
      expect(backLink()?.getAttribute('href')).toBe(TRAINING_PATH);
    });

    it('offers a waiting guardian only a child, on the waitlist form', async () => {
      await answer({ ...FULL, minimumAge: 14, maximumAge: 30, waitlisted: true });
      const radios = [...page.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
      expect(radios.map((radio) => radio.value)).toEqual(['minor']);
      expect(text(submitButton())).toBe('Join the waitlist');
    });

    it('a class with no place has no waitlist to join yet', async () => {
      TestBed.resetTestingModule();
      await open({ query: `?class=${CLASS_ID}` });
      await answer({ ...OPEN_CLASS, singleClass: { ...SINGLE, placesLeft: 0 } });
      expect(alertText(page.querySelector('[data-slot="alert"]'))).toBe(
        'This class is full. Tue, Feb 9, 2027 has no place left.',
      );
      expect(page.querySelector('[data-slot="refusal-action"]')).toBeNull();
      expect(page.querySelector('form')).toBeNull();
    });
  });

  describe('slim bar', () => {
    it('reads "Register for a training series" while the query is held and for the form', async () => {
      await open();
      expectBar(page, 'Register for a training series');
      await answer(OPEN);
      expectBar(page, 'Register for a training series');
    });

    it('names the not-found and server-error views', async () => {
      await open();
      await answer(null);
      expectBar(page, 'Page not found');
      registration()!.fail(new Error('Server Error: secret'));
      await flush();
      expectBar(page, 'Temporarily unavailable');
    });
  });
});
