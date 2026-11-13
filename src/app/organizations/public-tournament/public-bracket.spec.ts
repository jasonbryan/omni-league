import { TestBed } from '@angular/core/testing';
import type { PublicBracket as PublicBracketData } from '../../../../convex/lib/publicPage';
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

  it('watches the scroller, and stops when the page goes', () => {
    const { fixture, host } = create(BRACKET);
    expect(observed).toEqual([host.querySelector('[data-testid="bracket-scroller"]')]);
    fixture.destroy();
    expect(disconnects).toBeGreaterThan(0);
  });
});
