import { TestBed } from '@angular/core/testing';
import type { PublicPool } from '../../../../convex/lib/publicPage';
import { PublicPools } from './public-pools';
import { spacedText } from './testing/spaced-text';

const COLUMNS = [
  { short: 'P', label: 'Played' },
  { short: 'W', label: 'Won' },
  { short: 'L', label: 'Lost' },
  { short: 'Win %', label: 'Win percentage' },
  { short: '+/-', label: 'Point differential' },
];

const ONE_SET = { kind: 'sets' as const, sets: [{ a: 21, b: 15 }] };

const POOL_A: PublicPool = {
  pool: 'A',
  columns: COLUMNS,
  standings: [
    { place: 1, name: 'Ace', cells: ['1', '1', '0', '100%', '+6'] },
    { place: 2, name: 'Cove', cells: ['0', '0', '0', '0%', '0'] },
    { place: 3, name: 'Bay', cells: ['1', '0', '1', '0%', '-6'] },
  ],
  tiebreakers: 'Teams level on win percentage are ordered by head-to-head.',
  games: [
    { round: 1, teams: ['Ace', 'Bay'], score: ONE_SET, winner: 0 },
    { round: 2, teams: ['Ace', 'Cove'] },
    { round: 3, teams: ['Bay', 'Cove'] },
  ],
};

const UNPLAYED: PublicPool = {
  ...POOL_A,
  pool: 'B',
  standings: POOL_A.standings.map((row) => ({ ...row, place: 1 })),
  games: POOL_A.games.map(({ round, teams }) => ({ round, teams })),
};

function create(pools: readonly PublicPool[] | undefined) {
  const fixture = TestBed.createComponent(PublicPools);
  fixture.componentRef.setInput('pools', pools);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const text = spacedText;

describe('PublicPools', () => {
  it('renders nothing for a tournament with no pools', () => {
    expect(create(undefined).querySelector('section')).toBeNull();
  });

  it('heads the section Pools and gives each pool a section headed by its name', () => {
    const host = create([POOL_A, UNPLAYED]);
    const section = host.querySelector('section#pools');
    expect(text(section?.querySelector('h2'))).toBe('Pools');
    expect(section?.getAttribute('aria-labelledby')).toBe(section?.querySelector('h2')?.id);
    const pools = [...host.querySelectorAll('[data-testid="pool"]')];
    expect(pools.map((pool) => text(pool.querySelector('h3')))).toEqual(['Pool A', 'Pool B']);
    for (const pool of pools) {
      expect(pool.getAttribute('aria-labelledby')).toBe(pool.querySelector('h3')?.id);
    }
    expect(new Set(pools.map((pool) => pool.querySelector('h3')?.id)).size).toBe(2);
  });

  describe('the standings table', () => {
    it('has a caption naming the pool', () => {
      const table = create([POOL_A]).querySelector('table')!;
      expect(text(table.querySelector('caption'))).toBe('Pool A standings');
      expect(table.firstElementChild?.tagName).toBe('CAPTION');
    });

    it('has a column header for every column, each in the header row with scope col', () => {
      const table = create([POOL_A]).querySelector('table')!;
      const headers = [...table.querySelectorAll('thead th')];
      expect(headers.every((th) => th.getAttribute('scope') === 'col')).toBe(true);
      expect(headers.map((th) => text(th))).toEqual([
        'Place #',
        'Team',
        'P Played',
        'W Won',
        'L Lost',
        'Win % Win percentage',
        '+/- Point differential',
      ]);
    });

    it('has a row for each team with the team as its row header', () => {
      const table = create([POOL_A]).querySelector('table')!;
      const rows = [...table.querySelectorAll('tbody tr')];
      expect(rows.map((row) => text(row.querySelector('th[scope="row"]')))).toEqual([
        'Ace',
        'Cove',
        'Bay',
      ]);
      expect([...rows[0].querySelectorAll('td')].map((td) => text(td))).toEqual([
        '1',
        '1',
        '1',
        '0',
        '100%',
        '+6',
      ]);
    });

    it('says what the short headings and the tiebreakers are', () => {
      const host = create([POOL_A]);
      expect(text(host.querySelector('[data-testid="standings-key"]'))).toBe(
        'P played, W won, L lost, Win % win percentage, +/- point differential.',
      );
      expect(text(host)).toContain('Teams level on win percentage are ordered by head-to-head.');
    });
  });

  describe('a pool with no result yet', () => {
    it('says when standings appear, in place of a table', () => {
      const pool = create([UNPLAYED]).querySelector('[data-testid="pool"]')!;
      expect(text(pool.querySelector('[data-testid="no-standings"]'))).toBe(
        'Standings appear after the first result.',
      );
      expect(pool.querySelector('table')).toBeNull();
    });

    it('still lists the games', () => {
      expect(create([UNPLAYED]).querySelectorAll('[data-testid="pool-game"]')).toHaveLength(3);
    });
  });

  describe('the games', () => {
    it('lists each with its round and teams, and a played game with its result', () => {
      const games = [...create([POOL_A]).querySelectorAll('[data-testid="pool-game"]')];
      expect(games.map((game) => text(game))).toEqual([
        'Round 1 Ace v Bay 21–15. Ace won.',
        'Round 2 Ace v Cove',
        'Round 3 Bay v Cove',
      ]);
      expect(games[0].closest('ol')).not.toBeNull();
    });

    it('heads each pool’s games', () => {
      const host = create([POOL_A]);
      expect(text(host.querySelector('h4'))).toBe('Games in Pool A');
    });
  });
});
