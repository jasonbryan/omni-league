import { forbiddenError, openAdmin } from '../organizations/admin/testing/admin-harness';
import { TeamInviteLanding } from './team-invite-landing';
import { TeamPage } from './team-page';

const GET = 'teams:getForMember';
const LIST_PENDING = 'teamInvites:listPending';
const SHARKS_URL = '/app/teams/team_sharks';
const GULLS_URL = '/app/teams/team_gulls';
const ROUTES = [{ path: 'app/teams/:teamId', component: TeamPage }];

const SHARKS = {
  name: 'Sand Sharks',
  organization: { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' },
  league: { name: 'Sunday Reverse Coed 4s', slug: 'sunday-reverse-coed-4s' },
  season: { name: 'Summer 2027', slug: 'summer-2027' },
  minimumRosterSize: 4,
  rosterCount: 1,
  roster: [{ rosterEntryId: 're_1', name: 'Tasha Greene', isCaptain: true, isViewer: true }],
  viewerIsCaptain: true,
  viewerCanManage: true,
  viewerOnTeam: true,
  viewerTeamName: 'Sand Sharks',
};
const GULLS = { ...SHARKS, name: 'Gulf Gulls' };
const PENDING = { rows: [], total: 0 };

describe('TeamInviteLanding', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let scrolled: ReturnType<typeof vi.fn<() => void>>;
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

  beforeEach(() => {
    // jsdom has no scrollIntoView.
    scrolled = vi.fn<() => void>();
    Element.prototype.scrollIntoView = scrolled;
  });
  afterEach(() => {
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    else delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  async function open(url: string) {
    o = await openAdmin(ROUTES, url);
    o.acceptToken();
    await o.flush();
  }

  const landing = () => o.harness.routeDebugElement!.injector.get(TeamInviteLanding);
  const main = () => o.harness.routeNativeElement!.querySelector<HTMLElement>('main')!;
  const emailField = () => main().querySelector<HTMLInputElement>('#email')!;
  const scrolledElements = () => scrolled.mock.contexts as Element[];
  const answerTeam = async (team: object | null = SHARKS) => {
    o.subscription(GET)!.emit(team);
    await o.flush();
  };
  const answerPending = async () => {
    o.subscription(LIST_PENDING)!.emit(PENDING);
    await o.flush();
  };
  const arrive = async (url: string) => {
    await o.harness.navigateByUrl(url);
    await o.flush();
  };
  const expectLanded = () => {
    expect(landing().pending()).toBe(false);
    expect(scrolledElements()).toEqual([emailField().closest('section')]);
    expect(document.activeElement).toBe(emailField());
  };
  const expectNothingLanded = () => {
    expect(landing().pending()).toBe(false);
    expect(scrolled).not.toHaveBeenCalled();
    expect(main().contains(document.activeElement) && document.activeElement !== main()).toBe(
      false,
    );
  };

  describe('arming', () => {
    it('arms for a team page opened with #invite', async () => {
      await open(`${SHARKS_URL}#invite`);
      expect(landing().pending()).toBe(true);
    });

    it.each([
      ['no fragment', SHARKS_URL],
      ['another fragment', `${SHARKS_URL}#roster`],
    ])('does not arm for %s', async (_name, url) => {
      await open(url);
      expect(landing().pending()).toBe(false);
    });
  });

  describe('landing', () => {
    it('waits for the team, then for the pending list, and then scrolls to the panel and focuses the email field', async () => {
      await open(`${SHARKS_URL}#invite`);
      expect(scrolled).not.toHaveBeenCalled();
      await answerTeam();
      expect(landing().pending()).toBe(true);
      expect(scrolled).not.toHaveBeenCalled();
      await answerPending();
      expectLanded();
    });

    it('lands once the pending list has failed, because it is the panel the page lands on', async () => {
      await open(`${SHARKS_URL}#invite`);
      await answerTeam();
      o.subscription(LIST_PENDING)!.fail(new Error('connect ECONNREFUSED'));
      await o.flush();
      expectLanded();
    });

    it('does not move again when the pending list changes after it landed', async () => {
      await open(`${SHARKS_URL}#invite`);
      await answerTeam();
      await answerPending();
      scrolled.mockClear();
      (document.activeElement as HTMLElement).blur();
      o.subscription(LIST_PENDING)!.emit({
        rows: [{ inviteId: 'ti_devon', email: 'devon@example.com', expiresAt: Date.now() + 1e9 }],
        total: 1,
      });
      await o.flush();
      expect(scrolled).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(emailField());
    });

    it('lands on the full note, focusing its heading, when the roster is at the maximum', async () => {
      await open(`${SHARKS_URL}#invite`);
      await answerTeam({ ...SHARKS, maxRosterSize: 1 });
      await answerPending();
      const full = main().querySelector('[data-testid="team-full"]');
      expect(full?.id).toBe('invite');
      expect(scrolledElements()).toEqual([full]);
      expect(document.activeElement).toBe(full?.querySelector('h2'));
      expect(landing().pending()).toBe(false);
    });
  });

  describe('nothing to land on', () => {
    it('settles for a member who cannot manage the team, with no scroll and focus left alone', async () => {
      await open(`${SHARKS_URL}#invite`);
      await answerTeam({ ...SHARKS, viewerIsCaptain: false, viewerCanManage: false });
      expectNothingLanded();
    });

    it('settles for a teammate when the roster is at the maximum, whose note is Add a minor', async () => {
      await open(`${SHARKS_URL}#invite`);
      await answerTeam({
        ...SHARKS,
        maxRosterSize: 1,
        viewerIsCaptain: false,
        viewerCanManage: false,
      });
      expectNothingLanded();
    });

    it('settles on the not-found view', async () => {
      await open(`${SHARKS_URL}#invite`);
      await answerTeam(null);
      expectNothingLanded();
    });

    it('settles on the no-access view', async () => {
      await open(`${SHARKS_URL}#invite`);
      o.subscription(GET)!.fail(forbiddenError());
      await o.flush();
      expectNothingLanded();
    });

    it('settles on the error view', async () => {
      await open(`${SHARKS_URL}#invite`);
      o.subscription(GET)!.fail(new Error('connect ECONNREFUSED'));
      await o.flush();
      expectNothingLanded();
    });
  });

  describe('cancelling', () => {
    const choices = {
      'a scroll': () => document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true })),
      'a press on a control': () => {
        const button = document.createElement('button');
        document.body.append(button);
        button.click();
        button.remove();
      },
      'focus on another element': () => {
        const input = document.createElement('input');
        document.body.append(input);
        input.focus();
        input.remove();
      },
    };

    it.each(Object.keys(choices) as (keyof typeof choices)[])(
      'does not land after %s while the team query is held',
      async (name) => {
        await open(`${SHARKS_URL}#invite`);
        choices[name]();
        expect(landing().pending()).toBe(false);
        await answerTeam();
        await answerPending();
        expect(scrolled).not.toHaveBeenCalled();
        expect(document.activeElement).not.toBe(emailField());
      },
    );

    it('keeps the landing when <main> takes focus and for a press on text inside <main>', async () => {
      await open(`${SHARKS_URL}#invite`);
      main().focus();
      expect(document.activeElement).toBe(main());
      const text = main().querySelector('[role="status"]')!;
      text.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      text.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(landing().pending()).toBe(true);
      await answerTeam();
      await answerPending();
      expectLanded();
    });
  });

  describe('arriving at another team', () => {
    it('lands on the panel of team B when the page already shows team A and the link carries #invite', async () => {
      await open(SHARKS_URL);
      await answerTeam();
      await answerPending();
      expect(landing().pending()).toBe(false);
      await arrive(`${GULLS_URL}#invite`);
      expect(landing().pending()).toBe(true);
      await answerTeam(GULLS);
      await answerPending();
      expectLanded();
    });

    it('does not arm on a change of fragment alone on the same team', async () => {
      await open(SHARKS_URL);
      await answerTeam();
      await answerPending();
      await arrive(`${SHARKS_URL}#invite`);
      expect(landing().pending()).toBe(false);
      expect(scrolled).not.toHaveBeenCalled();
    });
  });
});
