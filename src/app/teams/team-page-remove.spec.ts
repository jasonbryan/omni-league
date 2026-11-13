import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import { TEAM_MESSAGES } from '../../../convex/lib/teamInput';
import { ConvexOfflineError } from '../core/data/convex';
import { openAdmin, text } from '../organizations/admin/testing/admin-harness';
import { TeamPage } from './team-page';

const GET = 'teams:getForMember';
const LIST_PENDING = 'teamInvites:listPending';
const REMOVE = 'rosterEntries:remove';
const URL = '/app/teams/team_sharks';
const ROUTES = [{ path: 'app/teams/:teamId', component: TeamPage }];

const ROW = { minor: null, viewerCanRename: false };
const ROSTER = [
  {
    ...ROW,
    rosterEntryId: 're_1',
    name: 'Tasha Greene',
    isCaptain: true,
    isViewer: true,
    viewerCanRemove: false,
  },
  {
    ...ROW,
    rosterEntryId: 're_2',
    name: 'Marcus Bell',
    isCaptain: false,
    isViewer: false,
    viewerCanRemove: true,
  },
  {
    ...ROW,
    rosterEntryId: 're_3',
    name: 'Elena Ruiz',
    isCaptain: false,
    isViewer: false,
    viewerCanRemove: true,
  },
];
const SHARKS = {
  name: 'Sand Sharks',
  organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
  league: { name: 'Sunday Reverse Coed 4s', slug: 'sunday-reverse-coed-4s' },
  season: { name: 'Summer 2027', slug: 'summer-2027' },
  minimumRosterSize: 4,
  rosterCount: 3,
  roster: ROSTER,
  viewerIsCaptain: true,
  viewerCanManage: true,
  viewerOnTeam: true,
  viewerTeamName: 'Sand Sharks',
};

describe('TeamPage: removing a player', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;

  afterEach(() => vi.restoreAllMocks());

  async function open(team: object = SHARKS) {
    o = await openAdmin(ROUTES, URL);
    o.acceptToken();
    await o.flush();
    o.subscription(GET)!.emit(team);
    await o.flush();
    o.subscription(LIST_PENDING)?.emit({ rows: [], total: 0 });
    await o.flush();
  }

  const main = () => o.harness.routeNativeElement!.querySelector('main')!;
  const rows = () => [
    ...main().querySelectorAll<HTMLElement>('section[aria-labelledby="roster-heading"] li'),
  ];
  const removeButton = (n: number) =>
    rows()[n].querySelector<HTMLButtonElement>('button[data-roster-entry-id]');
  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
  const dialogButton = (label: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      text(b)?.startsWith(label),
    )!;
  const status = () =>
    main().querySelector<HTMLElement>('section[aria-labelledby="roster-heading"] [role="status"]');
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);

  async function openDialog(n = 1) {
    await open();
    removeButton(n)!.click();
    await o.flush();
  }

  async function confirm() {
    dialogButton('Remove player').click();
    await o.flush();
  }

  it('gives each row but the captain’s a Remove named for the player and the team', async () => {
    await open();
    expect(removeButton(0)).toBeNull();
    expect([1, 2].map((n) => [text(removeButton(n)), removeButton(n)!.ariaHasPopup])).toEqual([
      ['Remove Marcus Bell from Sand Sharks', 'dialog'],
      ['Remove Elena Ruiz from Sand Sharks', 'dialog'],
    ]);
  });

  it('a member who cannot manage the team gets no Remove', async () => {
    await open({
      ...SHARKS,
      viewerIsCaptain: false,
      viewerCanManage: false,
      roster: ROSTER.map((player) => ({ ...player, viewerCanRemove: false })),
    });
    expect(main().querySelectorAll('button[data-roster-entry-id]')).toHaveLength(0);
  });

  it('opens an alert dialog titled for the player and team, with focus on Cancel', async () => {
    await openDialog();
    const box = dialog()!;
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(text(box.querySelector('h2'))).toBe('Remove Marcus Bell from Sand Sharks?');
    expect(box.getAttribute('aria-labelledby')).toBe(box.querySelector('h2')!.id);
    expect(text(box.querySelector('[data-slot="alert-dialog-description"]'))).toBe(
      'They’ll lose access to the team page. You can invite them again later.',
    );
    expect(document.activeElement).toBe(dialogButton('Cancel'));
    expect(calls()).toEqual([]);
  });

  it('removes: "Removing…" while it runs, then a status above the roster with focus on it', async () => {
    await openDialog();
    await confirm();
    expect(calls()).toEqual([[REMOVE, { rosterEntryId: 're_2' }]]);
    const busy = dialogButton('Removing');
    expect(text(busy)).toBe('Removing…');
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(dialogButton('Cancel').getAttribute('aria-disabled')).toBe('true');
    o.convex.calls[0].resolve(null);
    await o.flush();
    expect(dialog()).toBeNull();
    expect(text(status())).toBe(
      'Marcus Bell was removed from Sand Sharks. They can no longer open this page. You can invite them again.',
    );
    expect(document.activeElement).toBe(status());
  });

  it('removing the only removable player still shows the status, because the roster update arrives before the dialog closes', async () => {
    const [captain, marcus] = ROSTER;
    const pair = { ...SHARKS, rosterCount: 2, roster: [captain, marcus] };
    await open(pair);
    removeButton(1)!.click();
    await o.flush();
    await confirm();
    o.subscription(GET)!.emit({ ...pair, rosterCount: 1, roster: [captain] });
    await o.flush();
    o.convex.calls[0].resolve(null);
    await o.flush();
    expect(rows()).toHaveLength(1);
    expect(text(status())).toBe(
      'Marcus Bell was removed from Sand Sharks. They can no longer open this page. You can invite them again.',
    );
    expect(document.activeElement).toBe(status());
  });

  it('Cancel closes it, sends nothing, and returns focus to that row’s Remove', async () => {
    await openDialog(2);
    dialogButton('Cancel').click();
    await o.flush();
    expect(dialog()).toBeNull();
    expect(calls()).toEqual([]);
    expect(document.activeElement).toBe(removeButton(2));
  });

  it('Escape closes it the same way', async () => {
    await openDialog(2);
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await o.flush();
    expect(dialog()).toBeNull();
    expect(calls()).toEqual([]);
    expect(document.activeElement).toBe(removeButton(2));
  });

  it.each([
    [
      new ConvexError({ code: 'captainRequired', message: TEAM_MESSAGES.captainRequired }),
      'A team needs its captain.',
    ],
    [
      new ConvexError({ code: 'notRostered', message: TEAM_MESSAGES.notRostered }),
      'They’re no longer on the team.',
    ],
    [new Error('Server Error: secret'), 'Check your connection and try again.'],
  ])(
    'a refusal or failure shows its alert in the dialog, with focus on it, and no status',
    async (error, line) => {
      await openDialog();
      await confirm();
      o.convex.calls[0].reject(error);
      await o.flush();
      const alert = dialog()!.querySelector<HTMLElement>('[role="alert"]')!;
      expect(text(alert)).toBe(`Marcus Bell could not be removed. ${line}`);
      expect(document.activeElement).toBe(alert);
      expect(text(dialog())).not.toContain('secret');
      expect(dialogButton('Remove player').getAttribute('aria-disabled')).toBeNull();
      expect(status()).toBeNull();
    },
  );

  it('offline: a press shows the offline alert and sends nothing', async () => {
    await openDialog();
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    TestBed.tick();
    await o.harness.fixture.whenStable();
    const button = dialogButton('Remove player');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.click();
    await o.flush();
    const alert = dialog()!.querySelector<HTMLElement>('[role="alert"]')!;
    expect(text(alert)).toBe(
      "You're offline. Nothing was sent. Marcus Bell is still on the team. Try again when you’re connected.",
    );
    expect(document.activeElement).toBe(alert);
    expect(calls()).toEqual([]);
  });

  it('a refusal from the adapter at call time shows the offline alert', async () => {
    await openDialog();
    await confirm();
    o.convex.calls[0].reject(new ConvexOfflineError());
    await o.flush();
    expect(text(dialog()!.querySelector('[role="alert"]'))).toContain(
      'Marcus Bell is still on the team.',
    );
  });
});
