import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const APP = join(process.cwd(), 'src', 'app');
const UI = join(APP, 'ui') + sep;

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

const OUTSIDE_UI = sources(APP).filter((path) => !path.startsWith(UI));

const BADGE_BASE = 'group/badge';
const DELETED_CONSTANTS =
  /\b(?:BADGE_(?:DEFAULT|SECONDARY|OUTLINE\w*|DESTRUCTIVE)|OPEN_BADGE|MUTED_BADGE|FULL_BADGE)\b/;
const HAND_WRITTEN_BADGE = /\bdata-slot="badge"/;

const offenders = (pattern: RegExp | string) =>
  OUTSIDE_UI.filter((path) => {
    const source = readFileSync(path, 'utf8');
    return typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
  }).map((path) => relative(APP, path));

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
