import { sportList, sportPhrase } from './sport-list';

describe('sportList', () => {
  it.each([
    [[], ''],
    [['Soccer'], 'Soccer'],
    [['Soccer', 'Softball'], 'Soccer, softball'],
    [['Beach volleyball', 'Soccer', 'Softball'], 'Beach volleyball, soccer, softball'],
  ])('lists %j as %j', (names, expected) => {
    expect(sportList(names)).toBe(expected);
  });
});

describe('sportPhrase', () => {
  it.each([
    [[], ''],
    [['Soccer'], 'Soccer'],
    [['Soccer', 'Softball'], 'Soccer and softball'],
    [['Beach volleyball', 'Soccer', 'Softball'], 'Beach volleyball, soccer, and softball'],
  ])('joins %j as %j', (names, expected) => {
    expect(sportPhrase(names)).toBe(expected);
  });
});
