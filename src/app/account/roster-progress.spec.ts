import { rosterProgress } from './roster-progress';

describe('rosterProgress', () => {
  it('says how many of the minimum are on the roster, and how far along it is', () => {
    expect(rosterProgress(3, 4)).toEqual({ text: '3 of 4 needed', percent: 75, met: false });
  });

  it('is met exactly at the minimum', () => {
    expect(rosterProgress(2, 2)).toEqual({ text: '2 of 2 needed', percent: 100, met: true });
  });

  it('counts the players over the minimum, and keeps the bar full', () => {
    expect(rosterProgress(6, 4)).toEqual({ text: '6 players', percent: 100, met: true });
  });

  it('starts at nothing', () => {
    expect(rosterProgress(0, 4)).toEqual({ text: '0 of 4 needed', percent: 0, met: false });
  });
});
