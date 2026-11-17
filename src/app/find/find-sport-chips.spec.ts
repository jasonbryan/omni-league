import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NO_DIVISION_FILTERS, type DivisionFilters } from '../../../convex/lib/leagueFilters';
import type { ProgramType } from '../../../convex/lib/programs';
import type { Sport } from '../../../convex/lib/sports';
import { FindSportChips } from './find-sport-chips';

function render(inputs: {
  query: string;
  type?: ProgramType;
  sport?: Sport;
  filters?: DivisionFilters;
}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(FindSportChips);
  fixture.componentRef.setInput('query', inputs.query);
  fixture.componentRef.setInput('type', inputs.type);
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
      ['All sports', '/programs'],
      ['Beach volleyball', '/programs?sport=beach-volleyball'],
      ['Soccer', '/programs?sport=soccer'],
      ['Softball', '/programs?sport=softball'],
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
      '/programs?q=coed',
      '/programs?q=coed&sport=beach-volleyball',
      '/programs?q=coed&sport=soccer',
      '/programs?q=coed&sport=softball',
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
      '/programs',
      '/programs?sport=beach-volleyball&gender=girls&age=u10',
      '/programs?sport=soccer&gender=girls&format=7v7&level=competitive&age=u10',
      '/programs?sport=softball&gender=girls&level=competitive&age=u10',
    ]);
  });

  it('keeps gender and age in All sports for a search, whose results they narrow', () => {
    const filters: DivisionFilters = {
      ...NO_DIVISION_FILTERS,
      gender: ['womens'],
      ageGroup: ['u10'],
    };
    expect(render({ query: 'select', sport: 'soccer', filters })[0].href).toBe(
      '/programs?q=select&gender=girls&age=u10',
    );
  });

  it('keeps the type in every link, and drops the filters from All sports only when that is the organizations list', () => {
    expect(render({ query: '', type: 'tournament' }).map((chip) => chip.href)).toEqual([
      '/programs?type=tournament',
      '/programs?type=tournament&sport=beach-volleyball',
      '/programs?type=tournament&sport=soccer',
      '/programs?type=tournament&sport=softball',
    ]);
    const coed = { ...NO_DIVISION_FILTERS, gender: ['coed'] } as const;
    expect(render({ query: '', filters: coed }).map((chip) => chip.href)[0]).toBe('/programs');
    expect(render({ query: '', type: 'league', filters: coed }).map((chip) => chip.href)[0]).toBe(
      '/programs?type=league&gender=coed',
    );
  });
});
