import { ConvexError } from 'convex/values';
import { placeFailureOf, placedText } from './place-free-agent-text';

describe('placedText', () => {
  it('counts against the minimum up to it, and in players past it', () => {
    expect(placedText('Avery Chen', 'Dig Deep', 3, 4)).toEqual({
      title: 'Avery Chen is on Dig Deep now.',
      description: 'Dig Deep has 3 of 4 players.',
    });
    expect(placedText('Avery Chen', 'Dig Deep', 4, 4).description).toBe(
      'Dig Deep has 4 of 4 players.',
    );
    expect(placedText('Avery Chen', 'Block Party', 7, 4).description).toBe(
      'Block Party has 7 players.',
    );
    expect(placedText('Avery Chen', 'Duo', 1, 1).description).toBe('Duo has 1 of 1 player.');
  });
});

describe('placeFailureOf', () => {
  it('reads the roster refusals with their team, and an already-placed refusal', () => {
    for (const code of ['alreadyOnTeam', 'alreadyOnAnotherTeam']) {
      expect(placeFailureOf(new ConvexError({ code, teamName: 'Sand Sharks' }))).toEqual({
        kind: 'onTeam',
        teamName: 'Sand Sharks',
      });
    }
    expect(placeFailureOf(new ConvexError({ code: 'alreadyPlaced' }))).toEqual({
      kind: 'alreadyPlaced',
    });
  });

  it('reads anything else as a failure', () => {
    expect(placeFailureOf(new Error('Not allowed'))).toEqual({ kind: 'failed' });
    expect(placeFailureOf(new ConvexError({ code: 'FORBIDDEN' }))).toEqual({ kind: 'failed' });
    expect(placeFailureOf(new ConvexError('text'))).toEqual({ kind: 'failed' });
  });
});
