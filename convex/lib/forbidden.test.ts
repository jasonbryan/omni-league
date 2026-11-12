import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import {
  forbidden,
  forbiddenTournamentTeam,
  isForbidden,
  isForbiddenTournamentTeam,
} from './forbidden';

describe('forbidden', () => {
  test('both kinds are forbidden, and only the tournament team kind says so', () => {
    expect(isForbidden(forbidden())).toBe(true);
    expect(isForbidden(forbiddenTournamentTeam())).toBe(true);
    expect(isForbiddenTournamentTeam(forbidden())).toBe(false);
    expect(isForbiddenTournamentTeam(forbiddenTournamentTeam())).toBe(true);
  });

  test('another failure is neither', () => {
    for (const failure of [
      new Error('x'),
      new ConvexError({ code: 'OTHER', team: 'tournament' }),
    ]) {
      expect(isForbidden(failure)).toBe(false);
      expect(isForbiddenTournamentTeam(failure)).toBe(false);
    }
  });
});
