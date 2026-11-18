import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MAX_MINORS_PER_SESSION } from '../../../../convex/lib/individualRegistration';
import { AuthService } from '../../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../../core/data/convex';
import { FakeConvexClient } from '../../core/data/convex/testing/fake-convex-client';
import { PlainTestPage } from '../../shell/testing/test-pages';
import { PublicTrainingPage } from './public-training-page';
import {
  at,
  ORG_SLUG,
  TRAINING_ARGS,
  TRAINING_PATH,
  TRAINING_SLUG,
  TUESDAY_CLINIC,
} from './testing/training-data';
import type { PublicTrainingData } from './public-training-view';

const TRAINING = 'trainings:getPublicPage';
const MINE = 'trainingRegistrations:listMineForTraining';
const REGISTER_PATH = `/app/organizations/${ORG_SLUG}/training/${TRAINING_SLUG}/register`;
const NONE = { self: false, minorNames: [] as string[] };

/** The sample program with a place in every class, so nothing keeps the series from opening. */
const OPEN_SERIES: PublicTrainingData = {
  ...TUESDAY_CLINIC,
  classes: TUESDAY_CLINIC.classes.map((row) => ({ ...row, placesLeft: 5 })),
};
const WITH_CHILDREN: PublicTrainingData = { ...OPEN_SERIES, minimumAge: 9, maximumAge: 30 };
const ADULTS_ONLY: PublicTrainingData = { ...OPEN_SERIES, minimumAge: 18 };
const CHILDREN_ONLY: PublicTrainingData = {
  ...OPEN_SERIES,
  minimumAge: undefined,
  maximumAge: 12,
};

let client: FakeConvexClient;
let harness: RouterTestingHarness;

async function open({ signedIn = false, now = '2027-01-20' } = {}) {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at(now));
  client = new FakeConvexClient();
  const auth = new FakeAuthClient();
  if (!signedIn) auth.storedCookie = '';
  TestBed.configureTestingModule({
    providers: [
      provideFakeAuthClient(auth),
      provideRouter([
        { path: 'organizations/:orgSlug/training/:trainingSlug', component: PublicTrainingPage },
        { path: '**', component: PlainTestPage },
      ]),
      { provide: CONVEX_CLIENT, useValue: client },
    ],
  });
  if (signedIn) auth.emitSession({ id: 's1' });
  harness = await RouterTestingHarness.create(TRAINING_PATH);
  await settle();
  if (signedIn) {
    TestBed.inject(AuthService).onChange(true);
    await settle();
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
    await vi.advanceTimersByTimeAsync(0);
  }
}

async function emit(name: string, value: unknown): Promise<void> {
  client.activeSubscriptions.find((s) => s.name === name)!.emit(value);
  await settle();
}

const host = () => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const registerLink = () => host().querySelector<HTMLAnchorElement>('main a[href*="/register"]');
const registered = () => host().querySelector('[data-slot="series-registered"]');
const actions = () => host().querySelector('[data-slot="series-actions"]');
const fullNote = () => host().querySelector('[data-slot="series-full"]');

afterEach(() => {
  vi.useRealTimers();
});

describe('PublicTrainingPage registration, signed out', () => {
  beforeEach(async () => {
    await open();
    await emit(TRAINING, OPEN_SERIES);
  });

  it('asks for the training program only, and not for registrations', () => {
    expect(client.activeSubscriptions.map(({ name, args }) => ({ name, args }))).toEqual([
      { name: TRAINING, args: TRAINING_ARGS },
    ]);
  });

  it('links the series registration to the register page, named for the series', () => {
    expect(registerLink()?.getAttribute('href')).toBe(REGISTER_PATH);
    expect(text(registerLink())).toBe('Register for the series');
    expect(registerLink()?.getAttribute('data-slot')).toBe('button');
    expect(registerLink()?.querySelector('.sr-only')?.textContent).toBe(' for the series');
  });

  it('shows no registered line to a signed-out visitor', () => {
    expect(registered()).toBeNull();
    expect(text(host().querySelector('main'))).not.toContain("You're registered");
  });

  it('takes the link away once the clock passes the deadline', async () => {
    vi.setSystemTime(at('2027-02-01'));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    await settle();
    expect(registerLink()).toBeNull();
  });

  it('leaves the link off while a class is full and says so, naming no registrant', async () => {
    await emit(TRAINING, TUESDAY_CLINIC);
    expect(registerLink()).toBeNull();
    expect(text(fullNote())).toBe('A class is full, so no place is left for the whole series.');
  });
});

describe('PublicTrainingPage registration, nothing to register for', () => {
  it('offers no link once every class has passed, nor when the series is in progress', async () => {
    await open({ now: '2027-02-17' });
    await emit(TRAINING, OPEN_SERIES);
    expect(registerLink()).toBeNull();
    expect(actions()).toBeNull();
    TestBed.resetTestingModule();
    await open({ now: '2027-02-03' });
    await emit(TRAINING, OPEN_SERIES);
    expect(registerLink()).toBeNull();
  });
});

describe('PublicTrainingPage registration, signed in', () => {
  beforeEach(async () => {
    await open({ signedIn: true });
    await emit(TRAINING, ADULTS_ONLY);
  });

  it('asks for the caller’s registrations in this program with the route’s slugs', () => {
    expect(
      client.activeSubscriptions
        .filter(({ name }) => name === TRAINING || name === MINE)
        .map(({ name, args }) => ({ name, args })),
    ).toEqual([
      { name: TRAINING, args: TRAINING_ARGS },
      { name: MINE, args: TRAINING_ARGS },
    ]);
  });

  it('keeps the link while the registrations have not answered', () => {
    expect(registerLink()).not.toBeNull();
    expect(registered()).toBeNull();
  });

  it('reads "You\'re registered" in place of the link once the caller holds a place, on a program for adults', async () => {
    await emit(MINE, { self: true, minorNames: [] });
    expect(text(registered())).toBe("You're registered");
    expect(registerLink()).toBeNull();
  });

  it('is a plain line, which announces nothing on load', async () => {
    await emit(MINE, { self: true, minorNames: [] });
    expect(registered()?.tagName).toBe('P');
    expect(registered()?.hasAttribute('role')).toBe(false);
  });

  it('lets the Registration fact shrink below its line, so a long name cannot widen the details column', async () => {
    await emit(MINE, { self: true, minorNames: ['W'.repeat(60)] });
    expect(actions()?.parentElement?.classList).toContain('min-w-0');
  });

  it('keeps the line after the deadline', async () => {
    await emit(MINE, { self: true, minorNames: [] });
    vi.setSystemTime(at('2027-02-01'));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    await settle();
    expect(text(registered())).toBe("You're registered");
    expect(registerLink()).toBeNull();
  });

  it('keeps the row of the Register button, so the content below does not move', async () => {
    const before = actions()?.className;
    expect(before?.split(' ')).toEqual(
      expect.arrayContaining([
        'mt-3',
        'min-h-9',
        'flex',
        'items-center',
        'pointer-coarse:min-h-11',
      ]),
    );
    await emit(MINE, { self: true, minorNames: [] });
    expect(actions()?.className).toBe(before);
    expect(host().querySelectorAll('[data-slot="series-actions"]')).toHaveLength(1);
  });

  it('keeps the row after the series closes, so a late answer does not move the content below', async () => {
    vi.setSystemTime(at('2027-02-01'));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    await settle();
    expect(actions()).not.toBeNull();
  });
});

describe('PublicTrainingPage registration, a guardian’s children', () => {
  beforeEach(async () => {
    await open({ signedIn: true });
    await emit(TRAINING, WITH_CHILDREN);
  });

  it.each([
    [['Maya R.'], 'Maya R. is registered'],
    [['Maya R.', 'Leo R.'], 'Maya R. and Leo R. are registered'],
    [['Maya R.', 'Leo R.', 'Zoe R.'], 'Maya R., Leo R., and Zoe R. are registered'],
  ])('reads %j as one line, "%s", and keeps Register for another', async (names, line) => {
    await emit(MINE, { self: false, minorNames: names });
    expect(text(registered())).toBe(line);
    expect(registerLink()).not.toBeNull();
    expect(host().querySelectorAll('[data-slot="series-registered"]')).toHaveLength(1);
  });

  it('is a plain line that truncates, in the one row with the Register link', async () => {
    await emit(MINE, { self: false, minorNames: ['Maya R.'] });
    expect(registered()?.querySelector('.truncate')).not.toBeNull();
    expect(registered()?.closest('[data-slot="series-actions"]')).toBe(actions());
    expect(registerLink()?.parentElement).toBe(actions());
  });

  it('reads "You and <name> are registered" for the guardian and a child', async () => {
    await emit(MINE, { self: true, minorNames: ['Maya R.'] });
    expect(text(registered())).toBe('You and Maya R. are registered');
    expect(registerLink()).not.toBeNull();
  });

  it('takes the link away once the guardian has the most children and holds their own place', async () => {
    const children = (count: number) => Array.from({ length: count }, (_v, i) => `Child ${i + 1}`);
    await emit(MINE, { self: true, minorNames: children(MAX_MINORS_PER_SESSION - 1) });
    expect(registerLink()).not.toBeNull();
    await emit(MINE, { self: true, minorNames: children(MAX_MINORS_PER_SESSION) });
    expect(registerLink()).toBeNull();
  });

  it('offers only children where the maximum age is under 18, so a place held by the account holder cannot be', async () => {
    await emit(TRAINING, CHILDREN_ONLY);
    await emit(MINE, NONE);
    expect(registerLink()).not.toBeNull();
    await emit(MINE, { self: false, minorNames: children20() });
    expect(registerLink()).toBeNull();
  });
});

function children20(): string[] {
  return Array.from({ length: MAX_MINORS_PER_SESSION }, (_v, i) => `Child ${i + 1}`);
}
