import { Component } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { AdminArea } from './admin-area';
import {
  adminRoutes,
  COASTAL,
  forbiddenError,
  GET_ADMIN_CONTEXT,
  LIST_FOR_ADMIN,
  ME,
  openAdmin,
  text,
} from './testing/admin-harness';

@Component({ template: '<p id="child">child</p>' })
class Child {}

const ROUTES = adminRoutes(AdminArea, [
  { path: '', component: Child },
  { path: 'locations', component: Child },
]);
const OVERVIEW = `/app/organizations/${COASTAL.slug}`;
const LIST_MINE = 'organizations:listMine';
// The account row and the slim bar's initials each ask for it.
const ACCOUNT = [ME, ME];

describe('AdminArea', () => {
  describe('loading (state 4)', () => {
    it('asks nothing until Convex has accepted the token, and shows the polite status', async () => {
      const { convex, page } = await openAdmin(ROUTES, OVERVIEW);
      TestBed.tick();
      expect(convex.subscriptions).toEqual([]);
      expect(text(page.querySelector('main [role="status"]'))).toBe('Loading the admin area.');
      expect(page.querySelector('#child')).toBeNull();
    });

    it('asks organizations.getAdminContext with the slug, and nothing else but the account row’s users.me, once the token is accepted', async () => {
      const { convex, acceptToken } = await openAdmin(ROUTES, OVERVIEW);
      acceptToken();
      expect(convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([
        [GET_ADMIN_CONTEXT, { slug: COASTAL.slug }],
        [ME, {}],
        [ME, {}],
      ]);
    });

    it('draws the sidebar and panel placeholders, with the menu button and no navigation until the sidebar is known', async () => {
      const { page } = await openAdmin(ROUTES, OVERVIEW);
      expect(page.querySelector('button[aria-label="Open navigation"]')).not.toBeNull();
      expect(page.querySelector('nav')).toBeNull();
      expect(text(page.querySelector('aside [role="status"], [role="status"]'))).toBeTruthy();
      expect(
        page.querySelectorAll('[aria-hidden="true"].motion-safe\\:animate-pulse').length,
      ).toBeGreaterThan(5);
    });
  });

  describe('an org admin (states 1 and 3)', () => {
    async function ready(url = OVERVIEW) {
      const opened = await openAdmin(ROUTES, url);
      opened.acceptToken();
      opened.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
      await opened.flush();
      return opened;
    }

    it('shows the child route in the shell, with the menu button and the admin sidebar', async () => {
      const { page } = await ready();
      expect(page.querySelector('main #child')).not.toBeNull();
      expect(page.querySelector('main [role="status"]')).toBeNull();
      expect(page.querySelector('button[aria-label="Open navigation"]')).not.toBeNull();
      const nav = page.querySelector('nav')!;
      expect(nav.getAttribute('aria-label')).toBe('Coastal Bend Rec Club admin');
    });

    it('requests nothing besides getAdminContext, the account row’s users.me, and the sidebar’s four counts (the child asks for its own data)', async () => {
      const { convex } = await ready();
      expect(convex.activeSubscriptions.map((s) => s.name)).toEqual([
        GET_ADMIN_CONTEXT,
        ...ACCOUNT,
        'leagues:publishedCount',
        'leagues:listForAdmin',
        LIST_FOR_ADMIN,
        'memberships:listForOrganization',
      ]);
    });

    it('names the slim bar after the organization, and has no top bar from 1024px', async () => {
      const { page } = await ready();
      expect(text(page.querySelector('header p'))).toBe('Coastal Bend Rec Club');
      expect(page.querySelector('header')?.classList).toContain('lg:hidden');
    });

    it('serves the locations path through the same shell', async () => {
      const { page } = await ready(`${OVERVIEW}/locations`);
      expect(page.querySelector('main #child')).not.toBeNull();
      expect(page.querySelector('nav [aria-current="page"]')?.getAttribute('href')).toBe(
        `${OVERVIEW}/locations`,
      );
    });
  });

  describe('no access (state 5)', () => {
    async function forbidden(url = OVERVIEW) {
      const opened = await openAdmin(ROUTES, url);
      opened.acceptToken();
      opened.subscription(GET_ADMIN_CONTEXT)!.fail(forbiddenError());
      await opened.flush();
      return opened;
    }

    it('shows the heading, the sentence, and the link to /app, with the home sidebar and no child', async () => {
      const { page, convex } = await forbidden();
      expect(text(page.querySelector('h1'))).toBe('You can’t manage this organization');
      expect(text(page.querySelector('main p'))).toBe(
        'Only its org admins can open the admin area. If you should have access, ask one of them to invite you as an org admin.',
      );
      const link = page.querySelector<HTMLAnchorElement>('main a');
      expect(link?.getAttribute('href')).toBe('/app');
      expect(text(link)).toBe('Go to your organizations');
      expect(page.querySelector('nav')?.getAttribute('aria-label')).toBe('Your account');
      expect(page.querySelector('#child')).toBeNull();
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(convex.activeSubscriptions.map((s) => s.name)).toEqual([
        GET_ADMIN_CONTEXT,
        ...ACCOUNT,
        LIST_MINE,
      ]);
    });

    it('serves the same view for the locations path', async () => {
      const { page } = await forbidden(`${OVERVIEW}/locations`);
      expect(text(page.querySelector('h1'))).toBe('You can’t manage this organization');
    });

    it('sets the page title', async () => {
      await forbidden();
      expect(TestBed.inject(Title).getTitle()).toBe(
        'You can’t manage this organization | Omni League',
      );
    });
  });

  describe('unknown slug (state 6)', () => {
    it('shows the not-found view, with the home sidebar and no other query besides the account row’s and the sidebar’s', async () => {
      const { page, convex, acceptToken, subscription, flush } = await openAdmin(
        ROUTES,
        '/app/organizations/does-not-exist/locations',
      );
      acceptToken();
      expect(subscription(GET_ADMIN_CONTEXT)!.args).toEqual({ slug: 'does-not-exist' });
      subscription(GET_ADMIN_CONTEXT)!.emit(null);
      await flush();
      expect(text(page.querySelector('h1'))).toBe('Page not found');
      expect(text(page.querySelector('main a'))).toBe('Go to the home page');
      expect(page.querySelector('nav')?.getAttribute('aria-label')).toBe('Your account');
      expect(page.querySelector('#child')).toBeNull();
      expect(convex.activeSubscriptions.map((s) => s.name)).toEqual([
        GET_ADMIN_CONTEXT,
        ...ACCOUNT,
        LIST_MINE,
      ]);
    });
  });

  describe('any other failure of the context query', () => {
    it('shows the temporarily-unavailable view, never the error message', async () => {
      const { page, acceptToken, subscription, flush } = await openAdmin(ROUTES, OVERVIEW);
      acceptToken();
      subscription(GET_ADMIN_CONTEXT)!.fail(new Error('Server Error: secret detail'));
      await flush();
      expect(text(page.querySelector('h1'))).toBe('This page is temporarily unavailable');
      expect(page.textContent).not.toContain('secret detail');
      expect(page.querySelector('#child')).toBeNull();
    });
  });
});
