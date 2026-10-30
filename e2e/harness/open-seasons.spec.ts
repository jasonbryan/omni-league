import { expectedOpenCards } from '../support/open-seasons';
import { expect, test } from '../support/fixtures';
import { VIEWPORT_AGNOSTIC } from '../support/viewport-agnostic';

const GULF_COAST = 'gulf-coast-sport-social';

test.describe('expected Registration open cards from the demo data', VIEWPORT_AGNOSTIC, () => {
  test('lists the published Summer 2027 seasons by soonest deadline on 2026-10-30', () => {
    expect(expectedOpenCards(GULF_COAST, Date.parse('2026-10-30T17:00:00Z'))).toEqual([
      { leagueName: 'Coed 7v7 Rec', seasonName: 'Summer 2027' },
      { leagueName: 'Sunday Reverse Coed 4s', seasonName: 'Summer 2027' },
    ]);
  });

  test('keeps a season open through its deadline date and drops it the day after', () => {
    expect(expectedOpenCards(GULF_COAST, Date.parse('2027-05-20T11:59:00Z'))).toEqual([
      { leagueName: 'Coed 7v7 Rec', seasonName: 'Summer 2027' },
      { leagueName: 'Sunday Reverse Coed 4s', seasonName: 'Summer 2027' },
    ]);
    expect(expectedOpenCards(GULF_COAST, Date.parse('2027-05-20T12:00:00Z'))).toEqual([
      { leagueName: 'Sunday Reverse Coed 4s', seasonName: 'Summer 2027' },
    ]);
  });

  test('is empty after the last demo deadline', () => {
    expect(expectedOpenCards(GULF_COAST, Date.parse('2027-05-25T12:00:00Z'))).toEqual([]);
  });

  test('never counts the seasons dated from the run as open', () => {
    const titles = expectedOpenCards(GULF_COAST, Date.now()).map((card) => card.seasonName);
    expect(titles).not.toContain('Current season');
    expect(titles).not.toContain('Next season');
  });

  test('is empty for a demo organization with no published season', () => {
    expect(
      expectedOpenCards('port-aransas-beach-volleyball-club', Date.parse('2026-10-30T17:00:00Z')),
    ).toEqual([]);
  });

  test('throws for a slug that is no demo organization', () => {
    expect(() => expectedOpenCards('no-such-organization', 0)).toThrow(
      'No demo organization has the slug no-such-organization',
    );
  });
});
