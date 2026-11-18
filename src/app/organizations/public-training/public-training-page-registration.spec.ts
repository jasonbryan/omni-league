import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Id } from '../../../../convex/_generated/dataModel';
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
const WAITING = 'trainingWaitlist:listMineForTraining';
const REGISTER_PATH = `/app/organizations/${ORG_SLUG}/training/${TRAINING_SLUG}/register`;
const NONE = { self: false, minorNames: [] as string[], classes: [] as MineClass[] };

interface MineClass {
  classId: string;
  self: boolean;
  minorNames: string[];
}

/** The sample program with a place in every class, so nothing keeps the series from opening. */
const OPEN_SERIES: PublicTrainingData = {
  ...TUESDAY_CLINIC,
  classes: TUESDAY_CLINIC.classes.map((row) => ({ ...row, placesLeft: 5 })),
};
const CLASS_IDS = ['class_0', 'class_1', 'class_2'] as Id<'trainingClasses'>[];
/** The sample program that takes a single class, each class named by its id. */
const SINGLE_CLASS: PublicTrainingData = {
  ...OPEN_SERIES,
  allowSingleRegistration: true,
  classes: OPEN_SERIES.classes.map((row, index) => ({ ...row, classId: CLASS_IDS[index] })),
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

/** The caller's registrations apply with their waitlist spots, so an answer to the first also answers the second with none, unless `alone`. */
async function emit(name: string, value: unknown, { alone = false } = {}): Promise<void> {
  const waitlist = client.activeSubscriptions.find((s) => s.name === WAITING);
  if (name === MINE && waitlist && !alone) waitlist.emit([]);
  client.activeSubscriptions.find((s) => s.name === name)!.emit(value);
  await settle();
}

const host = () => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const registerLink = () =>
  host().querySelector<HTMLAnchorElement>('main a[href*="/register"]:not([href*="?class="])');
const classLinks = () => [
  ...host().querySelectorAll<HTMLAnchorElement>('main #classes a[href*="?class="]'),
];
const classRows = () => [...host().querySelectorAll('#classes li')];
const classActions = () => [...host().querySelectorAll('[data-slot="class-actions"]')];
const classRegistered = () => [...host().querySelectorAll('[data-slot="class-registered"]')];
const registered = () => host().querySelector('[data-slot="series-registered"]');
const actions = () => host().querySelector('[data-slot="series-actions"]');
const fullNote = () => host().querySelector('[data-slot="series-full"]');
const waiting = () => [...host().querySelectorAll('[data-slot="series-waitlist"]')];
const joinLink = () =>
  [...host().querySelectorAll<HTMLAnchorElement>('[data-slot="series-actions"] a')].find((link) =>
    text(link).startsWith('Join the waitlist'),
  );

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

  it('offers the waitlist in place of Register while a class is full, and says so, naming no registrant', async () => {
    await emit(TRAINING, TUESDAY_CLINIC);
    expect(registerLink()).toBe(joinLink());
    expect(text(joinLink())).toBe('Join the waitlist for the series');
    expect(joinLink()?.getAttribute('href')).toBe(REGISTER_PATH);
    expect(joinLink()?.getAttribute('data-slot')).toBe('button');
    expect(text(fullNote())).toBe('A class is full, so no place is left for the whole series.');
  });

  it('reads that people are waiting when the places are held for the waitlist, though a class has places', async () => {
    await emit(TRAINING, {
      ...OPEN_SERIES,
      seriesWaitlist: true,
      classes: OPEN_SERIES.classes.map((row) => ({ ...row, placesLeft: 0 })),
    });
    expect(text(fullNote())).toBe(
      'People are waiting for a place, so no place is left for the whole series.',
    );
    expect(text(joinLink())).toBe('Join the waitlist for the series');
    expect(classRows().map((row) => text(row.querySelector('[data-slot="class-places"]')))).toEqual(
      ['Full', 'Full', 'Full'],
    );
  });

  it('shows no waiting line to a signed-out visitor', () => {
    expect(waiting()).toEqual([]);
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

describe('PublicTrainingPage registration of one class, signed out', () => {
  beforeEach(async () => {
    await open();
    await emit(TRAINING, SINGLE_CLASS);
  });

  it('links each class to the register page with its id, named for the class', () => {
    expect(classLinks().map((link) => link.getAttribute('href'))).toEqual(
      CLASS_IDS.map((id) => `${REGISTER_PATH}?class=${id}`),
    );
    expect(classLinks().map((link) => text(link))).toEqual([
      'Register for Tue, Feb 2, 2027',
      'Register for Tue, Feb 9, 2027',
      'Register for Tue, Feb 16, 2027',
    ]);
    expect(classLinks()[0].getAttribute('data-slot')).toBe('button');
    expect(classLinks()[0].querySelector('.sr-only')?.textContent).toBe(' for Tue, Feb 2, 2027');
  });

  it('keeps the series link beside the class links', () => {
    expect(registerLink()?.getAttribute('href')).toBe(REGISTER_PATH);
  });

  it('keeps a row for each class, with the Register link last in it', () => {
    expect(classActions()).toHaveLength(3);
    expect(classActions().map((row) => row.parentElement)).toEqual(classRows());
    expect(classLinks().map((link) => link.parentElement)).toEqual(classActions());
  });

  it('keeps the link after the series deadline, which does not apply to a class', async () => {
    vi.setSystemTime(at('2027-02-01'));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    await settle();
    expect(registerLink()).toBeNull();
    expect(classLinks()).toHaveLength(3);
  });

  it('drops the link of a class once its date has passed, and keeps one on the class date', async () => {
    vi.setSystemTime(at('2027-02-01'));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    await settle();
    expect(classLinks()).toHaveLength(3);
    vi.setSystemTime(at('2027-02-02'));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    await settle();
    expect(classLinks().map((link) => link.getAttribute('href'))).toEqual([
      `${REGISTER_PATH}?class=${CLASS_IDS[1]}`,
      `${REGISTER_PATH}?class=${CLASS_IDS[2]}`,
    ]);
  });

  it('leaves the link off a full class and keeps its row', async () => {
    await emit(TRAINING, {
      ...SINGLE_CLASS,
      classes: SINGLE_CLASS.classes.map((row, index) => ({
        ...row,
        placesLeft: index === 1 ? 0 : 5,
      })),
    });
    expect(classLinks()).toHaveLength(2);
    expect(classActions()).toHaveLength(3);
  });

  it('shows no link on a program that does not take a single class', async () => {
    await emit(TRAINING, { ...SINGLE_CLASS, allowSingleRegistration: undefined });
    expect(classLinks()).toEqual([]);
    expect(classActions()).toEqual([]);
    await emit(TRAINING, { ...SINGLE_CLASS, allowSingleRegistration: false });
    expect(classLinks()).toEqual([]);
  });

  it('shows no link on a class a copy saved by an earlier release does not name', async () => {
    await emit(TRAINING, {
      ...SINGLE_CLASS,
      classes: SINGLE_CLASS.classes.map((row) => ({ ...row, classId: undefined })),
    });
    expect(classLinks()).toEqual([]);
    expect(classActions()).toEqual([]);
  });

  it('shows a link on a class while the series has begun', async () => {
    TestBed.resetTestingModule();
    await open({ now: '2027-02-03' });
    await emit(TRAINING, SINGLE_CLASS);
    expect(registerLink()).toBeNull();
    expect(classLinks()).toHaveLength(2);
  });
});

describe('PublicTrainingPage registration of one class, signed in', () => {
  beforeEach(async () => {
    await open({ signedIn: true });
    await emit(TRAINING, { ...SINGLE_CLASS, minimumAge: 18 });
  });

  it('asks for the registrations once, which name the classes too', () => {
    expect(client.activeSubscriptions.filter(({ name }) => name === MINE)).toHaveLength(1);
  });

  it('reads "You\'re registered" on the class the caller holds, and keeps the link on the others', async () => {
    await emit(MINE, { ...NONE, classes: [{ classId: CLASS_IDS[1], self: true, minorNames: [] }] });
    expect(classRegistered().map((line) => text(line))).toEqual(["You're registered"]);
    expect(classRegistered()[0].closest('li')).toBe(classRows()[1]);
    expect(classLinks().map((link) => link.getAttribute('href'))).toEqual([
      `${REGISTER_PATH}?class=${CLASS_IDS[0]}`,
      `${REGISTER_PATH}?class=${CLASS_IDS[2]}`,
    ]);
  });

  it('is a plain line that truncates, in the one row with the Register link', async () => {
    await emit(MINE, { ...NONE, classes: [{ classId: CLASS_IDS[0], self: true, minorNames: [] }] });
    expect(classRegistered()[0].tagName).toBe('P');
    expect(classRegistered()[0].hasAttribute('role')).toBe(false);
    expect(classRegistered()[0].querySelector('.truncate')).not.toBeNull();
    expect(classRegistered()[0].parentElement).toBe(classActions()[0]);
  });

  it('takes every class link away from a series holder on a program for adults', async () => {
    await emit(MINE, { ...NONE, self: true });
    expect(classLinks()).toEqual([]);
    expect(classActions()).toHaveLength(3);
  });

  it('keeps the rows as they were when the registrations answer, so the content below does not move', async () => {
    const before = classActions().map((row) => row.className);
    expect(before[0].split(' ')).toEqual(
      expect.arrayContaining([
        'mt-3',
        'min-h-9',
        'flex',
        'items-center',
        'pointer-coarse:min-h-11',
      ]),
    );
    await emit(MINE, {
      ...NONE,
      classes: [{ classId: CLASS_IDS[0], self: true, minorNames: [] }],
    });
    expect(classActions().map((row) => row.className)).toEqual(before);
    expect(classRows()).toHaveLength(3);
  });
});

describe('PublicTrainingPage registration of the series when a class is full', () => {
  const FULL_BY_VIEWER: PublicTrainingData = {
    ...SINGLE_CLASS,
    minimumAge: 18,
    classes: SINGLE_CLASS.classes.map((row, index) => ({
      ...row,
      placesLeft: index === 1 ? 0 : 5,
    })),
  };

  beforeEach(async () => {
    await open({ signedIn: true });
    await emit(TRAINING, FULL_BY_VIEWER);
  });

  it('says a class is full, with no series link, while the viewer holds no place in it', async () => {
    await emit(MINE, NONE);
    expect(text(fullNote())).toBe('A class is full, so no place is left for the whole series.');
    expect(text(joinLink())).toBe('Join the waitlist for the series');
    expect(text(registerLink())).toBe('Join the waitlist for the series');
  });

  it('offers the series when the only place of the full class is the viewer’s own', async () => {
    await emit(MINE, {
      ...NONE,
      classes: [{ classId: CLASS_IDS[1], self: true, minorNames: [] }],
    });
    expect(fullNote()).toBeNull();
    expect(registerLink()).not.toBeNull();
  });

  it('offers the series to a guardian whose child holds the last place', async () => {
    await emit(TRAINING, { ...FULL_BY_VIEWER, minimumAge: 9, maximumAge: 30 });
    await emit(MINE, {
      ...NONE,
      classes: [{ classId: CLASS_IDS[1], self: false, minorNames: ['Maya R.'] }],
    });
    expect(fullNote()).toBeNull();
    expect(registerLink()).not.toBeNull();
  });

  it('still says full for a class the viewer holds no place in, while holding another', async () => {
    await emit(MINE, {
      ...NONE,
      classes: [{ classId: CLASS_IDS[0], self: true, minorNames: [] }],
    });
    expect(text(fullNote())).toBe('A class is full, so no place is left for the whole series.');
  });
});

describe('PublicTrainingPage registration of one class, a guardian’s children', () => {
  beforeEach(async () => {
    await open({ signedIn: true });
    await emit(TRAINING, { ...SINGLE_CLASS, minimumAge: 9, maximumAge: 30 });
  });

  it('reads the names held in a class as one line and keeps the link for another child', async () => {
    await emit(MINE, {
      ...NONE,
      classes: [{ classId: CLASS_IDS[0], self: true, minorNames: ['Maya R.', 'Leo R.'] }],
    });
    expect(text(classRegistered()[0])).toBe('You, Maya R., and Leo R. are registered');
    expect(classLinks()).toHaveLength(3);
  });

  it('keeps the link for a child on a class where the account holder holds a place', async () => {
    await emit(MINE, { ...NONE, self: true });
    expect(classLinks()).toHaveLength(3);
  });

  it('keeps the link at the most children one guardian can register, because a child already held may take another class', async () => {
    const names = Array.from({ length: MAX_MINORS_PER_SESSION }, (_v, i) => `Child ${i + 1}`);
    await emit(MINE, {
      ...NONE,
      self: true,
      classes: [{ classId: CLASS_IDS[0], self: false, minorNames: names }],
    });
    expect(classLinks()).toHaveLength(3);
  });
});

describe('PublicTrainingPage registration, the waitlist, signed in', () => {
  const FULL_SERIES: PublicTrainingData = {
    ...WITH_CHILDREN,
    seriesWaitlist: true,
    classes: WITH_CHILDREN.classes.map((row) => ({ ...row, placesLeft: 0 })),
  };
  const FULL_ADULTS: PublicTrainingData = { ...FULL_SERIES, minimumAge: 18, maximumAge: undefined };
  const SELF = { kind: 'self' } as const;
  const MINOR = (minorName: string) => ({ kind: 'minor', minorName }) as const;
  const answers = async (mine: unknown, waitingFor: unknown) => {
    await emit(MINE, mine);
    await emit(WAITING, waitingFor);
  };

  beforeEach(async () => {
    await open({ signedIn: true });
  });

  it('asks for the caller’s waitlist spots in this program with the route’s slugs, once signed in', async () => {
    await emit(TRAINING, FULL_SERIES);
    expect(
      client.activeSubscriptions.filter(({ name }) => name === WAITING).map(({ args }) => args),
    ).toEqual([TRAINING_ARGS]);
  });

  it('reads "You\'re on the waitlist, position N" for the account holder, in place of the link, on a program for adults', async () => {
    await emit(TRAINING, FULL_ADULTS);
    await answers(NONE, [{ participant: SELF, position: 2 }]);
    expect(waiting().map(text)).toEqual(["You're on the waitlist, position 2"]);
    expect(joinLink()).toBeUndefined();
    expect(registerLink()).toBeNull();
  });

  it('reads a child’s spot by name, and keeps the link for another child', async () => {
    await emit(TRAINING, FULL_SERIES);
    await answers(NONE, [{ participant: MINOR('Maya R.'), position: 1 }]);
    expect(waiting().map(text)).toEqual(['Maya R. is on the waitlist, position 1']);
    expect(joinLink()).toBeDefined();
  });

  it('reads one line for each spot, in the order the server gives them', async () => {
    await emit(TRAINING, FULL_SERIES);
    await answers(NONE, [
      { participant: MINOR('Maya R.'), position: 1 },
      { participant: SELF, position: 3 },
    ]);
    expect(waiting().map(text)).toEqual([
      'Maya R. is on the waitlist, position 1',
      "You're on the waitlist, position 3",
    ]);
  });

  it('shows a registered child and a waiting one together, each on a line of its own', async () => {
    await emit(TRAINING, FULL_SERIES);
    await answers({ self: false, minorNames: ['Sam R.'], classes: [] }, [
      { participant: MINOR('Maya R.'), position: 1 },
    ]);
    expect(text(registered())).toBe('Sam R. is registered');
    expect(waiting().map(text)).toEqual(['Maya R. is on the waitlist, position 1']);
  });

  it('applies the answers together, so the row changes once and not for each answer', async () => {
    await emit(TRAINING, FULL_SERIES);
    await emit(MINE, { self: false, minorNames: ['Sam R.'], classes: [] }, { alone: true });
    expect(registered()).toBeNull();
    expect(waiting()).toEqual([]);
    await emit(WAITING, [{ participant: MINOR('Maya R.'), position: 1 }]);
    expect(text(registered())).toBe('Sam R. is registered');
    expect(waiting()).toHaveLength(1);
  });

  it('shows what did answer when the other answer fails', async () => {
    await emit(TRAINING, FULL_SERIES);
    await emit(MINE, { self: false, minorNames: ['Sam R.'], classes: [] }, { alone: true });
    client.activeSubscriptions.find((s) => s.name === WAITING)!.fail(new Error('Server Error'));
    await settle();
    expect(text(registered())).toBe('Sam R. is registered');
  });

  it('is plain lines that announce nothing on load, and wrap a long name rather than cut it', async () => {
    await emit(TRAINING, FULL_SERIES);
    await answers(NONE, [{ participant: MINOR('W'.repeat(60)), position: 1 }]);
    const [line] = waiting();
    expect(line.tagName).toBe('P');
    expect(line.hasAttribute('role')).toBe(false);
    expect(line.querySelector('.wrap-anywhere')).not.toBeNull();
    expect(line.querySelector('.truncate')).toBeNull();
  });

  it('keeps the lines in the one row of the series actions, which wraps only while lines wait', async () => {
    await emit(TRAINING, FULL_SERIES);
    expect(actions()?.classList).not.toContain('flex-wrap');
    await answers(NONE, [{ participant: MINOR('Maya R.'), position: 1 }]);
    expect(actions()?.classList).toContain('flex-wrap');
    expect(waiting()[0].closest('[data-slot="series-actions"]')).toBe(actions());
    expect(joinLink()?.parentElement).toBe(actions());
    expect(host().querySelectorAll('[data-slot="series-actions"]')).toHaveLength(1);
  });

  it('counts a guardian’s waiting children toward the most one account can hold', async () => {
    const children = (count: number) =>
      Array.from({ length: count }, (_v, index) => MINOR(`Child ${index + 1}`));
    await emit(TRAINING, FULL_SERIES);
    await answers({ self: true, minorNames: [], classes: [] }, []);
    expect(joinLink()).toBeDefined();
    await emit(
      WAITING,
      children(MAX_MINORS_PER_SESSION - 1).map((participant, index) => ({
        participant,
        position: index + 1,
      })),
    );
    expect(joinLink()).toBeDefined();
    await emit(
      WAITING,
      children(MAX_MINORS_PER_SESSION).map((participant, index) => ({
        participant,
        position: index + 1,
      })),
    );
    expect(joinLink()).toBeUndefined();
  });

  it('keeps the waiting lines after the series closes, with no link to join', async () => {
    await emit(TRAINING, FULL_ADULTS);
    await answers(NONE, [{ participant: SELF, position: 1 }]);
    vi.setSystemTime(at('2027-02-01'));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    await settle();
    expect(waiting().map(text)).toEqual(["You're on the waitlist, position 1"]);
    expect(joinLink()).toBeUndefined();
  });

  it('offers Register, not the waitlist, once no class is full and no one waits', async () => {
    await emit(TRAINING, OPEN_SERIES);
    await answers(NONE, []);
    expect(joinLink()).toBeUndefined();
    expect(text(registerLink())).toBe('Register for the series');
  });

  it('keeps the series row for a guardian whose own place fills a class: the series replaces it', async () => {
    const heldClass: PublicTrainingData = {
      ...SINGLE_CLASS,
      classes: SINGLE_CLASS.classes.map((row, index) => ({
        ...row,
        placesLeft: index === 0 ? 0 : 5,
      })),
    };
    await emit(TRAINING, heldClass);
    await emit(MINE, {
      ...NONE,
      classes: [{ classId: CLASS_IDS[0], self: true, minorNames: [] }],
    });
    expect(joinLink()).toBeUndefined();
    expect(text(registerLink())).toBe('Register for the series');
  });
});
