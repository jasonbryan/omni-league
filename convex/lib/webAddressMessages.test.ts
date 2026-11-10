import { describe, expect, test } from 'vitest';
import { LEAGUE_MESSAGES } from './leagueInput';
import { ORGANIZATION_MESSAGES } from './organizationInput';
import { SEASON_MESSAGES } from './seasonInput';

describe.each([
  ['organization', ORGANIZATION_MESSAGES],
  ['league', LEAGUE_MESSAGES],
  ['season', SEASON_MESSAGES],
])('%s messages about the web address', (_name, messages) => {
  test('never use the word slug', () => {
    for (const message of [
      messages.slugEmpty,
      messages.slugInvalid,
      messages.slugTaken('coed-sixes'),
    ]) {
      expect(message).not.toMatch(/slug/i);
    }
  });

  test('name the taken address and say what to do', () => {
    expect(messages.slugTaken('coed-sixes')).toBe(
      'coed-sixes is already taken. Choose another web address.',
    );
  });
});
