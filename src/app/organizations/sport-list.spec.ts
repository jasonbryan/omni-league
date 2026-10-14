import { sportsCommaList, sportsInSentence } from './sport-list';

describe('sportsCommaList', () => {
  it.each([
    [[], ''],
    [['Soccer'], 'Soccer'],
    [['Soccer', 'Softball'], 'Soccer, softball'],
    [['Beach volleyball', 'Soccer', 'Softball'], 'Beach volleyball, soccer, softball'],
  ])('lists %j as %j', (names, expected) => {
    expect(sportsCommaList(names)).toBe(expected);
  });
});

describe('sportsInSentence', () => {
  it.each([
    [[], ''],
    [['Soccer'], 'Soccer'],
    [['Soccer', 'Softball'], 'Soccer and softball'],
    [['Beach volleyball', 'Soccer', 'Softball'], 'Beach volleyball, soccer, and softball'],
  ])('joins %j as %j', (names, expected) => {
    expect(sportsInSentence(names)).toBe(expected);
  });
});
