import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NO_DIVISION_FILTERS, type DivisionFilters } from '../../../convex/lib/leagueFilters';
import type { ProgramType } from '../../../convex/lib/programs';
import type { Sport } from '../../../convex/lib/sports';
import { FindTypeChips } from './find-type-chips';

function render(inputs: {
  query: string;
  type?: ProgramType;
  sport?: Sport;
  filters?: DivisionFilters;
  offered?: readonly ProgramType[];
}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(FindTypeChips);
  fixture.componentRef.setInput('query', inputs.query);
  fixture.componentRef.setInput('type', inputs.type);
  fixture.componentRef.setInput('sport', inputs.sport);
  fixture.componentRef.setInput('filters', inputs.filters ?? NO_DIVISION_FILTERS);
  fixture.componentRef.setInput('offered', inputs.offered);
  fixture.detectChanges();
  const nav = (fixture.nativeElement as HTMLElement).querySelector('nav');
  return {
    label: nav?.getAttribute('aria-label'),
    chips: [...(nav?.querySelectorAll('a') ?? [])].map((link) => ({
      name: link.textContent?.trim(),
      href: link.getAttribute('href'),
      current: link.getAttribute('aria-current'),
    })),
  };
}

describe('FindTypeChips', () => {
  it('is a navigation named Program type with All, then each type with a match, as links', () => {
    const { label, chips } = render({ query: '', offered: ['league', 'tournament'] });
    expect(label).toBe('Program type');
    expect(chips.map((chip) => [chip.name, chip.href])).toEqual([
      ['All', '/programs'],
      ['Leagues', '/programs?type=league'],
      ['Tournaments', '/programs?type=tournament'],
    ]);
  });

  it('marks All current with no type, and the chosen type otherwise', () => {
    const offered = ['league', 'tournament'] as const;
    expect(render({ query: '', offered }).chips.map((chip) => chip.current)).toEqual([
      'page',
      null,
      null,
    ]);
    expect(
      render({ query: '', type: 'tournament', offered }).chips.map((chip) => chip.current),
    ).toEqual([null, null, 'page']);
  });

  it('leaves out a type with no match, and keeps the current type even with none', () => {
    expect(render({ query: 'x', offered: ['league'] }).chips.map((chip) => chip.name)).toEqual([
      'All',
      'Leagues',
    ]);
    const camps = render({ query: 'x', type: 'camp', offered: ['league'] });
    expect(camps.chips.map((chip) => [chip.name, chip.current])).toEqual([
      ['All', null],
      ['Leagues', null],
      ['Camps', 'page'],
    ]);
  });

  it('shows only All and the current type until the page knows the types', () => {
    expect(render({ query: 'x' }).chips.map((chip) => chip.name)).toEqual(['All']);
    expect(render({ query: 'x', type: 'tournament' }).chips.map((chip) => chip.name)).toEqual([
      'All',
      'Tournaments',
    ]);
  });

  it('keeps the search, the sport, and the filters in every link', () => {
    const filters = { ...NO_DIVISION_FILTERS, gender: ['womens'], ageGroup: ['u10'] } as const;
    const { chips } = render({
      query: 'coed',
      type: 'league',
      sport: 'soccer',
      filters,
      offered: ['league', 'tournament'],
    });
    expect(chips.map((chip) => chip.href)).toEqual([
      '/programs?q=coed&sport=soccer&gender=girls&age=u10',
      '/programs?type=league&q=coed&sport=soccer&gender=girls&age=u10',
      '/programs?type=tournament&q=coed&sport=soccer&gender=girls&age=u10',
    ]);
  });

  it('drops the filters from All when it opens the organizations list, which none applies to', () => {
    const filters = { ...NO_DIVISION_FILTERS, gender: ['coed'] } as const;
    const { chips } = render({ query: '', type: 'league', filters, offered: ['league'] });
    expect(chips[0].href).toBe('/programs');
    expect(chips[1].href).toBe('/programs?type=league&gender=coed');
  });

  it('shows a Camps chip only when camps match, and no chip carries a count', () => {
    const withCamps = render({ query: 'x', offered: ['league', 'camp'] });
    expect(withCamps.chips.map((chip) => [chip.name, chip.href])).toEqual([
      ['All', '/programs?q=x'],
      ['Leagues', '/programs?type=league&q=x'],
      ['Camps', '/programs?type=camp&q=x'],
    ]);
    expect(withCamps.chips.every((chip) => !/\d/.test(chip.name ?? ''))).toBe(true);
    expect(
      render({ query: 'x', offered: ['league', 'tournament'] }).chips.map((chip) => chip.name),
    ).not.toContain('Camps');
  });

  it('keeps the filters in the Camps link, which they do not narrow', () => {
    const filters = { ...NO_DIVISION_FILTERS, gender: ['coed'] } as const;
    const { chips } = render({ query: 'x', filters, offered: ['camp'] });
    expect(chips[1].href).toBe('/programs?type=camp&q=x&gender=coed');
  });

  it('holds a hidden list of every type a search offers, which is no link and no landmark content', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(FindTypeChips);
    fixture.componentRef.setInput('query', 'x');
    fixture.componentRef.setInput('offered', ['league']);
    fixture.detectChanges();
    const nav = (fixture.nativeElement as HTMLElement).querySelector('nav')!;
    const sizer = nav.querySelector('[data-chip-sizer]')!;
    expect(sizer.getAttribute('aria-hidden')).toBe('true');
    expect(sizer.classList.contains('invisible')).toBe(true);
    expect([...sizer.querySelectorAll('li')].map((item) => item.textContent?.trim())).toEqual([
      'All',
      'Leagues',
      'Tournaments',
      'Camps',
    ]);
    expect(sizer.querySelector('a, button, input')).toBeNull();
    expect(nav.querySelectorAll('a')).toHaveLength(2);
  });
});
