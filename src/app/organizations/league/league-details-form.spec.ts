import { ConvexError, type Value } from 'convex/values';
import { LEAGUE_MESSAGES } from '../../../../convex/lib/leagueInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { PRIMARY_BUTTON } from '../admin/button-classes';
import { STICKY_FOOTER_CLEARANCE } from '../admin/sticky-footer';
import { openAdmin, text } from '../admin/testing/admin-harness';
import { expectStickyFooterWithFocusFix } from '../admin/testing/sticky-footer-check';
import {
  COED,
  COED_AS_ORGANIZER,
  GET_ORGANIZER_CONTEXT,
  LEAGUE_ROUTES,
  LEAGUE_URL,
  LIST_CUSTOM_LEVELS,
  LIST_FOR_ORGANIZER,
  UNDO_UPDATE_LEAGUE,
  UPDATE_LEAGUE,
} from './testing/league-harness';

const SUNDAY = {
  ...COED,
  name: 'Sunday Reverse Coed 4s',
  slug: 'sunday-reverse-coed-4s',
  sport: 'beachVolleyball',
  division: {
    gender: 'coed',
    playersPerSide: 4,
    level: 'bb',
    ageGroup: 'adult',
    label: 'Coed · 4v4 · BB',
  },
};

const SEASONS = [
  {
    seasonId: 'se_fall27',
    name: 'Fall 2027',
    slug: 'fall-2027',
    startDate: '2027-09-12',
    endDate: '2027-11-14',
    registrationDeadline: '2027-08-29',
    formatName: '4v4',
    minimumRosterSize: 4,
    status: 'draft',
  },
  {
    seasonId: 'se_summer27',
    name: 'Summer 2027',
    slug: 'summer-2027',
    startDate: '2027-06-06',
    endDate: '2027-08-29',
    registrationDeadline: '2027-05-23',
    formatName: '4v4',
    minimumRosterSize: 4,
    status: 'published',
  },
];

const SAVED_DIVISION = {
  gender: 'coed',
  playersPerSide: 4,
  level: 'bb',
  ageGroup: 'adult',
};

const BASELINES = {
  name: 'Sunday Reverse Coed 4s',
  ...SAVED_DIVISION,
};

const EARLIER = {
  league: { name: 'Sunday Reverse Coed 4s', ...SAVED_DIVISION },
  draftSeasons: [{ seasonId: 'se_fall27', playersPerSide: 4, minimumRosterSize: 4 }],
  written: { name: 'Sunday Sand', ...SAVED_DIVISION, playersPerSide: 6 },
};

describe('LeagueDetailsForm', () => {
  type Opened = Awaited<ReturnType<typeof openAdmin>>;
  let o: Opened;
  let page: HTMLElement;

  async function open(context: unknown = SUNDAY, seasons: unknown[] = SEASONS) {
    o = await openAdmin(LEAGUE_ROUTES, LEAGUE_URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ORGANIZER_CONTEXT)!.emit(context);
    await o.flush();
    o.subscription(LIST_FOR_ORGANIZER)!.emit(seasons);
    await o.flush();
  }

  const section = () => page.querySelector<HTMLElement>('#details')!;
  const form = () => section().querySelector<HTMLFormElement>('form')!;
  const nameInput = () => page.querySelector<HTMLInputElement>('#league-name')!;
  const save = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const chip = (group: string, key: string) =>
    page.querySelector<HTMLInputElement>(`[id="details-${group}-${key}"]`)!;
  const calls = () => o.convex.calls.map((c) => [c.name, c.args]);
  const status = () => form().querySelector<HTMLElement>('[data-slot="save-status"]');
  const undoButton = () =>
    [...form().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      text(b)?.startsWith('Undo'),
    );

  async function typeName(value: string) {
    nameInput().value = value;
    nameInput().dispatchEvent(new Event('input'));
    await o.harness.fixture.whenStable();
  }

  async function leaveName() {
    nameInput().dispatchEvent(new Event('blur'));
    await o.harness.fixture.whenStable();
  }

  async function choose(group: string, key: string) {
    const radio = chip(group, key);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await o.harness.fixture.whenStable();
  }

  async function submit() {
    save().click();
    await o.flush();
  }

  describe('the section', () => {
    it('is the League details form with the name, division, and Save changes', async () => {
      await open();
      expect(section().getAttribute('aria-labelledby')).toBe('details-heading');
      expect(text(section().querySelector('h2'))).toBe('League details');
      expect(form().getAttribute('aria-labelledby')).toBe('details-heading');
      expect(form().hasAttribute('novalidate')).toBe(true);
      expect(text(page.querySelector('label[for="league-name"]'))).toBe('Name');
      expect(text(page.querySelector('#league-name-description'))).toBe(
        'The name players know it by every season, such as Sunday Coed 4s. Up to 100 characters.',
      );
      expect(text(section().querySelector('fieldset legend'))).toBe('Division');
      expect(text(save())).toBe('Save changes');
      expect(save().className.split(' ')).toEqual(
        expect.arrayContaining(PRIMARY_BUTTON.split(' ')),
      );
    });

    it('points the name field at its description while the name is valid', async () => {
      await open();
      expect(nameInput().getAttribute('aria-describedby')).toBe('league-name-description');
      expect(page.querySelector('#league-name-description')).not.toBeNull();
    });

    it('is filled with the league’s own name and division', async () => {
      await open({
        ...SUNDAY,
        division: {
          ...SUNDAY.division,
          gender: 'mens',
          ageGroup: 'over40',
          minimumRosterSize: 6,
        },
      });
      expect(nameInput().value).toBe('Sunday Reverse Coed 4s');
      expect(chip('gender', 'mens').checked).toBe(true);
      expect(chip('format', '4').checked).toBe(true);
      expect(chip('level', 'bb').checked).toBe(true);
      expect(page.querySelector<HTMLSelectElement>('#details-age-group')!.value).toBe('over40');
      expect(page.querySelector<HTMLInputElement>('#details-minimum-roster-size')!.value).toBe('6');
    });

    it('keeps the minimum roster size behind its link until one is saved', async () => {
      await open();
      expect(page.querySelector('#details-minimum-roster-size')).toBeNull();
      expect(text(form())).toContain('Raise the minimum roster size');
    });

    it('does not repeat an id the Create a season form uses', async () => {
      await open();
      const ids = [...page.querySelectorAll('[id]')].map((element) => element.id);
      expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    });

    it('shows the division label under the league’s name', async () => {
      await open();
      expect(text(page.querySelector('[data-slot="league-division"]'))).toBe('Coed · 4v4 · BB');
    });
  });

  describe('the sticky footer', () => {
    it('holds Save in the shared sticky footer, after the save status', async () => {
      await open();
      const footer = save().parentElement!;
      expect(footer.getAttribute('data-slot')).toBe('form-footer');
      expect(footer.className.split(' ')).toEqual(expect.arrayContaining(['sticky', 'bottom-0']));
      expect(footer.previousElementSibling).toBe(status());
    });

    it('keeps its fields clear of the footer when they take focus (WCAG 2.4.11)', async () => {
      await open();
      const group = form().querySelector('[data-slot="field-group"]')!;
      expect(group.className.split(' ')).toEqual(
        expect.arrayContaining(STICKY_FOOTER_CLEARANCE.split(' ')),
      );
    });

    it('brings a focused field, Undo, or the status it focuses back above the footer (WCAG 2.4.11)', async () => {
      await open();
      expectStickyFooterWithFocusFix(o.harness.fixture.debugElement, form());
    });
  });

  describe('the format hint', () => {
    it('names the published season, which keeps its format', async () => {
      await open();
      expect(text(page.querySelector('#details-format-description'))).toBe(
        'Players on each side, and so the minimum roster size. A change applies to new seasons; Summer 2027 keeps 4v4.',
      );
    });

    it('names none when no season is published', async () => {
      await open(SUNDAY, [SEASONS[0]]);
      expect(text(page.querySelector('#details-format-description'))).toBe(
        'Players on each side, and so the minimum roster size. A change applies to new seasons.',
      );
    });
  });

  describe('custom levels', () => {
    it('lets an org admin add one, and asks for the organization’s levels', async () => {
      await open();
      expect(page.querySelector('app-custom-level-panel')).not.toBeNull();
      expect(o.subscription(LIST_CUSTOM_LEVELS)!.args).toEqual({
        organizationId: 'org_gulf',
        sport: 'beachVolleyball',
      });
    });

    it('asks a league organizer for none, who sees the league’s own custom level', async () => {
      await open({
        ...SUNDAY,
        role: COED_AS_ORGANIZER.role,
        division: {
          ...SUNDAY.division,
          level: 'a',
          customLevel: { customLevelId: 'cl_gold', name: 'Gold' },
          label: 'Coed · 4v4 · Gold (A)',
        },
      });
      expect(o.subscription(LIST_CUSTOM_LEVELS)).toBeUndefined();
      expect(page.querySelector('app-custom-level-panel')).toBeNull();
      expect(chip('level', 'custom:cl_gold').checked).toBe(true);
      expect(text(page.querySelector('#details-level-description'))).toBe(
        'Standard levels for beach volleyball. Your custom levels: Gold (filters as A).',
      );
    });
  });

  describe('validation', () => {
    it('shows the name error when Name is left empty, and clears it as a name is typed', async () => {
      await open();
      await typeName('');
      expect(page.querySelector('#league-name-error')).toBeNull();
      await leaveName();
      expect(text(page.querySelector('#league-name-error'))).toBe(LEAGUE_MESSAGES.nameEmpty);
      expect(nameInput().getAttribute('aria-invalid')).toBe('true');
      await typeName('Sunday Sand');
      expect(page.querySelector('#league-name-error')).toBeNull();
    });

    it('sends nothing for an empty name, and focuses Name', async () => {
      await open();
      await typeName('  ');
      await submit();
      expect(calls()).toEqual([]);
      expect(text(page.querySelector('#league-name-error'))).toBe(LEAGUE_MESSAGES.nameEmpty);
      expect(document.activeElement).toBe(nameInput());
    });

    it('refuses a minimum below the format on leaving the field, and sends nothing', async () => {
      await open();
      form().querySelector<HTMLButtonElement>('button[type="button"]')!.click();
      await o.flush();
      const minimum = page.querySelector<HTMLInputElement>('#details-minimum-roster-size')!;
      minimum.value = '3';
      minimum.dispatchEvent(new Event('input'));
      minimum.dispatchEvent(new Event('blur'));
      await o.flush();
      expect(text(page.querySelector('#details-minimum-roster-size-error'))).toBe(
        LEAGUE_MESSAGES.minimumRosterSizeLow(4),
      );
      await submit();
      expect(calls()).toEqual([]);
      expect(document.activeElement).toBe(minimum);
    });
  });

  describe('saving', () => {
    it('sends the league’s id and values, and shows Saving… while it waits', async () => {
      await open();
      await typeName('Sunday Sand');
      await choose('format', '6');
      await submit();
      expect(calls()).toEqual([
        [
          UPDATE_LEAGUE,
          {
            leagueId: 'lg_coed',
            name: 'Sunday Sand',
            gender: 'coed',
            playersPerSide: 6,
            level: 'bb',
            ageGroup: 'adult',
            expected: BASELINES,
          },
        ],
      ]);
      expect(text(save())).toBe('Saving…');
      expect(save().getAttribute('aria-disabled')).toBe('true');
      o.convex.calls[0].resolve(EARLIER);
      await o.flush();
      expect(text(save())).toBe('Save changes');
    });

    it('sends the custom level and the raised minimum that were chosen', async () => {
      await open({
        ...SUNDAY,
        division: {
          ...SUNDAY.division,
          level: 'a',
          customLevel: { customLevelId: 'cl_gold', name: 'Gold' },
          minimumRosterSize: 6,
        },
      });
      await submit();
      expect(o.convex.calls[0].args).toEqual({
        leagueId: 'lg_coed',
        name: 'Sunday Reverse Coed 4s',
        gender: 'coed',
        playersPerSide: 4,
        level: 'a',
        customLevelId: 'cl_gold',
        ageGroup: 'adult',
        minimumRosterSize: 6,
        expected: {
          name: 'Sunday Reverse Coed 4s',
          gender: 'coed',
          playersPerSide: 4,
          level: 'a',
          customLevelId: 'cl_gold',
          ageGroup: 'adult',
          minimumRosterSize: 6,
        },
      });
    });

    it('sends the values it saved as the baselines of the next save', async () => {
      await open();
      await typeName('Sunday Sand');
      await choose('format', '6');
      await submit();
      o.convex.calls[0].resolve(EARLIER);
      await o.flush();
      await typeName('Sunday Sand 2');
      await submit();
      expect(o.convex.calls[1].args).toMatchObject({
        name: 'Sunday Sand 2',
        expected: { name: 'Sunday Sand', playersPerSide: 6 },
      });
    });

    it('sends the values Undo restored as the baselines of the next save', async () => {
      await open();
      await typeName('Sunday Sand');
      await choose('format', '6');
      await submit();
      o.convex.calls[0].resolve(EARLIER);
      await o.flush();
      undoButton()!.click();
      await o.flush();
      o.convex.calls[1].resolve(null);
      await o.flush();
      await typeName('Sunday Sand 2');
      await submit();
      expect(o.convex.calls[2].args).toMatchObject({
        expected: { name: 'Sunday Reverse Coed 4s', playersPerSide: 4 },
      });
    });

    it('sends only the league name as the baseline for a league without a division', async () => {
      await open({ ...SUNDAY, division: undefined });
      await typeName('Sunday Sand');
      await choose('format', '6');
      await submit();
      expect(o.convex.calls[0].args).toMatchObject({
        expected: { name: 'Sunday Reverse Coed 4s' },
      });
      expect(o.convex.calls[0].args).not.toHaveProperty('expected.playersPerSide');
    });

    it('says League details saved. with Undo, and keeps the values in the form', async () => {
      await open();
      await typeName('Sunday Sand');
      await submit();
      o.convex.calls[0].resolve({ ...EARLIER, draftSeasons: [] });
      await o.flush();
      expect(text(status())).toContain('League details saved.');
      expect(text(undoButton())).toBe('Undo');
      expect(nameInput().value).toBe('Sunday Sand');
    });

    it('ignores a second press while the first is pending', async () => {
      await open();
      await typeName('Sunday Sand');
      await submit();
      await submit();
      expect(o.convex.calls).toHaveLength(1);
    });

    it('fills the division from a renamed league and says so', async () => {
      await open();
      await typeName("Sunday Women's 6s A");
      await leaveName();
      expect(chip('gender', 'womens').checked).toBe(true);
      expect(chip('format', '6').checked).toBe(true);
      expect(chip('level', 'a').checked).toBe(true);
      expect(text(section().querySelector('fieldset [role="status"]'))).toBe(
        'Gender, format, and level were filled in from the name. Change any that are wrong.',
      );
    });

    it('leaves the division alone when the name states what the league already is', async () => {
      await open();
      await typeName('Coed 4s BB on Sunday');
      await leaveName();
      expect(text(section().querySelector('fieldset [role="status"]'))).toBe('');
    });
  });

  describe('Undo', () => {
    async function saved() {
      await open();
      await typeName('Sunday Sand');
      await choose('format', '6');
      await submit();
      o.convex.calls[0].resolve(EARLIER);
      await o.flush();
    }

    it('sends what the save returned, and puts the earlier values back in the form', async () => {
      await saved();
      undoButton()!.click();
      await o.flush();
      expect(o.convex.calls[1].name).toBe(UNDO_UPDATE_LEAGUE);
      expect(o.convex.calls[1].args).toEqual({ leagueId: 'lg_coed', ...EARLIER });
      expect(text(undoButton())).toBe('Undoing…');
      o.convex.calls[1].resolve(null);
      await o.flush();
      expect(nameInput().value).toBe('Sunday Reverse Coed 4s');
      expect(chip('format', '4').checked).toBe(true);
      expect(text(status())).toBe('Earlier details restored.');
      expect(undoButton()).toBeUndefined();
      expect(document.activeElement).toBe(status()!.firstElementChild);
    });

    it('says nothing was undone when it is refused, and keeps Undo', async () => {
      await saved();
      undoButton()!.click();
      await o.flush();
      o.convex.calls[1].reject(new Error('Server Error: secret'));
      await o.flush();
      expect(text(status())).toContain('The earlier details could not be restored. Try again.');
      expect(text(status())).not.toContain('secret');
      expect(text(undoButton())).toBe('Undo');
    });

    it('says nothing was undone when the connection drops', async () => {
      await saved();
      undoButton()!.click();
      await o.flush();
      o.convex.calls[1].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(status())).toContain(
        "You're offline. Nothing was undone. Try again when you're connected.",
      );
    });

    it('shows the server’s reason when the league changed since the save', async () => {
      await saved();
      undoButton()!.click();
      await o.flush();
      o.convex.calls[1].reject(
        new ConvexError({
          field: 'name',
          code: 'changedSince',
          message: LEAGUE_MESSAGES.changedSince,
        }),
      );
      await o.flush();
      expect(text(status())).toContain(LEAGUE_MESSAGES.changedSince);
    });

    it('stays while the league shows what the save wrote', async () => {
      await saved();
      o.subscription(GET_ORGANIZER_CONTEXT)!.emit({
        ...SUNDAY,
        name: 'Sunday Sand',
        division: { ...SUNDAY.division, playersPerSide: 6 },
      });
      await o.flush();
      expect(undoButton()).toBeDefined();
    });

    it('is gone once the league shows neither the saved values nor the earlier ones', async () => {
      await saved();
      o.subscription(GET_ORGANIZER_CONTEXT)!.emit({ ...SUNDAY, name: 'Renamed by someone else' });
      await o.flush();
      expect(text(status())).toContain('League details saved.');
      expect(undoButton()).toBeUndefined();
    });

    it('is not offered for a league that had no division before the save', async () => {
      await open();
      await typeName('Sunday Sand');
      await submit();
      o.convex.calls[0].resolve({ ...EARLIER, league: { name: 'Sunday Reverse Coed 4s' } });
      await o.flush();
      expect(text(status())).toContain('League details saved.');
      expect(undoButton()).toBeUndefined();
    });

    it('goes away when the user edits the form again', async () => {
      await saved();
      await typeName('Sunday Sand again');
      expect(status()!.textContent.trim()).toBe('');
      expect(undoButton()).toBeUndefined();
    });

    it('does not start a save while the Undo is pending', async () => {
      await saved();
      undoButton()!.click();
      await o.flush();
      await submit();
      expect(o.convex.calls).toHaveLength(2);
    });

    it('is gone once the next save starts', async () => {
      await saved();
      await typeName('Sunday Sand 2');
      await submit();
      expect(undoButton()).toBeUndefined();
    });
  });

  describe('a save from out-of-date details', () => {
    const SIX = {
      name: 'Sunday Reverse Coed 4s',
      division: { ...SUNDAY.division, playersPerSide: 6, label: 'Coed · 6v6 · BB' },
    };

    const changedSince = (current: Value = SIX) =>
      new ConvexError({
        field: 'name',
        code: 'changedSince',
        message: LEAGUE_MESSAGES.changedWhileEditing,
        current,
      });

    const alertBox = () => page.querySelector<HTMLElement>('[data-slot="alert"]');

    async function renameAndGetRefused(name = 'Sunday Sand') {
      await open();
      await typeName(name);
      await leaveName();
      await submit();
      o.convex.calls[0].reject(changedSince());
      await o.flush();
    }

    it('shows the alert and takes focus, with the typed name kept and no message under Name', async () => {
      await renameAndGetRefused();
      expect(alertBox()!.getAttribute('role')).toBe('alert');
      expect(text(alertBox())).toBe(LEAGUE_MESSAGES.changedWhileEditing);
      expect(document.activeElement).toBe(alertBox());
      expect(page.querySelector('#league-name-error')).toBeNull();
      expect(nameInput().value).toBe('Sunday Sand');
    });

    it('titles the changed alert with its heading above its description', async () => {
      await renameAndGetRefused();
      expect(text(alertBox()!.querySelector('[data-slot="alert-title"]'))).toBe(
        'Someone else changed this league while you were editing.',
      );
      expect(text(alertBox()!.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check the details and save again.',
      );
    });

    it('shows the newer format in a field the organizer did not edit', async () => {
      await renameAndGetRefused();
      expect(chip('format', '6').checked).toBe(true);
    });

    it('saves the typed name and the newer format on the next save, sending the newer values as the baselines', async () => {
      await renameAndGetRefused();
      await submit();
      expect(o.convex.calls).toHaveLength(2);
      expect(o.convex.calls[1].args).toEqual({
        leagueId: 'lg_coed',
        name: 'Sunday Sand',
        gender: 'coed',
        playersPerSide: 6,
        level: 'bb',
        ageGroup: 'adult',
        expected: { ...BASELINES, playersPerSide: 6 },
      });
      expect(alertBox()).toBeNull();
    });

    it('keeps the newer format when the new name states a format', async () => {
      await open();
      await typeName('Sunday Coed 4s');
      await leaveName();
      await submit();
      o.convex.calls[0].reject(changedSince());
      await o.flush();
      expect(chip('format', '6').checked).toBe(true);
      await submit();
      expect(o.convex.calls[1].args).toMatchObject({ name: 'Sunday Coed 4s', playersPerSide: 6 });
      expect(text(section().querySelector('fieldset [role="status"]'))).toBe('');
    });

    it('keeps a field the organizer edited, and sends the newer value as its baseline', async () => {
      await open();
      await choose('format', '2');
      await submit();
      o.convex.calls[0].reject(changedSince());
      await o.flush();
      expect(chip('format', '2').checked).toBe(true);
      await submit();
      expect(o.convex.calls[1].args).toMatchObject({
        playersPerSide: 2,
        expected: { playersPerSide: 6 },
      });
    });

    it('loads every detail the other organizer changed, including a custom level and a minimum', async () => {
      await open();
      await typeName('Sunday Sand');
      await submit();
      o.convex.calls[0].reject(
        changedSince({
          name: 'Sunday Gold',
          division: {
            gender: 'mens',
            playersPerSide: 6,
            level: 'a',
            customLevel: { customLevelId: 'cl_gold', name: 'Gold' },
            ageGroup: 'over40',
            minimumRosterSize: 8,
            label: "Men's · 6v6 · Gold (A)",
          },
        }),
      );
      await o.flush();
      expect(nameInput().value).toBe('Sunday Sand');
      expect(chip('gender', 'mens').checked).toBe(true);
      expect(chip('format', '6').checked).toBe(true);
      expect(chip('level', 'custom:cl_gold').checked).toBe(true);
      expect(page.querySelector<HTMLSelectElement>('#details-age-group')!.value).toBe('over40');
      expect(page.querySelector<HTMLInputElement>('#details-minimum-roster-size')!.value).toBe('8');
      await submit();
      expect(o.convex.calls[1].args).toEqual({
        leagueId: 'lg_coed',
        name: 'Sunday Sand',
        gender: 'mens',
        playersPerSide: 6,
        level: 'a',
        customLevelId: 'cl_gold',
        ageGroup: 'over40',
        minimumRosterSize: 8,
        expected: {
          name: 'Sunday Gold',
          gender: 'mens',
          playersPerSide: 6,
          level: 'a',
          customLevelId: 'cl_gold',
          ageGroup: 'over40',
          minimumRosterSize: 8,
        },
      });
    });

    it('loads the newer name when the organizer did not edit it', async () => {
      await open();
      await choose('format', '2');
      await submit();
      o.convex.calls[0].reject(changedSince({ ...SIX, name: 'Sunday Renamed' }));
      await o.flush();
      expect(nameInput().value).toBe('Sunday Renamed');
    });

    it('shows no alert on a save nobody else changed, and still fills the format from the name', async () => {
      await open();
      await typeName('Sunday Coed 6s');
      await leaveName();
      expect(chip('format', '6').checked).toBe(true);
      await submit();
      expect(o.convex.calls[0].args).toMatchObject({ playersPerSide: 6, expected: BASELINES });
      o.convex.calls[0].resolve(EARLIER);
      await o.flush();
      expect(alertBox()).toBeNull();
    });

    it('shows the alert and keeps the form when the refusal lacks the current values', async () => {
      await open();
      await typeName('Sunday Sand');
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'name',
          code: 'changedSince',
          message: LEAGUE_MESSAGES.changedWhileEditing,
        }),
      );
      await o.flush();
      expect(text(alertBox())).toContain('Someone else changed this league');
      expect(nameInput().value).toBe('Sunday Sand');
    });
  });

  describe('a save by another organizer, shown live', () => {
    const noteText = (value: string) =>
      `Someone else changed this to "${value}". Saving keeps yours.`;
    const RENAME_NOTE = 'Someone else changed this to "6v6". The name you typed did not change it.';

    async function live(change: Record<string, unknown> = {}, name = SUNDAY.name) {
      o.subscription(GET_ORGANIZER_CONTEXT)!.emit({
        ...SUNDAY,
        name,
        division: { ...SUNDAY.division, ...change },
      });
      await o.flush();
    }

    const noteOf = (id: string) => page.querySelector<HTMLElement>(`#${id}`);
    const notes = () => [...page.querySelectorAll('[data-slot="field-note"]')];
    const announcement = () => page.querySelector<HTMLElement>('[data-slot="note-announcement"]')!;
    const announced = () => [...announcement().querySelectorAll('p')].map((p) => text(p));
    const describedBy = (selector: string) =>
      page.querySelector(selector)!.getAttribute('aria-describedby')!.split(' ');

    async function chooseAgeGroup(key: string) {
      const select = page.querySelector<HTMLSelectElement>('#details-age-group')!;
      select.value = key;
      select.dispatchEvent(new Event('change'));
      await o.harness.fixture.whenStable();
    }

    async function typeMinimum(value: string) {
      if (!page.querySelector('#details-minimum-roster-size')) {
        form().querySelector<HTMLButtonElement>('button[type="button"]')!.click();
        await o.flush();
      }
      const minimum = page.querySelector<HTMLInputElement>('#details-minimum-roster-size')!;
      minimum.value = value;
      minimum.dispatchEvent(new Event('input'));
      await o.flush();
    }

    describe('a field that is not edited', () => {
      it('shows the other organizer’s value, with no note, alert, or status message', async () => {
        await open();
        await live({ playersPerSide: 6, label: 'Coed · 6v6 · BB' });
        expect(chip('format', '6').checked).toBe(true);
        expect(notes()).toEqual([]);
        expect(page.querySelector('[data-slot="alert"]')).toBeNull();
        expect(status()!.textContent.trim()).toBe('');
        expect(announced()).toEqual([]);
        await submit();
        expect(o.convex.calls[0].args).toMatchObject({
          playersPerSide: 6,
          expected: { playersPerSide: 6 },
        });
        o.convex.calls[0].resolve(EARLIER);
        await o.flush();
        expect(page.querySelector('[data-slot="alert"]')).toBeNull();
      });

      it('takes every detail', async () => {
        await open();
        await live(
          {
            gender: 'mens',
            playersPerSide: 6,
            level: 'a',
            ageGroup: 'over40',
            minimumRosterSize: 8,
          },
          'Sunday Gold',
        );
        expect(nameInput().value).toBe('Sunday Gold');
        expect(chip('gender', 'mens').checked).toBe(true);
        expect(chip('format', '6').checked).toBe(true);
        expect(chip('level', 'a').checked).toBe(true);
        expect(page.querySelector<HTMLSelectElement>('#details-age-group')!.value).toBe('over40');
        expect(page.querySelector<HTMLInputElement>('#details-minimum-roster-size')!.value).toBe(
          '8',
        );
        expect(notes()).toEqual([]);
        await submit();
        expect(o.convex.calls[0].args).toMatchObject({
          name: 'Sunday Gold',
          expected: { name: 'Sunday Gold', playersPerSide: 6, minimumRosterSize: 8 },
        });
      });

      it('does not count as an edit, so the saved status stays', async () => {
        await open();
        await typeName('Sunday Sand');
        await submit();
        o.convex.calls[0].resolve({ ...EARLIER, draftSeasons: [] });
        await o.flush();
        await live({ ageGroup: 'over40' }, 'Sunday Sand');
        expect(page.querySelector<HTMLSelectElement>('#details-age-group')!.value).toBe('over40');
        expect(text(status())).toContain('League details saved.');
      });
    });

    it('keeps the typed name and shows the newer format when only Name is edited', async () => {
      await open();
      await typeName('Sunday Sand');
      await leaveName();
      await live({ playersPerSide: 6 });
      expect(nameInput().value).toBe('Sunday Sand');
      expect(chip('format', '6').checked).toBe(true);
      expect(notes()).toEqual([]);
      expect(page.querySelector('[data-slot="alert"]')).toBeNull();
      await submit();
      expect(o.convex.calls[0].args).toMatchObject({
        name: 'Sunday Sand',
        playersPerSide: 6,
        expected: { name: 'Sunday Reverse Coed 4s', playersPerSide: 6 },
      });
      o.convex.calls[0].resolve(EARLIER);
      await o.flush();
      expect(page.querySelector('[data-slot="alert"]')).toBeNull();
    });

    describe('an edited field', () => {
      const FIELDS = [
        {
          field: 'Name',
          id: 'league-name',
          owner: '#league-name',
          edit: () => typeName('Sunday Sand'),
          change: () => live({}, 'Sunday Gold'),
          value: 'Sunday Gold',
          editAgain: () => typeName('Sunday Sand again'),
        },
        {
          field: 'Gender',
          id: 'details-gender',
          owner: 'fieldset#details-gender',
          edit: () => choose('gender', 'mens'),
          change: () => live({ gender: 'womens' }),
          value: "Women's",
          editAgain: () => choose('gender', 'coed'),
        },
        {
          field: 'Format',
          id: 'details-format',
          owner: 'fieldset#details-format',
          edit: () => choose('format', '2'),
          change: () => live({ playersPerSide: 6 }),
          value: '6v6',
          editAgain: () => choose('format', '3'),
        },
        {
          field: 'Minimum roster size',
          id: 'details-minimum-roster-size',
          owner: '#details-minimum-roster-size',
          edit: () => typeMinimum('5'),
          change: () => live({ minimumRosterSize: 8 }),
          value: '8',
          editAgain: () => typeMinimum('9'),
        },
        {
          field: 'Level',
          id: 'details-level',
          owner: 'fieldset#details-level',
          edit: () => choose('level', 'a'),
          change: () => live({ level: 'aa' }),
          value: 'AA',
          editAgain: () => choose('level', 'bb'),
        },
        {
          field: 'Age group',
          id: 'details-age-group',
          owner: '#details-age-group',
          edit: () => chooseAgeGroup('over40'),
          change: () => live({ ageGroup: 'u10' }),
          value: 'U10',
          editAgain: () => chooseAgeGroup('over50'),
        },
      ];

      it.each(FIELDS)(
        '$field keeps its value and shows a note with the value as labelled, linked by aria-describedby',
        async ({ id, owner, edit, change, value }) => {
          await open();
          await edit();
          await change();
          expect(text(noteOf(`${id}-note`))).toBe(noteText(value));
          expect(describedBy(owner)).toContain(`${id}-note`);
          expect(page.querySelector('[data-slot="alert"]')).toBeNull();
        },
      );

      it.each(FIELDS)('$field note clears when the field is changed', async (field) => {
        await open();
        await field.edit();
        await field.change();
        expect(noteOf(`${field.id}-note`)).not.toBeNull();
        await field.editAgain();
        expect(noteOf(`${field.id}-note`)).toBeNull();
        expect(describedBy(field.owner)).not.toContain(`${field.id}-note`);
      });

      it('keeps the typed values, and the next save writes them with no refusal', async () => {
        await open();
        await choose('format', '2');
        await live({ playersPerSide: 6 });
        await submit();
        expect(o.convex.calls[0].args).toMatchObject({
          playersPerSide: 2,
          expected: { playersPerSide: 6 },
        });
        o.convex.calls[0].resolve(EARLIER);
        await o.flush();
        expect(page.querySelector('[data-slot="alert"]')).toBeNull();
      });

      it('clears every note when the save lands', async () => {
        await open();
        await choose('format', '2');
        await typeName('Sunday Sand');
        await live({ playersPerSide: 6 }, 'Sunday Gold');
        expect(notes()).toHaveLength(2);
        await submit();
        o.convex.calls[0].resolve(EARLIER);
        await o.flush();
        expect(notes()).toEqual([]);
        expect(announced()).toEqual([]);
      });

      it('shows a newer custom level by its name', async () => {
        await open();
        await choose('level', 'a');
        await live({ level: 'b', customLevel: { customLevelId: 'cl_gold', name: 'Gold' } });
        expect(text(noteOf('details-level-note'))).toBe(noteText('Gold'));
      });

      it('says a minimum was cleared when the newer save has none', async () => {
        await open({ ...SUNDAY, division: { ...SUNDAY.division, minimumRosterSize: 6 } });
        await typeMinimum('7');
        await live();
        expect(text(noteOf('details-minimum-roster-size-note'))).toBe(
          'Someone else cleared this. Saving keeps yours.',
        );
      });

      it('shows the note when the server refuses a save as out of date', async () => {
        await open();
        await choose('format', '2');
        await submit();
        o.convex.calls[0].reject(
          new ConvexError({
            field: 'name',
            code: 'changedSince',
            message: LEAGUE_MESSAGES.changedWhileEditing,
            current: {
              name: SUNDAY.name,
              division: { ...SUNDAY.division, playersPerSide: 6, label: 'Coed · 6v6 · BB' },
            },
          }),
        );
        await o.flush();
        expect(text(noteOf('details-format-note'))).toBe(noteText('6v6'));
      });
    });

    describe('the rename note', () => {
      it('says the name did not change a format another organizer saved, and clears on save', async () => {
        await open();
        await live({ playersPerSide: 6 });
        await typeName('Sunday Coed 4s');
        await leaveName();
        expect(chip('format', '6').checked).toBe(true);
        expect(text(noteOf('details-format-note'))).toBe(RENAME_NOTE);
        expect(describedBy('fieldset#details-format')).toContain('details-format-note');
        await submit();
        expect(o.convex.calls[0].args).toMatchObject({ name: 'Sunday Coed 4s', playersPerSide: 6 });
        o.convex.calls[0].resolve(EARLIER);
        await o.flush();
        expect(notes()).toEqual([]);
      });

      it('goes when the name states the format again', async () => {
        await open();
        await live({ playersPerSide: 6 });
        await typeName('Sunday Coed 4s');
        await leaveName();
        await typeName('Sunday Coed 6s');
        await leaveName();
        expect(noteOf('details-format-note')).toBeNull();
      });
    });

    describe('the announcement', () => {
      it('is an sr-only live region of its own, apart from the save status', async () => {
        await open();
        const region = announcement();
        expect(region.getAttribute('role')).toBe('status');
        expect(region.classList.contains('sr-only')).toBe(true);
        expect(status()!.contains(region)).toBe(false);
        expect(region.textContent.trim()).toBe('');
      });

      it('puts a new note’s text in the region once, and not again on a later render', async () => {
        await open();
        await choose('format', '2');
        await live({ playersPerSide: 6 });
        expect(announced()).toEqual([noteText('6v6')]);
        const first = announcement().querySelector('p');
        o.subscription(LIST_FOR_ORGANIZER)!.emit(SEASONS);
        await o.flush();
        await typeName('Sunday Sand');
        expect(announced()).toEqual([noteText('6v6')]);
        expect(announcement().querySelector('p')).toBe(first);
      });

      it('announces each note when one update brings notes on two fields', async () => {
        await open();
        await choose('format', '2');
        await choose('gender', 'mens');
        await live({ playersPerSide: 6, gender: 'womens' });
        expect(announced()).toEqual([noteText("Women's"), noteText('6v6')]);
      });

      it('announces only the note that is new when another follows', async () => {
        await open();
        await choose('format', '2');
        await choose('gender', 'mens');
        await live({ playersPerSide: 6 });
        await live({ playersPerSide: 6, gender: 'womens' });
        expect(announced()).toEqual([noteText("Women's")]);
      });

      it('announces the rename note', async () => {
        await open();
        await live({ playersPerSide: 6 });
        await typeName('Sunday Coed 4s');
        await leaveName();
        expect(announced()).toEqual([RENAME_NOTE]);
      });

      it('announces nothing for a silent update of a field that is not edited', async () => {
        await open();
        await typeName('Sunday Sand');
        await live({ playersPerSide: 6 });
        expect(announced()).toEqual([]);
      });

      it('empties when the note clears', async () => {
        await open();
        await choose('format', '2');
        await live({ playersPerSide: 6 });
        await choose('format', '3');
        expect(announced()).toEqual([]);
      });
    });

    describe('the user’s own save and Undo', () => {
      it('shows no note when the league’s live value follows the save, before or after it resolves', async () => {
        await open();
        await typeName('Sunday Sand');
        await choose('format', '6');
        await submit();
        await live({ playersPerSide: 6 }, 'Sunday Sand');
        o.convex.calls[0].resolve(EARLIER);
        await o.flush();
        await live({ playersPerSide: 6 }, 'Sunday Sand');
        expect(notes()).toEqual([]);
        expect(announced()).toEqual([]);
        expect(text(status())).toContain('League details saved.');
      });

      it('shows no note when the live value follows Undo', async () => {
        await open();
        await typeName('Sunday Sand');
        await choose('format', '6');
        await submit();
        o.convex.calls[0].resolve(EARLIER);
        await o.flush();
        await live({ playersPerSide: 6 }, 'Sunday Sand');
        undoButton()!.click();
        await o.flush();
        await live();
        o.convex.calls[1].resolve(null);
        await o.flush();
        expect(notes()).toEqual([]);
        expect(announced()).toEqual([]);
        expect(nameInput().value).toBe('Sunday Reverse Coed 4s');
        expect(chip('format', '4').checked).toBe(true);
      });

      it('takes a change that arrived while Undo was pending when Undo fails', async () => {
        await open();
        await typeName('Sunday Sand');
        await submit();
        o.convex.calls[0].resolve(EARLIER);
        await o.flush();
        undoButton()!.click();
        await o.flush();
        await live({ ageGroup: 'over40' }, 'Sunday Sand');
        o.convex.calls[1].reject(new Error('Server Error: secret'));
        await o.flush();
        expect(page.querySelector<HTMLSelectElement>('#details-age-group')!.value).toBe('over40');
      });
    });

    it('loads another league as it is, with no note', async () => {
      await open();
      await choose('format', '2');
      o.subscription(GET_ORGANIZER_CONTEXT)!.emit({
        ...SUNDAY,
        leagueId: 'lg_other',
        name: 'Other League',
        division: { ...SUNDAY.division, playersPerSide: 6 },
      });
      await o.flush();
      expect(nameInput().value).toBe('Other League');
      expect(chip('format', '6').checked).toBe(true);
      expect(notes()).toEqual([]);
    });
  });

  describe('a refusal', () => {
    it('shows the server’s message under the field it names, and keeps the input', async () => {
      await open();
      await choose('format', '6');
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'format',
          code: 'draftSeasonsTooMany',
          message: LEAGUE_MESSAGES.draftSeasonsTooMany,
        }),
      );
      await o.flush();
      expect(text(page.querySelector('#details-format-error'))).toBe(
        'This league has too many draft seasons to update. Publish or remove some first.',
      );
      expect(chip('format', '6').checked).toBe(true);
      expect(page.querySelector('[data-slot="alert"]')).toBeNull();
    });

    it('shows the failure alert for any other error, with the input kept', async () => {
      await open();
      await typeName('Sunday Sand');
      await submit();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = page.querySelector('[data-slot="alert"]')!;
      expect(text(alert)).toContain('The league details could not be saved.');
      expect(text(alert)).not.toContain('secret');
      expect(nameInput().value).toBe('Sunday Sand');
    });

    it('titles the failure alert with its heading above its description', async () => {
      await open();
      await typeName('Sunday Sand');
      await submit();
      o.convex.calls[0].reject(new Error('Server Error: secret'));
      await o.flush();
      const alert = page.querySelector('[data-slot="alert"]')!;
      expect(text(alert.querySelector('[data-slot="alert-title"]'))).toBe(
        'The league details could not be saved.',
      );
      expect(text(alert.querySelector('[data-slot="alert-description"]'))).toBe(
        'Check your connection and try again.',
      );
    });

    it('shows the offline note when the connection drops, with what is unchanged', async () => {
      await open();
      await typeName('Sunday Sand');
      await submit();
      o.convex.calls[0].reject(new ConvexOfflineError());
      await o.flush();
      expect(text(page.querySelector('[data-slot="alert"]'))).toContain(
        "You're offline. Nothing was sent.",
      );
      expect(text(page.querySelector('[data-slot="alert"]'))).toContain(
        "Try again when you're connected.",
      );
    });
  });
});
