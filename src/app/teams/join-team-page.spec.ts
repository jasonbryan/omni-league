import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ConvexError } from 'convex/values';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT, ConvexOfflineError } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { captureTeamInviteToken } from '../invites/capture-invite-token';
import { INVITE_TOKEN_KEY, TEAM_INVITE_TOKEN_KEY } from '../invites/invite-token-store';
import { JoinTeamPage } from './join-team-page';

const TOKEN = 'teamtokenABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_abc';
const STAFF_TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP-_0123456';
const GET_BY_TOKEN = 'teamInvites:getByToken';
const ACCEPT = 'teamInvites:accept';
const ME = 'users:me';
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const EXPIRES = NOW + 12 * 24 * 60 * 60 * 1000;

const INVITE = {
  status: 'valid',
  teamName: 'Sand Sharks',
  seasonName: 'Summer 2027',
  leagueName: 'Sunday Reverse Coed 4s',
  organizationName: 'Gulf Coast Sport & Social',
  expiresAt: EXPIRES,
};
const JOINED = {
  teamId: 'team123',
  teamName: 'Sand Sharks',
  seasonName: 'Summer 2027',
  captainName: 'Tasha Greene',
};

@Component({ template: 'elsewhere' })
class Elsewhere {}

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim();

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

async function open(options: { token?: string | null; signedIn?: boolean } = {}) {
  const { token = TOKEN, signedIn = false } = options;
  if (token) sessionStorage.setItem(TEAM_INVITE_TOKEN_KEY, token);
  const convex = new FakeConvexClient();
  const auth = new FakeAuthClient();
  TestBed.configureTestingModule({
    providers: [
      provideFakeAuthClient(auth),
      { provide: CONVEX_CLIENT, useValue: convex },
      provideRouter([
        {
          path: 'teams/join',
          component: JoinTeamPage,
          canActivate: [captureTeamInviteToken],
          runGuardsAndResolvers: 'always',
        },
        { path: 'app', component: Elsewhere },
        { path: 'app/teams/:teamId', component: Elsewhere },
        { path: 'sign-in', component: Elsewhere },
        { path: 'sign-up', component: Elsewhere },
        { path: '', component: Elsewhere },
      ]),
    ],
  });
  auth.emitSession(signedIn ? { id: 's1' } : null);
  const harness = await RouterTestingHarness.create('/teams/join');
  const page = harness.routeNativeElement!;
  const flush = async () => {
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.fixture.whenStable();
    TestBed.tick();
  };
  const sub = (name: string) => convex.activeSubscriptions.find((s) => s.name === name);
  const emitInvite = async (value: unknown) => {
    sub(GET_BY_TOKEN)?.emit(value);
    await flush();
  };
  const signIn = async (name = 'Devon Park') => {
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    sub(ME)?.emit({ name });
    await flush();
  };
  const accept = () =>
    [...page.querySelectorAll('button')].find((b) => text(b)?.startsWith('Accept invite'));
  const call = () => convex.calls.find((c) => c.name === ACCEPT);
  return { convex, auth, harness, page, flush, sub, emitInvite, signIn, accept, call };
}

const links = (page: HTMLElement) =>
  [...page.querySelectorAll('main a')].map((a) => [text(a), a.getAttribute('href')]);

describe('JoinTeamPage', () => {
  it('renders in the public layout: top bar and footer, no sidebar', async () => {
    const { page, flush } = await open();
    await flush();
    expect(page.firstElementChild?.tagName).toBe('APP-PUBLIC-LAYOUT');
    expect(page.querySelector('main#main')).not.toBeNull();
    expect(page.querySelector('button[aria-label="Open navigation"]')).toBeNull();
  });

  describe('tokens', () => {
    it('with no token stored, shows the invalid view and never asks getByToken', async () => {
      const { page, flush, convex } = await open({ token: null });
      await flush();
      expect(text(page.querySelector('h1'))).toBe('This invite link can’t be used');
      expect(text(page.querySelector('main p'))).toBe(
        'It may have expired, been revoked, or already been accepted. Ask the team’s captain for a new link.',
      );
      expect(convex.subscriptions.filter((s) => s.name === GET_BY_TOKEN)).toEqual([]);
      expect(TestBed.inject(Title).getTitle()).toBe('Invite unavailable | Omni League');
      expect(links(page)).toEqual([['Go to the home page', '/']]);
    });

    it('reads only the team token: a staff token in the same tab is never sent and stays stored', async () => {
      sessionStorage.setItem(INVITE_TOKEN_KEY, STAFF_TOKEN);
      const { page, flush, convex } = await open({ token: null });
      await flush();
      expect(convex.subscriptions.filter((s) => s.name === GET_BY_TOKEN)).toEqual([]);
      expect(text(page.querySelector('h1'))).toBe('This invite link can’t be used');
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(STAFF_TOKEN);
    });

    it('a link opened on the open page is captured: the page reads the new token and the URL stays clean', async () => {
      const { page, flush, sub, emitInvite, harness } = await open({ token: null });
      await flush();
      await harness.navigateByUrl(`/teams/join#${TOKEN}`);
      await flush();
      expect(TestBed.inject(Router).url).toBe('/teams/join');
      expect(sub(GET_BY_TOKEN)?.args).toEqual({ token: TOKEN });
      await emitInvite(INVITE);
      expect(text(page.querySelector('h1'))).toBe('Join Sand Sharks');
      const hrefs = [...page.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
      expect(hrefs.filter((href) => href.includes(TOKEN) || href.includes('%23'))).toEqual([]);
    });
  });

  describe('checking', () => {
    it('shows a skeleton of the invite card with five detail rows and a status', async () => {
      const { page, flush, sub } = await open();
      await flush();
      expect(sub(GET_BY_TOKEN)?.args).toEqual({ token: TOKEN });
      const card = page.querySelector('main [data-testid="invite-skeleton"]');
      expect(card?.querySelectorAll('[data-skeleton="row"]')).toHaveLength(5);
      expect(text(card?.querySelector('[role="status"]'))).toBe('Checking your invite…');
      expect(page.querySelector('h1')).toBeNull();
    });
  });

  describe('signed out', () => {
    it('shows the team, season, league, organization, and expiry, with sign-up and sign-in that carry only returnTo', async () => {
      const { page, emitInvite } = await open();
      await emitInvite(INVITE);
      expect(text(page.querySelector('h1'))).toBe('Join Sand Sharks');
      expect(text(page.querySelector('main p:nth-of-type(1)'))).toBe('Team invite');
      expect(text(page.querySelector('main p:nth-of-type(2)'))).toBe(
        'You’re invited to play on this team.',
      );
      const rows = [...page.querySelectorAll('dl > div')].map((row) => [
        text(row.querySelector('dt')),
        text(row.querySelector('dd')),
      ]);
      expect(rows).toEqual([
        ['Team', 'Sand Sharks'],
        ['Season', 'Summer 2027'],
        ['League', 'Sunday Reverse Coed 4s'],
        ['Organization', 'Gulf Coast Sport & Social'],
        ['Expires', 'Oct 23, 2026'],
      ]);
      expect(links(page)).toEqual([
        ['Create an account', '/sign-up?returnTo=%2Fteams%2Fjoin'],
        ['Sign in', '/sign-in?returnTo=%2Fteams%2Fjoin'],
      ]);
      expect(page.querySelector('button')).toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe('Team invite | Omni League');
    });
  });

  describe('signed in', () => {
    it('shows who is signed in and Accept invite, and sends only the token', async () => {
      const { page, emitInvite, signIn, accept, flush, call } = await open({ signedIn: true });
      await emitInvite(INVITE);
      await signIn();
      expect(text(page.querySelector('main .px-5.pt-5 p'))).toBe('Signed in as Devon Park.');
      expect(page.querySelector('main a')).toBeNull();
      accept()?.click();
      await flush();
      expect(call()?.kind).toBe('mutation');
      expect(call()?.args).toEqual({ token: TOKEN });
    });

    it('while accepting: aria-disabled, "Accepting…", a status, and a second press sends nothing', async () => {
      const { page, emitInvite, signIn, accept, flush, convex } = await open({ signedIn: true });
      await emitInvite(INVITE);
      await signIn();
      accept()?.click();
      await flush();
      const button = [...page.querySelectorAll('button')].find((b) => text(b) === 'Accepting…');
      expect(button?.getAttribute('aria-disabled')).toBe('true');
      expect(text(page.querySelector('main [role="status"]'))).toBe('Accepting the invite.');
      button?.click();
      await flush();
      expect(convex.calls.filter((c) => c.name === ACCEPT)).toHaveLength(1);
    });

    it('on success: the accepted view names the season and captain, focus on the heading, the token deleted, a link to the team page', async () => {
      const { page, emitInvite, signIn, accept, flush, call } = await open({ signedIn: true });
      await emitInvite(INVITE);
      await signIn();
      accept()?.click();
      await flush();
      await emitInvite({ status: 'invalid' });
      call()?.resolve(JOINED);
      await flush();
      const heading = page.querySelector('h1');
      expect(text(heading)).toBe('You’re on Sand Sharks');
      expect(document.activeElement).toBe(heading);
      expect(text(page.querySelector('main p'))).toBe(
        'You’re on the roster for Summer 2027. Tasha Greene is the captain.',
      );
      expect(links(page)).toEqual([['Go to Sand Sharks', '/app/teams/team123']]);
      expect(sessionStorage.getItem(TEAM_INVITE_TOKEN_KEY)).toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe('Joined Sand Sharks | Omni League');
    });
  });

  describe('refusals', () => {
    async function refuse(failure: Error) {
      const ctx = await open({ signedIn: true });
      await ctx.emitInvite(INVITE);
      await ctx.signIn();
      ctx.accept()?.click();
      await ctx.flush();
      ctx.call()?.reject(failure);
      await ctx.flush();
      return ctx;
    }
    const alertOf = (page: HTMLElement) => {
      const alert = page.querySelector('[role="alert"]');
      return {
        alert,
        title: text(alert?.querySelector('[data-slot="alert-title"]')),
        description: text(alert?.querySelector('[data-slot="alert-description"]')),
      };
    };

    it('a different email: a neutral alert takes focus, and "Sign in with a different account" signs out to /sign-in?returnTo=/teams/join, keeping the token', async () => {
      const { page, flush, auth } = await refuse(new ConvexError({ code: 'emailMismatch' }));
      const { alert, title, description } = alertOf(page);
      expect([title, description]).toEqual([
        'This invite was sent to a different email address.',
        'Sign in with that address to accept it.',
      ]);
      expect(alert?.className).not.toContain('text-destructive');
      expect(document.activeElement).toBe(alert);
      expect([...page.querySelectorAll('button')].map((b) => text(b))).toEqual([
        'Sign in with a different account',
      ]);
      page.querySelector('button')?.click();
      await flush();
      await flush();
      expect(auth.signOuts).toBe(1);
      expect(TestBed.inject(Router).url).toBe('/sign-in?returnTo=%2Fteams%2Fjoin');
      expect(sessionStorage.getItem(TEAM_INVITE_TOKEN_KEY)).toBe(TOKEN);
    });

    it('already on this team: a neutral alert and a link to the team page, no Accept, and the token deleted', async () => {
      const { page } = await refuse(
        new ConvexError({ code: 'alreadyOnTeam', teamName: 'Sand Sharks', teamId: 'team123' }),
      );
      const { alert, title, description } = alertOf(page);
      expect([title, description]).toEqual([
        'You’re already on Sand Sharks.',
        'This invite can’t add you twice.',
      ]);
      expect(alert?.className).not.toContain('text-destructive');
      expect(document.activeElement).toBe(alert);
      expect(page.querySelector('button')).toBeNull();
      expect(links(page)).toEqual([['Go to Sand Sharks', '/app/teams/team123']]);
      expect(sessionStorage.getItem(TEAM_INVITE_TOKEN_KEY)).toBeNull();
    });

    it('on another team in the season: names that team, links to your teams, no Accept', async () => {
      const { page } = await refuse(
        new ConvexError({
          code: 'alreadyOnAnotherTeam',
          teamName: 'Net Results',
          message: 'Already on Net Results in this season.',
        }),
      );
      const { title, description } = alertOf(page);
      expect([title, description]).toEqual([
        'You’re already on Net Results in this season.',
        'Each person plays on one team per season, so you can’t join Sand Sharks.',
      ]);
      expect(page.querySelector('button')).toBeNull();
      expect(links(page)).toEqual([['Go to your teams', '/app']]);
      expect(sessionStorage.getItem(TEAM_INVITE_TOKEN_KEY)).toBeNull();
    });

    it('the invite became invalid: the invalid view, and the token is deleted', async () => {
      const { page } = await refuse(new ConvexError({ code: 'invalid' }));
      expect(text(page.querySelector('h1'))).toBe('This invite link can’t be used');
      expect(sessionStorage.getItem(TEAM_INVITE_TOKEN_KEY)).toBeNull();
    });

    it('an unexpected error: a destructive alert takes focus, and Accept invite stays for a retry', async () => {
      const { page, accept, flush, convex } = await refuse(new Error('boom'));
      const { alert, title, description } = alertOf(page);
      expect([title, description]).toEqual([
        'The invite could not be accepted.',
        'Check your connection and try again.',
      ]);
      expect(alert?.className).toContain('text-destructive');
      expect(document.activeElement).toBe(alert);
      expect(sessionStorage.getItem(TEAM_INVITE_TOKEN_KEY)).toBe(TOKEN);
      accept()?.click();
      await flush();
      expect(convex.calls.filter((c) => c.name === ACCEPT)).toHaveLength(2);
      expect(page.querySelector('[role="alert"]')).toBeNull();
    });

    it('offline after the press: the offline alert, and Accept invite stays', async () => {
      const { page, accept } = await refuse(new ConvexOfflineError());
      expect(text(page.querySelector('[role="alert"] [data-slot="alert-title"]'))).toBe(
        "You're offline. Nothing was sent.",
      );
      expect(accept()).toBeDefined();
    });

    it('offline before the press: a press shows the offline alert and sends nothing', async () => {
      const { page, accept, emitInvite, signIn, flush, convex } = await open({ signedIn: true });
      await emitInvite(INVITE);
      await signIn();
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
      await flush();
      expect(accept()?.getAttribute('aria-disabled')).toBe('true');
      accept()?.click();
      await flush();
      expect(convex.calls.filter((c) => c.name === ACCEPT)).toEqual([]);
      expect(document.activeElement).toBe(page.querySelector('[role="alert"]'));
    });

    it('a roster refusal link opened again clears the stored token again', async () => {
      const { flush, harness } = await refuse(
        new ConvexError({ code: 'alreadyOnAnotherTeam', teamName: 'Net Results' }),
      );
      await harness.navigateByUrl(`/teams/join#${TOKEN}`);
      await flush();
      expect(sessionStorage.getItem(TEAM_INVITE_TOKEN_KEY)).toBeNull();
    });
  });

  describe('the invite could not be loaded', () => {
    it('shows the temporarily-unavailable view with a Try again link back to the page', async () => {
      const { page, flush, sub } = await open();
      await flush();
      sub(GET_BY_TOKEN)?.fail(new Error('down'));
      await flush();
      expect(text(page.querySelector('h1'))).toBe('This page is temporarily unavailable');
      const retry = [...page.querySelectorAll('main a')].find((a) => text(a) === 'Try again');
      expect(retry?.getAttribute('href')).toBe('/teams/join');
    });
  });
});
