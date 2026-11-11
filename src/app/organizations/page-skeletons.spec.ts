import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OrganizationRowsSkeleton, OrganizationSkeleton } from './organization-skeleton';
import { PublicLeagueSkeleton } from './public-league/public-league-skeleton';
import { PublicSeasonSkeleton } from './public-season/public-season-skeleton';

describe('page skeletons', () => {
  it.each<[string, Type<unknown>]>([
    ['organization', OrganizationSkeleton],
    ['league', PublicLeagueSkeleton],
    ['season', PublicSeasonSkeleton],
  ])(
    'the %s skeleton marks the page as loading, so the layout leaves out its footer',
    (_, skeleton) => {
      const fixture = TestBed.createComponent(skeleton);

      expect((fixture.nativeElement as HTMLElement).hasAttribute('data-page-loading')).toBe(true);
    },
  );

  it('a skeleton for a list inside a loaded page does not mark the page as loading', () => {
    const fixture = TestBed.createComponent(OrganizationRowsSkeleton);
    fixture.componentRef.setInput('kind', 'league');

    expect((fixture.nativeElement as HTMLElement).hasAttribute('data-page-loading')).toBe(false);
  });

  describe('breadcrumb rows', () => {
    const ROWS = '[data-testid="skeleton-breadcrumb-row"]';
    const rowsOf = (skeleton: Type<unknown>) => {
      const fixture = TestBed.createComponent(skeleton);
      return [...(fixture.nativeElement as HTMLElement).querySelectorAll(ROWS)];
    };

    it.each<[string, Type<unknown>, number]>([
      ['league', PublicLeagueSkeleton, 1],
      ['season', PublicSeasonSkeleton, 2],
    ])(
      'the %s skeleton sets each row by the pointer and not by the width, as the breadcrumb link does',
      (_, skeleton, count) => {
        const rows = rowsOf(skeleton);

        expect(rows).toHaveLength(count);
        for (const row of rows) {
          expect(row.classList).toContain('h-5');
          expect(row.classList).toContain('pointer-coarse:h-11');
          expect([...row.classList].filter((name) => name.startsWith('md:h-'))).toEqual([]);
        }
      },
    );

    it('the second season row is the one that goes away from 640px, where the breadcrumb fits on one line', () => {
      const [first, second] = rowsOf(PublicSeasonSkeleton);

      expect(first?.classList).not.toContain('sm:hidden');
      expect(second?.classList).toContain('sm:hidden');
    });
  });
});
