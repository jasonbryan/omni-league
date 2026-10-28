import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { hasSportChoice, SportChips } from './sport-chips';
import { GULF_COAST } from './testing/pages';

@Component({
  imports: [SportChips],
  template: `<app-sport-chips
    [slug]="slug"
    [sports]="sports"
    [allSportsLeagueCount]="leagueCount"
    [currentSegment]="current"
  />`,
})
class Host {
  slug = GULF_COAST.slug;
  sports = GULF_COAST.sports;
  leagueCount = GULF_COAST.leagueCount;
  current: string | undefined = undefined;
}

function render(change: Partial<Host> = {}): HTMLElement {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(Host);
  Object.assign(fixture.componentInstance, change);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('SportChips', () => {
  it('links All sports and then one chip per sport, in sport order, each with its league count', () => {
    const links = [...render().querySelectorAll('nav[aria-label="Sports"] a')];
    expect(links.map((a) => [text(a), a.getAttribute('href')])).toEqual([
      ['All sports 5 leagues', '/organizations/gulf-coast-sport-social'],
      [
        'Beach volleyball 2 leagues',
        '/organizations/gulf-coast-sport-social/sports/beach-volleyball',
      ],
      ['Soccer 2 leagues', '/organizations/gulf-coast-sport-social/sports/soccer'],
      ['Softball 1 league', '/organizations/gulf-coast-sport-social/sports/softball'],
    ]);
  });

  it('shows the count visibly and the noun to screen readers only', () => {
    const chip = render().querySelectorAll('nav a')[3];
    const count = chip.querySelector('span');
    expect(count?.firstChild?.textContent).toBe('1');
    expect(text(count?.querySelector('.sr-only'))).toBe('league');
  });

  it('marks All sports current when no sport is, and sets aria-current on no other chip', () => {
    const links = [...render().querySelectorAll('nav a')];
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['page', null, null, null]);
  });

  it('marks only the chip of the current sport', () => {
    const links = [...render({ current: 'soccer' }).querySelectorAll('nav a')];
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, null, 'page', null]);
  });

  it('renders nothing for an organization with one sport', () => {
    const host = render({ sports: [GULF_COAST.sports[0]], leagueCount: 2 });
    expect(host.querySelector('nav')).toBeNull();
  });

  it('renders nothing for an organization with no sport', () => {
    const host = render({ sports: [], leagueCount: 0 });
    expect(host.querySelector('nav')).toBeNull();
  });
});

describe('hasSportChoice', () => {
  it.each([
    [0, false],
    [1, false],
    [2, true],
    [3, true],
  ])('is %i sports: %s', (count, expected) => {
    expect(hasSportChoice(GULF_COAST.sports.concat(GULF_COAST.sports).slice(0, count))).toBe(
      expected,
    );
  });
});
