import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  AGE_GROUPS,
  GENDERS,
  STANDARD_LEVEL_LABELS,
  ageGroupLabel,
  ageGroupValidator,
  customLevelLabel,
  deriveDivisionFromName,
  divisionLabel,
  formatLabel,
  genderLabel,
  genderValidator,
  isLevelOfSport,
  isPlayersPerSideOfSport,
  isYouth,
  levelLabel,
  levelsOfSport,
  playersPerSideOfSport,
  standardLevelValidator,
} from './divisions';
import { SPORT_FORMATS, SPORT_NAMES, formatName, type Sport } from './sports';

const sports = Object.keys(SPORT_NAMES) as Sport[];

describe('gender', () => {
  test('lists Coed, Men’s, and Women’s, with no Open gender', () => {
    expect([...GENDERS]).toEqual(['coed', 'mens', 'womens']);
    expect(GENDERS.map((gender) => genderLabel(gender))).toEqual(['Coed', "Men's", "Women's"]);
  });

  test('reads Men’s and Women’s as Boys and Girls for a youth age group', () => {
    expect(GENDERS.map((gender) => genderLabel(gender, 'u12'))).toEqual(['Coed', 'Boys', 'Girls']);
    expect(GENDERS.map((gender) => genderLabel(gender, 'adult'))).toEqual([
      'Coed',
      "Men's",
      "Women's",
    ]);
    expect(genderLabel('mens', 'over40')).toBe("Men's");
  });

  test('the validator accepts exactly the gender keys', () => {
    expect(genderValidator.members.map((member) => member.value)).toEqual([...GENDERS]);
  });
});

describe('standard levels', () => {
  test('are the ladder of each sport, in order', () => {
    expect(levelsOfSport('beachVolleyball')).toEqual(['rec', 'b', 'bb', 'a', 'aa', 'open']);
    expect(levelsOfSport('soccer')).toEqual(['rec', 'intermediate', 'competitive']);
    expect(levelsOfSport('softball')).toEqual(['rec', 'intermediate', 'competitive']);
  });

  test('have a label for every key of every list', () => {
    expect(levelsOfSport('beachVolleyball').map(levelLabel)).toEqual([
      'Rec',
      'B',
      'BB',
      'A',
      'AA',
      'Open',
    ]);
    for (const sport of ['soccer', 'softball'] as const) {
      expect(levelsOfSport(sport).map(levelLabel)).toEqual(['Rec', 'Intermediate', 'Competitive']);
    }
    for (const sport of sports) {
      for (const level of levelsOfSport(sport)) {
        expect(STANDARD_LEVEL_LABELS[level]).toBeTruthy();
      }
    }
  });

  test('answers whether a level belongs to a sport', () => {
    expect(isLevelOfSport('beachVolleyball', 'bb')).toBe(true);
    expect(isLevelOfSport('beachVolleyball', 'competitive')).toBe(false);
    expect(isLevelOfSport('soccer', 'open')).toBe(false);
    expect(isLevelOfSport('softball', 'intermediate')).toBe(true);
  });

  test('the validator accepts exactly the union of every sport’s keys', () => {
    const literals = standardLevelValidator.members.map((member) => member.value).sort();
    const keys = [...new Set(sports.flatMap((sport) => levelsOfSport(sport)))].sort();
    expect(literals).toEqual(keys);
  });
});

describe('age groups', () => {
  test('are Adult, 30+ to 60+, then U6 to U19, in order', () => {
    expect(AGE_GROUPS.map((group) => group.key)).toEqual([
      'adult',
      'over30',
      'over35',
      'over40',
      'over50',
      'over55',
      'over60',
      ...Array.from({ length: 14 }, (_, index) => `u${index + 6}`),
    ]);
    expect(AGE_GROUPS.map((group) => group.label)).toEqual([
      'Adult',
      '30+',
      '35+',
      '40+',
      '50+',
      '55+',
      '60+',
      ...Array.from({ length: 14 }, (_, index) => `U${index + 6}`),
    ]);
    expect(AGE_GROUPS[0].key).toBe('adult');
  });

  test('labels each key', () => {
    expect(ageGroupLabel('adult')).toBe('Adult');
    expect(ageGroupLabel('over30')).toBe('30+');
    expect(ageGroupLabel('u19')).toBe('U19');
  });

  test('treats only U6 to U19 as youth', () => {
    const youth = AGE_GROUPS.filter((group) => isYouth(group.key)).map((group) => group.key);
    expect(youth).toEqual(Array.from({ length: 14 }, (_, index) => `u${index + 6}`));
    expect(isYouth('adult')).toBe(false);
    expect(isYouth('over60')).toBe(false);
  });

  test('the validator accepts exactly the age group keys', () => {
    expect(ageGroupValidator.members.map((member) => member.value)).toEqual(
      AGE_GROUPS.map((group) => group.key),
    );
  });
});

describe('players per side', () => {
  test('is a range per sport', () => {
    expect(playersPerSideOfSport('beachVolleyball')).toEqual([2, 3, 4, 5, 6]);
    expect(playersPerSideOfSport('soccer')).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(playersPerSideOfSport('softball')).toEqual([9, 10]);
  });

  test('accepts whole numbers in the range and nothing else', () => {
    expect(isPlayersPerSideOfSport('beachVolleyball', 2)).toBe(true);
    expect(isPlayersPerSideOfSport('beachVolleyball', 6)).toBe(true);
    expect(isPlayersPerSideOfSport('beachVolleyball', 1)).toBe(false);
    expect(isPlayersPerSideOfSport('beachVolleyball', 7)).toBe(false);
    expect(isPlayersPerSideOfSport('soccer', 4)).toBe(true);
    expect(isPlayersPerSideOfSport('soccer', 11)).toBe(true);
    expect(isPlayersPerSideOfSport('soccer', 12)).toBe(false);
    expect(isPlayersPerSideOfSport('softball', 8)).toBe(false);
    expect(isPlayersPerSideOfSport('softball', 9)).toBe(true);
    expect(isPlayersPerSideOfSport('softball', 10)).toBe(true);
    expect(isPlayersPerSideOfSport('soccer', 4.5)).toBe(false);
    expect(isPlayersPerSideOfSport('soccer', Number.NaN)).toBe(false);
  });

  test('covers every current season format of every sport', () => {
    for (const sport of sports) {
      for (const format of SPORT_FORMATS[sport]) {
        expect(isPlayersPerSideOfSport(sport, format.minimumRosterSize)).toBe(true);
      }
    }
  });
});

describe('format display', () => {
  test('formatLabel writes players per side as 4v4', () => {
    expect(formatLabel(4)).toBe('4v4');
    expect(formatLabel(11)).toBe('11v11');
  });

  test('each season format name is its key, written as players per side', () => {
    expect(formatName('beachVolleyball', '4v4')).toBe('4v4');
    for (const sport of sports) {
      for (const format of SPORT_FORMATS[sport]) {
        expect(format.name).toBe(format.key);
        expect(format.name).toBe(formatLabel(format.minimumRosterSize));
      }
    }
  });
});

describe('divisionLabel', () => {
  test('joins gender, format, and level with a middle dot', () => {
    expect(
      divisionLabel({ gender: 'coed', playersPerSide: 4, levelLabel: 'BB', ageGroup: 'adult' }),
    ).toBe('Coed · 4v4 · BB');
  });

  test('adds an adult bracket after the level', () => {
    expect(
      divisionLabel({ gender: 'mens', playersPerSide: 11, levelLabel: 'Rec', ageGroup: 'over30' }),
    ).toBe("Men's · 11v11 · Rec · 30+");
  });

  test('reads gender as Boys or Girls for a youth group and adds the group', () => {
    expect(
      divisionLabel({ gender: 'womens', playersPerSide: 7, levelLabel: 'Rec', ageGroup: 'u10' }),
    ).toBe('Girls · 7v7 · Rec · U10');
    expect(
      divisionLabel({ gender: 'mens', playersPerSide: 7, levelLabel: 'Rec', ageGroup: 'u10' }),
    ).toBe('Boys · 7v7 · Rec · U10');
    expect(
      divisionLabel({ gender: 'coed', playersPerSide: 5, levelLabel: 'Rec', ageGroup: 'u8' }),
    ).toBe('Coed · 5v5 · Rec · U8');
  });

  test('treats a missing age group as Adult', () => {
    expect(divisionLabel({ gender: 'womens', playersPerSide: 2, levelLabel: 'A' })).toBe(
      "Women's · 2v2 · A",
    );
  });

  test('names every age group without a trailing dot for Adult', () => {
    for (const { key, label } of AGE_GROUPS) {
      const text = divisionLabel({
        gender: 'coed',
        playersPerSide: 4,
        levelLabel: 'Rec',
        ageGroup: key,
      });
      expect(text).toBe(key === 'adult' ? 'Coed · 4v4 · Rec' : `Coed · 4v4 · Rec · ${label}`);
    }
  });
});

describe('customLevelLabel', () => {
  test('shows an organization’s level with the standard level it maps to', () => {
    expect(customLevelLabel('Gold', 'a', 'beachVolleyball')).toBe('Gold (A)');
    expect(customLevelLabel('Div 1', 'competitive', 'soccer')).toBe('Div 1 (Competitive)');
  });

  test('throws for a standard level of another sport', () => {
    expect(() => customLevelLabel('Gold', 'a', 'soccer')).toThrow();
  });
});

describe('deriveDivisionFromName', () => {
  type Derived = ReturnType<typeof deriveDivisionFromName>;
  const rows: [string, Sport, Derived][] = [
    [
      "Wednesday Women's 2s BB",
      'beachVolleyball',
      { gender: 'womens', playersPerSide: 2, level: 'bb' },
    ],
    ['Sunday Reverse Coed 4s', 'beachVolleyball', { gender: 'coed', playersPerSide: 4 }],
    ["Men's Over-30 11v11", 'soccer', { gender: 'mens', playersPerSide: 11 }],
    ["Competitive Men's 4s", 'beachVolleyball', { gender: 'mens', playersPerSide: 4 }],
    ['Coed 7v7 Rec', 'soccer', { gender: 'coed', playersPerSide: 7, level: 'rec' }],
    ['Coed 12v12', 'soccer', { gender: 'coed' }],
    ['Play a game', 'beachVolleyball', {}],
    ["Women's A League", 'beachVolleyball', { gender: 'womens', level: 'a' }],
    ['Open Doubles', 'soccer', {}],
    ['Women’s 2s', 'beachVolleyball', { gender: 'womens', playersPerSide: 2 }],
    ['CO-ED 4s', 'beachVolleyball', { gender: 'coed', playersPerSide: 4 }],
    ['Men’s 4’s rec', 'beachVolleyball', { gender: 'mens', playersPerSide: 4, level: 'rec' }],
    ['Coed 4s and 6s', 'beachVolleyball', { gender: 'coed', playersPerSide: 4 }],
    ['A Coed League', 'beachVolleyball', { gender: 'coed' }],
  ];

  test.each(rows)('%j (%s)', (name, sport, expected) => {
    expect(deriveDivisionFromName(name, sport)).toStrictEqual(expected);
  });

  test.each<[string, Sport, Derived]>([
    ['WOMENS 4S', 'beachVolleyball', { gender: 'womens', playersPerSide: 4 }],
    ['ladies 4 v 4', 'beachVolleyball', { gender: 'womens', playersPerSide: 4 }],
    ['Mens 4V4 REC', 'beachVolleyball', { gender: 'mens', playersPerSide: 4, level: 'rec' }],
    [
      'Coed Intermediate 7v7',
      'soccer',
      { gender: 'coed', playersPerSide: 7, level: 'intermediate' },
    ],
    [
      'COMPETITIVE coed 10s',
      'softball',
      { gender: 'coed', playersPerSide: 10, level: 'competitive' },
    ],
    ['coed 4s open', 'beachVolleyball', { gender: 'coed', playersPerSide: 4, level: 'open' }],
    ['Coed 6s AA', 'beachVolleyball', { gender: 'coed', playersPerSide: 6, level: 'aa' }],
    ['Coed 6s B', 'beachVolleyball', { gender: 'coed', playersPerSide: 6, level: 'b' }],
  ])('matches %j ignoring case where the rules allow', (name, sport, expected) => {
    expect(deriveDivisionFromName(name, sport)).toStrictEqual(expected);
  });

  test.each<[string, Sport]>([
    ['Coed 4s bb', 'beachVolleyball'],
    ['Coed 4s aa', 'beachVolleyball'],
    ['Coed 4s a', 'beachVolleyball'],
    ['Coed 4s b', 'beachVolleyball'],
  ])('reads lowercase letter levels in %j as ordinary words', (name, sport) => {
    expect(deriveDivisionFromName(name, sport).level).toBeUndefined();
  });

  test('matches whole words only', () => {
    expect(deriveDivisionFromName('Menstrual Recreation Opening', 'beachVolleyball')).toStrictEqual(
      {},
    );
    expect(deriveDivisionFromName('Women4s', 'beachVolleyball')).toStrictEqual({});
    expect(deriveDivisionFromName('Gladiators 4s', 'beachVolleyball')).toStrictEqual({
      playersPerSide: 4,
    });
    expect(deriveDivisionFromName("Women's", 'soccer')).toStrictEqual({ gender: 'womens' });
  });

  test('does not read a gender word inside a longer word', () => {
    expect(deriveDivisionFromName("Policemen's 4s", 'beachVolleyball')).toStrictEqual({
      playersPerSide: 4,
    });
    expect(deriveDivisionFromName('Policemens 4s', 'beachVolleyball')).toStrictEqual({
      playersPerSide: 4,
    });
    expect(deriveDivisionFromName('Intercoed 4s', 'beachVolleyball')).toStrictEqual({
      playersPerSide: 4,
    });
    expect(deriveDivisionFromName('Superladies 4s', 'beachVolleyball')).toStrictEqual({
      playersPerSide: 4,
    });
  });

  test('takes the first level in the name', () => {
    expect(deriveDivisionFromName('Rec Open BB', 'beachVolleyball').level).toBe('rec');
    expect(deriveDivisionFromName('BB AA', 'beachVolleyball').level).toBe('bb');
    expect(deriveDivisionFromName('Intermediate Competitive', 'soccer').level).toBe('intermediate');
  });

  test('reads a level in straight quotes', () => {
    expect(deriveDivisionFromName("Coed 'BB' 4s", 'beachVolleyball')).toStrictEqual({
      gender: 'coed',
      playersPerSide: 4,
      level: 'bb',
    });
    expect(deriveDivisionFromName("Coed 'Rec'", 'soccer')).toStrictEqual({
      gender: 'coed',
      level: 'rec',
    });
  });

  test('does not read an age group number as a format', () => {
    expect(deriveDivisionFromName('U10 Girls 7s', 'soccer')).toStrictEqual({ playersPerSide: 7 });
    expect(deriveDivisionFromName('U10 Girls', 'soccer')).toStrictEqual({});
  });

  test('takes the earliest gender and the first format in range', () => {
    expect(deriveDivisionFromName("Women's and Men's 4s", 'beachVolleyball').gender).toBe('womens');
    expect(deriveDivisionFromName('Coed 12s 7s', 'soccer').playersPerSide).toBe(7);
  });

  test('reads a bare number without v or s as no format', () => {
    expect(deriveDivisionFromName('Coed 4', 'beachVolleyball')).toStrictEqual({ gender: 'coed' });
    expect(deriveDivisionFromName('Coed 4v5', 'beachVolleyball')).toStrictEqual({
      gender: 'coed',
    });
  });

  test('does not derive an age group', () => {
    expect(deriveDivisionFromName("Men's Over-30 U10 4s", 'beachVolleyball')).toStrictEqual({
      gender: 'mens',
      playersPerSide: 4,
    });
  });

  test('gives nothing for an empty name', () => {
    expect(deriveDivisionFromName('', 'softball')).toStrictEqual({});
  });
});

describe('imports', () => {
  test('divisions.ts imports only convex/values and ./sports, so the app can import it', () => {
    const source = readFileSync(new URL('./divisions.ts', import.meta.url), 'utf8');
    const specifiers = [...source.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)].map(
      (match) => match[1],
    );
    expect(specifiers.sort()).toEqual(['./sports', 'convex/values']);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});
