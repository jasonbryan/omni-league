import { ConvexError, type Value } from 'convex/values';
import { TOURNAMENT_MESSAGES } from '../../../../convex/lib/tournamentInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { PRIMARY_BUTTON } from './button-classes';
import { TournamentPage } from './tournament-page';
import { COASTAL, Elsewhere, openAdmin, text } from './testing/admin-harness';
import type { Routes } from '@angular/router';

const ROUTES: Routes = [
  { path: 'app/organizations/:orgSlug/tournaments/:tournamentSlug', component: TournamentPage },
  { path: 'app/organizations/:slug', component: Elsewhere },
  { path: 'app', component: Elsewhere },
  { path: 'organizations/:orgSlug', component: Elsewhere },
];
const URL = `/app/organizations/${COASTAL.slug}/tournaments/winter-doubles-classic`;
const GET = 'tournaments:getForManagement';
const UPDATE = 'tournaments:updateDetails';
const UNDO = 'tournaments:undoUpdateDetails';

const HELD = {
  startDate: '2027-01-16',
  endDate: '2027-01-17',
  registrationDeadline: '2027-01-09',
  maximumTeams: 4,
  setsPerGame: 1,
};

const TOURNAMENT = {
  tournamentId: 'tn_winter',
  organizationId: COASTAL.organizationId,
  role: 'orgAdmin',
  status: 'draft',
  organization: { name: COASTAL.name, slug: COASTAL.slug },
  name: 'Winter Doubles Classic',
  slug: 'winter-doubles-classic',
  sport: 'beachVolleyball',
  sportName: 'Beach volleyball',
  divisionLabel: 'Coed · 2v2 · Open',
  locations: [{ name: 'Pelican Shoals Sand Courts', address: '2150 Pelican Shoals Dr' }],
  minimumRosterSize: 2,
  teamCount: 3,
  bracketCreated: false,
  ...HELD,
};

const WRITTEN = { ...HELD, maximumTeams: 6, setsPerGame: 3 };
const SAVED = { earlier: HELD, written: WRITTEN };

describe('TournamentDetailsForm', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(tournament: unknown = TOURNAMENT) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    await o.flush();
    o.subscription(GET)!.emit(tournament);
    await o.flush();
    o.subscription('waitlist:listForTournament')?.emit({ rows: [], waitlistCount: 0 });
    await o.flush();
  }

  const section = () => page.querySelector<HTMLElement>('#edit-details')!;
  const form = () => section().querySelector<HTMLFormElement>('form')!;
  const input = (id: string) => page.querySelector<HTMLInputElement>(`#details-${id}`)!;
  const save = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const sets = (key: string) => page.querySelector<HTMLInputElement>(`#sets-per-game-${key}`);
  const status = () => form().querySelector<HTMLElement>('[data-slot="save-status"]')!;
  const alertBox = () => form().querySelector<HTMLElement>('[data-slot="alert"]');
  const undoButton = () =>
    [...form().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      text(b)?.startsWith('Undo'),
    );
  const error = (id: string) => text(page.querySelector(`#details-${id}-error`));

  async function type(id: string, value: string) {
    const field = input(id);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await o.harness.fixture.whenStable();
  }

  async function leave(id: string) {
    input(id).dispatchEvent(new Event('blur'));
    await o.harness.fixture.whenStable();
  }

  async function chooseSets(key: string) {
    const radio = sets(key)!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await o.harness.fixture.whenStable();
  }

  async function submit() {
    save().click();
    await o.flush();
  }

  async function saved() {
    await open();
    await type('maximum-teams', '6');
    await chooseSets('3');
    await submit();
    o.convex.calls[0].resolve(SAVED);
    await o.flush();
  }

  describe('the section', () => {
    it('is the Edit details form, filled with the dates, deadline, maximum, and sets per game', async () => {
      await open();
      expect(section().getAttribute('aria-labelledby')).toBe('edit-details-heading');
      expect(text(section().querySelector('h2'))).toBe('Edit details');
      expect(form().hasAttribute('novalidate')).toBe(true);
      expect(input('start-date').value).toBe('2027-01-16');
      expect(input('end-date').value).toBe('2027-01-17');
      expect(input('registration-deadline').value).toBe('2027-01-09');
      expect(input('maximum-teams').value).toBe('4');
      expect(sets('1')!.checked).toBe(true);
      expect(text(save())).toBe('Save changes');
      expect(save().className.split(' ')).toEqual(
        expect.arrayContaining(PRIMARY_BUTTON.split(' ')),
      );
    });

    it('shows the structure as text, not a field', async () => {
      await open();
      expect(text(section().querySelector('[data-slot="structure"]'))).toBe(
        'StructureBracket only',
      );
      expect(section().querySelector('input[name="structure"], select')).toBeNull();
    });

    it('offers sets per game as 1 or 3 for beach volleyball', async () => {
      await open();
      expect(sets('1')).not.toBeNull();
      expect(sets('3')).not.toBeNull();
      expect(sets('2')).toBeNull();
    });

    it('shows sets per game as text with the reason once the bracket is created, and keeps the other fields editable', async () => {
      await open({ ...TOURNAMENT, setsPerGame: 3, bracketCreated: true });
      expect(sets('1')).toBeNull();
      expect(sets('3')).toBeNull();
      expect(text(section().querySelector('[data-slot="sets-per-game"]'))).toBe(
        'Sets per gameBest of 3 The bracket is created, so sets per game cannot change.',
      );
      expect(input('maximum-teams').disabled).toBe(false);
    });

    it('leaves sets per game out for a sport that has no choice', async () => {
      await open({ ...TOURNAMENT, sport: 'soccer', sportName: 'Soccer' });
      expect(sets('1')).toBeNull();
      expect(text(section())).not.toContain('Sets per game');
    });

    it('says the range and how many teams are registered, which the maximum cannot go below', async () => {
      await open();
      expect(text(page.querySelector('#details-maximum-teams-description'))).toBe(
        'The most teams the bracket takes, from 2 to 128. 3 teams are registered.',
      );
    });

    it('uses the singular for one team', async () => {
      await open({ ...TOURNAMENT, teamCount: 1 });
      expect(text(page.querySelector('#details-maximum-teams-description'))).toBe(
        'The most teams the bracket takes, from 2 to 128. 1 team is registered.',
      );
    });

    it('says only the range when no team is registered', async () => {
      await open({ ...TOURNAMENT, teamCount: 0 });
      expect(text(page.querySelector('#details-maximum-teams-description'))).toBe(
        'The most teams the bracket takes, from 2 to 128.',
      );
    });

    it('does not repeat an id on the page', async () => {
      await open();
      const ids = [...page.querySelectorAll('[id]')].map((element) => element.id);
      expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    });

    it('keeps the save button visible on a phone, with the sticky footer', async () => {
      await open();
      expect(form().querySelector('[data-slot="form-footer"]')).not.toBeNull();
    });
  });

  describe('validation', () => {
    it('shows a maximum below the team count under the field on leaving it, and clears it once valid', async () => {
      await open();
      await type('maximum-teams', '2');
      expect(error('maximum-teams')).toBeUndefined();
      await leave('maximum-teams');
      expect(error('maximum-teams')).toBe(TOURNAMENT_MESSAGES.maximumTeamsBelowTeams(3));
      expect(input('maximum-teams').getAttribute('aria-invalid')).toBe('true');
      await type('maximum-teams', '3');
      expect(error('maximum-teams')).toBeUndefined();
    });

    it('shows an end date before the start and a deadline after it', async () => {
      await open();
      await type('end-date', '2027-01-15');
      await leave('end-date');
      await type('registration-deadline', '2027-01-17');
      await leave('registration-deadline');
      expect(error('end-date')).toBe(TOURNAMENT_MESSAGES.endBeforeStart);
      expect(error('registration-deadline')).toBe(
        TOURNAMENT_MESSAGES.deadlineAfterStart('2027-01-16'),
      );
    });

    it('sends nothing and focuses the first invalid field when it is submitted with an error', async () => {
      await open();
      await type('maximum-teams', '2');
      await type('registration-deadline', '');
      await submit();
      expect(o.convex.calls).toEqual([]);
      expect(error('registration-deadline')).toBe('Enter the registration deadline.');
      expect(error('maximum-teams')).toBe(TOURNAMENT_MESSAGES.maximumTeamsBelowTeams(3));
      expect(document.activeElement).toBe(input('registration-deadline'));
    });

    it('shows a refusal of the server under its field and keeps every value', async () => {
      await open();
      await type('maximum-teams', '129');
      await submit();
      expect(o.convex.calls).toEqual([]);
      await type('maximum-teams', '5');
      await type('end-date', '2027-01-20');
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'maximumTeams',
          code: 'maximumTeamsBelowTeams',
          message: TOURNAMENT_MESSAGES.maximumTeamsBelowTeams(7),
        }),
      );
      await o.flush();
      expect(error('maximum-teams')).toBe(TOURNAMENT_MESSAGES.maximumTeamsBelowTeams(7));
      expect(input('maximum-teams').value).toBe('5');
      expect(input('end-date').value).toBe('2027-01-20');
      expect(document.activeElement).toBe(input('maximum-teams'));
    });
  });

  describe('saving', () => {
    it('sends the values with what the form showed, and says Details saved with Undo', async () => {
      await open();
      await type('maximum-teams', '6');
      await chooseSets('3');
      await submit();
      expect(o.convex.calls.map((c) => [c.name, c.args])).toEqual([
        [
          UPDATE,
          {
            tournamentId: 'tn_winter',
            startDate: '2027-01-16',
            endDate: '2027-01-17',
            registrationDeadline: '2027-01-09',
            maximumTeams: 6,
            setsPerGame: 3,
            expected: HELD,
          },
        ],
      ]);
      expect(text(save())).toBe('Saving…');
      expect(save().getAttribute('aria-disabled')).toBe('true');
      o.convex.calls[0].resolve(SAVED);
      await o.flush();
      expect(text(status())).toBe('Details saved.Undo');
      expect(text(save())).toBe('Save changes');
      expect(input('maximum-teams').value).toBe('6');
    });

    it('leaves a blank end date out, so the tournament is one day', async () => {
      await open();
      await type('end-date', '');
      await submit();
      expect(o.convex.calls[0].args).not.toHaveProperty('endDate');
    });

    it('sends no sets per game once the bracket is created, so the held value stays', async () => {
      await open({ ...TOURNAMENT, bracketCreated: true });
      await type('maximum-teams', '8');
      await submit();
      expect(o.convex.calls[0].args).not.toHaveProperty('setsPerGame');
    });

    it('sends no sets per game for a sport that has none', async () => {
      await open({ ...TOURNAMENT, sport: 'soccer', sportName: 'Soccer' });
      await type('maximum-teams', '8');
      await submit();
      expect(o.convex.calls[0].args).not.toHaveProperty('setsPerGame');
    });

    it('goes away when the user edits the form again', async () => {
      await saved();
      await type('maximum-teams', '7');
      expect(status().textContent?.trim()).toBe('');
    });

    it('keeps every field and shows the failure alert, focused, when the server fails', async () => {
      await open();
      await type('maximum-teams', '6');
      await type('start-date', '2027-02-06');
      await type('end-date', '2027-02-07');
      await chooseSets('3');
      await submit();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(alertBox()!.getAttribute('role')).toBe('alert');
      expect(text(alertBox()!.querySelector('[data-slot="alert-title"]'))).toBe(
        'The tournament details could not be saved.',
      );
      expect(text(alertBox())).not.toContain('secret');
      expect(document.activeElement).toBe(alertBox());
      expect(input('maximum-teams').value).toBe('6');
      expect(input('start-date').value).toBe('2027-02-06');
      expect(input('end-date').value).toBe('2027-02-07');
      expect(sets('3')!.checked).toBe(true);
    });

    it('keeps every field and says nothing was sent when the connection drops', async () => {
      await open();
      await type('maximum-teams', '6');
      await submit();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(alertBox())).toContain("You're offline. Nothing was sent.");
      expect(text(alertBox())).toContain("Try again when you're connected.");
      expect(input('maximum-teams').value).toBe('6');
    });
  });

  describe('Undo', () => {
    it('sends what the save returned, and puts the earlier values back', async () => {
      await saved();
      undoButton()!.click();
      await o.flush();
      expect(o.convex.calls[1].name).toBe(UNDO);
      expect(o.convex.calls[1].args).toEqual({ tournamentId: 'tn_winter', ...SAVED });
      expect(text(undoButton())).toBe('Undoing…');
      o.convex.calls[1].resolve(null);
      await o.flush();
      expect(input('maximum-teams').value).toBe('4');
      expect(sets('1')!.checked).toBe(true);
      expect(text(status())).toBe('Earlier details restored.');
      expect(undoButton()).toBeUndefined();
      expect(document.activeElement).toBe(status().firstElementChild);
    });

    it('shows the server’s reason when it refuses, and keeps Undo', async () => {
      await saved();
      undoButton()!.click();
      await o.flush();
      o.convex.calls[1].reject(
        new ConvexError({
          field: 'maximumTeams',
          code: 'maximumTeamsBelowTeams',
          message: TOURNAMENT_MESSAGES.undoMaximumTeamsBelowTeams(6, 4),
        }),
      );
      await o.flush();
      expect(text(status())).toContain(
        '6 teams are registered, more than the earlier maximum of 4, so it cannot be undone.',
      );
      expect(text(undoButton())).toBe('Undo');
      expect(input('maximum-teams').value).toBe('6');
    });

    it('says nothing was undone when the server fails or the connection drops', async () => {
      await saved();
      undoButton()!.click();
      await o.flush();
      o.convex.calls[1].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(text(status())).toContain('The earlier details could not be restored. Try again.');
      expect(text(status())).not.toContain('secret');
      undoButton()!.click();
      await o.flush();
      o.convex.calls[2].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(status())).toContain(
        "You're offline. Nothing was undone. Try again when you're connected.",
      );
    });

    it('is gone once the tournament shows neither the saved values nor the earlier ones', async () => {
      await saved();
      o.subscription(GET)!.emit({ ...TOURNAMENT, ...WRITTEN, maximumTeams: 9 });
      await o.flush();
      expect(text(status())).toContain('Details saved.');
      expect(undoButton()).toBeUndefined();
    });

    it('stays while the tournament shows what the save wrote', async () => {
      await saved();
      o.subscription(GET)!.emit({ ...TOURNAMENT, ...WRITTEN });
      await o.flush();
      expect(undoButton()).toBeDefined();
    });
  });

  describe('another editor’s change', () => {
    const changedSince = (current: Value) =>
      new ConvexError({
        field: 'startDate',
        code: 'changedSince',
        message: TOURNAMENT_MESSAGES.changedWhileEditing,
        current,
      });

    it('shows the alert, focused, when the save is refused, loads the newer values into untouched fields, and keeps the typed ones', async () => {
      await open();
      await type('maximum-teams', '6');
      await submit();
      o.convex.calls[0].reject(changedSince({ ...HELD, endDate: '2027-01-18', maximumTeams: 10 }));
      await o.flush();
      expect(text(alertBox()!.querySelector('[data-slot="alert-title"]'))).toBe(
        'Someone else changed this tournament while you were editing.',
      );
      expect(document.activeElement).toBe(alertBox());
      expect(input('end-date').value).toBe('2027-01-18');
      expect(input('maximum-teams').value).toBe('6');
    });

    it('sends the newer values as expected on the next save', async () => {
      await open();
      await type('maximum-teams', '6');
      await submit();
      const current = { ...HELD, endDate: '2027-01-18', maximumTeams: 10 };
      o.convex.calls[0].reject(changedSince(current));
      await o.flush();
      await submit();
      expect(o.convex.calls[1].args).toMatchObject({ maximumTeams: 6, expected: current });
    });

    it('follows a live change in the fields the user has not edited, and leaves the edited ones', async () => {
      await open();
      await type('maximum-teams', '6');
      o.subscription(GET)!.emit({ ...TOURNAMENT, endDate: '2027-01-18', maximumTeams: 10 });
      await o.flush();
      expect(input('end-date').value).toBe('2027-01-18');
      expect(input('maximum-teams').value).toBe('6');
    });

    it('still sends the older value of an edited field as expected, so the server refuses the overwrite', async () => {
      await open();
      await type('maximum-teams', '6');
      o.subscription(GET)!.emit({ ...TOURNAMENT, maximumTeams: 10 });
      await o.flush();
      await submit();
      expect(o.convex.calls[0].args).toMatchObject({ expected: HELD });
    });
  });

  describe('loading', () => {
    it('shows no form while the tournament loads', async () => {
      o = await openAdmin(ROUTES, URL);
      page = o.page;
      o.acceptToken();
      await o.flush();
      expect(page.querySelector('#edit-details')).toBeNull();
      expect(page.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    });
  });

  describe('who sees it', () => {
    it('shows an assigned league organizer the form too', async () => {
      await open({ ...TOURNAMENT, role: 'leagueOrganizer' });
      expect(section()).not.toBeNull();
    });
  });
});
