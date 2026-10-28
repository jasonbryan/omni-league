import type { Id } from '../../../../convex/_generated/dataModel';
import { filledFromNameMessage, LeagueDivision } from './league-division';

const GOLD = { customLevelId: 'gold' as Id<'customLevels'>, standardLevel: 'a' as const };

const NAME = "Wednesday Women's 2s BB";

describe('LeagueDivision', () => {
  it('starts as Coed, Rec, and Adult with no format and no minimum', () => {
    const division = new LeagueDivision();
    expect([
      division.gender(),
      division.playersPerSide(),
      division.level(),
      division.ageGroup(),
      division.minimumText(),
      division.filledFromName(),
    ]).toEqual(['coed', null, 'rec', 'adult', '', []]);
  });

  describe('filling in from the name', () => {
    it('sets gender, format, and level where the name states them', () => {
      const division = new LeagueDivision();
      division.fillFromName(NAME, 'beachVolleyball');
      expect([division.gender(), division.playersPerSide(), division.level()]).toEqual([
        'womens',
        2,
        'bb',
      ]);
      expect(division.filledFromName()).toEqual(['gender', 'format', 'level']);
    });

    it('leaves a field the name does not state at its default', () => {
      const division = new LeagueDivision();
      division.fillFromName('Sunday Night Sand', 'beachVolleyball');
      expect([division.gender(), division.playersPerSide(), division.level()]).toEqual([
        'coed',
        null,
        'rec',
      ]);
      expect(division.filledFromName()).toEqual([]);
    });

    it('never overwrites a field the organizer chose by hand, and fills the rest', () => {
      const division = new LeagueDivision();
      division.chooseGender('coed');
      division.fillFromName(NAME, 'beachVolleyball');
      expect(division.gender()).toBe('coed');
      expect([division.playersPerSide(), division.level()]).toEqual([2, 'bb']);
      expect(division.filledFromName()).toEqual(['format', 'level']);
    });

    it('fills a field again when the name changes, until the organizer chooses it', () => {
      const division = new LeagueDivision();
      division.fillFromName('Coed 4s', 'beachVolleyball');
      expect(division.playersPerSide()).toBe(4);
      division.fillFromName('Coed 6s', 'beachVolleyball');
      expect(division.playersPerSide()).toBe(6);
      division.chooseFormat(3);
      division.fillFromName('Coed 2s', 'beachVolleyball');
      expect(division.playersPerSide()).toBe(3);
    });

    it('returns a filled field to its default when the edited name no longer states it', () => {
      const division = new LeagueDivision();
      division.fillFromName("Women's 2s BB", 'beachVolleyball');
      division.fillFromName("Women's league", 'beachVolleyball');
      expect([division.gender(), division.playersPerSide(), division.level()]).toEqual([
        'womens',
        null,
        'rec',
      ]);
      expect(division.filledFromName()).toEqual(['gender']);
    });

    it('keeps a field the organizer chose when the edited name no longer states it', () => {
      const division = new LeagueDivision();
      division.fillFromName("Women's 2s BB", 'beachVolleyball');
      division.chooseLevel('a');
      division.fillFromName("Women's 2s", 'beachVolleyball');
      expect(division.level()).toBe('a');
    });

    it('stops counting a field as filled once the organizer chooses it', () => {
      const division = new LeagueDivision();
      division.fillFromName(NAME, 'beachVolleyball');
      division.chooseLevel('a');
      expect(division.filledFromName()).toEqual(['gender', 'format']);
    });

    it('does nothing before a sport is chosen', () => {
      const division = new LeagueDivision();
      division.fillFromName(NAME, null);
      expect(division.gender()).toBe('coed');
      expect(division.playersPerSide()).toBeNull();
      expect(division.filledFromName()).toEqual([]);
    });
  });

  describe('changing the sport', () => {
    function chosenSixAndBb() {
      const division = new LeagueDivision();
      division.chooseGender('mens');
      division.chooseFormat(6);
      division.chooseLevel('bb');
      division.setAgeGroup('over40');
      return division;
    }

    it('keeps a format the new sport has and resets a level it does not to Rec', () => {
      const division = chosenSixAndBb();
      division.sportChanged('soccer');
      expect(division.playersPerSide()).toBe(6);
      expect(division.level()).toBe('rec');
    });

    it('clears a format the new sport does not have', () => {
      const division = chosenSixAndBb();
      division.sportChanged('softball');
      expect(division.playersPerSide()).toBeNull();
      expect(division.level()).toBe('rec');
    });

    it('keeps gender and age group, and a level both sports have', () => {
      const division = chosenSixAndBb();
      division.chooseLevel('competitive');
      division.sportChanged('softball');
      expect([division.gender(), division.ageGroup(), division.level()]).toEqual([
        'mens',
        'over40',
        'competitive',
      ]);
    });

    it('lets the name fill a format that was cleared by the change', () => {
      const division = new LeagueDivision();
      division.fillFromName('Coed 6s', 'soccer');
      expect(division.playersPerSide()).toBe(6);
      division.sportChanged('softball');
      expect(division.playersPerSide()).toBeNull();
      division.fillFromName('Coed 10s', 'softball');
      expect(division.playersPerSide()).toBe(10);
    });
  });

  it('clear() goes back to the defaults', () => {
    const division = new LeagueDivision();
    division.fillFromName(NAME, 'beachVolleyball');
    division.setAgeGroup('u12');
    division.setMinimumText('5');
    division.clear();
    expect([
      division.gender(),
      division.playersPerSide(),
      division.level(),
      division.ageGroup(),
      division.minimumText(),
      division.filledFromName(),
    ]).toEqual(['coed', null, 'rec', 'adult', '', []]);
    division.fillFromName(NAME, 'beachVolleyball');
    expect(division.gender()).toBe('womens');
  });

  describe('the minimum roster size', () => {
    it('is undefined when blank and the number when typed', () => {
      const division = new LeagueDivision();
      expect(division.minimumRosterSize()).toBeUndefined();
      division.setMinimumText('  ');
      expect(division.minimumRosterSize()).toBeUndefined();
      division.setMinimumText('6');
      expect(division.minimumRosterSize()).toBe(6);
      division.setMinimumText('abc');
      expect(division.minimumRosterSize()).toBeNaN();
    });
  });
});

describe('LeagueDivision: a custom level', () => {
  it('chooses the custom level and the standard level it filters as', () => {
    const division = new LeagueDivision();
    division.chooseCustomLevel(GOLD);
    expect([division.customLevelId(), division.level()]).toEqual([GOLD.customLevelId, 'a']);
  });

  it('is left when a standard level is chosen', () => {
    const division = new LeagueDivision();
    division.chooseCustomLevel(GOLD);
    division.chooseLevel('bb');
    expect([division.customLevelId(), division.level()]).toEqual([null, 'bb']);
  });

  it('is not overwritten by a level the name states', () => {
    const division = new LeagueDivision();
    division.chooseCustomLevel(GOLD);
    division.fillFromName('Tuesday BB', 'beachVolleyball');
    expect([division.customLevelId(), division.level()]).toEqual([GOLD.customLevelId, 'a']);
  });

  it('is cleared with Level reset to Rec when the sport changes, even to a sport with its standard level', () => {
    const division = new LeagueDivision();
    division.chooseCustomLevel({ customLevelId: GOLD.customLevelId, standardLevel: 'rec' });
    division.sportChanged('soccer');
    expect([division.customLevelId(), division.level()]).toEqual([null, 'rec']);
    division.fillFromName('Tuesday Competitive', 'soccer');
    expect(division.level()).toBe('competitive');
  });

  it('undo restores the level chosen before, and forgets the custom level', () => {
    const division = new LeagueDivision();
    division.chooseLevel('bb');
    division.chooseCustomLevel(GOLD);
    division.undoCustomLevel(GOLD.customLevelId);
    expect([division.customLevelId(), division.level()]).toEqual([null, 'bb']);
  });

  it('undo restores a level the name filled, so the name can still change it', () => {
    const division = new LeagueDivision();
    division.fillFromName('Tuesday BB', 'beachVolleyball');
    division.chooseCustomLevel(GOLD);
    division.undoCustomLevel(GOLD.customLevelId);
    expect([division.level(), division.filledFromName()]).toEqual(['bb', ['level']]);
    division.fillFromName('Tuesday AA', 'beachVolleyball');
    expect(division.level()).toBe('aa');
  });

  it('undo restores an earlier custom level', () => {
    const division = new LeagueDivision();
    const silver = { customLevelId: 'silver' as Id<'customLevels'>, standardLevel: 'b' as const };
    division.chooseCustomLevel(silver);
    division.chooseCustomLevel(GOLD);
    division.undoCustomLevel(GOLD.customLevelId);
    expect([division.customLevelId(), division.level()]).toEqual([silver.customLevelId, 'b']);
  });

  it('undo leaves the choice alone when another level was chosen since', () => {
    const division = new LeagueDivision();
    division.chooseCustomLevel(GOLD);
    division.chooseLevel('aa');
    division.undoCustomLevel(GOLD.customLevelId);
    expect([division.customLevelId(), division.level()]).toEqual([null, 'aa']);
  });

  describe('loading a saved division', () => {
    const SAVED = {
      gender: 'mens' as const,
      playersPerSide: 4,
      level: 'a' as const,
      customLevelId: GOLD.customLevelId,
      ageGroup: 'over40' as const,
      minimumRosterSize: 6,
    };

    it('sets every choice, and shows a minimum of 6 as text', () => {
      const division = new LeagueDivision();
      division.load(SAVED);
      expect([
        division.gender(),
        division.playersPerSide(),
        division.level(),
        division.customLevelId(),
        division.ageGroup(),
        division.minimumText(),
        division.filledFromName(),
      ]).toEqual(['mens', 4, 'a', GOLD.customLevelId, 'over40', '6', []]);
    });

    it('leaves the minimum blank when the saved division has none', () => {
      const division = new LeagueDivision();
      division.load({ ...SAVED, minimumRosterSize: undefined, customLevelId: undefined });
      expect([division.minimumText(), division.customLevelId()]).toEqual(['', null]);
    });

    it('replaces what was loaded or typed before', () => {
      const division = new LeagueDivision();
      division.chooseGender('womens');
      division.setMinimumText('9');
      division.load(SAVED);
      expect([division.gender(), division.minimumText()]).toEqual(['mens', '6']);
    });

    it('fills a choice from the name when the name states a different value', () => {
      const division = new LeagueDivision();
      division.load({ ...SAVED, customLevelId: undefined });
      division.fillFromName("Women's 6s BB", 'beachVolleyball');
      expect([division.gender(), division.playersPerSide(), division.level()]).toEqual([
        'womens',
        6,
        'bb',
      ]);
      expect(division.filledFromName()).toEqual(['gender', 'format', 'level']);
    });

    it('keeps a saved custom level, which the name does not override', () => {
      const division = new LeagueDivision();
      division.load(SAVED);
      division.fillFromName("Women's 6s BB", 'beachVolleyball');
      expect([division.level(), division.customLevelId()]).toEqual(['a', GOLD.customLevelId]);
      expect(division.filledFromName()).toEqual(['gender', 'format']);
    });

    it('says nothing about a choice the name states as it already is', () => {
      const division = new LeagueDivision();
      division.load({ ...SAVED, customLevelId: undefined, level: 'bb', gender: 'womens' });
      division.fillFromName("Women's 4s BB", 'beachVolleyball');
      expect(division.filledFromName()).toEqual([]);
    });
  });

  it('clear() leaves no custom level', () => {
    const division = new LeagueDivision();
    division.chooseCustomLevel(GOLD);
    division.clear();
    expect([division.customLevelId(), division.level()]).toEqual([null, 'rec']);
  });
});

describe('filledFromNameMessage', () => {
  it('names what was filled, as the mockup words it for all three', () => {
    expect(filledFromNameMessage(['gender', 'format', 'level'])).toBe(
      'Gender, format, and level were filled in from the name. Change any that are wrong.',
    );
  });

  it('names only the choices that were filled', () => {
    expect(filledFromNameMessage(['format', 'level'])).toBe(
      'Format and level were filled in from the name. Change any that are wrong.',
    );
    expect(filledFromNameMessage(['level'])).toBe(
      'Level was filled in from the name. Change any that are wrong.',
    );
  });

  it('is null when nothing was filled', () => {
    expect(filledFromNameMessage([])).toBeNull();
  });
});
