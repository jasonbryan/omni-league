import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Component } from '@angular/core';
import { routes } from '../app.routes';
import { captureInviteToken } from './capture-invite-token';
import { INVITE_TOKEN_KEY, InviteTokenStore } from './invite-token-store';

// The token of an invite link lives in the fragment of `/invites/accept#<token>`, which no request
// carries. The route guard moves it into sessionStorage and takes it out of the URL (#70).

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP-_0123456';

@Component({ template: 'accept' })
class Accept {}

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

  it('the app route re-runs the guard on every navigation, so a fragment-only one is captured', () => {
    const route = routes.find((candidate) => candidate.path === 'invites/accept');
    expect(route?.canActivate).toContain(captureInviteToken);
    expect(route?.runGuardsAndResolvers).toBe('always');
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
