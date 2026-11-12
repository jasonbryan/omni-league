import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NO_DIVISION_FILTERS, type DivisionFilters } from '../../../convex/lib/leagueFilters';
import {
  OpenSeasonsSeen,
  UNSEEN_OPEN_SEASON_COUNT,
  type OpenSeasonsView,
} from './open-seasons-seen';

const SLUG = 'gulf-coast-sport-social';

const view = (
  sport?: string,
  filters: DivisionFilters = NO_DIVISION_FILTERS,
  slug = SLUG,
): OpenSeasonsView => ({ slug, sport, filters });

const COED: DivisionFilters = { ...NO_DIVISION_FILTERS, gender: ['coed'] };
const MENS: DivisionFilters = { ...NO_DIVISION_FILTERS, gender: ['mens'] };

const ALL_SPORTS_OPEN = ['Soccer', 'Soccer', 'Soccer', 'Beach volleyball'];

function store(platform: 'browser' | 'server' = 'browser'): OpenSeasonsSeen {
  TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
  return TestBed.inject(OpenSeasonsSeen);
}

describe('OpenSeasonsSeen', () => {
  describe('with nothing seen', () => {
    it('expects two cards', () => {
      expect(store().expectedCount(view())).toBe(UNSEEN_OPEN_SEASON_COUNT);
      expect(UNSEEN_OPEN_SEASON_COUNT).toBe(2);
    });

    it('expects two cards for a sport view and a filtered view', () => {
      const seen = store();
      expect(seen.expectedCount(view('Soccer'))).toBe(2);
      expect(seen.expectedCount(view(undefined, COED))).toBe(2);
    });
  });

  describe('rule 1: a view seen before gives its own count', () => {
    it('gives the count of the seasons shown for that view', () => {
      const seen = store();
      seen.record(view('Soccer'), ['Soccer', 'Soccer']);
      seen.record(view('Softball'), []);
      expect(seen.expectedCount(view('Soccer'))).toBe(2);
      expect(seen.expectedCount(view('Softball'))).toBe(0);
    });

    it('keeps the last answer for the view', () => {
      const seen = store();
      seen.record(view('Soccer'), ['Soccer', 'Soccer']);
      seen.record(view('Soccer'), ['Soccer']);
      expect(seen.expectedCount(view('Soccer'))).toBe(1);
    });

    it('keeps the filters of a view apart from the same sport unfiltered', () => {
      const seen = store();
      seen.record(view('Soccer'), ['Soccer', 'Soccer', 'Soccer']);
      seen.record(view('Soccer', COED), ['Soccer']);
      seen.record(view('Soccer', MENS), []);
      expect(seen.expectedCount(view('Soccer'))).toBe(3);
      expect(seen.expectedCount(view('Soccer', COED))).toBe(1);
      expect(seen.expectedCount(view('Soccer', MENS))).toBe(0);
    });

    it('names one view from every spelling of the same filters', () => {
      const seen = store();
      seen.record(view('Soccer', { ...NO_DIVISION_FILTERS, gender: ['coed'], level: ['rec'] }), [
        'Soccer',
      ]);
      expect(
        seen.expectedCount(
          view('Soccer', { ...NO_DIVISION_FILTERS, level: ['rec'], gender: ['coed'] }),
        ),
      ).toBe(1);
    });
  });

  describe('rule 2: All sports was seen and the new view is one sport without filters', () => {
    it('gives the count of the All sports seasons in that sport', () => {
      const seen = store();
      seen.record(view(), ALL_SPORTS_OPEN);
      expect(seen.expectedCount(view('Soccer'))).toBe(3);
      expect(seen.expectedCount(view('Beach volleyball'))).toBe(1);
    });

    it('gives 0 for a sport with no open season in All sports', () => {
      const seen = store();
      seen.record(view(), ALL_SPORTS_OPEN);
      expect(seen.expectedCount(view('Softball'))).toBe(0);
    });

    it('does not apply to a sport view with filters', () => {
      const seen = store();
      seen.record(view(), ALL_SPORTS_OPEN);
      expect(seen.expectedCount(view('Soccer', COED))).toBe(ALL_SPORTS_OPEN.length);
    });

    it('does not apply when All sports was seen with filters', () => {
      const seen = store();
      seen.record(view(undefined, COED), ['Soccer', 'Soccer']);
      seen.record(view('Beach volleyball'), ['Beach volleyball']);
      expect(seen.expectedCount(view('Soccer'))).toBe(1);
    });

    it("gives way to the view's own count", () => {
      const seen = store();
      seen.record(view(), ALL_SPORTS_OPEN);
      seen.record(view('Soccer'), ['Soccer']);
      expect(seen.expectedCount(view('Soccer'))).toBe(1);
    });
  });

  describe('rule 3: any other view seen gives the latest count', () => {
    it('gives the count of the latest view for a filter change', () => {
      const seen = store();
      seen.record(view('Soccer'), ['Soccer', 'Soccer', 'Soccer']);
      expect(seen.expectedCount(view('Soccer', COED))).toBe(3);
    });

    it('gives the count of the latest view for one sport to another when All sports was not seen', () => {
      const seen = store();
      seen.record(view('Soccer'), ['Soccer', 'Soccer', 'Soccer']);
      expect(seen.expectedCount(view('Softball'))).toBe(3);
      seen.record(view('Softball'), []);
      expect(seen.expectedCount(view('Beach volleyball'))).toBe(0);
    });

    it('gives the count of the latest view for All sports after a sport view with filters', () => {
      const seen = store();
      seen.record(view('Soccer', COED), ['Soccer']);
      expect(seen.expectedCount(view())).toBe(1);
    });
  });

  describe('navigation paths', () => {
    it('All sports, then Softball, then Soccer: Soccer reads the All sports count, not the Softball zero', () => {
      const seen = store();
      seen.record(view(), ALL_SPORTS_OPEN);
      expect(seen.expectedCount(view('Softball'))).toBe(0);
      seen.record(view('Softball'), []);
      expect(seen.expectedCount(view('Soccer'))).toBe(3);
    });

    it('All sports, then Soccer, then back to All sports: All sports reads its own count', () => {
      const seen = store();
      seen.record(view(), ALL_SPORTS_OPEN);
      seen.record(view('Soccer'), ['Soccer', 'Soccer', 'Soccer']);
      expect(seen.expectedCount(view())).toBe(ALL_SPORTS_OPEN.length);
    });
  });

  it('keeps organizations apart', () => {
    const seen = store();
    seen.record(view(), ALL_SPORTS_OPEN);
    seen.record(view('Soccer'), ['Soccer', 'Soccer', 'Soccer']);
    const other = 'port-aransas-beach-club';
    expect(seen.expectedCount(view(undefined, NO_DIVISION_FILTERS, other))).toBe(2);
    expect(seen.expectedCount(view('Soccer', NO_DIVISION_FILTERS, other))).toBe(2);
    seen.record(view('Softball', NO_DIVISION_FILTERS, other), []);
    expect(seen.expectedCount(view('Soccer', NO_DIVISION_FILTERS, other))).toBe(0);
    expect(seen.expectedCount(view('Soccer'))).toBe(3);
  });

  it('writes nothing in a server render', () => {
    const seen = store('server');
    seen.record(view(), ALL_SPORTS_OPEN);
    seen.record(view('Soccer'), ['Soccer']);
    expect(seen.expectedCount(view())).toBe(2);
    expect(seen.expectedCount(view('Soccer'))).toBe(2);
    expect(seen.expectedCount(view('Softball'))).toBe(2);
  });

  it('is not kept in storage', () => {
    localStorage.clear();
    store().record(view('Soccer'), ['Soccer']);
    expect(localStorage.length).toBe(0);
  });

  describe('the kind of card last seen', () => {
    it('expects a season with nothing seen, and the kind recorded for a view', () => {
      const seen = store();
      expect(seen.expectedKind(view())).toBe('season');
      seen.record(view('Soccer'), ['Soccer'], 'tournament');
      expect(seen.expectedKind(view('Soccer'))).toBe('tournament');
      expect(seen.expectedKind(view('Softball'))).toBe('tournament');
    });

    it('keeps the kind of another organization apart, and records a season by default', () => {
      const seen = store();
      seen.record(view(undefined, NO_DIVISION_FILTERS, 'other-org'), ['Soccer'], 'tournament');
      expect(seen.expectedKind(view())).toBe('season');
      seen.record(view(), ['Soccer']);
      expect(seen.expectedKind(view())).toBe('season');
    });

    it('records nothing on the server', () => {
      const seen = store('server');
      seen.record(view(), ['Soccer'], 'tournament');
      expect(seen.expectedKind(view())).toBe('season');
    });
  });
});
