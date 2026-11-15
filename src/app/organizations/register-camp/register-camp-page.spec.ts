import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConvexError } from 'convex/values';
import { AuthService } from '../../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../../core/data/convex';
import { FakeConvexClient } from '../../core/data/convex/testing/fake-convex-client';
import { expectAlertClasses, expectAlertSlots } from '../../ui/testing/alert';
import { radiusClasses } from '../../ui/testing/radius-classes';
import { expectPendingSpinner } from '../../ui/testing/spinner';
import { RegisterCampPage } from './register-camp-page';

@Component({ template: 'elsewhere' })
class Elsewhere {}

const SLUGS = { orgSlug: 'gulf-coast-sport-social', campSlug: 'adult-beach-skills-camp' };
const SESSION_ID = 'session_week1';
const PATH = `/app/organizations/${SLUGS.orgSlug}/camps/${SLUGS.campSlug}/register`;
const URL = `${PATH}?session=${SESSION_ID}`;
const CAMP_PATH = `/organizations/${SLUGS.orgSlug}/camps/${SLUGS.campSlug}`;
const GET = 'campRegistrations:getForRegistration';
const REGISTER = 'campRegistrations:register';
const SESSION = {
  sessionId: SESSION_ID,
  name: 'Week 1',
  startDate: '2027-07-05',
  endDate: '2027-07-09',
  dailyStartTime: '09:00',
  dailyEndTime: '12:00',
  registrationDeadline: '2027-06-28',
  placesLeft: 12,
};
const OPEN = {
  organizationName: 'Gulf Coast Sport & Social',
  name: 'Adult Beach Skills Camp',
  minimumAge: 18,
  maximumAge: 99,
  session: SESSION,
  registered: false,
};
const REGISTERED = { ...OPEN, registered: true };
const FULL = { ...OPEN, session: { ...SESSION, placesLeft: 0 } };
const YOUTH = { ...OPEN, minimumAge: 9, maximumAge: 17 };

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

describe('RegisterCampPage', () => {
  let convex: FakeConvexClient;
  let harness: RouterTestingHarness;
  let page: HTMLElement;

  async function open({ signedIn = true, now = '2027-06-01T00:00:00Z', url = URL } = {}) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(now));
    convex = new FakeConvexClient();
    const auth = new FakeAuthClient();
    if (!signedIn) auth.storedCookie = '';
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        provideRouter([
          {
            path: 'app/organizations/:orgSlug/camps/:campSlug/register',
            component: RegisterCampPage,
          },
          { path: 'sign-in', component: Elsewhere },
          { path: '**', component: Elsewhere },
        ]),
      ],
    });
    if (signedIn) auth.emitSession({ id: 's1' });
    harness = await RouterTestingHarness.create(url);
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

  async function tick() {
    ageBox()!.click();
    await harness.fixture.whenStable();
  }

  async function submit() {
    page.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await flush();
  }

  describe('the state order', () => {
    it('asks nothing until Convex has accepted the token, then asks with the slugs and the session', async () => {
      await open();
      expect(registration()?.args).toEqual({ ...SLUGS, sessionId: SESSION_ID });
      expect(text(page.querySelector('main [role="status"]'))).toBe('Loading the camp session.');
    });

    it('leaves the session out of the question when the address has none', async () => {
      await open({ url: PATH });
      expect(registration()?.args).toEqual(SLUGS);
    });

    it('while loading, the button placeholder is rounded-lg', async () => {
      await open();
      const button = page.querySelector('[data-testid="register-skeleton"] .pb-6 > div:last-child');
      expect(radiusClasses(button)).toEqual(['rounded-lg']);
    });

    it('not found: shows the not-found view and calls no mutation, signed in or not', async () => {
      for (const signedIn of [true, false]) {
        TestBed.resetTestingModule();
        await open({ signedIn });
        await answer(null);
        expect(text(page.querySelector('main h1'))).toBe('Page not found');
        expect(ageBox()).toBeNull();
        expect(convex.calls).toEqual([]);
        expect(url()).toBe(URL);
      }
    });

    it('signed out: goes to sign-in with this address and its session as returnTo, in place of this entry', async () => {
      await open({ signedIn: false });
      expect(registration()?.args).toEqual({ ...SLUGS, sessionId: SESSION_ID });
      await answer(OPEN);
      expect(url()).toBe(`/sign-in?returnTo=${encodeURIComponent(URL)}`);
      expect(convex.calls).toEqual([]);
    });

    it('an unknown session: says so with a link back to the camp, and no form', async () => {
      await open();
      await answer({ ...OPEN, session: null });
      const alert = page.querySelector('[data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('status');
      expectAlertSlots(alert);
      expect(alertText(alert)).toBe(
        'This session was not found. It may have been removed, or the link is incomplete. Choose a session on the camp page.',
      );
      expect(page.querySelector('form')).toBeNull();
      const back = [...page.querySelectorAll('main a')].find(
        (a) => text(a) === 'Back to the camp page',
      );
      expect(back?.getAttribute('href')).toBe(CAMP_PATH);
    });

    it('registered, even after the deadline: says so with a link back to the camp, and no form', async () => {
      await open({ now: '2027-06-30T00:00:00Z' });
      await answer(REGISTERED);
      const card = page.querySelector('[data-slot="alert"]');
      expect(card?.getAttribute('role')).toBe('status');
      expectAlertSlots(card);
      expectAlertClasses(card, 'default', 'outline-offset-2 focus:outline-2 focus:outline-ring');
      expect(alertText(card)).toBe(
        "You're registered for Week 1. Your place is held. You’ll find it on the camp page.",
      );
      expect(page.querySelector('form')).toBeNull();
      const back = [...page.querySelectorAll('main a')].find(
        (a) => text(a) === 'Back to the camp page',
      );
      expect(back?.getAttribute('href')).toBe(CAMP_PATH);
    });

    it('closed: shows the deadline and no form, with a link back to the camp', async () => {
      await open({ now: '2027-06-30T00:00:00Z' });
      await answer(OPEN);
      const alert = page.querySelector('[data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('status');
      expect(alertText(alert)).toBe(
        'Registration for this session is closed. It closed on Jun 28, 2027.',
      );
      expect(page.querySelector('form')).toBeNull();
      expect(
        [...page.querySelectorAll('main a')].some((a) => text(a) === 'Back to the camp page'),
      ).toBe(true);
    });

    it('full: says so with a link back to the camp, and no form', async () => {
      await open();
      await answer(FULL);
      const alert = page.querySelector('[data-slot="alert"]');
      expect(alertText(alert)).toBe(
        'This session is full. Every place is taken. Choose another session on the camp page.',
      );
      expect(page.querySelector('form')).toBeNull();
    });

    it('a camp whose maximum age is 17: says an adult cannot register themself, and no form', async () => {
      await open();
      await answer(YOUTH);
      const alert = page.querySelector('[data-slot="alert"]');
      expect(alertText(alert)).toBe(
        'This camp is for ages 9 to 17. An adult cannot register themself for it.',
      );
      expect(page.querySelector('form')).toBeNull();
    });

    it('open: the form with the session’s facts and the title', async () => {
      await open();
      await answer(OPEN);
      expect(text(page.querySelector('main h1'))).toBe('Adult Beach Skills Camp');
      const facts = [...page.querySelectorAll('main dl > div')].map((row) => [
        text(row.querySelector('dt')),
        text(row.querySelector('dd')),
      ]);
      expect(facts).toEqual([
        ['Session', 'Week 1'],
        ['Dates', 'Jul 5 – Jul 9, 2027'],
        ['Hours', '9 AM to 12 PM'],
        ['Ages', 'Ages 18 to 99'],
        ['Places left', '12 places left'],
        ['Registration closes', 'Jun 28, 2027'],
      ]);
      expect(document.title).toBe('Register for Week 1 | Adult Beach Skills Camp | Omni League');
    });
  });

  describe('the form', () => {
    beforeEach(async () => {
      await open();
      await answer(OPEN);
    });

    it('asks who is attending, with Me chosen as the only option', () => {
      const group = page.querySelector('fieldset');
      expect(text(group?.querySelector('legend'))).toBe("Who's attending");
      const radios = [...page.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
      expect(radios.map((radio) => [radio.value, radio.checked])).toEqual([['self', true]]);
      expect(text(page.querySelector('label[for="participant-self"]'))).toBe('Me');
    });

    it('offers the age box for the camp’s ages on the start date, unticked', () => {
      expect(text(page.querySelector('label[for="age-confirmed"]'))).toBe(
        'I am 18 to 99 years old on Jul 5, 2027',
      );
      expect(ageBox()?.getAttribute('aria-checked')).toBe('false');
      expect(page.querySelector('#age-confirmed-error')).toBeNull();
    });

    it('keeps Register in a sticky footer for phones', () => {
      const footer = page.querySelector('[data-slot="form-footer"]');
      expect(footer?.classList.contains('sticky')).toBe(true);
      expect(footer?.querySelector('button[type="submit"]')).not.toBeNull();
      expect(text(footer?.querySelector('button[type="submit"]'))).toBe('Register');
    });

    it('an unticked submit shows "Confirm your age to continue." under the box, focuses it, and sends nothing', async () => {
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
      await submit();
      await tick();
      expect(page.querySelector('#age-confirmed-error')).toBeNull();
      expect(ageBox()?.getAttribute('aria-checked')).toBe('true');
    });

    it('leaving a ticked then cleared box shows the error, and leaving an untouched box does not', async () => {
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

    it('sends the session, the participant, and the age box, shows the pending state, then opens the camp page in place of this entry', async () => {
      await tick();
      await submit();
      expect(registers().map((call) => call.args)).toEqual([
        { sessionId: SESSION_ID, participant: { kind: 'self' }, ageConfirmed: true },
      ]);
      const button = page.querySelector('button[type="submit"]');
      expect(text(button)).toBe('Registering…');
      expect(button?.getAttribute('aria-disabled')).toBe('true');
      expectPendingSpinner(button);
      expect(text(page.querySelector('form > p[role="status"]'))).toBe('Registering for Week 1.');
      registers()[0].resolve({ registrationId: 'reg_1' });
      await flush();
      expect(url()).toBe(CAMP_PATH);
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
    });

    it.each([
      [
        'closed',
        { code: 'registrationClosed', message: 'Registration for this session is closed.' },
        'Registration for this session is closed.',
      ],
      ['full', { code: 'sessionFull', message: 'This session is full.' }, 'This session is full.'],
      [
        'adults not allowed',
        { code: 'adultNotAllowed', message: 'x' },
        'This camp is for ages 18 to 99.',
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

    it('a refusal as already registered shows the registered card, whose alert takes focus', async () => {
      await tick();
      await submit();
      registers()[0].reject(
        new ConvexError({ code: 'alreadyRegistered', message: 'You are already registered.' }),
      );
      await flush();
      const alert = page.querySelector<HTMLElement>('[data-slot="alert"]');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(text(alert)).toContain("You're registered for Week 1.");
      expect(page.querySelector('form')).toBeNull();
      expect(document.activeElement).toBe(alert);
    });

    it('a refusal as not found shows the unknown-session card', async () => {
      await tick();
      await submit();
      registers()[0].reject(
        new ConvexError({ code: 'campNotFound', message: 'This camp session is not open.' }),
      );
      await flush();
      expect(text(page.querySelector('[data-slot="alert"]'))).toContain(
        'This session was not found.',
      );
      expect(page.querySelector('form')).toBeNull();
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
});
