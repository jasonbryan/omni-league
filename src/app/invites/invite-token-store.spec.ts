import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Component } from '@angular/core';
import { routes } from '../app.routes';
import { acceptInviteRoutes, joinTeamRoutes } from '../app.routes.invites';
import { captureInviteToken, captureTeamInviteToken } from './capture-invite-token';
import {
  INVITE_TOKEN_KEY,
  InviteTokenStore,
  TEAM_INVITE_TOKEN_KEY,
  TeamInviteTokenStore,
} from './invite-token-store';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP-_0123456';
const TEAM_TOKEN = 'teamtokenABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_abc';

@Component({ template: 'accept' })
class Accept {}

/** The app's route for `path`, with its lazy child resolved and the child's page swapped for a stub. */
function appInviteRoute(path: string, lazyRoutes: Routes): Routes {
  const parent = routes.find((candidate) => candidate.path === path);
  const children = lazyRoutes.map((child) => ({
    ...child,
    loadComponent: undefined,
    component: Accept,
  }));
  return [{ ...parent, loadChildren: undefined, children }];
}

async function openTwoLinks(path: string, lazyRoutes: Routes, first: string, second: string) {
  TestBed.configureTestingModule({ providers: [provideRouter(appInviteRoute(path, lazyRoutes))] });
  const harness = await RouterTestingHarness.create(`/${path}#${first}`);
  await harness.navigateByUrl(`/${path}#${second}`);
}

afterEach(() => sessionStorage.clear());

describe('InviteTokenStore', () => {
  it('saves a well-formed token in sessionStorage and reads it back', () => {
    const store = TestBed.inject(InviteTokenStore);
    expect(store.read()).toBeNull();
    expect(store.save(TOKEN)).toBe(true);
    expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
    expect(store.read()).toBe(TOKEN);
  });

  it.each(['', ' ', 'a b', 'tok?en', 'tok#en', 'tok/en', 'é', 'x'.repeat(129)])(
    'refuses %j, which no invite link holds, and forgets any earlier token',
    (raw) => {
      const store = TestBed.inject(InviteTokenStore);
      store.save(TOKEN);
      expect(store.save(raw)).toBe(false);
      expect(store.read()).toBeNull();
    },
  );

  it('does not return a malformed value found in sessionStorage', () => {
    sessionStorage.setItem(INVITE_TOKEN_KEY, 'not a token!');
    expect(TestBed.inject(InviteTokenStore).read()).toBeNull();
  });

  it('clear removes the token', () => {
    const store = TestBed.inject(InviteTokenStore);
    store.save(TOKEN);
    store.clear();
    expect(store.read()).toBeNull();
    expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBeNull();
  });

  it('keeps working when sessionStorage throws (blocked storage)', () => {
    const store = TestBed.inject(InviteTokenStore);
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(store.save(TOKEN)).toBe(false);
    blocked.mockRestore();
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(store.read()).toBeNull();
    read.mockRestore();
  });
});

describe('captureInviteToken', () => {
  async function open(url: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'invites/accept', component: Accept, canActivate: [captureInviteToken] },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return harness;
  }

  it('moves the fragment into sessionStorage and leaves the URL without it', async () => {
    await open(`/invites/accept#${TOKEN}`);
    expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
    expect(TestBed.inject(Router).url).toBe('/invites/accept');
  });

  it('leaves the URL and the stored token alone when there is no fragment', async () => {
    sessionStorage.setItem(INVITE_TOKEN_KEY, TOKEN);
    await open('/invites/accept');
    expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
    expect(TestBed.inject(Router).url).toBe('/invites/accept');
  });

  it('a fragment on the page that is already open is captured and leaves the URL clean', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'invites/accept',
            component: Accept,
            canActivate: [captureInviteToken],
            runGuardsAndResolvers: 'always',
          },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create('/invites/accept');
    expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBeNull();
    await harness.navigateByUrl(`/invites/accept#${TOKEN}`);
    expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
    expect(TestBed.inject(Router).url).toBe('/invites/accept');
  });

  it('the app route re-runs the guard on every navigation, so a second link in the open tab replaces the token', async () => {
    const second = TOKEN.split('').reverse().join('');
    await openTwoLinks('invites/accept', acceptInviteRoutes, TOKEN, second);
    expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(second);
    expect(TestBed.inject(Router).url).toBe('/invites/accept');
  });

  it('a new link replaces the token of an earlier one', async () => {
    sessionStorage.setItem(INVITE_TOKEN_KEY, 'earlier-token');
    await open(`/invites/accept#${TOKEN}`);
    expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
  });

  it('a malformed fragment is dropped, with the earlier token, and leaves the URL clean', async () => {
    sessionStorage.setItem(INVITE_TOKEN_KEY, TOKEN);
    await open('/invites/accept#not%20a%20token');
    expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/invites/accept');
  });

  it('never keeps a token passed in the query string, and drops the query from the URL', async () => {
    await open(`/invites/accept?token=${TOKEN}&x=1`);
    expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/invites/accept');
  });
});

describe('the staff and team invite stores', () => {
  it('keep their tokens under separate keys, so neither reads or clears the other', () => {
    const staff = TestBed.inject(InviteTokenStore);
    const team = TestBed.inject(TeamInviteTokenStore);
    expect(INVITE_TOKEN_KEY).not.toBe(TEAM_INVITE_TOKEN_KEY);
    staff.save(TOKEN);
    expect(team.read()).toBeNull();
    team.save(TEAM_TOKEN);
    expect(staff.read()).toBe(TOKEN);
    expect(team.read()).toBe(TEAM_TOKEN);
    expect(sessionStorage.getItem(TEAM_INVITE_TOKEN_KEY)).toBe(TEAM_TOKEN);
    team.clear();
    expect(staff.read()).toBe(TOKEN);
    team.save(TEAM_TOKEN);
    staff.save('not a token');
    expect(team.read()).toBe(TEAM_TOKEN);
    expect(staff.read()).toBeNull();
  });
});

describe('captureTeamInviteToken', () => {
  @Component({ template: 'join' })
  class Join {}

  async function open(url: string) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'teams/join', component: Join, canActivate: [captureTeamInviteToken] },
          { path: 'invites/accept', component: Accept, canActivate: [captureInviteToken] },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return harness;
  }

  it('moves the fragment into the team key only and leaves the URL without it', async () => {
    sessionStorage.setItem(INVITE_TOKEN_KEY, TOKEN);
    await open(`/teams/join#${TEAM_TOKEN}`);
    expect(sessionStorage.getItem(TEAM_INVITE_TOKEN_KEY)).toBe(TEAM_TOKEN);
    expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
    expect(TestBed.inject(Router).url).toBe('/teams/join');
  });

  it('a staff link opened after it leaves the team token in place', async () => {
    const harness = await open(`/teams/join#${TEAM_TOKEN}`);
    await harness.navigateByUrl(`/invites/accept#${TOKEN}`);
    expect(sessionStorage.getItem(TEAM_INVITE_TOKEN_KEY)).toBe(TEAM_TOKEN);
    expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
  });

  it('never keeps a token passed in the query string, and drops the query from the URL', async () => {
    await open(`/teams/join?token=${TEAM_TOKEN}`);
    expect(sessionStorage.getItem(TEAM_INVITE_TOKEN_KEY)).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/teams/join');
  });

  it('the app route re-runs the guard on every navigation, so a second link in the open tab replaces the token', async () => {
    const second = TEAM_TOKEN.split('').reverse().join('');
    await openTwoLinks('teams/join', joinTeamRoutes, TEAM_TOKEN, second);
    expect(sessionStorage.getItem(TEAM_INVITE_TOKEN_KEY)).toBe(second);
    expect(TestBed.inject(Router).url).toBe('/teams/join');
  });
});
