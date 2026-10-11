import { describe, expect, test } from 'vitest';
import {
  checkInviteEmail,
  checkInviteLeagues,
  INVITE_LIFETIME_MS,
  INVITE_MESSAGES,
  MAX_INVITE_EMAIL_LENGTH,
  normaliseInviteEmail,
} from './inviteInput';

describe('inviteInput (#67)', () => {
  test('an invite lasts 14 days', () => {
    expect(INVITE_LIFETIME_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  test('normalises an address by trimming and lower-casing it', () => {
    expect(normaliseInviteEmail('  Dana.Whitlock@Example.COM ')).toBe('dana.whitlock@example.com');
  });

  test('accepts an ordinary address and returns it normalised', () => {
    expect(checkInviteEmail(' Dana@Example.com ')).toEqual({ ok: true, email: 'dana@example.com' });
    expect(checkInviteEmail('a+tag@mail.example.co.uk')).toMatchObject({ ok: true });
  });

  test('refuses an empty address with the approved message', () => {
    expect(checkInviteEmail('  ')).toEqual({
      ok: false,
      error: { field: 'email', code: 'emailEmpty', message: 'Enter their email address.' },
    });
  });

  test.each([
    'dana',
    'dana@',
    '@example.com',
    'a b@example.com',
    'dana@example',
    'a@@b.com',
    'a@b..com',
  ])('refuses %j as malformed', (bad) => {
    expect(checkInviteEmail(bad)).toEqual({
      ok: false,
      error: {
        field: 'email',
        code: 'emailInvalid',
        message: 'Enter an email address like name@example.com.',
      },
    });
  });

  test('refuses an address longer than 254 characters', () => {
    const long = `${'a'.repeat(MAX_INVITE_EMAIL_LENGTH)}@example.com`;
    expect(checkInviteEmail(long)).toMatchObject({ ok: false });
  });

  test('refuses a league organizer with no league', () => {
    expect(checkInviteLeagues(0)).toEqual({
      field: 'leagues',
      code: 'leaguesEmpty',
      message: 'Choose at least one league.',
    });
    expect(checkInviteLeagues(1)).toBeNull();
  });

  test('the server messages name the address', () => {
    expect(INVITE_MESSAGES.alreadyMember('x@example.com')).toBe(
      'x@example.com is already on your staff.',
    );
    expect(INVITE_MESSAGES.alreadyInvited('x@example.com')).toBe(
      'x@example.com already has a pending invite. To send a new link, revoke that invite first.',
    );
  });
});
