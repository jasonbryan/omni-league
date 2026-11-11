import {
  attentionCount,
  inviteExpiryText,
  invitesPendingText,
  moreItemsText,
} from './attention-text';

const none = { total: 0, capped: false };
const counts = (drafts = none, leagues = none, invites = none) => ({
  draftSeasons: drafts,
  leaguesWithoutSeason: leagues,
  pendingInvites: invites,
});

describe('attentionCount', () => {
  it('counts each draft season, each league without a season, and the invites as one item', () => {
    expect(
      attentionCount(
        counts(
          { total: 2, capped: false },
          { total: 1, capped: false },
          { total: 7, capped: false },
        ),
      ),
    ).toEqual({ shown: '4', spoken: '4 items' });
  });

  it('says "1 item" for one', () => {
    expect(attentionCount(counts(none, { total: 1, capped: false }))).toEqual({
      shown: '1',
      spoken: '1 item',
    });
  });

  it('is null when nothing needs attention', () => {
    expect(attentionCount(counts())).toBeNull();
  });

  it('reads "100+" and "more than 100 items" when a kind passes its read cap', () => {
    expect(attentionCount(counts({ total: 100, capped: true }))).toEqual({
      shown: '100+',
      spoken: 'more than 100 items',
    });
    expect(attentionCount(counts(none, { total: 100, capped: true }))).toEqual({
      shown: '100+',
      spoken: 'more than 100 items',
    });
  });

  it('adds the other items to a capped total', () => {
    expect(
      attentionCount(counts({ total: 100, capped: true }, none, { total: 2, capped: false })),
    ).toEqual({ shown: '101+', spoken: 'more than 101 items' });
  });

  it('does not make the heading "+" for a capped invite item, which is one item', () => {
    expect(attentionCount(counts(none, none, { total: 100, capped: true }))).toEqual({
      shown: '1',
      spoken: '1 item',
    });
  });
});

describe('moreItemsText', () => {
  it('is null when every item is shown', () => {
    expect(moreItemsText({ total: 20, capped: false }, 20)).toBeNull();
  });

  it('says "and 5 more" for 25 with 20 shown', () => {
    expect(moreItemsText({ total: 25, capped: false }, 20)).toBe('and 5 more');
  });

  it('adds "+" when the total is capped', () => {
    expect(moreItemsText({ total: 100, capped: true }, 20)).toBe('and 80+ more');
  });

  it('says "and more" when a capped kind shows as many as its total', () => {
    expect(moreItemsText({ total: 20, capped: true }, 20)).toBe('and more');
  });
});

describe('invitesPendingText', () => {
  it('uses the singular for one', () => {
    expect(invitesPendingText({ total: 1, capped: false })).toBe('1 staff invite is pending');
  });

  it('uses the plural for more', () => {
    expect(invitesPendingText({ total: 4, capped: false })).toBe('4 staff invites are pending');
  });

  it('reads "100+" past the read cap', () => {
    expect(invitesPendingText({ total: 100, capped: true })).toBe('100+ staff invites are pending');
  });
});

describe('inviteExpiryText', () => {
  const EXPIRES = Date.UTC(2027, 9, 18, 2, 30);
  const BEFORE = Date.UTC(2027, 9, 1);
  const AFTER = Date.UTC(2027, 9, 20);

  it('reads "expires" with the date in the viewer time zone: the evening before in Chicago, the day itself in London', () => {
    expect(inviteExpiryText(EXPIRES, BEFORE, 'America/Chicago')).toBe('expires Oct 17');
    expect(inviteExpiryText(EXPIRES, BEFORE, 'Europe/London')).toBe('expires Oct 18');
  });

  it('reads "expired" once the instant has passed', () => {
    expect(inviteExpiryText(EXPIRES, AFTER, 'Europe/London')).toBe('expired Oct 18');
    expect(inviteExpiryText(EXPIRES, EXPIRES, 'Europe/London')).toBe('expired Oct 18');
  });

  it("uses the device's time zone when none is given", () => {
    const device = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
      EXPIRES,
    );
    expect(inviteExpiryText(EXPIRES, BEFORE)).toBe(`expires ${device}`);
  });
});
