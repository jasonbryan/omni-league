import { ConvexError } from 'convex/values';
import {
  promoteFailureOf,
  promoteFailureText,
  promotedText,
  promoteOfflineText,
  waitlistEmptyText,
  waitlistNote,
} from './waitlist-text';

describe('waitlist text', () => {
  it('reads each refusal by its code, and anything else as a failure', () => {
    expect(promoteFailureOf(new ConvexError({ code: 'noRoom', message: 'x' }))).toEqual({
      kind: 'noRoom',
    });
    expect(promoteFailureOf(new ConvexError({ code: 'alreadyPromoted', message: 'x' }))).toEqual({
      kind: 'alreadyPromoted',
    });
    expect(
      promoteFailureOf(
        new ConvexError({ code: 'alreadyOnAnotherTeam', teamName: 'Sand Sharks', message: 'x' }),
      ),
    ).toEqual({ kind: 'captainOnTeam', teamName: 'Sand Sharks' });
    expect(promoteFailureOf(new ConvexError({ code: 'bracketCreated', message: 'x' }))).toEqual({
      kind: 'bracketCreated',
    });
    expect(promoteFailureOf(new Error('Not allowed'))).toEqual({ kind: 'failed' });
  });

  it('says why a promotion was refused', () => {
    const text = (failure: Parameters<typeof promoteFailureText>[0]) =>
      promoteFailureText(failure, 'Late Lobsters', 'Rosa Delgado', 'season');
    expect(text({ kind: 'noRoom' })).toEqual({
      title: 'Late Lobsters could not be promoted.',
      description: 'The season is full. Raise the maximum teams first.',
    });
    expect(text({ kind: 'captainOnTeam', teamName: 'Sand Sharks' }).description).toBe(
      'Rosa Delgado is already on Sand Sharks.',
    );
    expect(text({ kind: 'alreadyPromoted' }).description).toBe('It has already been promoted.');
    expect(text({ kind: 'bracketCreated' }).description).toBe(
      'The bracket is created, so waiting teams cannot be promoted.',
    );
    expect(text({ kind: 'failed' }).description).toBe('Check your connection and try again.');
    expect(promoteOfflineText('Late Lobsters')).toBe(
      'Late Lobsters is still waiting. Try again when you’re connected.',
    );
  });

  it('says the promoted team is a team now, with the count against the maximum', () => {
    expect(promotedText('Late Lobsters', 'Rosa Delgado', 5, 6, 'season')).toEqual({
      title: 'Late Lobsters is a team now.',
      description:
        'Rosa Delgado is its captain and can invite players. The season has 5 of 6 teams.',
    });
    expect(promotedText('Late Lobsters', 'Rosa Delgado', 5, undefined, 'season').description).toBe(
      'Rosa Delgado is its captain and can invite players. The season has 5 teams.',
    );
  });

  it('notes no room, or the room promoting fills', () => {
    expect(waitlistNote(4, 4, 'season')).toEqual({
      title: 'The season is full',
      description: 'Raise the maximum teams to promote a waiting team.',
    });
    expect(waitlistNote(4, 6, 'season').title).toBe('Room for 2 more teams');
    expect(waitlistNote(5, 6, 'season').title).toBe('Room for 1 more team');
    expect(waitlistNote(5, undefined, 'season').title).toBe('Room for more teams');
  });

  it('names a tournament where the text names the season', () => {
    expect(
      promoteFailureText({ kind: 'noRoom' }, 'Late Lobsters', 'Rosa Delgado', 'tournament'),
    ).toEqual({
      title: 'Late Lobsters could not be promoted.',
      description: 'The tournament is full. Raise the maximum teams first.',
    });
    expect(promotedText('Late Lobsters', 'Rosa Delgado', 5, 6, 'tournament').description).toBe(
      'Rosa Delgado is its captain and can invite players. The tournament has 5 of 6 teams.',
    );
    expect(waitlistNote(4, 4, 'tournament')).toEqual({
      title: 'The tournament is full',
      description: 'Raise the maximum teams to promote a waiting team.',
    });
    expect(waitlistNote(5, 6, 'tournament').description).toBe(
      'While teams are waiting, new teams still join the waitlist, so promote to fill the places.',
    );
    expect(waitlistEmptyText('season')).toBe(
      'When the season is full, teams that register wait here in the order they joined.',
    );
    expect(waitlistEmptyText('tournament')).toBe(
      'When the tournament is full, teams that register wait here in the order they joined.',
    );
  });
});
