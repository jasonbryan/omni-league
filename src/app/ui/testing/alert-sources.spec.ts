import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { appPath, offenders, OUTSIDE_UI, readSource } from './app-sources';

const ALERT_STRINGS = ['group/alert', '/alert:col-start-2', 'data-[slot=alert-description]'];
const DELETED_CONSTANTS = /\bALERT_(?:NEUTRAL|DESTRUCTIVE|TITLE|DESCRIPTION|DIALOG_\w+)\b/;
const HAND_WRITTEN_PART = /(?<![[\w-])data-slot="alert(?:-title|-description|-dialog-\w+)?"/;

const HLM_ALERTS_BY_FILE: Record<string, number> = {
  'organizations/admin/admin-alert.ts': 1,
  'organizations/admin/admin-offline-alert.ts': 1,
  'invites/invite-alert.ts': 1,
  'invites/invite-offline-alert.ts': 1,
  'sign-in/sign-in-page.ts': 1,
  'sign-up/sign-up-page.ts': 1,
  'organizations/create-organization-page.ts': 1,
  'account/your-organizations.ts': 1,
  'account/your-teams.ts': 1,
  'find/find-content.ts': 1,
  'find/find-organizations.ts': 1,
  'teams/register-free-agent-page.ts': 4,
  'teams/register-team-page.ts': 5,
};

const count = (relativePath: string, pattern: RegExp) =>
  readSource(OUTSIDE_UI.find((path) => appPath(path) === relativePath)!).match(pattern)?.length ??
  0;

describe('alert sources', () => {
  it('keeps the alert and alert dialog class strings inside src/app/ui', () => {
    for (const fragment of ALERT_STRINGS) expect(offenders(fragment), fragment).toEqual([]);
    expect(offenders('group/alert-dialog-content')).toEqual([]);
  });

  it('imports none of the deleted alert constants and has no alert-dialog-classes file', () => {
    expect(offenders(DELETED_CONSTANTS)).toEqual([]);
    expect(
      existsSync(join(process.cwd(), 'src/app/organizations/admin/alert-dialog-classes.ts')),
    ).toBe(false);
  });

  it('draws every alert and alert dialog part through its directive, with no hand-written data-slot', () => {
    expect(offenders(HAND_WRITTEN_PART)).toEqual([]);
  });

  it.each(Object.entries(HLM_ALERTS_BY_FILE))(
    '%s draws %i alert(s) through hlmAlert',
    (path, n) => {
      expect(count(path, /\bhlmAlert\b/g)).toBe(n);
    },
  );

  it('draws the confirm dialog through the alert-dialog parts', () => {
    const source = readSource(
      OUTSIDE_UI.find((path) => appPath(path) === 'organizations/admin/confirm-dialog.ts')!,
    );
    for (const part of ['Content', 'Header', 'Media', 'Title', 'Description', 'Footer']) {
      expect(source, part).toContain(`hlmAlertDialog${part}`);
    }
  });
});
