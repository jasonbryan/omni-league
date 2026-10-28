import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { PAGE_STALLED_ANNOUNCEMENT } from '../public-layout/page-load-status';
import { PAGE_LOAD_WAIT_MS } from '../public-layout/page-load-wait';
import { AcceptInvitePage } from './accept-invite-page';
import { captureInviteToken } from './capture-invite-token';
import { INVITE_TOKEN_KEY } from './invite-token-store';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP-_0123456';
const NEW_TOKEN = 'ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvutsrqponmlkji_-98765';
const GET_BY_TOKEN = 'invites:getByToken';
const ME = 'users:me';

const ORGANIZER = {
  status: 'valid',
  organizationName: 'Coastal Bend Rec Club',
  role: 'leagueOrganizer',
  leagueNames: ['Coed 7v7 Rec'],
};

@Component({ template: 'elsewhere' })
class Elsewhere {}

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim();

type Session = 'pending' | 'signedOut' | 'signedIn';

async function open(session: Session = 'signedOut') {
  sessionStorage.setItem(INVITE_TOKEN_KEY, TOKEN);
  const convex = new FakeConvexClient();
  const auth = new FakeAuthClient();
  TestBed.configureTestingModule({
    providers: [
      provideFakeAuthClient(auth),
      { provide: CONVEX_CLIENT, useValue: convex },
      provideRouter([
        {
          path: 'invites/accept',
          component: AcceptInvitePage,
          canActivate: [captureInviteToken],
          runGuardsAndResolvers: 'always',
        },
        { path: '**', component: Elsewhere },
      ]),
    ],
  });
  if (session !== 'pending') auth.emitSession(session === 'signedIn' ? { id: 's1' } : null);
  const harness = await RouterTestingHarness.create('/invites/accept');
  const page = harness.routeNativeElement!;
  const flush = async () => {
    await vi.advanceTimersByTimeAsync(0);
    await harness.fixture.whenStable();
    TestBed.tick();
  };
  const elapse = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    await flush();
  };
  const sub = (name: string) => convex.activeSubscriptions.find((s) => s.name === name);
  const emit = async (name: string, value: unknown) => {
    sub(name)?.emit(value);
    await flush();
  };
  const goOnline = async (online: boolean) => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online);
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
    await flush();
  };
  const authenticate = async () => {
    TestBed.inject(AuthService).onChange(true);
    await flush();
  };
  await flush();
  return { auth, convex, harness, page, flush, elapse, sub, emit, goOnline, authenticate };
}

const skeleton = (page: HTMLElement) => page.querySelector('[data-testid="invite-skeleton"]');
const errorView = (page: HTMLElement) => page.querySelector('app-server-error-view');
const announcement = (page: HTMLElement) =>
  page.querySelector('main app-page-load-status [role="status"]');

describe('AcceptInvitePage when the invite check does not finish', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  describe('the footer rule', () => {
    it('marks the skeleton as a whole-page skeleton while checking, and not once the view moves on', async () => {
      const { page, emit } = await open();
      expect(skeleton(page)?.hasAttribute('data-page-loading')).toBe(true);
      expect(page.querySelectorAll('[data-page-loading]')).toHaveLength(1);
      const layout = page.querySelector('footer')!.parentElement!;
      expect(layout.className).toContain('[&:has([data-page-loading])>footer]:hidden');

      await emit(GET_BY_TOKEN, ORGANIZER);
      expect(page.querySelector('h1')?.textContent).toContain('Join Coastal Bend Rec Club');
      expect(page.querySelector('[data-page-loading]')).toBeNull();
      expect(page.querySelector('footer')).not.toBeNull();
    });
  });

  describe('a stall', () => {
    it('in invites.getByToken shows the unavailable view with Try again to the page, and no skeleton', async () => {
      const { page, elapse } = await open();
      await elapse(PAGE_LOAD_WAIT_MS - 1);
      expect(skeleton(page)).not.toBeNull();
      expect(errorView(page)).toBeNull();

      await elapse(1);
      expect(skeleton(page)).toBeNull();
      expect(text(errorView(page)?.querySelector('h1'))).toBe(
        'This page is temporarily unavailable',
      );
      expect(errorView(page)?.querySelector('a')?.getAttribute('href')).toBe('/invites/accept');
      expect(page.querySelector('[data-page-loading]')).toBeNull();
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
    });

    it('in the session check shows the unavailable view, then the sign-up view once the session answers', async () => {
      const { page, auth, elapse, emit, flush } = await open('pending');
      await emit(GET_BY_TOKEN, ORGANIZER);
      expect(skeleton(page)).not.toBeNull();

      await elapse(PAGE_LOAD_WAIT_MS);
      expect(errorView(page)).not.toBeNull();

      auth.emitSession(null);
      await flush();
      expect(errorView(page)).toBeNull();
      expect(text(page.querySelector('h1'))).toBe('Join Coastal Bend Rec Club');
      expect(text(page.querySelector('main a'))).toBe('Create an account');
    });

    it('in users.me after a valid invite shows the unavailable view, then the Accept invite view on a late answer', async () => {
      const { page, elapse, emit, authenticate } = await open('signedIn');
      await emit(GET_BY_TOKEN, ORGANIZER);
      await authenticate();
      expect(skeleton(page)).not.toBeNull();

      await elapse(PAGE_LOAD_WAIT_MS);
      expect(errorView(page)).not.toBeNull();
      expect(skeleton(page)).toBeNull();

      await emit(ME, { name: 'Jordan Mills' });
      expect(errorView(page)).toBeNull();
      expect(text(page.querySelector('h1'))).toBe('Join Coastal Bend Rec Club');
      expect(text(page.querySelector('main .px-5.pt-5 p'))).toBe('Signed in as Jordan Mills.');
    });

    it('that moves from one cause to the next is still one wait', async () => {
      const { page, elapse, emit, authenticate } = await open('signedIn');
      await elapse(PAGE_LOAD_WAIT_MS - 4_000);
      await emit(GET_BY_TOKEN, ORGANIZER);
      await authenticate();
      expect(skeleton(page)).not.toBeNull();

      await elapse(3_999);
      expect(errorView(page)).toBeNull();
      await elapse(1);
      expect(errorView(page)).not.toBeNull();
    });

    it('is followed by the right view when the held invite answer arrives', async () => {
      const { page, elapse, emit } = await open();
      await elapse(PAGE_LOAD_WAIT_MS);
      expect(errorView(page)).not.toBeNull();

      await emit(GET_BY_TOKEN, ORGANIZER);
      expect(errorView(page)).toBeNull();
      expect(text(page.querySelector('h1'))).toBe('Join Coastal Bend Rec Club');
    });

    it('is followed by the invalid view when the held answer says the invite is unusable', async () => {
      const { page, elapse, emit } = await open();
      await elapse(PAGE_LOAD_WAIT_MS);

      await emit(GET_BY_TOKEN, { status: 'invalid' });
      expect(errorView(page)).toBeNull();
      expect(text(page.querySelector('h1'))).toBe('This invite link can’t be used');
    });

    it('does not show when the answer arrives before the wait ends', async () => {
      const { page, elapse, emit } = await open();
      await elapse(PAGE_LOAD_WAIT_MS - 1);
      await emit(GET_BY_TOKEN, ORGANIZER);

      await elapse(PAGE_LOAD_WAIT_MS * 2);
      expect(errorView(page)).toBeNull();
      expect(text(page.querySelector('h1'))).toBe('Join Coastal Bend Rec Club');
    });

    it('starts over when the guard captures a new invite token', async () => {
      const { page, harness, elapse, flush, sub } = await open();
      await elapse(PAGE_LOAD_WAIT_MS - 1_000);

      await harness.navigateByUrl(`/invites/accept#${NEW_TOKEN}`);
      await flush();
      expect(sub(GET_BY_TOKEN)?.args).toEqual({ token: NEW_TOKEN });

      await elapse(PAGE_LOAD_WAIT_MS - 1);
      expect(skeleton(page)).not.toBeNull();
      expect(errorView(page)).toBeNull();
      await elapse(1);
      expect(errorView(page)).not.toBeNull();
    });
  });

  describe('offline', () => {
    it('keeps the checking view and runs no wait', async () => {
      const { page, goOnline, elapse } = await open();
      await goOnline(false);

      await elapse(PAGE_LOAD_WAIT_MS * 3);
      expect(skeleton(page)).not.toBeNull();
      expect(errorView(page)).toBeNull();
    });

    it('returns to checking when the page goes offline after the unavailable view, and starts the wait over back online', async () => {
      const { page, goOnline, elapse } = await open();
      await elapse(PAGE_LOAD_WAIT_MS);
      expect(errorView(page)).not.toBeNull();

      await goOnline(false);
      expect(errorView(page)).toBeNull();
      expect(skeleton(page)).not.toBeNull();
      await elapse(PAGE_LOAD_WAIT_MS * 2);
      expect(errorView(page)).toBeNull();

      await goOnline(true);
      expect(skeleton(page)).not.toBeNull();
      await elapse(PAGE_LOAD_WAIT_MS - 1);
      expect(errorView(page)).toBeNull();
      await elapse(1);
      expect(errorView(page)).not.toBeNull();
    });
  });

  describe('announcement', () => {
    it('fills a status region that was already empty in the page, and leaves focus where it was', async () => {
      const { page, elapse } = await open();
      const region = announcement(page);
      expect(region).not.toBeNull();
      expect(region?.textContent).toBe('');
      const focused = document.activeElement;

      await elapse(PAGE_LOAD_WAIT_MS);
      expect(errorView(page)).not.toBeNull();
      expect(announcement(page)).toBe(region);
      expect(region?.textContent).toBe(PAGE_STALLED_ANNOUNCEMENT);
      expect(document.activeElement).toBe(focused);
    });

    it('keeps the skeleton status as the first status in main', async () => {
      const { page } = await open();
      expect(text(page.querySelector('main [role="status"]'))).toBe('Checking your invite…');
    });

    it('empties the region when the held answer arrives', async () => {
      const { page, elapse, emit } = await open();
      const region = announcement(page);
      await elapse(PAGE_LOAD_WAIT_MS);

      await emit(GET_BY_TOKEN, ORGANIZER);
      expect(announcement(page)).toBe(region);
      expect(region?.textContent).toBe('');
    });
  });
});
