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
});
