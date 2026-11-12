import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const appDir = join(root, 'src', 'app');
const uiDir = join(appDir, 'ui');

const CARD_SURFACE = ['bg-card', 'ring-foreground/10'];

// The signed-in pages whose cards still carry the surface classes.
const PENDING = [
  'src/app/account/account-page.ts',
  'src/app/account/account-settings-page.ts',
  'src/app/account/your-organizations.ts',
  'src/app/account/your-teams.ts',
  'src/app/notifications/notifications-page.ts',
  'src/app/organizations/admin/admin-attention.ts',
  'src/app/organizations/admin/admin-details.ts',
  'src/app/organizations/admin/admin-leagues.ts',
  'src/app/organizations/admin/admin-loading.ts',
  'src/app/organizations/admin/admin-locations.ts',
  'src/app/organizations/admin/admin-logo.ts',
  'src/app/organizations/admin/admin-no-access.ts',
  'src/app/organizations/admin/admin-open-seasons.ts',
  'src/app/organizations/admin/admin-overview.ts',
  'src/app/organizations/admin/admin-staff.ts',
  'src/app/organizations/admin/staff-invite-panel.ts',
  'src/app/organizations/league/league-loading.ts',
  'src/app/organizations/league/league-management.ts',
  'src/app/organizations/league/league-no-access.ts',
  'src/app/organizations/season-management/season-limits.ts',
  'src/app/organizations/season-management/season-loading.ts',
  'src/app/organizations/season-management/season-management.ts',
  'src/app/organizations/season-management/season-waitlist-panel.ts',
  'src/app/teams/add-minor-panel.ts',
  'src/app/teams/join-team-page.ts',
  'src/app/teams/register-card.ts',
  'src/app/teams/season-teams-panel.ts',
  'src/app/teams/team-invite-panel.ts',
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

const posix = (path) => relative(root, path).split(sep).join('/');

const STRING_LITERAL = /'[^'\n]*'|"[^"\n]*"|`[^`]*`/g;

const withCardSurface = () =>
  [...sourceFiles(appDir)]
    .filter((path) =>
      (readFileSync(path, 'utf8').match(STRING_LITERAL) ?? []).some((literal) =>
        CARD_SURFACE.every((name) => literal.includes(name)),
      ),
    )
    .map(posix)
    .sort();

describe('hand-written card surfaces', () => {
  it('are absent outside src/app/ui, apart from the signed-in pages still to move', () => {
    assert.deepEqual(withCardSurface(), PENDING);
  });

  it('are listed as pending only while the file still holds one', () => {
    const holding = new Set(withCardSurface());
    assert.deepEqual(
      PENDING.filter((path) => !holding.has(path)),
      [],
    );
  });
});
