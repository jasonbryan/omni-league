import {
  leadingKind,
  OPEN_CAMPS_INTRO,
  openIntro,
  registerForText,
  type OpenCardKind,
} from './open-registration';
import { OPEN_MIXED_INTRO, OPEN_TOURNAMENTS_INTRO } from './tournament-status';
import { OPEN_SEASONS_INTRO } from './season-status';

const intro = (...kinds: OpenCardKind[]) => openIntro(kinds);

describe('openIntro', () => {
  it('keeps the season, tournament, and season-and-tournament lines', () => {
    expect(intro()).toBe(OPEN_SEASONS_INTRO);
    expect(intro('season')).toBe(OPEN_SEASONS_INTRO);
    expect(intro('tournament')).toBe(OPEN_TOURNAMENTS_INTRO);
    expect(intro('season', 'tournament')).toBe(OPEN_MIXED_INTRO);
  });

  it('speaks of a person, not a team, for camp sessions alone', () => {
    expect(intro('camp')).toBe(OPEN_CAMPS_INTRO);
    expect(OPEN_CAMPS_INTRO).toBe('Register yourself or a child for a camp session.');
  });

  it('adds the camp sessions to the team line of the others', () => {
    expect(intro('season', 'camp')).toBe(
      'Register a team for a season, or yourself or a child for a camp session.',
    );
    expect(intro('tournament', 'camp')).toBe(
      'Register a team for a tournament, or yourself or a child for a camp session.',
    );
    expect(intro('season', 'tournament', 'camp')).toBe(
      'Register a team for a season or a tournament, or yourself or a child for a camp session.',
    );
  });
});

describe('leadingKind and registerForText', () => {
  it('lead with seasons, then tournaments, then camps, and default to a season', () => {
    expect(leadingKind(['camp', 'tournament', 'season'])).toBe('season');
    expect(leadingKind(['camp', 'tournament'])).toBe('tournament');
    expect(leadingKind(['camp'])).toBe('camp');
    expect(leadingKind([])).toBe('season');
  });

  it('name the hero button for each kind', () => {
    expect(registerForText('season')).toBe('Register for a season');
    expect(registerForText('tournament')).toBe('Register for a tournament');
    expect(registerForText('camp')).toBe('Register for a camp');
  });
});
