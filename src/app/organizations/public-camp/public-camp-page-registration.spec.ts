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
} from './testing/camp-data';

const CAMP = 'camps:getPublicPage';
const MINE = 'campRegistrations:listMineForCamp';
const MINORS = 'campRegistrations:listMyMinorsForCamp';
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
const registered = (index: number) =>
  rows()[index].querySelector('[data-slot="session-registered"]');

afterEach(() => {
  vi.useRealTimers();
});

describe('PublicCampPage registration, signed out', () => {
  beforeEach(async () => {
    await open();
    await emit(CAMP, JUNIOR_CAMP);
  });

  it('asks for the camp only, and not for registrations', () => {
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

  it('leaves the link off a full session', () => {
    expect(registerLink(2)).toBeUndefined();
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

  it('takes the box of the Register button it replaces, so the rows below do not move', async () => {
    const boxClasses = (element: Element | null | undefined) =>
      ['mt-3', 'h-9'].filter((name) => element?.classList.contains(name));
    await emit(CAMP, ADULT_CAMP);
    const button = registerLink(0);
    expect(boxClasses(button)).toEqual(['mt-3', 'h-9']);
    await emit(MINE, [WEEK_1]);
    expect(boxClasses(registered(0))).toEqual(['mt-3', 'h-9']);
    expect(registered(0)?.classList.contains('pointer-coarse:min-h-11')).toBe(true);
    expect(registered(0)?.classList.contains('flex')).toBe(true);
    expect(registered(0)?.classList.contains('items-center')).toBe(true);
  });
});

describe('PublicCampPage registration, a guardian’s children', () => {
  beforeEach(async () => {
    await open({ signedIn: true });
    await emit(CAMP, JUNIOR_CAMP);
  });

  it('reads "<name> is registered" for each child, in the session they hold, and keeps Register for another', async () => {
    await emit(MINORS, [
      { sessionId: WEEK_1, minorName: 'Maya R.' },
      { sessionId: WEEK_1, minorName: 'Leo R.' },
    ]);
    expect([...rows()[0].querySelectorAll('[data-slot="session-registered"]')].map(text)).toEqual([
      'Maya R. is registered',
      'Leo R. is registered',
    ]);
    expect(registerLink(0)?.getAttribute('href')).toBe(`${REGISTER_PATH}?session=${WEEK_1}`);
    expect(registered(1)).toBeNull();
  });

  it('are plain lines that announce nothing on load', async () => {
    await emit(MINORS, [{ sessionId: WEEK_1, minorName: 'Maya R.' }]);
    expect(registered(0)?.tagName).toBe('P');
    expect(registered(0)?.hasAttribute('role')).toBe(false);
  });

  it('shows the guardian’s own line and then the children’s on a camp that admits both', async () => {
    await emit(CAMP, { ...JUNIOR_CAMP, minimumAge: 14, maximumAge: 30 });
    await emit(MINE, [WEEK_1]);
    await emit(MINORS, [{ sessionId: WEEK_1, minorName: 'Maya R.' }]);
    expect([...rows()[0].querySelectorAll('[data-slot="session-registered"]')].map(text)).toEqual([
      "You're registered",
      'Maya R. is registered',
    ]);
    expect(registerLink(0)).toBeDefined();
  });

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
});
