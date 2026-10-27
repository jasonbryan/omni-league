import { TestBed } from '@angular/core/testing';
import { ConvexError } from 'convex/values';
import type { Id } from '../../../../convex/_generated/dataModel';
import { LeagueForm } from './league-form';

const REDFISH = 'loc_redfish' as Id<'locations'>;

function create() {
  const form = TestBed.runInInjectionContext(() => new LeagueForm(() => [REDFISH]));
  form.model.set({ name: 'Sunday Sand', slug: 'sunday-sand' });
  return form;
}

const send = () => vi.fn().mockResolvedValue(undefined);

describe('LeagueForm: the division', () => {
  it('fills gender, format, and level from the name when Name is left', () => {
    const form = create();
    form.chooseSport('beachVolleyball');
    form.model.set({ name: "Wednesday Women's 2s BB", slug: 'wednesday' });
    form.left('name');
    expect([form.division.gender(), form.division.playersPerSide(), form.division.level()]).toEqual(
      ['womens', 2, 'bb'],
    );
  });

  it('fills from a name left before the sport was chosen, once the sport is chosen', () => {
    const form = create();
    form.model.set({ name: 'Coed 4s BB', slug: 'coed-4s-bb' });
    form.left('name');
    expect(form.division.playersPerSide()).toBeNull();
    form.chooseSport('beachVolleyball');
    expect([form.division.playersPerSide(), form.division.level()]).toEqual([4, 'bb']);
  });

  it('keeps a format the new sport has, and clears one it does not', () => {
    const form = create();
    form.chooseSport('beachVolleyball');
    form.division.chooseFormat(6);
    form.division.chooseLevel('bb');
    form.chooseSport('soccer');
    expect([form.division.playersPerSide(), form.division.level()]).toEqual([6, 'rec']);
    form.chooseSport('softball');
    expect(form.division.playersPerSide()).toBeNull();
  });

  it('fills from the name when it is submitted, as Enter in Name does before Name is left', async () => {
    const form = create();
    form.chooseSport('beachVolleyball');
    form.toggleLocation(REDFISH, true);
    form.model.set({ name: 'Sunday Coed 4s', slug: 'sunday-coed-4s' });
    const sendCreate = send();
    await form.submit(true, sendCreate);
    expect(sendCreate).toHaveBeenCalledWith(expect.objectContaining({ playersPerSide: 4 }));
  });

  describe('Format', () => {
    it('is refused on submit when none is chosen: nothing is sent and focus goes to Format', async () => {
      const form = create();
      form.chooseSport('beachVolleyball');
      const sendCreate = send();
      const outcome = await form.submit(true, sendCreate);
      expect(outcome).toEqual({ sent: false, focus: 'format' });
      expect(sendCreate).not.toHaveBeenCalled();
      expect(form.errors.format()).toBe('Choose a format. Players filter leagues by it.');
    });

    it('shows no error when focus passes through it unchosen', () => {
      const form = create();
      form.chooseSport('soccer');
      form.left('format');
      expect(form.errors.format()).toBeNull();
    });

    it('clears a shown error the moment a format is chosen', async () => {
      const form = create();
      form.chooseSport('soccer');
      await form.submit(true, send());
      expect(form.errors.format()).not.toBeNull();
      form.division.chooseFormat(11);
      expect(form.errors.format()).toBeNull();
    });
  });

  describe('Minimum roster size', () => {
    function withFormat(playersPerSide: number) {
      const form = create();
      form.chooseSport('beachVolleyball');
      form.division.chooseFormat(playersPerSide);
      return form;
    }

    it('shows the error when the field is left below the format, and not while typing', () => {
      const form = withFormat(4);
      form.division.setMinimumText('3');
      expect(form.errors.minimumRosterSize()).toBeNull();
      form.left('minimumRosterSize');
      expect(form.errors.minimumRosterSize()).toBe(
        '4v4 needs at least 4 players. Enter 4 or more.',
      );
      form.division.setMinimumText('4');
      expect(form.errors.minimumRosterSize()).toBeNull();
    });

    it('shows nothing when the field is left blank, or before a format is chosen', () => {
      const form = withFormat(4);
      form.left('minimumRosterSize');
      expect(form.errors.minimumRosterSize()).toBeNull();
      const noFormat = create();
      noFormat.chooseSport('beachVolleyball');
      noFormat.division.setMinimumText('1');
      noFormat.left('minimumRosterSize');
      expect(noFormat.errors.minimumRosterSize()).toBeNull();
    });

    it('is checked again against a larger format when the format changes', async () => {
      const form = withFormat(2);
      form.division.setMinimumText('3');
      form.left('minimumRosterSize');
      expect(form.errors.minimumRosterSize()).toBeNull();
      form.division.chooseFormat(6);
      const outcome = await form.submit(true, send());
      expect(outcome).toEqual({ sent: false, focus: 'minimumRosterSize' });
      expect(form.errors.minimumRosterSize()).toBe(
        '6v6 needs at least 6 players. Enter 6 or more.',
      );
    });
  });

  describe('sending', () => {
    it('sends the defaults with the format, and no minimum when none is typed', async () => {
      const form = create();
      form.chooseSport('beachVolleyball');
      form.division.chooseFormat(4);
      form.toggleLocation(REDFISH, true);
      const sendCreate = send();
      await form.submit(true, sendCreate);
      expect(sendCreate).toHaveBeenCalledWith({
        name: 'Sunday Sand',
        slug: 'sunday-sand',
        sport: 'beachVolleyball',
        locationIds: [REDFISH],
        gender: 'coed',
        playersPerSide: 4,
        level: 'rec',
        ageGroup: 'adult',
      });
    });

    it('sends the chosen division and the minimum roster size', async () => {
      const form = create();
      form.chooseSport('beachVolleyball');
      form.toggleLocation(REDFISH, true);
      form.division.chooseGender('womens');
      form.division.chooseFormat(4);
      form.division.chooseLevel('bb');
      form.division.setAgeGroup('over40');
      form.division.setMinimumText('6');
      const sendCreate = send();
      await form.submit(true, sendCreate);
      expect(sendCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          gender: 'womens',
          playersPerSide: 4,
          level: 'bb',
          ageGroup: 'over40',
          minimumRosterSize: 6,
        }),
      );
    });

    it('keeps every field after a refused submit', async () => {
      const form = create();
      form.chooseSport('beachVolleyball');
      form.division.chooseGender('mens');
      form.division.chooseLevel('a');
      form.division.setAgeGroup('u12');
      form.division.setMinimumText('2');
      await form.submit(true, send());
      expect([
        form.division.gender(),
        form.division.level(),
        form.division.ageGroup(),
        form.division.minimumText(),
        form.sport(),
        form.model().name,
      ]).toEqual(['mens', 'a', 'u12', '2', 'beachVolleyball', 'Sunday Sand']);
    });

    it('shows a server refusal under the field it names, and keeps the value', async () => {
      const form = create();
      form.chooseSport('beachVolleyball');
      form.division.chooseFormat(4);
      form.toggleLocation(REDFISH, true);
      const refusal = new ConvexError({
        field: 'level',
        code: 'levelInvalid',
        message: 'Choose one of the levels listed.',
      });
      const outcome = await form.submit(true, () => Promise.reject(refusal));
      expect(outcome).toEqual({ sent: false, focus: 'level' });
      expect(form.errors.level()).toBe('Choose one of the levels listed.');
      expect(form.division.playersPerSide()).toBe(4);
      form.division.chooseLevel('bb');
      expect(form.errors.level()).toBeNull();
    });
  });

  it('clear() puts the division back to its defaults and hides its errors', async () => {
    const form = create();
    form.chooseSport('soccer');
    form.division.chooseGender('mens');
    await form.submit(true, send());
    form.clear();
    expect(form.division.gender()).toBe('coed');
    expect(form.errors.format()).toBeNull();
  });
});
