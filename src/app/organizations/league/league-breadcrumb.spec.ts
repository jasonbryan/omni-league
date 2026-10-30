import { openAdmin, text } from '../admin/testing/admin-harness';
import {
  COED,
  COED_AS_ORGANIZER,
  GET_ORGANIZER_CONTEXT,
  GULF,
  LEAGUE_ROUTES,
  LEAGUE_URL,
  LIST_FOR_ORGANIZER,
} from './testing/league-harness';

describe('LeagueManagement: the breadcrumb', () => {
  let page: HTMLElement;

  async function open(context: unknown) {
    const o = await openAdmin(LEAGUE_ROUTES, LEAGUE_URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ORGANIZER_CONTEXT)!.emit(context);
    await o.flush();
    o.subscription(LIST_FOR_ORGANIZER)!.emit([]);
    await o.flush();
  }

  const nav = () => page.querySelector<HTMLElement>('main nav[aria-label="Breadcrumb"]')!;
  const items = () =>
    [...nav().querySelectorAll<HTMLElement>('ol > li:not([aria-hidden])')].map((li) => {
      const link = li.querySelector('a')!;
      return {
        text: text(li),
        href: link.getAttribute('href'),
        current: link.getAttribute('aria-current'),
      };
    });

  it('for an org admin reads the organization, Leagues, and the league, linking to the admin Overview and Leagues', async () => {
    await open(COED);
    expect(items()).toEqual([
      { text: GULF.name, href: `/app/organizations/${GULF.slug}`, current: null },
      { text: 'Leagues', href: `/app/organizations/${GULF.slug}/leagues`, current: null },
      {
        text: 'Coed 7v7 Rec',
        href: `/app/organizations/${GULF.slug}/leagues/${COED.slug}`,
        current: 'page',
      },
    ]);
  });

  it('sits above the h1 and replaces the plain organization name', async () => {
    await open(COED);
    const h1 = page.querySelector('main h1')!;
    expect(nav().compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(page.querySelector('main p.text-sm.font-medium')).toBeNull();
  });

  it('separates the items with hidden chevrons, so a screen reader hears a plain list', async () => {
    await open(COED);
    expect(nav().querySelectorAll('ol > li[aria-hidden="true"]')).toHaveLength(2);
  });

  it('for a league organizer who is not an org admin reads Your organizations and the league, because the admin area is closed to them', async () => {
    await open(COED_AS_ORGANIZER);
    expect(items()).toEqual([
      { text: 'Your organizations', href: '/app', current: null },
      {
        text: 'Coed 7v7 Rec',
        href: `/app/organizations/${GULF.slug}/leagues/${COED.slug}`,
        current: 'page',
      },
    ]);
    expect(nav().textContent).not.toContain(GULF.name);
  });

  it('for a user who is both an org admin and a league organizer of the league shows the org admin breadcrumb', async () => {
    await open({ ...COED, role: 'orgAdmin' });
    expect(items().map((item) => item.text)).toEqual([GULF.name, 'Leagues', 'Coed 7v7 Rec']);
  });

  it('gives each link a 44px target on touch screens', async () => {
    await open(COED);
    for (const link of nav().querySelectorAll('a')) {
      expect(link.className).toContain('min-h-11');
    }
  });
});
