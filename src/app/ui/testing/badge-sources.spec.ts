import { offenders, OUTSIDE_UI } from './app-sources';

const BADGE_BASE = 'group/badge';
const DELETED_CONSTANTS =
  /\b(?:BADGE_(?:DEFAULT|SECONDARY|OUTLINE\w*|DESTRUCTIVE)|OPEN_BADGE|MUTED_BADGE|FULL_BADGE)\b/;
const HAND_WRITTEN_BADGE = /\bdata-slot="badge"/;

describe('badge sources', () => {
  it('finds the app sources', () => {
    expect(OUTSIDE_UI.length).toBeGreaterThan(100);
  });

  it('keeps the badge base string inside src/app/ui', () => {
    expect(offenders(BADGE_BASE)).toEqual([]);
  });

  it('imports none of the deleted badge constants', () => {
    expect(offenders(DELETED_CONSTANTS)).toEqual([]);
  });

  it('draws every badge through hlmBadge, with no hand-written data-slot', () => {
    expect(offenders(HAND_WRITTEN_BADGE)).toEqual([]);
  });
});
