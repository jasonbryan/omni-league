import { TestBed } from '@angular/core/testing';
import type { PublicBracket as PublicBracketData } from '../../../../convex/lib/publicPage';
import type { Score } from '../../../../convex/lib/sports';
import { PublicBracket } from './public-bracket';
import { spacedText } from './testing/spaced-text';

type Game = PublicBracketData['rounds'][number]['games'][number];

const team = (name: string, seed: number) => ({ name, seed });

const QUARTER: Game = {
  teams: [team('Sand Crabs', 1), team('Dig Dogs', 8)],
  bye: false,
};

const BRACKET: PublicBracketData = {
  rounds: [
    {
      name: 'Semifinals',
      games: [QUARTER, { teams: [team('Net Results', 2), team('Dune Dashers', 7)], bye: false }],
    },
    { name: 'Final', games: [{ teams: [null, null], bye: false }] },
  ],
};

function create(bracket: PublicBracketData | undefined) {
  const fixture = TestBed.createComponent(PublicBracket);
  fixture.componentRef.setInput('bracket', bracket);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const text = spacedText;

const games = (host: HTMLElement) => [...host.querySelectorAll('li[data-testid="bracket-game"]')];

describe('PublicBracket', () => {
  it('heads the section Bracket and gives each round a section with its heading', () => {
    const { host } = create(BRACKET);
    const section = host.querySelector('section#bracket');
    expect(text(section?.querySelector('h2'))).toBe('Bracket');
    expect(section?.getAttribute('aria-labelledby')).toBe(section?.querySelector('h2')?.id);
    const rounds = [...host.querySelectorAll('section section')];
    expect(rounds.map((round) => text(round.querySelector('h3')))).toEqual(['Semifinals', 'Final']);
    for (const round of rounds) {
      expect(round.getAttribute('aria-labelledby')).toBe(round.querySelector('h3')?.id);
    }
    expect(new Set(rounds.map((round) => round.querySelector('h3')?.id)).size).toBe(2);
  });

  it('lists each game with its seeds and teams as a list item', () => {
    const { host } = create(BRACKET);
    const items = games(host);
    expect(items).toHaveLength(3);
    expect(text(items[0])).toBe('Game 1: (1) Sand Crabs against (8) Dig Dogs');
    expect(text(items[1])).toBe('Game 2: (2) Net Results against (7) Dune Dashers');
    expect(items[0].closest('ol')).not.toBeNull();
  });

  it('shows a place no team fills yet as To be decided', () => {
    const { host } = create(BRACKET);
    expect(text(games(host)[2])).toBe('Game 1: To be decided against To be decided');
  });

  it('reads Won beside the winner of a game with a result, in text and in weight', () => {
    const { host } = create({
      rounds: [{ name: 'Final', games: [{ ...QUARTER, winner: 1 }] }],
    });
    const [first, second] = [...games(host)[0].querySelectorAll('[data-testid="bracket-team"]')];
    expect(text(first)).toBe('(1) Sand Crabs');
    expect(text(second)).toBe('against (8) Dig Dogs Won');
    expect(second.classList).toContain('font-semibold');
    expect(first.classList).not.toContain('font-semibold');
    expect(host.textContent?.match(/Won/g)).toHaveLength(1);
  });

  it('reads Bye in the empty place of a first-round bye and marks no winner', () => {
    const { host } = create({
      rounds: [
        { name: 'Semifinals', games: [{ teams: [team('Sand Crabs', 1), null], bye: true }] },
      ],
    });
    expect(text(games(host)[0])).toBe('Game 1: (1) Sand Crabs against Bye');
    expect(host.textContent).not.toContain('Won');
  });

  it('heads the section with the Final’s winner when there is one', () => {
    const { host } = create({
      winner: 'Sand Crabs',
      rounds: [{ name: 'Final', games: [{ ...QUARTER, winner: 0 }] }],
    });
    const section = host.querySelector('section#bracket')!;
    const winner = section.querySelector('[data-testid="bracket-winner"]');
    expect(text(winner)).toBe('Winner: Sand Crabs');
    expect(
      winner!.compareDocumentPosition(section.querySelector('[data-testid="bracket-scroller"]')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows no winner line until the Final has a result', () => {
    const { host } = create(BRACKET);
    expect(host.querySelector('[data-testid="bracket-winner"]')).toBeNull();
  });

  it('says where the bracket will appear when there is none', () => {
    const { host } = create(undefined);
    expect(text(host.querySelector('h2'))).toBe('Bracket');
    expect(text(host.querySelector('section#bracket p'))).toBe(
      'The bracket appears here once the organizer creates it.',
    );
    expect(host.querySelector('[data-testid="bracket-scroller"]')).toBeNull();
    expect(games(host)).toHaveLength(0);
  });

  it('puts the rounds in a labelled region a keyboard can focus', () => {
    const { host } = create(BRACKET);
    const scroller = host.querySelector('[data-testid="bracket-scroller"]')!;
    expect(scroller.getAttribute('role')).toBe('region');
    expect(scroller.getAttribute('aria-label')).toBe('Bracket rounds');
    expect(scroller.getAttribute('tabindex')).toBe('0');
  });

  it('stacks the rounds on phones and sets them side by side from 768px', () => {
    const { host } = create(BRACKET);
    const scroller = host.querySelector('[data-testid="bracket-scroller"]')!;
    expect(scroller.classList).toContain('flex-col');
    expect(scroller.classList).toContain('md:flex-row');
    expect(scroller.classList).toContain('md:overflow-x-auto');
    expect(scroller.classList).not.toContain('overflow-x-auto');
  });
});

const THREE_SETS: Score = {
  kind: 'sets',
  sets: [
    { a: 21, b: 15 },
    { a: 18, b: 21 },
    { a: 15, b: 10 },
  ],
};

const lineOf = (host: HTMLElement, index = 0) =>
  games(host)[index].querySelector('[data-testid="bracket-score"]');

const withGame = (game: Partial<Game>) =>
  create({ rounds: [{ name: 'Final', games: [{ ...QUARTER, ...game }] }] });

describe('PublicBracket score line', () => {
  it('reads a one-set score after both teams, with a screen-reader label', () => {
    const { host } = withGame({
      winner: 0,
      score: { kind: 'sets', sets: [{ a: 21, b: 15 }] },
    });
    const line = lineOf(host)!;
    expect(text(line)).toBe('Score: 21–15');
    expect(line.querySelector('.sr-only')?.textContent).toBe('Score: ');
    expect(text(games(host)[0])).toBe(
      'Game 1: (1) Sand Crabs Won against (8) Dig Dogs Score: 21–15',
    );
    expect(games(host)[0].querySelector('app-public-bracket-game')?.lastElementChild).toBe(line);
  });

  it('reads every set of a best-of-3 score, the first team first in each', () => {
    const { host } = withGame({ winner: 0, score: THREE_SETS });
    expect(text(lineOf(host))).toBe('Score: 21–15, 18–21, 15–10');
  });

  it.each([
    ['goals', { kind: 'goals', a: 3, b: 1 }, '3–1'],
    ['runs', { kind: 'runs', a: 12, b: 4 }, '12–4'],
  ] as const)('reads a %s score as one pair', (_, score, expected) => {
    const { host } = withGame({ winner: 0, score });
    expect(text(lineOf(host))).toBe(`Score: ${expected}`);
  });

  it('styles the line as a muted small row with the padding of a team row', () => {
    const { host } = withGame({ winner: 0, score: THREE_SETS });
    const line = lineOf(host)!;
    expect(line.classList).toContain('text-sm');
    expect(line.classList).toContain('text-muted-foreground');
    expect(line.classList).toContain('px-3');
    expect(line.classList).toContain('py-2');
  });

  it.each([
    [0, 'Sand Crabs forfeited'],
    [1, 'Dig Dogs forfeited'],
  ] as const)(
    'reads a forfeit in place %i as the team and forfeited, with no score',
    (side, expected) => {
      const { host } = withGame({ winner: side === 0 ? 1 : 0, forfeit: side });
      const line = lineOf(host)!;
      expect(text(line)).toBe(expected);
      expect(line.querySelector('.sr-only')).toBeNull();
      expect(text(games(host)[0])).not.toContain('Score');
      expect(text(games(host)[0])).not.toMatch(/\d+–\d+/);
    },
  );

  it('reads Forfeit when no team fills the place that forfeited', () => {
    const { host } = withGame({ teams: [team('Sand Crabs', 1), null], forfeit: 1 });
    expect(text(lineOf(host))).toBe('Forfeit');
  });

  it('shows the forfeit line and not the score when a game carries both', () => {
    const { host } = withGame({
      winner: 1,
      forfeit: 0,
      score: { kind: 'sets', sets: [{ a: 0, b: 21 }] },
    });
    expect(host.querySelectorAll('[data-testid="bracket-score"]')).toHaveLength(1);
    expect(text(lineOf(host))).toBe('Sand Crabs forfeited');
  });

  it('shows no line for a bye, a place to be decided, and a two-team game with no result', () => {
    const { host } = create({
      rounds: [
        {
          name: 'Semifinals',
          games: [
            { teams: [team('Sand Crabs', 1), null], bye: true, winner: 0 },
            QUARTER,
            { teams: [team('Net Results', 2), null], bye: false },
          ],
        },
        { name: 'Final', games: [{ teams: [null, null], bye: false }] },
      ],
    });
    expect(host.querySelectorAll('[data-testid="bracket-score"]')).toHaveLength(0);
    expect(host.textContent).not.toContain('Score');
  });

  it('shows a corrected score in place of the old one', () => {
    const fixture = TestBed.createComponent(PublicBracket);
    const show = (score: Score) => {
      const game: Game = { ...QUARTER, winner: 0, score };
      fixture.componentRef.setInput('bracket', { rounds: [{ name: 'Final', games: [game] }] });
      fixture.detectChanges();
      return text(lineOf(fixture.nativeElement as HTMLElement));
    };
    expect(show({ kind: 'sets', sets: [{ a: 21, b: 15 }] })).toBe('Score: 21–15');
    expect(show({ kind: 'sets', sets: [{ a: 12, b: 21 }] })).toBe('Score: 12–21');
  });
});

describe('PublicBracket scroll hint', () => {
  type Callback = () => void;
  let callbacks: Callback[];
  let disconnects: number;
  let observed: Element[];

  beforeEach(() => {
    callbacks = [];
    disconnects = 0;
    observed = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: Callback) {
          callbacks.push(callback);
        }
        observe(element: Element) {
          observed.push(element);
        }
        disconnect() {
          disconnects++;
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const hint = (host: HTMLElement) => host.querySelector('[data-testid="bracket-scroll-hint"]')!;

  function measure(
    fixture: { detectChanges(): void },
    host: HTMLElement,
    wide: number,
    shown: number,
  ) {
    const scroller = host.querySelector('[data-testid="bracket-scroller"]')!;
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: wide });
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: shown });
    for (const callback of callbacks) callback();
    fixture.detectChanges();
  }

  it('shows a visible hint from 768px, until the rounds are measured to fit', () => {
    const { fixture, host } = create(BRACKET);
    expect(text(hint(host))).toBe('Scroll sideways for more rounds.');
    expect(hint(host).classList).toContain('hidden');
    expect(hint(host).classList).toContain('md:block');
    expect(hint(host).classList).not.toContain('invisible');
    measure(fixture, host, 1000, 800);
    expect(hint(host).classList).not.toContain('invisible');
  });

  it('hides the hint, keeping its line, when the rounds fit', () => {
    const { fixture, host } = create(BRACKET);
    measure(fixture, host, 700, 700);
    expect(hint(host).classList).toContain('invisible');
    measure(fixture, host, 900, 700);
    expect(hint(host).classList).not.toContain('invisible');
  });

  it('shows the hint when any one of the sections’ rounds overflows', () => {
    const { fixture, host } = create(DOUBLE);
    const [winners, losers] = [...host.querySelectorAll('[data-testid="bracket-scroller"]')];
    const size = (element: Element, wide: number, shown: number) => {
      Object.defineProperty(element, 'scrollWidth', { configurable: true, value: wide });
      Object.defineProperty(element, 'clientWidth', { configurable: true, value: shown });
    };
    size(winners, 700, 700);
    size(losers, 700, 700);
    for (const callback of callbacks) callback();
    fixture.detectChanges();
    expect(hint(host).classList).toContain('invisible');
    size(losers, 1000, 700);
    for (const callback of callbacks) callback();
    fixture.detectChanges();
    expect(hint(host).classList).not.toContain('invisible');
  });

  it('watches the scroller, and stops when the page goes', () => {
    const { fixture, host } = create(BRACKET);
    expect(observed).toEqual([host.querySelector('[data-testid="bracket-scroller"]')]);
    fixture.destroy();
    expect(disconnects).toBeGreaterThan(0);
  });
});

type GrandFinalData = NonNullable<PublicBracketData['grandFinal']>;

const WINNERS_TEAMS = [team('Sand Crabs', 1), team('Net Results', 2)];

const DOUBLE: PublicBracketData = {
  rounds: [
    { name: 'Winners’ semifinals', games: [QUARTER] },
    { name: 'Winners’ final', games: [{ teams: [null, null], bye: false }] },
  ],
  losers: [
    { name: 'Losers’ round 1', games: [{ teams: [team('Dig Dogs', 8), null], bye: false }] },
    { name: 'Losers’ final', games: [{ teams: [null, null], bye: false }] },
  ],
  grandFinal: { games: [{ teams: [null, null], bye: false }], decidingGameIfNeeded: true },
};

const withGrandFinal = (grandFinal: GrandFinalData) => create({ ...DOUBLE, grandFinal });

const sections = (host: HTMLElement) => [
  ...host.querySelectorAll('section#bracket section[aria-labelledby$="-heading"]'),
];

const NOTE = 'Game 2 is played only if the losers’ bracket team wins game 1.';
const note = (host: HTMLElement) => host.querySelector('[data-testid="grand-final-note"]');

describe('PublicBracket for a double-elimination bracket', () => {
  it('gives the winners’ bracket, the losers’ bracket, and the grand final a section each, under the Bracket heading', () => {
    const { host } = create(DOUBLE);
    const all = sections(host);
    expect(all.map((section) => text(section.querySelector('h3')))).toEqual([
      'Winners’ bracket',
      'Losers’ bracket',
      'Grand final',
    ]);
    for (const section of all) {
      expect(section.getAttribute('aria-labelledby')).toBe(section.querySelector('h3')?.id);
    }
    expect(new Set(all.map((section) => section.querySelector('h3')?.id)).size).toBe(3);
    expect(text(host.querySelector('h2'))).toBe('Bracket');
  });

  it('heads each round with an h4 under its section’s h3, and ids them apart', () => {
    const { host } = create(DOUBLE);
    const [winners, losers] = sections(host);
    expect([...winners.querySelectorAll('h4')].map(text)).toEqual([
      'Winners’ semifinals',
      'Winners’ final',
    ]);
    expect([...losers.querySelectorAll('h4')].map(text)).toEqual([
      'Losers’ round 1',
      'Losers’ final',
    ]);
    const ids = [...host.querySelectorAll('h3, h4')].map((heading) => heading.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(host.querySelectorAll('section#bracket section section[aria-labelledby]')).toHaveLength(
      4,
    );
  });

  it('puts each of the two bracket sections’ rounds in its own labelled region a keyboard can focus', () => {
    const { host } = create(DOUBLE);
    const regions = [...host.querySelectorAll('[data-testid="bracket-scroller"]')];
    expect(regions.map((region) => region.getAttribute('aria-label'))).toEqual([
      'Winners’ bracket rounds',
      'Losers’ bracket rounds',
    ]);
    for (const region of regions) {
      expect(region.getAttribute('role')).toBe('region');
      expect(region.getAttribute('tabindex')).toBe('0');
    }
  });

  it('lists the games of every section with the markup of a single bracket', () => {
    const { host } = create(DOUBLE);
    expect(games(host).map(text)).toEqual([
      'Game 1: (1) Sand Crabs against (8) Dig Dogs',
      'Game 1: To be decided against To be decided',
      'Game 1: (8) Dig Dogs against To be decided',
      'Game 1: To be decided against To be decided',
      'Game 1 To be decided against To be decided',
    ]);
  });

  it('leaves the losers’ bracket out when a bracket of two teams has none', () => {
    const twoTeams = { rounds: DOUBLE.rounds, grandFinal: DOUBLE.grandFinal };
    const { host } = create(twoTeams);
    expect(sections(host).map((section) => text(section.querySelector('h3')))).toEqual([
      'Winners’ bracket',
      'Grand final',
    ]);
  });

  it('shows the winner above the sections', () => {
    const { host } = create({ ...DOUBLE, winner: 'Sand Crabs' });
    const winner = host.querySelector('[data-testid="bracket-winner"]')!;
    expect(text(winner)).toBe('Winner: Sand Crabs');
    expect(
      winner.compareDocumentPosition(sections(host)[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps a single-elimination bracket to its rounds, with no sections and no h4', () => {
    const { host } = create(BRACKET);
    expect(sections(host)).toHaveLength(0);
    expect(host.querySelectorAll('h4')).toHaveLength(0);
    expect(host.textContent).not.toContain('Grand final');
  });
});

describe('PublicBracket grand final', () => {
  const first = { teams: WINNERS_TEAMS, bye: false };
  const grandFinalSection = (host: HTMLElement) => sections(host)[2];

  it('waiting: names game 1 and says game 2 is played only if the losers’ bracket team wins it', () => {
    const { host } = withGrandFinal({ games: [first], decidingGameIfNeeded: true });
    const items = [...grandFinalSection(host).querySelectorAll('li[data-testid="bracket-game"]')];
    expect(items.map(text)).toEqual(['Game 1 (1) Sand Crabs against (2) Net Results']);
    expect(text(note(host))).toBe(NOTE);
  });

  it('not needed: the winners’ bracket team won game 1, so there is no game 2 and no note', () => {
    const { host } = withGrandFinal({
      games: [{ ...first, winner: 0 }],
      decidingGameIfNeeded: true,
    });
    const items = [...grandFinalSection(host).querySelectorAll('li[data-testid="bracket-game"]')];
    expect(items).toHaveLength(1);
    expect(text(items[0])).toBe('Game 1 (1) Sand Crabs Won against (2) Net Results');
    expect(host.textContent).not.toContain('Game 2');
    expect(note(host)).toBeNull();
  });

  it('played: shows Game 2 with its teams after game 1, and no note', () => {
    const { host } = withGrandFinal({
      games: [{ ...first, winner: 1 }, first],
      decidingGameIfNeeded: true,
    });
    const items = [...grandFinalSection(host).querySelectorAll('li[data-testid="bracket-game"]')];
    expect(items.map(text)).toEqual([
      'Game 1 (1) Sand Crabs against (2) Net Results Won',
      'Game 2 (1) Sand Crabs against (2) Net Results',
    ]);
    expect(note(host)).toBeNull();
  });

  it('played: shows the score and the winner of Game 2', () => {
    const { host } = withGrandFinal({
      games: [
        { ...first, winner: 1 },
        { ...first, winner: 0, score: { kind: 'sets', sets: [{ a: 21, b: 15 }] } },
      ],
      decidingGameIfNeeded: true,
    });
    const items = [...grandFinalSection(host).querySelectorAll('li[data-testid="bracket-game"]')];
    expect(text(items[1])).toBe('Game 2 (1) Sand Crabs Won against (2) Net Results Score: 21–15');
  });

  it('a single game: no game number and no note, played or not', () => {
    for (const played of [{}, { winner: 1 } as const]) {
      const { host } = withGrandFinal({
        games: [{ ...first, ...played }],
        decidingGameIfNeeded: false,
      });
      const item = grandFinalSection(host).querySelector('li[data-testid="bracket-game"]')!;
      expect(text(item)).toMatch(/^Game 1: /);
      expect(note(host)).toBeNull();
    }
  });
});
