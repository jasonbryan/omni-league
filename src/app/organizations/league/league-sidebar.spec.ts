import { SIDEBAR_ROW, SIDEBAR_ROW_CURRENT } from '../../shell/sidebar-classes';
import { openAdmin, text } from '../admin/testing/admin-harness';
import {
  COED,
  COED_AS_ORGANIZER,
  GET_ORGANIZER_CONTEXT,
  GULF,
  LEAGUE_ROUTES,
  LEAGUE_URL,
  LIST_FOR_ORGANIZER,
  LIST_MINE,
  MINE_AS_ORGANIZER,
} from './testing/league-harness';

const CURRENT_CLASS = SIDEBAR_ROW_CURRENT;
const OTHER_CLASS = SIDEBAR_ROW;

const tokens = (value: string) => value.split(' ').sort();

describe('LeagueSidebar', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(context: unknown) {
    o = await openAdmin(LEAGUE_ROUTES, LEAGUE_URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ORGANIZER_CONTEXT)!.emit(context);
    await o.flush();
    o.subscription(LIST_FOR_ORGANIZER)?.emit([]);
    await o.flush();
  }

  async function answer(mine: unknown) {
    o.subscription(LIST_MINE)!.emit(mine);
    await o.flush();
  }

  const links = () => [
    ...page.querySelectorAll<HTMLAnchorElement>('nav ul[aria-label="Your leagues"] a'),
  ];
  const row = (a: HTMLAnchorElement) => [
    text(a),
    a.getAttribute('href'),
    a.getAttribute('aria-current'),
  ];

  it('asks organizations.listMine with no argument, once, and only for a league organizer', async () => {
    o = await openAdmin(LEAGUE_ROUTES, LEAGUE_URL);
    o.acceptToken();
    expect(o.convex.activeSubscriptions.map((s) => s.name)).not.toContain(LIST_MINE);
    o.subscription(GET_ORGANIZER_CONTEXT)!.emit(COED_AS_ORGANIZER);
    await o.flush();
    const asked = o.convex.activeSubscriptions.filter((s) => s.name === LIST_MINE);
    expect(asked.map((s) => s.args)).toEqual([{}]);
  });

  it('does not ask for an org admin, whose sidebar is the admin sidebar', async () => {
    await open(COED);
    expect(o.convex.activeSubscriptions.map((s) => s.name)).not.toContain(LIST_MINE);
  });

  it('lists every assigned league of this organization in the order given, the current one marked', async () => {
    await open(COED_AS_ORGANIZER);
    await answer(MINE_AS_ORGANIZER);
    const base = `/app/organizations/${GULF.slug}/leagues`;
    expect(links().map(row)).toEqual([
      ['Coed 7v7 Rec', `${base}/coed-7v7-rec`, 'page'],
      ['Friday Night Coed 6s', `${base}/friday-night-coed-6s`, null],
      ['Thursday Night Coed 2s', `${base}/thursday-night-coed-2s`, null],
    ]);
  });

  it('marks the current league in the sidebar-item style and the others plain, as the mockup draws them', async () => {
    await open({
      ...COED_AS_ORGANIZER,
      name: 'Friday Night Coed 6s',
      slug: 'friday-night-coed-6s',
    });
    await answer(MINE_AS_ORGANIZER);
    const [first, second, third] = links();
    expect(second.getAttribute('aria-current')).toBe('page');
    expect(tokens(second.className)).toEqual(tokens(CURRENT_CLASS));
    for (const other of [first, third]) {
      expect(other.hasAttribute('aria-current')).toBe(false);
      expect(tokens(other.className)).toEqual(tokens(OTHER_CLASS));
      expect(other.querySelector('ng-icon')!.classList.contains('text-muted-foreground')).toBe(
        true,
      );
    }
    expect(second.querySelector('ng-icon')!.classList.contains('text-muted-foreground')).toBe(
      false,
    );
  });

  it('lists no league of another organization', async () => {
    await open(COED_AS_ORGANIZER);
    await answer(MINE_AS_ORGANIZER);
    expect(page.querySelector('nav')!.textContent).not.toContain('Tuesday Slowpitch');
  });

  it('starts with the organization link to /app: the mark, the name, and "League organizer"', async () => {
    await open(COED_AS_ORGANIZER);
    await answer(MINE_AS_ORGANIZER);
    const nav = page.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe(`${GULF.name} leagues`);
    const head = nav.querySelector('a')!;
    expect(head.getAttribute('href')).toBe('/app');
    expect(text(head.querySelector('.truncate'))).toBe(GULF.name);
    expect(text(head.querySelector('span.block.text-xs'))).toBe('League organizer');
    expect(text(head.querySelector('[aria-hidden="true"]'))).toBe('GC');
  });

  it('follows the list with Public page, and has no admin section, count, or "View public page"', async () => {
    await open(COED_AS_ORGANIZER);
    await answer(MINE_AS_ORGANIZER);
    const nav = page.querySelector('nav')!;
    const lists = [...nav.querySelectorAll('ul')];
    expect(lists).toHaveLength(2);
    expect(
      [...lists[1].querySelectorAll('a')].map((a) => [text(a), a.getAttribute('href')]),
    ).toEqual([['Public page', `/organizations/${GULF.slug}`]]);
    const labels = [...nav.querySelectorAll('a')].map((a) => text(a));
    for (const absent of ['Overview', 'Locations', 'Staff', 'Details', 'View public page']) {
      expect(
        labels.some((label) => label?.includes(absent)),
        absent,
      ).toBe(false);
    }
    expect(nav.querySelector('.tabular-nums')).toBeNull();
    expect(nav.textContent).not.toContain('Your organizations');
  });

  it('asks for no admin count', async () => {
    await open(COED_AS_ORGANIZER);
    const names = o.convex.activeSubscriptions.map((s) => s.name);
    for (const admin of [
      'leagues:publishedCount',
      'locations:listForAdmin',
      'memberships:listForOrganization',
    ]) {
      expect(names).not.toContain(admin);
    }
  });

  it('shows only the current league until the answer comes, and after a failed one', async () => {
    await open(COED_AS_ORGANIZER);
    expect(links().map(row)).toEqual([['Coed 7v7 Rec', LEAGUE_URL, 'page']]);
    o.subscription(LIST_MINE)!.fail(new Error('Server Error: secret'));
    await o.flush();
    expect(links().map(row)).toEqual([['Coed 7v7 Rec', LEAGUE_URL, 'page']]);
    expect(page.textContent).not.toContain('secret');
  });

  it('still shows the current league when the answer does not hold it, in name order', async () => {
    await open(COED_AS_ORGANIZER);
    await answer([
      {
        ...MINE_AS_ORGANIZER[0],
        leagues: [
          { name: 'Alpha 4s', slug: 'alpha-4s' },
          { name: 'Zulu 2s', slug: 'zulu-2s' },
        ],
      },
    ]);
    expect(links().map((a) => text(a))).toEqual(['Alpha 4s', 'Coed 7v7 Rec', 'Zulu 2s']);
    expect(links().filter((a) => a.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('follows the live answer when the caller is assigned another league', async () => {
    await open(COED_AS_ORGANIZER);
    await answer([
      { ...MINE_AS_ORGANIZER[0], leagues: [{ name: 'Coed 7v7 Rec', slug: COED.slug }] },
    ]);
    expect(links()).toHaveLength(1);
    await answer(MINE_AS_ORGANIZER);
    expect(links()).toHaveLength(3);
  });
});
