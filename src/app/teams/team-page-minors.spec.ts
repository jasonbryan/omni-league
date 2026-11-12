import { ConvexError } from 'convex/values';
import { ConvexOfflineError } from '../core/data/convex';
import { openAdmin, text } from '../organizations/admin/testing/admin-harness';
import { TeamPage } from './team-page';
import { expectPendingSpinner } from '../ui/testing/spinner';
import { expectBadge } from '../ui/testing/badge';

const GET = 'teams:getForMember';
const ADD_MINOR = 'rosterEntries:addMinor';
const RENAME_MINOR = 'rosterEntries:renameMinor';
const URL = '/app/teams/team_sharks';
const ROUTES = [{ path: 'app/teams/:teamId', component: TeamPage }];

const ADULT = { minor: null, viewerCanRename: false, viewerCanRemove: false, isViewer: false };
const ROSTER = [
  { ...ADULT, rosterEntryId: 're_1', name: 'Tasha Greene', isCaptain: true },
  { ...ADULT, rosterEntryId: 're_2', name: 'Marcus Bell', isCaptain: false, isViewer: true },
  { ...ADULT, rosterEntryId: 're_3', name: 'Elena Ruiz', isCaptain: false },
  {
    rosterEntryId: 're_4',
    name: 'Theo Bell',
    isCaptain: false,
    isViewer: false,
    minor: { guardianName: 'Marcus Bell' },
    viewerCanRename: true,
    viewerCanRemove: true,
  },
];
const SHARKS = {
  name: 'Sand Sharks',
  organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
  league: { name: 'Sunday Reverse Coed 4s', slug: 'sunday-reverse-coed-4s' },
  season: { name: 'Summer 2027', slug: 'summer-2027' },
  minimumRosterSize: 4,
  rosterCount: 4,
  roster: ROSTER,
  viewerIsCaptain: false,
  viewerCanManage: false,
  viewerOnTeam: true,
  viewerTeamName: 'Sand Sharks',
};

describe('TeamPage: minors', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;

  afterEach(() => vi.restoreAllMocks());

  async function open(team: object = SHARKS) {
    o = await openAdmin(ROUTES, URL);
    o.acceptToken();
    await o.flush();
    o.subscription(GET)!.emit(team);
    await o.flush();
  }

  const main = () => o.harness.routeNativeElement!.querySelector('main')!;
  const rows = () => [
    ...main().querySelectorAll<HTMLElement>('section[aria-labelledby="roster-heading"] li'),
  ];
  const button = (scope: Element, label: string) =>
    [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      text(b)?.startsWith(label),
    );
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);
  const addPanel = () => main().querySelector<HTMLElement>('#add-minor');
  const field = (id: string) => main().querySelector<HTMLInputElement>(`#${id}`)!;

  async function type(id: string, value: string) {
    field(id).value = value;
    field(id).dispatchEvent(new Event('input'));
    await o.flush();
  }

  it('marks a minor’s row with the Minor badge and the guardian, and gives the guardian Rename and Remove', async () => {
    await open();
    expect(rows().map((row) => text(row.querySelector('h3')))).toEqual([
      'Tasha Greene',
      'Marcus Bell (you)',
      'Elena Ruiz',
      'Theo Bell',
    ]);
    const theo = rows()[3];
    expect(text(theo.querySelector('[data-slot="badge"]'))).toBe('Minor');
    expectBadge(theo.querySelector('[data-slot="badge"]'), 'outline', 'default');
    expect(text(theo.querySelector('p.mt-1'))).toBe('Guardian: Marcus Bell');
    expect([...theo.querySelectorAll('button')].map((b) => text(b))).toEqual([
      'Rename Theo Bell',
      'Remove Theo Bell from Sand Sharks',
    ]);
    expect(
      rows()
        .slice(0, 3)
        .flatMap((row) => [...row.querySelectorAll('button')]),
    ).toEqual([]);
    expect(text(main().querySelector('[data-testid="roster-count"]'))).toBe('4 of 4 players');
  });

  it('a player on another team sees the short name with no mark, no guardian, no control, and no Add a minor', async () => {
    await open({
      ...SHARKS,
      viewerOnTeam: false,
      viewerTeamName: 'Block Party',
      roster: [
        ...ROSTER.slice(0, 3).map((row) => ({ ...row, isViewer: false })),
        { ...ADULT, rosterEntryId: 're_4', name: 'Theo B.', isCaptain: false },
      ],
    });
    expect(text(rows()[3])).toBe('TB Theo B.');
    expect(main().textContent).not.toContain('Guardian');
    expect(main().querySelectorAll('[data-slot="badge"]')).toHaveLength(1);
    expect(addPanel()).toBeNull();
  });

  it('a guardian whose only entry is a minor’s gets the guardian note', async () => {
    await open({
      ...SHARKS,
      viewerTeamName: null,
      roster: ROSTER.map((row) => ({ ...row, isViewer: false })),
    });
    expect(text(main().querySelector('[data-testid="viewer-note"]'))).toBe(
      'You’re the guardian of a minor on this team.',
    );
  });

  describe('Rename', () => {
    async function openRename() {
      await open();
      button(rows()[3], 'Rename')!.click();
      await o.flush();
    }

    it('opens a form in place of the row, with the name filled in and focus on the field', async () => {
      await openRename();
      expect(text(rows()[3].querySelector('h3'))).toBe('Rename Theo Bell');
      expect(field('rename-name').value).toBe('Theo Bell');
      expect(document.activeElement).toBe(field('rename-name'));
    });

    it('an empty name shows the error under the field, with focus, and sends nothing', async () => {
      await openRename();
      await type('rename-name', '  ');
      button(rows()[3], 'Save name')!.click();
      await o.flush();
      expect(text(main().querySelector('#rename-name-error'))).toBe('Enter the minor’s name.');
      expect(document.activeElement).toBe(field('rename-name'));
      expect(calls()).toEqual([]);
    });

    it('saves: a status above the roster, with focus on it', async () => {
      await openRename();
      await type('rename-name', ' Theodore  Bell ');
      button(rows()[3], 'Save name')!.click();
      await o.flush();
      expect(calls()).toEqual([
        [RENAME_MINOR, { rosterEntryId: 're_4', minorName: 'Theodore Bell' }],
      ]);
      const pending = button(rows()[3], 'Saving')!;
      expect(text(pending)).toBe('Saving…');
      expect(pending.getAttribute('aria-disabled')).toBe('true');
      expectPendingSpinner(pending);
      o.convex.calls[0].resolve({ minorName: 'Theodore Bell' });
      await o.flush();
      const status = main().querySelector<HTMLElement>(
        'section[aria-labelledby="roster-heading"] [role="status"]',
      );
      expect(text(status)).toBe('Renamed to Theodore Bell.');
      expect(document.activeElement).toBe(status);
      expect(field('rename-name')).toBeNull();
    });

    it('Cancel closes the form and returns focus to Rename', async () => {
      await openRename();
      button(rows()[3], 'Cancel')!.click();
      await o.flush();
      expect(document.activeElement).toBe(button(rows()[3], 'Rename'));
      expect(calls()).toEqual([]);
    });
  });

  describe('Add a minor', () => {
    const submit = () => button(addPanel()!, 'Add minor')!;

    it('is shown to anyone on the team, with its note and field', async () => {
      await open();
      expect(text(addPanel()!.querySelector('h2'))).toBe('Add a minor');
      expect(text(addPanel()!.querySelector('#add-minor-note'))).toBe(
        'For a child you’re responsible for. Only their name is stored, and you manage their place on the roster. Players on other teams see their first name and last initial.',
      );
      expect(text(addPanel()!.querySelector('label'))).toBe('Minor’s name');
    });

    it('submitted empty: the error under the field, with focus, and nothing sent', async () => {
      await open();
      submit().click();
      await o.flush();
      expect(text(main().querySelector('#minor-name-error'))).toBe('Enter the minor’s name.');
      expect(field('minor-name').getAttribute('aria-describedby')).toBe(
        'minor-name-description minor-name-error',
      );
      expect(document.activeElement).toBe(field('minor-name'));
      expect(calls()).toEqual([]);
    });

    it('adds: a status in the panel with focus, and an empty field', async () => {
      await open();
      await type('minor-name', 'Nora  Bell');
      submit().click();
      await o.flush();
      expect(calls()).toEqual([[ADD_MINOR, { teamId: 'team_sharks', minorName: 'Nora Bell' }]]);
      const pending = button(addPanel()!, 'Adding')!;
      expect(text(pending)).toBe('Adding…');
      expect(pending.getAttribute('aria-disabled')).toBe('true');
      expectPendingSpinner(pending);
      o.convex.calls[0].resolve({ rosterEntryId: 're_5', minorName: 'Nora Bell' });
      await o.flush();
      const status = addPanel()!.querySelector<HTMLElement>('[data-slot="alert"]');
      expect(text(status)).toBe('Nora Bell was added to Sand Sharks.');
      expect(document.activeElement).toBe(status);
      expect(field('minor-name').value).toBe('');
    });

    it('the same minor already in the season: the stored name in bold and the team, with focus on the field', async () => {
      await open();
      await type('minor-name', 'theo  bell');
      submit().click();
      await o.flush();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'minorName',
          code: 'minorInSeason',
          minorName: 'Theo Bell',
          teamName: 'Sand Sharks',
          message: 'Theo Bell is already on Sand Sharks in this season.',
        }),
      );
      await o.flush();
      const error = main().querySelector('#minor-name-error');
      expect(text(error)).toBe('Theo Bell is already on Sand Sharks in this season.');
      expect(text(error?.querySelector('strong'))).toBe('Theo Bell');
      expect(document.activeElement).toBe(field('minor-name'));
    });

    it('offline at call time: the offline alert, and the name stays', async () => {
      await open();
      await type('minor-name', 'Nora Bell');
      submit().click();
      await o.flush();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(addPanel()!.querySelector('[role="alert"]'))).toContain(
        'The name is still here. Try again when you’re connected.',
      );
      expect(field('minor-name').value).toBe('Nora Bell');
    });
  });
});
