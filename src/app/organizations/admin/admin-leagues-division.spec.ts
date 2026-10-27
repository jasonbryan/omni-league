import { ConvexError } from 'convex/values';
import { AdminArea } from './admin-area';
import { AdminLeagues } from './admin-leagues';
import {
  adminRoutes,
  COASTAL,
  COASTAL_LOCATIONS,
  GET_ADMIN_CONTEXT,
  LIST_FOR_ADMIN,
  openAdmin,
  text,
} from './testing/admin-harness';

const ROUTES = adminRoutes(AdminArea, [{ path: 'leagues', component: AdminLeagues }]);
const URL = `/app/organizations/${COASTAL.slug}/leagues`;
const LIST_LEAGUES = 'leagues:listForAdmin';
const CREATE = 'leagues:create';

describe('AdminLeagues: the Division group', () => {
  let o: Awaited<ReturnType<typeof openAdmin>>;
  let page: HTMLElement;

  async function open(leagues: unknown[] = []) {
    o = await openAdmin(ROUTES, URL);
    page = o.page;
    o.acceptToken();
    o.subscription(GET_ADMIN_CONTEXT)!.emit(COASTAL);
    await o.flush();
    o.subscription(LIST_LEAGUES)!.emit(leagues);
    o.subscription(LIST_FOR_ADMIN)!.emit(COASTAL_LOCATIONS.slice(0, 1));
    await o.flush();
  }

  const input = (id: string) => page.querySelector<HTMLInputElement>(`#${id}`)!;
  const form = () => page.querySelector<HTMLFormElement>('#create-league form')!;
  const submitButton = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const error = (id: string) => text(page.querySelector(`#${id}-error`)) ?? null;
  const settle = () => o.harness.fixture.whenStable();

  const group = (name: string) => {
    const radios = [
      ...page.querySelectorAll<HTMLInputElement>(`fieldset#${name} input[type="radio"]`),
    ];
    return {
      legend: text(page.querySelector(`fieldset#${name} legend`)),
      labels: radios.map((radio) => text(radio.closest('label'))),
      checked: radios.filter((radio) => radio.checked).map((radio) => text(radio.closest('label'))),
    };
  };
  const status = () =>
    text(page.querySelector('#create-league form [role="status"]:not(.sr-only)'));
  const ageGroup = () => page.querySelector<HTMLSelectElement>('select#age-group')!;

  async function type(id: string, value: string) {
    input(id).value = value;
    input(id).dispatchEvent(new Event('input'));
    await settle();
  }

  async function leave(id: string) {
    input(id).dispatchEvent(new Event('blur'));
    await settle();
  }

  async function choose(id: string) {
    input(id).checked = true;
    input(id).dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }

  async function submit() {
    submitButton().click();
    await o.flush();
  }

  async function pressRaiseMinimum() {
    [...form().querySelectorAll('button')]
      .find((button) => text(button) === 'Raise the minimum roster size')!
      .click();
    await o.flush();
  }

  describe('the choices', () => {
    it('shows no choices until a sport is chosen, and says why', async () => {
      await open();
      expect(page.querySelector('fieldset#gender')).toBeNull();
      expect(page.querySelector('fieldset#format')).toBeNull();
      expect(text(form())).toContain('Choose a sport to see its formats and levels.');
    });

    it('beach volleyball: Coed, 2v2 to 6v6 with none chosen, Rec to Open with Rec chosen, and Adult', async () => {
      await open();
      await choose('sport-beachVolleyball');
      expect(group('gender')).toEqual({
        legend: 'Gender',
        labels: ['Coed', "Men's", "Women's"],
        checked: ['Coed'],
      });
      expect(group('format')).toEqual({
        legend: 'Format',
        labels: ['2v2', '3v3', '4v4', '5v5', '6v6'],
        checked: [],
      });
      expect(group('level')).toEqual({
        legend: 'Level',
        labels: ['Rec', 'B', 'BB', 'A', 'AA', 'Open'],
        checked: ['Rec'],
      });
      expect(ageGroup().value).toBe('adult');
    });

    it('soccer: 4v4 to 11v11, and Rec, Intermediate, and Competitive', async () => {
      await open();
      await choose('sport-soccer');
      expect(group('format').labels).toEqual([
        '4v4',
        '5v5',
        '6v6',
        '7v7',
        '8v8',
        '9v9',
        '10v10',
        '11v11',
      ]);
      expect(group('level').labels).toEqual(['Rec', 'Intermediate', 'Competitive']);
    });

    it('explains Gender, Format, and Level in a hint under each', async () => {
      await open();
      await choose('sport-beachVolleyball');
      expect(text(page.querySelector('#gender-description'))).toBe(
        'Shown as Boys and Girls for youth age groups.',
      );
      expect(text(page.querySelector('#format-description'))).toBe(
        'Players on each side. It sets the minimum roster size of every season of this league.',
      );
      expect(text(page.querySelector('#level-description'))).toBe(
        'Standard levels for beach volleyball.',
      );
    });

    it('a chip is chosen by pressing its label, and its radio shows no text of its own', async () => {
      await open();
      await choose('sport-beachVolleyball');
      const chip = input('format-4').closest('label')!.querySelector('span')!;
      expect(text(input('format-4'))).toBe('');
      chip.click();
      await settle();
      expect(group('format').checked).toEqual(['4v4']);
    });

    it('Age group is a native select: Adult, 30+ to 60+, then U6 to U19, with Adult chosen', async () => {
      await open();
      await choose('sport-beachVolleyball');
      const select = ageGroup();
      expect(select.tagName).toBe('SELECT');
      expect(text(page.querySelector('label[for="age-group"]'))).toBe('Age group');
      expect([...select.options].map((option) => text(option))).toEqual([
        'Adult',
        '30+',
        '35+',
        '40+',
        '50+',
        '55+',
        '60+',
        ...Array.from({ length: 14 }, (_, index) => `U${index + 6}`),
      ]);
      expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual([
        'Adult',
        'Youth',
      ]);
      expect(select.selectedOptions[0]?.value).toBe('adult');
    });
  });

  describe('filling in from the name', () => {
    const NAME = "Wednesday Women's 2s BB";

    it('chooses Women’s, 2v2, and BB when Name is left, and says so in a status', async () => {
      await open();
      await choose('sport-beachVolleyball');
      await type('name', NAME);
      expect(status()).toBe('');
      await leave('name');
      expect(group('gender').checked).toEqual(["Women's"]);
      expect(group('format').checked).toEqual(['2v2']);
      expect(group('level').checked).toEqual(['BB']);
      expect(status()).toBe(
        'Gender, format, and level were filled in from the name. Change any that are wrong.',
      );
    });

    it('keeps a gender chosen by hand, fills the rest, and names only those in the status', async () => {
      await open();
      await choose('sport-beachVolleyball');
      await choose('gender-coed');
      await type('name', NAME);
      await leave('name');
      expect(group('gender').checked).toEqual(['Coed']);
      expect(group('format').checked).toEqual(['2v2']);
      expect(status()).toBe(
        'Format and level were filled in from the name. Change any that are wrong.',
      );
    });

    it('drops a choice from the status once the organizer changes it', async () => {
      await open();
      await choose('sport-beachVolleyball');
      await type('name', NAME);
      await leave('name');
      await choose('level-a');
      expect(status()).toBe(
        'Gender and format were filled in from the name. Change any that are wrong.',
      );
    });

    it('fills in once the sport is chosen, when the name was left first', async () => {
      await open();
      await type('name', NAME);
      await leave('name');
      await choose('sport-beachVolleyball');
      expect(group('format').checked).toEqual(['2v2']);
    });

    it('announces the status from a live region that is in the page before it has text', async () => {
      await open();
      await choose('sport-beachVolleyball');
      const region = page.querySelector('#create-league form fieldset [role="status"]');
      expect(region).not.toBeNull();
      expect(text(region)).toBe('');
      await type('name', NAME);
      await leave('name');
      expect(page.querySelector('#create-league form fieldset [role="status"]')).toBe(region);
      expect(text(region)).toContain('filled in from the name');
    });
  });

  describe('changing the sport', () => {
    it('keeps gender and age group, keeps 6v6, and resets BB to Rec for soccer', async () => {
      await open();
      await choose('sport-beachVolleyball');
      await choose('gender-mens');
      await choose('format-6');
      await choose('level-bb');
      ageGroup().value = 'over40';
      ageGroup().dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      await choose('sport-soccer');
      expect(group('gender').checked).toEqual(["Men's"]);
      expect(group('format').checked).toEqual(['6v6']);
      expect(group('level').checked).toEqual(['Rec']);
      expect(ageGroup().value).toBe('over40');
    });

    it('clears the format for softball, which has no 6v6', async () => {
      await open();
      await choose('sport-beachVolleyball');
      await choose('format-6');
      await choose('sport-softball');
      expect(group('format').checked).toEqual([]);
    });
  });

  describe('submitting', () => {
    async function fillRest() {
      await type('name', 'Sunday Night Sand');
      await choose('sport-beachVolleyball');
    }

    it('without a format sends nothing, shows the error under Format, and focuses its first chip', async () => {
      await open();
      await fillRest();
      await submit();
      expect(o.convex.calls).toEqual([]);
      expect(error('format')).toBe('Choose a format. Players filter leagues by it.');
      expect(page.querySelector('fieldset#format')?.getAttribute('aria-describedby')).toBe(
        'format-description format-error',
      );
      expect(input('format-2').getAttribute('aria-invalid')).toBe('true');
      expect(page.querySelector('#format-error')?.getAttribute('role')).toBe('alert');
      expect(document.activeElement).toBe(input('format-2'));
    });

    it('keeps every field as it was after the refusal', async () => {
      await open();
      await fillRest();
      await choose('gender-womens');
      await choose('level-aa');
      ageGroup().value = 'u12';
      ageGroup().dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      await submit();
      expect(group('gender').checked).toEqual(["Women's"]);
      expect(group('level').checked).toEqual(['AA']);
      expect(ageGroup().value).toBe('u12');
      expect(input('name').value).toBe('Sunday Night Sand');
      expect(group('format').checked).toEqual([]);
    });

    it('clears the error as soon as a format is chosen', async () => {
      await open();
      await fillRest();
      await submit();
      await choose('format-4');
      expect(error('format')).toBeNull();
      expect(page.querySelector('fieldset#format')?.getAttribute('aria-describedby')).toBe(
        'format-description',
      );
    });

    it('sends the chosen division', async () => {
      await open();
      await fillRest();
      await choose('gender-mens');
      await choose('format-6');
      await choose('level-bb');
      ageGroup().value = 'over40';
      ageGroup().dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      await submit();
      expect(o.convex.calls.map((call) => [call.name, call.args])).toEqual([
        [
          CREATE,
          {
            organizationId: COASTAL.organizationId,
            name: 'Sunday Night Sand',
            slug: 'sunday-night-sand',
            sport: 'beachVolleyball',
            locationIds: ['loc_pelican'],
            gender: 'mens',
            playersPerSide: 6,
            level: 'bb',
            ageGroup: 'over40',
          },
        ],
      ]);
    });

    it('shows a server refusal under the field, and keeps what was entered', async () => {
      await open();
      await fillRest();
      await choose('format-4');
      await submit();
      o.convex.calls[0].reject(
        new ConvexError({
          field: 'format',
          code: 'formatInvalid',
          message: 'Choose a format. Players filter leagues by it.',
        }),
      );
      await o.flush();
      expect(error('format')).toBe('Choose a format. Players filter leagues by it.');
      expect(group('format').checked).toEqual(['4v4']);
      expect(document.activeElement).toBe(input('format-2'));
    });

    it('goes back to the defaults after a create', async () => {
      await open();
      await fillRest();
      await choose('gender-mens');
      await choose('format-4');
      await submit();
      o.convex.calls[0].resolve({ leagueId: 'lg_new' });
      await o.flush();
      expect(page.querySelector('fieldset#gender')).toBeNull();
      await choose('sport-beachVolleyball');
      expect(group('gender').checked).toEqual(['Coed']);
      expect(group('format').checked).toEqual([]);
    });
  });

  describe('the minimum roster size', () => {
    async function withFormat(count: number) {
      await open();
      await type('name', 'Sunday Reverse Coed 4s');
      await choose('sport-beachVolleyball');
      await choose(`format-${count}`);
    }

    it('is behind a button until it is wanted', async () => {
      await withFormat(4);
      expect(page.querySelector('#minimum-roster-size')).toBeNull();
      await pressRaiseMinimum();
      expect(input('minimum-roster-size')).not.toBeNull();
      expect(document.activeElement).toBe(input('minimum-roster-size'));
      expect(text(page.querySelector('label[for="minimum-roster-size"]'))).toBe(
        'Minimum roster size',
      );
    });

    it('shows the error under the field when it is left below the format', async () => {
      await withFormat(4);
      await pressRaiseMinimum();
      await type('minimum-roster-size', '3');
      expect(error('minimum-roster-size')).toBeNull();
      await leave('minimum-roster-size');
      expect(error('minimum-roster-size')).toBe('4v4 needs at least 4 players. Enter 4 or more.');
      expect(input('minimum-roster-size').getAttribute('aria-invalid')).toBe('true');
      expect(input('minimum-roster-size').getAttribute('aria-describedby')).toBe(
        'minimum-roster-size-description minimum-roster-size-error',
      );
      await submit();
      expect(o.convex.calls).toEqual([]);
      expect(document.activeElement).toBe(input('minimum-roster-size'));
    });

    it('sends the number typed, and no minimum when it is blank', async () => {
      await withFormat(4);
      await pressRaiseMinimum();
      await type('minimum-roster-size', '6');
      await submit();
      expect(o.convex.calls[0].args).toMatchObject({ playersPerSide: 4, minimumRosterSize: 6 });
      o.convex.calls[0].resolve({ leagueId: 'lg_new' });
      await o.flush();
      expect(page.querySelector('#minimum-roster-size')).toBeNull();

      await type('name', 'Second One');
      await choose('sport-beachVolleyball');
      await choose('format-4');
      await pressRaiseMinimum();
      await submit();
      expect(o.convex.calls[1].args).not.toHaveProperty('minimumRosterSize');
    });
  });

  describe('the Leagues list', () => {
    it('shows each league’s division under its name, and none for a league without one', async () => {
      await open([
        {
          leagueId: 'lg_a',
          name: 'Sunday Reverse Coed 4s',
          slug: 'sunday-reverse-coed-4s',
          sportName: 'Beach volleyball',
          status: 'draft',
          locationNames: ['Pelican Shoals Sand Courts'],
          divisionLabel: 'Coed · 4v4 · BB',
        },
        {
          leagueId: 'lg_b',
          name: 'Old League',
          slug: 'old-league',
          sportName: 'Soccer',
          status: 'published',
          locationNames: ['Redfish Flats Fields'],
        },
      ]);
      const rows = [...page.querySelectorAll<HTMLElement>('#leagues-list > li')];
      expect(text(rows[0].querySelector('[data-slot="league-division"]'))).toBe('Coed · 4v4 · BB');
      expect(rows[1].querySelector('[data-slot="league-division"]')).toBeNull();
    });
  });
});
