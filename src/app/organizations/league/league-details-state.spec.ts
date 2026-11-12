import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import {
  LeagueDetails,
  savedDetails,
  type DetailsValues,
  type ExpectedDetails,
} from './league-details-state';

const DIVISION = {
  gender: 'coed' as const,
  playersPerSide: 4,
  level: 'bb' as const,
  ageGroup: 'adult' as const,
  minimumRosterSize: 5,
  label: 'Coed · 4v4 · BB',
};

function newDetails(): LeagueDetails {
  return TestBed.runInInjectionContext(() => new LeagueDetails(() => 'beachVolleyball'));
}

function sendStub() {
  return vi.fn<(values: DetailsValues, expected: ExpectedDetails) => Promise<string>>(() =>
    Promise.resolve('sent'),
  );
}

describe('LeagueDetails', () => {
  it('sends the loaded name and division as the expected values', async () => {
    const details = newDetails();
    details.load(savedDetails('Sunday Sand', DIVISION));
    const send = sendStub();
    await details.submit(true, send);
    expect(send.mock.calls[0]?.[1]).toEqual({
      name: 'Sunday Sand',
      gender: 'coed',
      playersPerSide: 4,
      level: 'bb',
      ageGroup: 'adult',
      minimumRosterSize: 5,
    });
  });

  it('sends the newer name and division as the expected values after another organizer changed the league', async () => {
    const details = newDetails();
    details.load(savedDetails('Sunday Sand', DIVISION));
    details.takeNewerLeague(
      savedDetails('Sunday Grass', { ...DIVISION, playersPerSide: 6, minimumRosterSize: 7 }),
    );
    const send = sendStub();
    await details.submit(true, send);
    expect(send.mock.calls[0]?.[1]).toEqual({
      name: 'Sunday Grass',
      gender: 'coed',
      playersPerSide: 6,
      level: 'bb',
      ageGroup: 'adult',
      minimumRosterSize: 7,
    });
    expect(details.division.baseline).toMatchObject({ playersPerSide: 6, minimumRosterSize: 7 });
  });

  it('throws and sends nothing when submitted before a league is loaded', async () => {
    const details = newDetails();
    const send = sendStub();
    await expect(details.submit(true, send)).rejects.toThrow('LeagueDetails.submit before load');
    expect(send).not.toHaveBeenCalled();
  });
});
