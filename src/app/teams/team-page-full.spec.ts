import { openAdmin, text } from '../organizations/admin/testing/admin-harness';
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

  async function open(team: object) {
    o = await openAdmin(ROUTES, URL);
    o.acceptToken();
    await o.flush();
    o.subscription(GET)!.emit(team);
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
