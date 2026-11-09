import { ConvexError } from 'convex/values';
import { waitlistPlaceOf } from './waitlist-place';

describe('waitlistPlaceOf reading the on-the-waitlist refusal', () => {
  it('gives the team name and position from a refusal that holds both', () => {
    const failure = new ConvexError({ code: 'onWaitlist', teamName: 'Late Lobsters', position: 2 });
    expect(waitlistPlaceOf(failure)).toEqual({ teamName: 'Late Lobsters', position: 2 });
  });

  it('gives null when the team name is missing or not a string', () => {
    expect(waitlistPlaceOf(new ConvexError({ position: 2 }))).toBeNull();
    expect(waitlistPlaceOf(new ConvexError({ teamName: 7, position: 2 }))).toBeNull();
  });

  it('gives null when the position is missing or not a number', () => {
    expect(waitlistPlaceOf(new ConvexError({ teamName: 'Late Lobsters' }))).toBeNull();
    expect(
      waitlistPlaceOf(new ConvexError({ teamName: 'Late Lobsters', position: '2' })),
    ).toBeNull();
  });

  it('gives null when the refusal data is a string or null', () => {
    expect(waitlistPlaceOf(new ConvexError('onWaitlist'))).toBeNull();
    expect(waitlistPlaceOf(new ConvexError(null))).toBeNull();
  });

  it('gives null for an error that is not a ConvexError', () => {
    expect(waitlistPlaceOf(new Error('boom'))).toBeNull();
    expect(waitlistPlaceOf({ teamName: 'Late Lobsters', position: 2 })).toBeNull();
    expect(waitlistPlaceOf(undefined)).toBeNull();
  });
});
