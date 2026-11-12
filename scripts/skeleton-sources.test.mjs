import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const appDir = join(root, 'src', 'app');
const uiDir = join(appDir, 'ui');

const PENDING_FILES = [
  'src/app/account/account-settings-page.ts',
  'src/app/invites/accept-invite-page.ts',
  'src/app/notifications/notifications-page.ts',
  'src/app/organizations/admin/admin-attention.ts',
  'src/app/organizations/admin/admin-leagues.ts',
  'src/app/organizations/admin/admin-loading.ts',
  'src/app/organizations/admin/admin-locations.ts',
  'src/app/organizations/admin/admin-open-seasons.ts',
  'src/app/organizations/admin/admin-overview.ts',
  'src/app/organizations/admin/admin-staff.ts',
  'src/app/organizations/league/league-loading.ts',
  'src/app/organizations/league/league-management.ts',
  'src/app/organizations/season-management/season-loading.ts',
  'src/app/shell/account-row.ts',
  'src/app/shell/home-sidebar.ts',
  'src/app/shell/shell.ts',
  'src/app/teams/join-team-page.ts',
  'src/app/teams/register-card.ts',
  'src/app/teams/season-teams-panel.ts',
  'src/app/teams/team-page.ts',
  'src/app/teams/team-pending-invites.ts',
];

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path !== uiDir) yield* sourceFiles(path);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      yield path;
    }
  }
}

const pulsing = () =>
  [...sourceFiles(appDir)]
    .filter((path) => readFileSync(path, 'utf8').includes('animate-pulse'))
    .map((path) => relative(root, path).split(sep).join('/'));

describe('hand-written skeletons', () => {
  it('are absent outside src/app/ui and the pending files: a loading box uses hlmSkeleton', () => {
    const pending = new Set(PENDING_FILES);
    assert.deepEqual(
      pulsing().filter((file) => !pending.has(file)),
      [],
    );
  });

  it('the pending list names only files that still hand-write one', () => {
    const offenders = new Set(pulsing());
    assert.deepEqual(
      PENDING_FILES.filter((file) => !offenders.has(file)),
      [],
    );
  });

  it('the helm skeleton pulses only through motion-safe:animate-pulse', () => {
    const skeleton = readFileSync(join(uiDir, 'skeleton', 'hlm-skeleton.ts'), 'utf8');
    assert.match(skeleton, /motion-safe:animate-pulse/);
    assert.doesNotMatch(skeleton.replaceAll('motion-safe:animate-pulse', ''), /animate-/);
  });
});
