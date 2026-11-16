import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../../core/data/convex';
import { FakeConvexClient } from '../../core/data/convex/testing/fake-convex-client';
import { PlainTestPage } from '../../shell/testing/test-pages';
import { PublicCampPage } from './public-camp-page';
import {
  ADULT_CAMP,
  at,
  CAMP_ARGS,
  CAMP_PATH,
  JUNIOR_CAMP,
  ORG_SLUG,
  CAMP_SLUG,
  WEEK_1,
  WEEK_2,
  WEEK_3,
} from './testing/camp-data';

const CAMP = 'camps:getPublicPage';
const MINE = 'campRegistrations:listMineForCamp';
const MINORS = 'campRegistrations:listMyMinorsForCamp';
const WAITING = 'campWaitlist:listMineForCamp';
const REGISTER_PATH = `/app/organizations/${ORG_SLUG}/camps/${CAMP_SLUG}/register`;

let client: FakeConvexClient;
let harness: RouterTestingHarness;

async function open({ signedIn = false, now = '2027-06-01' } = {}) {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at(now));
  client = new FakeConvexClient();
  const auth = new FakeAuthClient();
  if (!signedIn) auth.storedCookie = '';
  TestBed.configureTestingModule({
    providers: [
      provideFakeAuthClient(auth),
      provideRouter([
        { path: 'organizations/:orgSlug/camps/:campSlug', component: PublicCampPage },
        { path: '**', component: PlainTestPage },
      ]),
      { provide: CONVEX_CLIENT, useValue: client },
    ],
  });
  if (signedIn) auth.emitSession({ id: 's1' });
  harness = await RouterTestingHarness.create(CAMP_PATH);
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
const rows = () => [...host().querySelectorAll('main #sessions li')];
const registerLink = (index: number) =>
  [...rows()[index].querySelectorAll('a')].find((a) => text(a).startsWith('Register'));
const joinLink = (index: number) =>
  [...rows()[index].querySelectorAll('a')].find((a) => text(a).startsWith('Join the waitlist'));
const waiting = (index: number) =>
  [...rows()[index].querySelectorAll('[data-slot="session-waitlist"]')].map(text);
const registered = (index: number) =>
  rows()[index].querySelector('[data-slot="session-registered"]');
const actions = (index: number) => rows()[index].querySelector('[data-slot="session-actions"]');
const BOTH_CAMP = { ...JUNIOR_CAMP, minimumAge: 14, maximumAge: 30 };

afterEach(() => {
  vi.useRealTimers();
});

describe('PublicCampPage registration, signed out', () => {
  beforeEach(async () => {
    await open();
    await emit(CAMP, JUNIOR_CAMP);
  });

  it('asks for the camp only, and not for registrations or the waitlist', () => {
    expect(client.activeSubscriptions.map(({ name, args }) => ({ name, args }))).toEqual([
      { name: CAMP, args: CAMP_ARGS },
    ]);
  });

  it('links each open session with places to its register page', () => {
    expect(registerLink(0)?.getAttribute('href')).toBe(`${REGISTER_PATH}?session=${WEEK_1}`);
    expect(text(registerLink(0))).toBe('Register for Week 1');
    expect(registerLink(1)?.getAttribute('href')).toBe(`${REGISTER_PATH}?session=${WEEK_2}`);
  });

  it('gives a link a button’s look and a name that tells the sessions apart', () => {
    expect(registerLink(0)?.getAttribute('data-slot')).toBe('button');
    expect(registerLink(0)?.querySelector('.sr-only')?.textContent).toBe(' for Week 1');
  });

  it('leaves the Register link off a full session, and offers its waitlist while registration is open', () => {
    expect(registerLink(2)).toBeUndefined();
    expect(joinLink(2)?.getAttribute('href')).toBe(`${REGISTER_PATH}?session=${WEEK_3}`);
    expect(text(joinLink(2))).toBe('Join the waitlist for Week 3');
    expect(joinLink(2)?.getAttribute('data-slot')).toBe('button');
    expect(joinLink(2)?.querySelector('.sr-only')?.textContent).toBe(' for Week 3');
    expect(joinLink(0)).toBeUndefined();
    expect(joinLink(1)).toBeUndefined();
  });

  it('takes the waitlist link away once the deadline passes', async () => {
    vi.setSystemTime(at('2027-07-16'));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    await settle();
    expect(joinLink(2)).toBeUndefined();
  });

  it('shows no registered line to a signed-out visitor', () => {
    expect(registered(0)).toBeNull();
    expect(text(host().querySelector('main'))).not.toContain("You're registered");
  });

  it('takes the link away once the clock passes the deadline', async () => {
    vi.setSystemTime(at('2027-07-02'));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    await settle();
    expect(registerLink(0)).toBeUndefined();
  });

  it('leaves the link off a session from a copy saved before sessions had ids', async () => {
    const [first, ...rest] = JUNIOR_CAMP.sessions;
    const { sessionId, ...withoutId } = first;
    void sessionId;
    await emit(CAMP, { ...JUNIOR_CAMP, sessions: [withoutId, ...rest] });
    expect(registerLink(0)).toBeUndefined();
    expect(registerLink(1)).toBeDefined();
  });
});

describe('PublicCampPage registration, closed sessions', () => {
  it('shows no link when every session has closed', async () => {
    await open({ now: '2027-07-20' });
    await emit(CAMP, JUNIOR_CAMP);
    expect(rows().map((row) => row.querySelector('a'))).toEqual([null, null, null]);
  });
});

describe('PublicCampPage registration, signed in', () => {
  beforeEach(async () => {
    await open({ signedIn: true });
    await emit(CAMP, JUNIOR_CAMP);
  });

  it('asks for the caller’s registrations and children in this camp with the route’s slugs', () => {
    expect(
      client.activeSubscriptions
        .filter(({ name }) => name === CAMP || name === MINE || name === MINORS)
        .map(({ name, args }) => ({ name, args })),
    ).toEqual([
      { name: CAMP, args: CAMP_ARGS },
      { name: MINE, args: CAMP_ARGS },
      { name: MINORS, args: CAMP_ARGS },
    ]);
  });

  it('keeps the links while the registrations have not answered', () => {
    expect(registerLink(0)).toBeDefined();
    expect(registered(0)).toBeNull();
  });

  it('reads "You\'re registered" in place of the link for a session the caller holds, on a camp for adults', async () => {
    await emit(CAMP, ADULT_CAMP);
    await emit(MINE, [WEEK_1]);
    expect(text(registered(0))).toBe("You're registered");
    expect(registerLink(0)).toBeUndefined();
    expect(registerLink(1)?.getAttribute('href')).toBe(`${REGISTER_PATH}?session=${WEEK_2}`);
    expect(registered(1)).toBeNull();
  });

  it('keeps the line after the deadline and on a full session', async () => {
    await emit(CAMP, ADULT_CAMP);
    await emit(MINE, ['session_week3']);
    expect(text(registered(2))).toBe("You're registered");
  });

  it('is a plain line, which announces nothing on load', async () => {
    await emit(CAMP, ADULT_CAMP);
    await emit(MINE, [WEEK_1]);
    expect(registered(0)?.tagName).toBe('P');
    expect(registered(0)?.hasAttribute('role')).toBe(false);
  });

  it('keeps the row of the Register button, so the rows below do not move', async () => {
    await emit(CAMP, ADULT_CAMP);
    const before = actions(0)?.className;
    expect(before?.split(' ')).toEqual(
      expect.arrayContaining(['mt-3', 'h-9', 'flex', 'items-center', 'pointer-coarse:min-h-11']),
    );
    await emit(MINE, [WEEK_1]);
    expect(actions(0)?.className).toBe(before);
    expect(rows()[0].querySelectorAll('[data-slot="session-actions"]')).toHaveLength(1);
  });
});

describe('PublicCampPage registration, a guardian’s children', () => {
  const lines = (index: number) =>
    [...rows()[index].querySelectorAll('[data-slot="session-registered"]')].map(text);

  beforeEach(async () => {
    await open({ signedIn: true });
    await emit(CAMP, JUNIOR_CAMP);
  });

  it.each([
    [['Maya R.'], 'Maya R. is registered'],
    [['Maya R.', 'Leo R.'], 'Maya R. and Leo R. are registered'],
    [['Maya R.', 'Leo R.', 'Zoe R.'], 'Maya R., Leo R., and Zoe R. are registered'],
  ])('reads %j as one line, "%s", and keeps Register for another', async (names, line) => {
    await emit(
      MINORS,
      names.map((minorName) => ({ sessionId: WEEK_1, minorName })),
    );
    expect(lines(0)).toEqual([line]);
    expect(registerLink(0)?.getAttribute('href')).toBe(`${REGISTER_PATH}?session=${WEEK_1}`);
    expect(registered(1)).toBeNull();
  });

  it('is a plain line that truncates and announces nothing on load', async () => {
    await emit(MINORS, [{ sessionId: WEEK_1, minorName: 'Maya R.' }]);
    expect(registered(0)?.tagName).toBe('P');
    expect(registered(0)?.hasAttribute('role')).toBe(false);
    expect(registered(0)?.querySelector('.truncate')).not.toBeNull();
  });

  it('puts the line and the Register link in the one row, beside each other', async () => {
    await emit(MINORS, [{ sessionId: WEEK_1, minorName: 'Maya R.' }]);
    expect(registered(0)?.parentElement).toBe(actions(0));
    expect(registerLink(0)?.parentElement).toBe(actions(0));
    expect(rows()[0].querySelectorAll('[data-slot="session-actions"]')).toHaveLength(1);
  });

  it('reads "You and <name> are registered" on a camp that admits both', async () => {
    await emit(CAMP, BOTH_CAMP);
    await emit(MINE, [WEEK_1]);
    await emit(MINORS, [{ sessionId: WEEK_1, minorName: 'Maya R.' }]);
    expect(lines(0)).toEqual(['You and Maya R. are registered']);
    expect(registerLink(0)).toBeDefined();
  });

  it.each([
    ['JUNIOR_CAMP', JUNIOR_CAMP, [] as string[]],
    ['a camp for ages 14 to 30', BOTH_CAMP, [WEEK_1]],
  ])(
    'keeps the same row classes before and after the answers arrive on %s',
    async (_label, camp, mine) => {
      await emit(CAMP, camp);
      const before = rows().map((_row, index) => actions(index)?.className);
      expect(before[0]?.split(' ')).toEqual(expect.arrayContaining(['mt-3', 'h-9']));
      await emit(MINE, mine);
      await emit(MINORS, [{ sessionId: WEEK_1, minorName: 'Maya R.' }]);
      expect(rows().map((_row, index) => actions(index)?.className)).toEqual(before);
      for (const index of [0, 1]) {
        expect(rows()[index].querySelectorAll('[data-slot="session-actions"]').length).toBe(1);
      }
    },
  );

  it('shows a child’s line after the deadline and on a full session, with no link', async () => {
    await emit(MINORS, [{ sessionId: 'session_week3', minorName: 'Maya R.' }]);
    expect(text(registered(2))).toBe('Maya R. is registered');
    expect(registerLink(2)).toBeUndefined();
  });

  it('keeps the Register link on a camp for adults only off a guardian’s own registered session', async () => {
    await emit(CAMP, ADULT_CAMP);
    await emit(MINE, [WEEK_1]);
    expect(registerLink(0)).toBeUndefined();
    expect(registerLink(1)).toBeDefined();
  });

  it('takes the Register link away once the guardian has 20 children in the session, and not at 19', async () => {
    const children = (count: number) =>
      Array.from({ length: count }, (_value, index) => ({
        sessionId: WEEK_1,
        minorName: `Child ${index + 1}`,
      }));
    await emit(MINORS, children(19));
    expect(registerLink(0)).toBeDefined();
    await emit(MINORS, children(20));
    expect(registerLink(0)).toBeUndefined();
    expect(registerLink(1)).toBeDefined();
  });
});

describe('PublicCampPage waitlist', () => {
  const entry = (sessionId: string, participant: unknown, position: number) => ({
    sessionId,
    participant,
    position,
  });
  const MAYA = { kind: 'minor', minorName: 'Maya R.' };

  beforeEach(async () => {
    await open({ signedIn: true, now: '2027-07-03' });
    await emit(CAMP, JUNIOR_CAMP);
  });

  it('asks for the caller’s waiting entries in this camp with the route’s slugs', () => {
    expect(client.activeSubscriptions.find(({ name }) => name === WAITING)?.args).toEqual(
      CAMP_ARGS,
    );
  });

  it('reads "<name> is on the waitlist, position N" on the session, as a plain line', async () => {
    await emit(WAITING, [entry(WEEK_3, MAYA, 1)]);
    expect(waiting(2)).toEqual(['Maya R. is on the waitlist, position 1']);
    const line = rows()[2].querySelector('[data-slot="session-waitlist"]');
    expect(line?.tagName).toBe('P');
    expect(line?.hasAttribute('role')).toBe(false);
    expect(waiting(0)).toEqual([]);
  });

  it('reads "You are on the waitlist" for the account holder, and one line for each entry in order', async () => {
    await emit(CAMP, { ...JUNIOR_CAMP, minimumAge: 14, maximumAge: 30 });
    await emit(WAITING, [entry(WEEK_3, { kind: 'self' }, 2), entry(WEEK_3, MAYA, 5)]);
    expect(waiting(2)).toEqual([
      'You are on the waitlist, position 2',
      'Maya R. is on the waitlist, position 5',
    ]);
  });

  it('keeps the waitlist link for another child, and drops it once the account holder waits on an adult camp', async () => {
    await emit(WAITING, [entry(WEEK_3, MAYA, 1)]);
    expect(joinLink(2)).toBeDefined();
    await emit(CAMP, ADULT_CAMP);
    await emit(WAITING, [entry(WEEK_3, { kind: 'self' }, 1)]);
    expect(joinLink(2)).toBeUndefined();
    expect(waiting(2)).toEqual(['You are on the waitlist, position 1']);
  });

  it('keeps the line after the deadline, with no link', async () => {
    TestBed.resetTestingModule();
    await open({ signedIn: true, now: '2027-07-20' });
    await emit(CAMP, JUNIOR_CAMP);
    await emit(WAITING, [entry(WEEK_3, MAYA, 1)]);
    expect(waiting(2)).toEqual(['Maya R. is on the waitlist, position 1']);
    expect(joinLink(2)).toBeUndefined();
  });

  it('takes the waitlist link away at 20 children counted between places and the waitlist', async () => {
    await emit(
      MINORS,
      Array.from({ length: 10 }, (_value, index) => ({
        sessionId: WEEK_3,
        minorName: `Held ${index}`,
      })),
    );
    await emit(
      WAITING,
      Array.from({ length: 9 }, (_value, index) =>
        entry(WEEK_3, { kind: 'minor', minorName: `Wait ${index}` }, index + 1),
      ),
    );
    expect(joinLink(2)).toBeDefined();
    await emit(
      WAITING,
      Array.from({ length: 10 }, (_value, index) =>
        entry(WEEK_3, { kind: 'minor', minorName: `Wait ${index}` }, index + 1),
      ),
    );
    expect(joinLink(2)).toBeUndefined();
  });

  it('shows no waitlist line to a signed-out visitor', async () => {
    TestBed.resetTestingModule();
    await open({ now: '2027-07-03' });
    await emit(CAMP, JUNIOR_CAMP);
    expect(waiting(2)).toEqual([]);
    expect(client.activeSubscriptions.some(({ name }) => name === WAITING)).toBe(false);
  });
});
