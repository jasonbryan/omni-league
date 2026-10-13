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
import { AcceptInvitePage } from './accept-invite-page';
import { captureInviteToken } from './capture-invite-token';
import { INVITE_TOKEN_KEY } from './invite-token-store';

// /invites/accept (#70), design/mockups/70-accept-invite.html states 1 to 10.

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP-_0123456';
const GET_BY_TOKEN = 'invites:getByToken';
const ACCEPT = 'invites:accept';
const ME = 'users:me';
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const EXPIRES = NOW + 12 * 24 * 60 * 60 * 1000;

const ORGANIZER = {
  status: 'valid',
  organizationName: 'Coastal Bend Rec Club',
  role: 'leagueOrganizer',
  leagueNames: ['Coed 7v7 Rec'],
  expiresAt: EXPIRES,
};
const ADMIN = { ...ORGANIZER, role: 'orgAdmin', leagueNames: [] };

@Component({ template: 'elsewhere' })
class Elsewhere {}

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim();

afterEach(() => sessionStorage.clear());

async function open(options: { token?: string | null; signedIn?: boolean } = {}) {
  const { token = TOKEN, signedIn = false } = options;
  if (token) sessionStorage.setItem(INVITE_TOKEN_KEY, token);
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
        { path: 'app', component: Elsewhere },
        { path: 'sign-in', component: Elsewhere },
        { path: 'sign-up', component: Elsewhere },
        { path: '', component: Elsewhere },
      ]),
    ],
  });
  auth.emitSession(signedIn ? { id: 's1' } : null);
  const harness = await RouterTestingHarness.create('/invites/accept');
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
  const signIn = async (name = 'Jordan Mills') => {
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

describe('AcceptInvitePage', () => {
  describe('no token', () => {
    it('shows the invalid view and never asks getByToken (a bookmarked /invites/accept)', async () => {
      const { page, flush, convex } = await open({ token: null });
      await flush();
      expect(text(page.querySelector('h1'))).toBe('This invite link can’t be used');
      expect(text(page.querySelector('main p'))).toContain(
        'Ask the org admin who invited you for a new link.',
      );
      expect(convex.subscriptions.filter((s) => s.name === GET_BY_TOKEN)).toEqual([]);
      expect(TestBed.inject(Title).getTitle()).toBe('Invite unavailable | Omni League');
      const home = [...page.querySelectorAll('a')].find((a) => text(a) === 'Go to the home page');
      expect(home?.getAttribute('href')).toBe('/');
    });
  });

  describe('checking', () => {
    it('asks getByToken with the stored token and says "Checking your invite…" in a status region', async () => {
      const { page, flush, sub } = await open();
      await flush();
      expect(sub(GET_BY_TOKEN)?.args).toEqual({ token: TOKEN });
      const status = page.querySelector('main [role="status"]');
      expect(text(status)).toBe('Checking your invite…');
      expect(page.querySelector('h1')).toBeNull();
    });

    it('shows a skeleton of the invite card (icon, heading, three detail rows, a button) and no spinner', async () => {
      const { page, flush } = await open();
      await flush();
      const card = page.querySelector('main [data-testid="invite-skeleton"]');
      expect(card).not.toBeNull();
      expect(card?.querySelectorAll('[data-skeleton="icon"]')).toHaveLength(1);
      expect(card?.querySelectorAll('[data-skeleton="heading"]')).toHaveLength(1);
      expect(card?.querySelectorAll('[data-skeleton="row"]')).toHaveLength(3);
      expect(card?.querySelectorAll('[data-skeleton="button"]')).toHaveLength(1);
      for (const block of card?.querySelectorAll('[data-skeleton]') ?? []) {
        expect(block.className).toContain('bg-muted');
        expect(block.className).toContain('motion-safe:animate-pulse');
        expect(block.closest('[aria-hidden="true"]')).not.toBeNull();
      }
      // The only live region is the sr-only status; nothing spins.
      const statuses = page.querySelectorAll('main [role="status"]');
      expect(statuses).toHaveLength(1);
      expect(statuses[0].className).toContain('sr-only');
      expect(page.querySelector('main .animate-spin, main [class*="animate-spin"]')).toBeNull();
      expect(page.querySelector('main ng-icon')).toBeNull();
    });

    it('keeps the skeleton while the session is still unknown after the invite arrived', async () => {
      const { page, flush, emitInvite } = await open({ signedIn: true });
      await emitInvite(ORGANIZER);
      await flush();
      // Signed in, but the account has not answered yet.
      expect(page.querySelector('[data-testid="invite-skeleton"]')).not.toBeNull();
      expect(page.querySelector('h1')).toBeNull();
    });

    it('a link opened on the open page is captured: the page reads the new token and the URL stays clean', async () => {
      const { page, flush, sub, emitInvite, harness } = await open({ token: null });
      await flush();
      expect(text(page.querySelector('h1'))).toBe('This invite link can’t be used');
      await harness.navigateByUrl(`/invites/accept#${TOKEN}`);
      await flush();
      expect(TestBed.inject(Router).url).toBe('/invites/accept');
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
      expect(sub(GET_BY_TOKEN)?.args).toEqual({ token: TOKEN });
      await emitInvite(ORGANIZER);
      expect(text(page.querySelector('h1'))).toBe('Join Coastal Bend Rec Club');
      const hrefs = [...page.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
      expect(hrefs.filter((href) => href.includes(TOKEN) || href.includes('%23'))).toEqual([]);
    });

    it('the URL and the stored token carry the fragment nowhere', async () => {
      const { flush } = await open();
      await flush();
      expect(TestBed.inject(Router).url).toBe('/invites/accept');
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
    });
  });

  describe('signed out', () => {
    it('shows the organization, role, league, and expiry, with sign-up and sign-in that carry only returnTo', async () => {
      const { page, emitInvite } = await open();
      await emitInvite(ORGANIZER);
      expect(text(page.querySelector('h1'))).toBe('Join Coastal Bend Rec Club');
      expect(text(page.querySelector('main p:nth-of-type(1)'))).toBe('Staff invite');
      expect(text(page.querySelector('main p:nth-of-type(2)'))).toBe(
        'You’re invited to run a league as a league organizer.',
      );
      const rows = [...page.querySelectorAll('dl > div')].map((row) => [
        text(row.querySelector('dt')),
        text(row.querySelector('dd')),
      ]);
      expect(rows).toEqual([
        ['Organization', 'Coastal Bend Rec Club'],
        ['Role', 'League organizer'],
        ['League', 'Coed 7v7 Rec'],
        ['Expires', 'Oct 23, 2026'],
      ]);
      expect(text(page.querySelector('main .px-5.pt-5'))).toContain(
        'To accept, create an account or sign in with the email address this invite was sent to.',
      );
      const links = [...page.querySelectorAll('main a')].map((a) => [
        text(a),
        a.getAttribute('href'),
      ]);
      expect(links).toEqual([
        ['Create an account', '/sign-up?returnTo=%2Finvites%2Faccept'],
        ['Sign in', '/sign-in?returnTo=%2Finvites%2Faccept'],
      ]);
      expect(page.querySelector('button')).toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe('Staff invite | Omni League');
    });

    it('names several leagues with "Leagues"', async () => {
      const { page, emitInvite } = await open();
      await emitInvite({ ...ORGANIZER, leagueNames: ['Coed 7v7 Rec', 'Sand 2s'] });
      const row = [...page.querySelectorAll('dl > div')].find(
        (r) => text(r.querySelector('dt')) === 'Leagues',
      );
      expect(text(row?.querySelector('dd'))).toBe('Coed 7v7 Rec and Sand 2s');
      expect(text(page.querySelector('main p:nth-of-type(2)'))).toBe(
        'You’re invited to run leagues as a league organizer.',
      );
    });

    it('an org admin invite reads Org admin and has no League row', async () => {
      const { page, emitInvite } = await open();
      await emitInvite(ADMIN);
      expect(text(page.querySelector('main p:nth-of-type(2)'))).toBe(
        'You’re invited to help manage the organization as an org admin.',
      );
      expect([...page.querySelectorAll('dl dt')].map((dt) => text(dt))).toEqual([
        'Organization',
        'Role',
        'Expires',
      ]);
      expect(text(page.querySelectorAll('dl dd')[1])).toBe('Org admin');
    });

    it('shows the checking view, not the sign-in buttons, until the session answers', async () => {
      const { page, flush, auth, emitInvite } = await open({ signedIn: false });
      auth.emitPending();
      await emitInvite(ORGANIZER);
      await flush();
      expect(page.querySelector('main a')).not.toBeNull();
    });
  });

  describe('signed in', () => {
    it('shows who is signed in and an Accept invite button, and sends only the token', async () => {
      const { page, emitInvite, signIn, accept, flush, call } = await open({ signedIn: true });
      await emitInvite(ORGANIZER);
      await signIn();
      expect(text(page.querySelector('main .px-5.pt-5 p'))).toBe('Signed in as Jordan Mills.');
      expect(page.querySelector('main a')).toBeNull();
      expect(accept()?.getAttribute('aria-disabled')).toBeNull();
      expect(page.querySelector('main [role="status"]')?.textContent?.trim()).toBe('');

      accept()?.click();
      await flush();
      expect(call()?.kind).toBe('mutation');
      expect(call()?.args).toEqual({ token: TOKEN });
    });

    it('while accepting: aria-disabled, "Accepting…", a status says "Accepting the invite.", a second press sends nothing', async () => {
      const { page, emitInvite, signIn, accept, flush, convex } = await open({ signedIn: true });
      await emitInvite(ORGANIZER);
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

    it('on success: the accepted view, focus on the heading, the token deleted, a link to the league', async () => {
      const { page, emitInvite, signIn, accept, flush, call } = await open({ signedIn: true });
      await emitInvite(ORGANIZER);
      await signIn();
      accept()?.click();
      await flush();
      call()?.resolve({
        organizationName: 'Coastal Bend Rec Club',
        organizationSlug: 'coastal-bend',
        role: 'leagueOrganizer',
        leagueNames: ['Coed 7v7 Rec'],
        leagues: [{ name: 'Coed 7v7 Rec', slug: 'coed-7v7-rec' }],
      });
      await flush();
      const heading = page.querySelector('h1');
      expect(text(heading)).toBe('You’re on the staff of Coastal Bend Rec Club');
      expect(document.activeElement).toBe(heading);
      expect(heading?.getAttribute('tabindex')).toBe('-1');
      expect(text(page.querySelector('main p'))).toBe(
        'You’re a league organizer for Coed 7v7 Rec.',
      );
      const link = [...page.querySelectorAll('a')].find((a) => text(a) === 'Open Coed 7v7 Rec');
      expect(link?.getAttribute('href')).toBe(
        '/app/organizations/coastal-bend/leagues/coed-7v7-rec',
      );
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe('Invite accepted | Omni League');
    });

    it('an org admin acceptance says so', async () => {
      const { page, emitInvite, signIn, accept, flush, call } = await open({ signedIn: true });
      await emitInvite(ADMIN);
      await signIn();
      accept()?.click();
      await flush();
      call()?.resolve({
        organizationName: 'Coastal Bend Rec Club',
        organizationSlug: 'coastal-bend',
        role: 'orgAdmin',
        leagueNames: [],
        leagues: [],
      });
      await flush();
      expect(text(page.querySelector('main p'))).toBe('You’re an org admin.');
      const link = [...page.querySelectorAll('main a')].find((a) => text(a)?.startsWith('Open'));
      expect(text(link)).toBe('Open Coastal Bend Rec Club');
      expect(link?.getAttribute('href')).toBe('/app/organizations/coastal-bend');
      expect(TestBed.inject(Router).url).toBe('/invites/accept');
    });

    describe('where the primary button goes after accepting, issue 212', () => {
      async function acceptWith(invite: unknown, result: unknown) {
        const ctx = await open({ signedIn: true });
        await ctx.emitInvite(invite);
        await ctx.signIn();
        ctx.accept()?.click();
        await ctx.flush();
        ctx.call()?.resolve(result);
        await ctx.flush();
        return [...ctx.page.querySelectorAll('main a')].map((a) => ({
          label: text(a),
          href: a.getAttribute('href'),
        }));
      }

      it('several leagues: "Go to your organizations" to /app', async () => {
        const links = await acceptWith(
          { ...ORGANIZER, leagueNames: ['Coed 7v7 Rec', 'Sand 2s'] },
          {
            organizationName: 'Coastal Bend Rec Club',
            organizationSlug: 'coastal-bend',
            role: 'leagueOrganizer',
            leagueNames: ['Coed 7v7 Rec', 'Sand 2s'],
            leagues: [
              { name: 'Coed 7v7 Rec', slug: 'coed-7v7-rec' },
              { name: 'Sand 2s', slug: 'sand-2s' },
            ],
          },
        );
        expect(links).toEqual([{ label: 'Go to your organizations', href: '/app' }]);
      });

      it('no league left (all deleted since the invite): "Go to your organizations" to /app', async () => {
        const links = await acceptWith(ORGANIZER, {
          organizationName: 'Coastal Bend Rec Club',
          organizationSlug: 'coastal-bend',
          role: 'leagueOrganizer',
          leagueNames: [],
          leagues: [],
        });
        expect(links).toEqual([{ label: 'Go to your organizations', href: '/app' }]);
      });

      it('an answer without slugs (a backend one release behind): "Go to your organizations" to /app', async () => {
        const links = await acceptWith(ORGANIZER, {
          organizationName: 'Coastal Bend Rec Club',
          role: 'leagueOrganizer',
          leagueNames: ['Coed 7v7 Rec'],
        });
        expect(links).toEqual([{ label: 'Go to your organizations', href: '/app' }]);
      });

      it('the destination holds only slugs: no token in the link', async () => {
        const links = await acceptWith(ADMIN, {
          organizationName: 'Coastal Bend Rec Club',
          organizationSlug: 'coastal-bend',
          role: 'orgAdmin',
          leagueNames: [],
          leagues: [],
        });
        expect(links.map((l) => l.href).join(' ')).not.toContain(TOKEN);
      });
    });

    it('stays on the accepted view when the invite then reads as invalid', async () => {
      const { page, emitInvite, signIn, accept, flush, call } = await open({ signedIn: true });
      await emitInvite(ORGANIZER);
      await signIn();
      accept()?.click();
      await flush();
      await emitInvite({ status: 'invalid' });
      expect(page.querySelector('h1')?.textContent).toContain('Join Coastal Bend Rec Club');
      call()?.resolve({
        organizationName: 'Coastal Bend Rec Club',
        organizationSlug: 'coastal-bend',
        role: 'leagueOrganizer',
        leagueNames: ['Coed 7v7 Rec'],
        leagues: [{ name: 'Coed 7v7 Rec', slug: 'coed-7v7-rec' }],
      });
      await flush();
      await emitInvite({ status: 'invalid' });
      expect(text(page.querySelector('h1'))).toBe('You’re on the staff of Coastal Bend Rec Club');
    });
  });

  describe('refusals', () => {
    async function refuse(failure: Error) {
      const ctx = await open({ signedIn: true });
      await ctx.emitInvite(ORGANIZER);
      await ctx.signIn();
      ctx.accept()?.click();
      await ctx.flush();
      ctx.call()?.reject(failure);
      await ctx.flush();
      return ctx;
    }

    it('a different email: the alert takes focus, the invite stays on screen, and the switch button is below it', async () => {
      const { page } = await refuse(new ConvexError({ code: 'emailMismatch' }));
      const alert = page.querySelector('[role="alert"]');
      expect(text(alert?.querySelector('[data-slot="alert-title"]'))).toBe(
        'This invite was sent to a different email address.',
      );
      expect(text(alert?.querySelector('[data-slot="alert-description"]'))).toBe(
        'Sign in with that address to accept it.',
      );
      expect(document.activeElement).toBe(alert);
      expect(text(page.querySelector('h1'))).toBe('Join Coastal Bend Rec Club');
      const buttons = [...page.querySelectorAll('button')].map((b) => text(b));
      expect(buttons).toEqual(['Sign in with a different account']);
      const switchButton = page.querySelector('button');
      expect(switchButton?.className).toContain('bg-primary');
      expect(switchButton?.className).not.toContain('bg-background');
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
    });

    it('"Sign in with a different account" signs out, opens /sign-in?returnTo=/invites/accept, and keeps the token', async () => {
      const { page, flush, auth } = await refuse(new ConvexError({ code: 'emailMismatch' }));
      [...page.querySelectorAll('button')]
        .find((b) => text(b) === 'Sign in with a different account')
        ?.click();
      await flush();
      await flush();
      expect(auth.signOuts).toBe(1);
      expect(TestBed.inject(Router).url).toBe('/sign-in?returnTo=%2Finvites%2Faccept');
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
      expect(TestBed.inject(AuthService).signedIn()).toBe(false);
    });

    it('already a member: a neutral alert that takes focus and a link to /app, no Accept', async () => {
      const { page } = await refuse(new ConvexError({ code: 'alreadyMember' }));
      const alert = page.querySelector('[role="alert"]');
      expect(text(alert?.querySelector('[data-slot="alert-title"]'))).toBe(
        'You’re already on the staff of Coastal Bend Rec Club.',
      );
      expect(text(alert?.querySelector('[data-slot="alert-description"]'))).toBe(
        'This invite can’t change your role. Ask an org admin if it should change.',
      );
      expect(document.activeElement).toBe(alert);
      expect(alert?.className).toContain('text-card-foreground');
      expect(alert?.className).not.toContain('text-destructive');
      expect(page.querySelector('button')).toBeNull();
      const link = [...page.querySelectorAll('main a')].find(
        (a) => text(a) === 'Go to your organizations',
      );
      expect(link?.getAttribute('href')).toBe('/app');
      expect(link?.className).toContain('bg-background');
      expect(link?.className).not.toContain('bg-primary');
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBeNull();
    });

    it('the invite became invalid: the invalid view, and the token is deleted', async () => {
      const { page } = await refuse(new ConvexError({ code: 'invalid' }));
      expect(text(page.querySelector('h1'))).toBe('This invite link can’t be used');
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBeNull();
    });

    it('an unexpected error: a destructive alert that takes focus, and Accept invite stays for a retry', async () => {
      const { page, accept } = await refuse(new Error('boom'));
      const alert = page.querySelector('[role="alert"]');
      expect(text(alert?.querySelector('[data-slot="alert-title"]'))).toBe(
        'The invite could not be accepted.',
      );
      expect(text(alert?.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
      expect(alert?.className).toContain('text-destructive');
      expect(document.activeElement).toBe(alert);
      expect(accept()).toBeDefined();
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
    });

    it('offline: "You\'re offline. Nothing was sent." and Accept invite stays', async () => {
      const { page, accept } = await refuse(new ConvexOfflineError());
      expect(text(page.querySelector('[role="alert"] [data-slot="alert-title"]'))).toBe(
        "You're offline. Nothing was sent.",
      );
      expect(accept()).toBeDefined();
    });

    describe('offline before the press (design/mockups/88-offline-note.html states 2 and 3)', () => {
      async function goOffline(flush: () => Promise<void>) {
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
        window.dispatchEvent(new Event('offline'));
        await flush();
      }

      it('Accept invite looks disabled but stays focusable', async () => {
        const { accept, emitInvite, signIn, flush } = await open({ signedIn: true });
        await emitInvite(ORGANIZER);
        await signIn();
        expect(accept()?.getAttribute('aria-disabled')).toBeNull();
        expect(accept()?.classList.contains('opacity-50')).toBe(false);
        await goOffline(flush);
        expect(accept()?.getAttribute('aria-disabled')).toBe('true');
        expect(accept()?.classList.contains('opacity-50')).toBe(true);
        expect(accept()?.hasAttribute('disabled')).toBe(false);
      });

      it('a press shows the offline alert, takes focus to it, and sends nothing', async () => {
        const { page, accept, emitInvite, signIn, flush, convex } = await open({ signedIn: true });
        await emitInvite(ORGANIZER);
        await signIn();
        await goOffline(flush);
        accept()?.click();
        await flush();
        expect(convex.calls.filter((c) => c.name === ACCEPT)).toEqual([]);
        const alert = page.querySelector('[role="alert"]');
        expect(text(alert?.querySelector('[data-slot="alert-title"]'))).toBe(
          "You're offline. Nothing was sent.",
        );
        expect(document.activeElement).toBe(alert);
        expect(accept()).toBeDefined();
        expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
      });

      it('back online, the press sends the token and clears the alert', async () => {
        const { page, accept, emitInvite, signIn, flush, call } = await open({ signedIn: true });
        await emitInvite(ORGANIZER);
        await signIn();
        await goOffline(flush);
        accept()?.click();
        await flush();
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
        window.dispatchEvent(new Event('online'));
        await flush();
        expect(accept()?.getAttribute('aria-disabled')).toBeNull();
        accept()?.click();
        await flush();
        expect(call()?.args).toEqual({ token: TOKEN });
        expect(page.querySelector('[role="alert"]')).toBeNull();
      });
    });

    it('a retry after an error sends the token again and clears the alert', async () => {
      const { page, accept, flush, convex } = await refuse(new Error('boom'));
      accept()?.click();
      await flush();
      expect(convex.calls.filter((c) => c.name === ACCEPT)).toHaveLength(2);
      expect(page.querySelector('[role="alert"]')).toBeNull();
    });
  });

  describe('a spent link opened again on the open page', () => {
    it('an invalid link clears the stored token again', async () => {
      const { page, emitInvite, flush, harness } = await open();
      await emitInvite({ status: 'invalid' });
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBeNull();
      await harness.navigateByUrl(`/invites/accept#${TOKEN}`);
      await flush();
      expect(text(page.querySelector('h1'))).toBe('This invite link can’t be used');
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBeNull();
    });

    it('an already-member link clears the stored token again', async () => {
      const { page, emitInvite, signIn, accept, flush, call, harness } = await open({
        signedIn: true,
      });
      await emitInvite(ORGANIZER);
      await signIn();
      accept()?.click();
      await flush();
      call()?.reject(new ConvexError({ code: 'alreadyMember' }));
      await flush();
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBeNull();
      await harness.navigateByUrl(`/invites/accept#${TOKEN}`);
      await flush();
      expect(page.querySelector('[role="alert"]')).not.toBeNull();
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBeNull();
    });
  });

  describe('invalid', () => {
    it.each([['unknown, revoked, expired, or accepted token alike', { status: 'invalid' }]])(
      'shows the invalid view for %s, signed out or in, and deletes the token',
      async (_, answer) => {
        const { page, emitInvite } = await open();
        await emitInvite(answer);
        expect(text(page.querySelector('h1'))).toBe('This invite link can’t be used');
        expect(text(page.querySelector('main p'))).toBe(
          'It may have expired, been revoked, or already been accepted. Ask the org admin who invited you for a new link.',
        );
        expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBeNull();
        expect(page.querySelector('dl')).toBeNull();
      },
    );
  });

  describe('the invite could not be loaded', () => {
    it('shows the temporarily-unavailable view with a heading and a Try again link back to the page', async () => {
      const { page, flush, sub } = await open();
      await flush();
      sub(GET_BY_TOKEN)?.fail(new Error('down'));
      await flush();
      expect(text(page.querySelector('h1'))).toBe('This page is temporarily unavailable');
      const retry = [...page.querySelectorAll('main a')].find((a) => text(a) === 'Try again');
      expect(retry?.getAttribute('href')).toBe('/invites/accept');
      expect(sessionStorage.getItem(INVITE_TOKEN_KEY)).toBe(TOKEN);
    });
  });
});
