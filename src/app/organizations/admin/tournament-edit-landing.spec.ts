import type { Routes } from '@angular/router';
import { TournamentEditLanding } from './tournament-edit-landing';
import { TournamentPage } from './tournament-page';
import { COASTAL, Elsewhere, forbiddenError, openAdmin } from './testing/admin-harness';

const ROUTES: Routes = [
  { path: 'app/organizations/:orgSlug/tournaments/:tournamentSlug', component: TournamentPage },
  { path: 'app/organizations/:slug', component: Elsewhere },
  { path: 'app', component: Elsewhere },
  { path: 'organizations/:orgSlug', component: Elsewhere },
];
const BASE = `/app/organizations/${COASTAL.slug}/tournaments`;
const WINTER_URL = `${BASE}/winter-doubles-classic`;
const SPRING_URL = `${BASE}/spring-open`;
const GET = 'tournaments:getForManagement';

const WINTER = {
  tournamentId: 'tn_winter',
  organizationId: COASTAL.organizationId,
  role: 'orgAdmin',
  status: 'draft',
  organization: { name: COASTAL.name, slug: COASTAL.slug },
  name: 'Winter Doubles Classic',
  slug: 'winter-doubles-classic',
  sport: 'beachVolleyball',
  sportName: 'Beach volleyball',
  divisionLabel: 'Coed · 2v2 · Open',
  locations: [{ name: 'Pelican Shoals Sand Courts', address: '2150 Pelican Shoals Dr' }],
  minimumRosterSize: 2,
  teamCount: 0,
  startDate: '2027-01-16',
  endDate: '2027-01-17',
  registrationDeadline: '2027-01-09',
  maximumTeams: 4,
  setsPerGame: 1,
};
const SPRING = { ...WINTER, tournamentId: 'tn_spring', name: 'Spring Open', slug: 'spring-open' };

describe('TournamentEditLanding', () => {
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

  const landing = () => o.harness.routeDebugElement!.injector.get(TournamentEditLanding);
  const main = () => o.harness.routeNativeElement!.querySelector<HTMLElement>('main')!;
  const startDate = () => main().querySelector<HTMLInputElement>('#details-start-date');
  const answer = async (tournament: object | null = WINTER) => {
    o.subscription(GET)!.emit(tournament);
    await o.flush();
    o.subscription('waitlist:listForTournament')?.emit({ rows: [], waitlistCount: 0 });
    await o.flush();
  };
  const expectLanded = () => {
    expect(landing().pending()).toBe(false);
    expect(scrolled.mock.contexts as Element[]).toEqual([main().querySelector('#edit-details')]);
    expect(document.activeElement).toBe(startDate());
  };
  const expectNothingLanded = () => {
    expect(landing().pending()).toBe(false);
    expect(scrolled).not.toHaveBeenCalled();
    expect(main().contains(document.activeElement) && document.activeElement !== main()).toBe(
      false,
    );
  };

  describe('arming', () => {
    it('arms for a tournament page opened with #edit-details', async () => {
      await open(`${WINTER_URL}#edit-details`);
      expect(landing().pending()).toBe(true);
    });

    it.each([
      ['no fragment', WINTER_URL],
      ['another fragment', `${WINTER_URL}#details`],
    ])('does not arm for %s', async (_name, url) => {
      await open(url);
      expect(landing().pending()).toBe(false);
    });
  });

  describe('landing', () => {
    it('waits for the tournament, then scrolls to the form and focuses its first field', async () => {
      await open(`${WINTER_URL}#edit-details`);
      expect(scrolled).not.toHaveBeenCalled();
      await answer();
      expectLanded();
    });

    it('does not move again when the tournament changes after it landed', async () => {
      await open(`${WINTER_URL}#edit-details`);
      await answer();
      scrolled.mockClear();
      (document.activeElement as HTMLElement).blur();
      await answer({ ...WINTER, maximumTeams: 6 });
      expect(scrolled).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(startDate());
    });

    it('lands for an assigned league organizer too', async () => {
      await open(`${WINTER_URL}#edit-details`);
      await answer({ ...WINTER, role: 'leagueOrganizer' });
      expectLanded();
    });
  });

  describe('nothing to land on', () => {
    it('settles on the not-found view', async () => {
      await open(`${WINTER_URL}#edit-details`);
      await answer(null);
      expectNothingLanded();
    });

    it('settles on the no-access view', async () => {
      await open(`${WINTER_URL}#edit-details`);
      o.subscription(GET)!.fail(forbiddenError());
      await o.flush();
      expectNothingLanded();
    });

    it('settles on the error view', async () => {
      await open(`${WINTER_URL}#edit-details`);
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
      'does not land after %s while the tournament query is held',
      async (name) => {
        await open(`${WINTER_URL}#edit-details`);
        choices[name]();
        expect(landing().pending()).toBe(false);
        await answer();
        expect(scrolled).not.toHaveBeenCalled();
        expect(document.activeElement).not.toBe(startDate());
      },
    );

    it('keeps the landing when <main> takes focus', async () => {
      await open(`${WINTER_URL}#edit-details`);
      main().focus();
      expect(landing().pending()).toBe(true);
      await answer();
      expectLanded();
    });
  });

  describe('arriving at another tournament', () => {
    it('lands on the form of tournament B when the page already shows A and the link carries #edit-details', async () => {
      await open(WINTER_URL);
      await answer();
      expect(landing().pending()).toBe(false);
      await o.harness.navigateByUrl(`${SPRING_URL}#edit-details`);
      await o.flush();
      expect(landing().pending()).toBe(true);
      await answer(SPRING);
      expectLanded();
    });

    it('does not arm on a change of fragment alone on the same tournament', async () => {
      await open(WINTER_URL);
      await answer();
      await o.harness.navigateByUrl(`${WINTER_URL}#edit-details`);
      await o.flush();
      expect(landing().pending()).toBe(false);
      expect(scrolled).not.toHaveBeenCalled();
    });
  });
});
