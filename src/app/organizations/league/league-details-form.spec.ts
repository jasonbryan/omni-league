import { ConvexError } from 'convex/values';
import { LEAGUE_MESSAGES } from '../../../../convex/lib/leagueInput';
import { ConvexOfflineError } from '../../core/data/convex';
import { PRIMARY_BUTTON } from '../admin/button-classes';
import { openAdmin, text } from '../admin/testing/admin-harness';
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
      expect(text(page.querySelector('#league-name-description'))).toBe('Up to 100 characters.');
      expect(text(section().querySelector('fieldset legend'))).toBe('Division');
      expect(text(save())).toBe('Save changes');
      expect(save().className.split(' ')).toEqual(
        expect.arrayContaining(PRIMARY_BUTTON.split(' ')),
      );
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
      });
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

  describe('a save and an Undo', () => {
    it('do not start an Undo while the save is pending', async () => {
      await open();
      await typeName('Sunday Sand');
      await submit();
      expect(undoButton()).toBeUndefined();
      expect(o.convex.calls).toHaveLength(1);
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
