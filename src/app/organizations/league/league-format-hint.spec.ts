import { formatHint, publishedSeasonsEarliestFirst } from './league-format-hint';

const LEAD = 'Players on each side, and so the minimum roster size.';

const seasons = (...names: string[]) => names.map((name) => ({ name, formatName: '4v4' }));

describe('formatHint', () => {
  it('names the one published season, which keeps its format', () => {
    expect(formatHint(seasons('Summer 2027'))).toBe(
      `${LEAD} A change applies to new seasons; Summer 2027 keeps 4v4.`,
    );
  });

  it('names two and three published seasons', () => {
    expect(formatHint(seasons('Summer 2027', 'Fall 2027'))).toBe(
      `${LEAD} A change applies to new seasons; Summer 2027 and Fall 2027 keep 4v4.`,
    );
    expect(formatHint(seasons('A', 'B', 'C'))).toBe(
      `${LEAD} A change applies to new seasons; A, B and C keep 4v4.`,
    );
  });

  it('names three of five, then counts the rest', () => {
    expect(
      formatHint(seasons('Summer 2027', 'Fall 2027', 'Spring 2028', 'Summer 2028', 'Fall 2028')),
    ).toBe(
      `${LEAD} A change applies to new seasons; Summer 2027, Fall 2027, Spring 2028 and 2 more keep 4v4.`,
    );
  });

  it('names none when no season is published', () => {
    expect(formatHint([])).toBe(`${LEAD} A change applies to new seasons.`);
  });

  it('says the seasons keep their own formats when they differ', () => {
    expect(
      formatHint([
        { name: 'Summer 2027', formatName: '4v4' },
        { name: 'Fall 2027', formatName: '6v6' },
      ]),
    ).toBe(
      `${LEAD} A change applies to new seasons; Summer 2027 and Fall 2027 keep their own formats.`,
    );
  });
});

describe('publishedSeasonsEarliestFirst', () => {
  const season = (name: string, startDate: string, status: 'draft' | 'published') => ({
    name,
    startDate,
    status,
    formatName: '4v4',
  });

  it('lists published seasons only, earliest first', () => {
    expect(
      publishedSeasonsEarliestFirst([
        season('Fall 2027', '2027-09-12', 'published'),
        season('Winter 2027', '2027-12-12', 'draft'),
        season('Summer 2027', '2027-06-06', 'published'),
      ]).map((s) => s.name),
    ).toEqual(['Summer 2027', 'Fall 2027']);
  });
});
