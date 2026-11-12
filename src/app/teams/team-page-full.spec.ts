import { openAdmin, text } from '../organizations/admin/testing/admin-harness';
import { expectBareCard } from '../ui/testing/card';
import { TeamPage } from './team-page';

const GET = 'teams:getForMember';
const URL = '/app/teams/team_sharks';
const ROUTES = [{ path: 'app/teams/:teamId', component: TeamPage }];

const ADULT = { minor: null, viewerCanRename: false, viewerCanRemove: false, isViewer: false };
const ROSTER = [
  { ...ADULT, rosterEntryId: 're_1', name: 'Tasha Greene', isCaptain: true },
  { ...ADULT, rosterEntryId: 're_2', name: 'Marcus Bell', isCaptain: false },
  { ...ADULT, rosterEntryId: 're_3', name: 'Elena Ruiz', isCaptain: false },
  { ...ADULT, rosterEntryId: 're_4', name: 'Devon Park', isCaptain: false },
];
const SHARKS = {
  name: 'Sand Sharks',
  organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
  league: { name: 'Sunday Reverse Coed 4s', slug: 'sunday-reverse-coed-4s' },
  season: { name: 'Summer 2027', slug: 'summer-2027' },
  minimumRosterSize: 4,
  maxRosterSize: 4,
  rosterCount: 4,
  roster: ROSTER,
  viewerIsCaptain: true,
  viewerCanManage: true,
  viewerOnTeam: true,
  viewerTeamName: 'Sand Sharks',
};

describe('TeamPage: maximum roster size', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;

  async function open(team: object, url = URL) {
    o = await openAdmin(ROUTES, url);
    o.acceptToken();
    await o.flush();
    o.subscription(GET)!.emit(team);
    await o.flush();
    o.subscription('teamInvites:listPending')?.emit({ rows: [], total: 0 });
    await o.flush();
  }

  const main = () => o.harness.routeNativeElement!.querySelector('main')!;
  const full = () => main().querySelector<HTMLElement>('[data-testid="team-full"]');

  it('a full team shows "4 of 4 players", the full note, and one panel in place of the invite form and Add a minor', async () => {
    await open(SHARKS);
    expect(text(main().querySelector('[data-testid="roster-count"]'))).toBe('4 of 4 players');
    expect(text(main().querySelector('[data-testid="roster-note"]'))).toBe(
      'The team is full: 4 players is this season’s maximum.',
    );
    expect(main().querySelector('#email')).toBeNull();
    expect(main().querySelector('#minor-name')).toBeNull();
    expect(full()?.id).toBe('invite');
    expect(text(full()?.querySelector('h2'))).toBe('Invite players');
    expect([...full()!.querySelectorAll('p')].map((p) => text(p))).toEqual([
      'The team is full',
      'Sand Sharks has 4 players, this season’s maximum. Remove a player to invite someone else or add a minor.',
    ]);
  });

  it('draws the full panel as a bare helm card, with its test id kept', async () => {
    await open(SHARKS);
    expectBareCard(full(), 'overflow-hidden');
  });

  it('a teammate sees the panel as Add a minor, asking the captain to make room', async () => {
    await open({ ...SHARKS, viewerIsCaptain: false, viewerCanManage: false });
    expect(full()?.id).toBe('add-minor');
    expect(text(full()?.querySelector('h2'))).toBe('Add a minor');
    expect(text(full()?.querySelector('p:last-child'))).toBe(
      'Sand Sharks has 4 players, this season’s maximum. Ask the captain to remove a player first.',
    );
  });

  it('a player on another team sees the note but no panel', async () => {
    await open({
      ...SHARKS,
      viewerIsCaptain: false,
      viewerCanManage: false,
      viewerOnTeam: false,
      viewerTeamName: 'Block Party',
    });
    expect(text(main().querySelector('[data-testid="roster-note"]'))).toBe(
      'The team is full: 4 players is this season’s maximum.',
    );
    expect(full()).toBeNull();
  });

  describe('the #invite landing and the invite jump', () => {
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    let scrolled: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
      // jsdom has no scrollIntoView.
      scrolled = vi.fn<() => void>();
      Element.prototype.scrollIntoView = scrolled;
    });
    afterEach(() => {
      if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
      else delete (Element.prototype as Partial<Element>).scrollIntoView;
    });

    it('opened at #invite, scrolls the full note into view and focuses its heading', async () => {
      await open(SHARKS, `${URL}#invite`);
      expect(scrolled.mock.contexts).toEqual([full()]);
      expect(document.activeElement).toBe(full()?.querySelector('h2'));
      expect(full()?.querySelector('h2')?.getAttribute('tabindex')).toBe('-1');
    });

    it('opened without #invite, leaves scroll and focus alone', async () => {
      await open(SHARKS);
      expect(scrolled).not.toHaveBeenCalled();
      expect(main().contains(document.activeElement) && document.activeElement !== main()).toBe(
        false,
      );
    });

    it('the Invite players link scrolls to the full note and focuses its heading', async () => {
      await open(SHARKS);
      const jump = [...main().querySelectorAll<HTMLAnchorElement>('a')].find(
        (a) => text(a) === 'Invite players',
      )!;
      jump.click();
      expect(scrolled.mock.contexts).toEqual([full()]);
      expect(document.activeElement).toBe(full()?.querySelector('h2'));
    });

    it('a teammate who cannot manage the team and opens #invite gets no scroll', async () => {
      await open({ ...SHARKS, viewerIsCaptain: false, viewerCanManage: false }, `${URL}#invite`);
      expect(scrolled).not.toHaveBeenCalled();
    });
  });

  it('below the maximum the forms stay, and the note says how many the team can have', async () => {
    await open({ ...SHARKS, maxRosterSize: 6, rosterCount: 3, roster: ROSTER.slice(0, 3) });
    expect(text(main().querySelector('[data-testid="roster-note"]'))).toBe(
      '1 more needed to reach the minimum of 4 players. Up to 6 players.',
    );
    expect(full()).toBeNull();
    expect(main().querySelector('#email')).not.toBeNull();
    expect(main().querySelector('#minor-name')).not.toBeNull();
  });
});
