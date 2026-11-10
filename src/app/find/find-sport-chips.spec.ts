import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NO_DIVISION_FILTERS, type DivisionFilters } from '../../../convex/lib/leagueFilters';
import type { Sport } from '../../../convex/lib/sports';
import { FindSportChips } from './find-sport-chips';

function render(inputs: { query: string; sport?: Sport; filters?: DivisionFilters }) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(FindSportChips);
  fixture.componentRef.setInput('query', inputs.query);
  fixture.componentRef.setInput('sport', inputs.sport);
  fixture.componentRef.setInput('filters', inputs.filters ?? NO_DIVISION_FILTERS);
  fixture.detectChanges();
  const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('nav a')];
  return links.map((link) => ({
    name: link.textContent?.trim(),
    href: link.getAttribute('href'),
    current: link.getAttribute('aria-current'),
  }));
}

describe('FindSportChips', () => {
  it('lists All sports, then each sport, as links', () => {
    expect(render({ query: '' }).map((chip) => [chip.name, chip.href])).toEqual([
      ['All sports', '/leagues'],
      ['Beach volleyball', '/leagues?sport=beach-volleyball'],
      ['Soccer', '/leagues?sport=soccer'],
      ['Softball', '/leagues?sport=softball'],
    ]);
  });

  it('marks All sports current with no sport, and a sport current when it is chosen', () => {
    expect(render({ query: '' }).map((chip) => chip.current)).toEqual(['page', null, null, null]);
    expect(render({ query: '', sport: 'soccer' }).map((chip) => chip.current)).toEqual([
      null,
      null,
      'page',
      null,
    ]);
  });

  it('keeps the search in every link', () => {
    expect(render({ query: 'coed', sport: 'beachVolleyball' }).map((chip) => chip.href)).toEqual([
      '/leagues?q=coed',
      '/leagues?q=coed&sport=beach-volleyball',
      '/leagues?q=coed&sport=soccer',
      '/leagues?q=coed&sport=softball',
    ]);
  });

  it('keeps gender and age in every link, and a format or level only where the sport has it', () => {
    const filters: DivisionFilters = {
      gender: ['womens'],
      playersPerSide: [7],
      level: ['competitive'],
      ageGroup: ['u10'],
    };
    expect(render({ query: '', sport: 'soccer', filters }).map((chip) => chip.href)).toEqual([
      '/leagues',
      '/leagues?sport=beach-volleyball&gender=girls&age=u10',
      '/leagues?sport=soccer&gender=girls&format=7v7&level=competitive&age=u10',
      '/leagues?sport=softball&gender=girls&level=competitive&age=u10',
    ]);
  });

  it('keeps gender and age in All sports for a search, whose results they narrow', () => {
    const filters: DivisionFilters = {
      ...NO_DIVISION_FILTERS,
      gender: ['womens'],
      ageGroup: ['u10'],
    };
    expect(render({ query: 'select', sport: 'soccer', filters })[0].href).toBe(
      '/leagues?q=select&gender=girls&age=u10',
    );
  });
});
