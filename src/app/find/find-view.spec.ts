import { convertToParamMap } from '@angular/router';
import { parseFindView } from './find-view';

const view = (query: string) => {
  const params: Record<string, string[]> = {};
  for (const [name, value] of new URLSearchParams(query)) (params[name] ??= []).push(value);
  return parseFindView(convertToParamMap(params));
};

describe('parseFindView', () => {
  it('reads the sport from its segment and the filters from their URL spelling', () => {
    expect(view('sport=soccer&gender=girls&age=u10')).toEqual({
      type: undefined,
      sport: 'soccer',
      filters: { gender: ['womens'], playersPerSide: [], level: [], ageGroup: ['u10'] },
    });
    expect(view('sport=beach-volleyball').sport).toBe('beachVolleyball');
  });

  it('reads no sport from an unknown segment, a camel-case key, or no parameter', () => {
    expect(view('sport=cricket').sport).toBeUndefined();
    expect(view('sport=beachVolleyball').sport).toBeUndefined();
    expect(view('').sport).toBeUndefined();
  });

  it('uses the first value of a repeated sport', () => {
    expect(view('sport=soccer&sport=softball').sport).toBe('soccer');
    expect(view('sport=cricket&sport=soccer').sport).toBeUndefined();
  });

  it('drops a level that is not one of the sport, and a format that is not', () => {
    expect(view('sport=softball&level=bb&level=rec&format=4v4&format=10v10').filters).toEqual({
      gender: [],
      playersPerSide: [10],
      level: ['rec'],
      ageGroup: [],
    });
  });

  it('drops format and level when no sport is chosen, and keeps gender and age', () => {
    expect(view('format=4v4&level=bb&gender=coed&age=over40').filters).toEqual({
      gender: ['coed'],
      playersPerSide: [],
      level: [],
      ageGroup: ['over40'],
    });
  });
});

describe('parseFindView, the type', () => {
  it('reads each known program type', () => {
    for (const type of ['league', 'tournament', 'camp', 'training']) {
      expect(view(`type=${type}`).type).toBe(type);
    }
  });

  it('ignores an unknown type, a different case, or an inherited property name', () => {
    expect(view('type=zzz').type).toBeUndefined();
    expect(view('type=League').type).toBeUndefined();
    expect(view('type=constructor').type).toBeUndefined();
    expect(view('type=').type).toBeUndefined();
  });

  it('uses the first value of a repeated type', () => {
    expect(view('type=camp&type=league').type).toBe('camp');
    expect(view('type=zzz&type=league').type).toBeUndefined();
  });
});
