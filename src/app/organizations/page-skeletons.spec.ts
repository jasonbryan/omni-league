import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FindSkeleton } from '../find/find-skeleton';
import { radiusClasses } from '../ui/testing/radius-classes';
import {
  OpenSeasonsSkeleton,
  OrganizationRowsSkeleton,
  OrganizationSkeleton,
} from './organization-skeleton';
import { PublicLeagueSkeleton } from './public-league/public-league-skeleton';
import type { PublicPageNames } from './public-league/public-page-names';
import { PublicSeasonSkeleton } from './public-season/public-season-skeleton';

const ROWS = '[data-testid="skeleton-breadcrumb-row"]';
const rowCount = (root: Element) => root.querySelectorAll(ROWS).length;

describe('page skeletons', () => {
  describe('skeleton elements', () => {
    type Tally = Record<string, number>;
    const RADIUS_TALLIES: [string, Type<unknown>, Record<string, unknown>, Tally][] = [
      [
        'organization',
        OrganizationSkeleton,
        {},
        { 'rounded-lg md:rounded-xl': 1, 'rounded-md': 36, 'rounded-full': 6 },
      ],
      ['league rows', OrganizationRowsSkeleton, { kind: 'league' }, { 'rounded-md': 9 }],
      ['location rows', OrganizationRowsSkeleton, { kind: 'location' }, { 'rounded-md': 6 }],
      ['open seasons', OpenSeasonsSkeleton, { count: 3 }, { 'rounded-md': 22, 'rounded-full': 3 }],
      [
        'no open seasons',
        OpenSeasonsSkeleton,
        { count: 0, noOpenText: 'None open' },
        { 'rounded-md': 1 },
      ],
      ['league', PublicLeagueSkeleton, {}, { 'rounded-md': 14, 'rounded-full': 2 }],
      [
        'season',
        PublicSeasonSkeleton,
        {},
        { 'rounded-md': 16, 'rounded-full': 2, 'rounded-lg': 4 },
      ],
      ['find', FindSkeleton, {}, { 'rounded-md': 7, 'rounded-xl': 3, 'rounded-full': 3 }],
    ];

    const render = (skeleton: Type<unknown>, inputs: Record<string, unknown>) => {
      const fixture = TestBed.createComponent(skeleton);
      for (const [name, value] of Object.entries(inputs)) {
        fixture.componentRef.setInput(name, value);
      }
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };

    it.each(RADIUS_TALLIES)(
      'the %s skeleton draws every filled box through the skeleton, each with its own radius',
      (_, skeleton, inputs, tally) => {
        const root = render(skeleton, inputs);
        const boxes = [...root.querySelectorAll('.bg-muted')];
        const counted: Tally = {};
        for (const box of boxes) {
          expect(box.getAttribute('data-slot')).toBe('skeleton');
          const radius = radiusClasses(box).join(' ') || 'none';
          counted[radius] = (counted[radius] ?? 0) + 1;
        }

        expect(counted).toEqual(tally);
        expect(root.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(boxes.length);
      },
    );

    it.each(RADIUS_TALLIES)(
      'the %s skeleton pulses only where motion is allowed',
      (_, skeleton, inputs) => {
        for (const box of render(skeleton, inputs).querySelectorAll('[data-slot="skeleton"]')) {
          const animations = [...box.classList].filter((name) => name.includes('animate-'));

          expect(animations).toEqual(['motion-safe:animate-pulse']);
        }
      },
    );
  });

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
    const rowsOf = (skeleton: Type<unknown>) => {
      const fixture = TestBed.createComponent(skeleton);
      fixture.detectChanges();
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

  describe('the league skeleton given names', () => {
    const NAMES: PublicPageNames = {
      organization: { slug: 'gulf-coast-sport-social', name: 'Gulf Coast Sport & Social' },
      league: {
        slug: 'sunday-reverse-coed-4s',
        name: 'Sunday Reverse Coed 4s',
        sportName: 'Beach volleyball',
      },
    };
    const skeleton = (names?: PublicPageNames) => {
      const fixture = TestBed.createComponent(PublicLeagueSkeleton);
      fixture.componentRef.setInput('names', names);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };
    const text = (element: Element | null) =>
      (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

    it('shows the organization and the sport as breadcrumb text, and the league name as the heading text, all hidden from assistive technology', () => {
      const root = skeleton(NAMES);
      const crumbs = root.querySelector('[data-testid="skeleton-breadcrumb"]');
      const heading = root.querySelector('[data-testid="skeleton-heading"]');

      expect([...(crumbs?.querySelectorAll('li > span') ?? [])].map(text)).toEqual([
        'Gulf Coast Sport & Social',
        'Beach volleyball',
      ]);
      expect(crumbs?.getAttribute('aria-hidden')).toBe('true');
      expect(text(heading)).toBe('Sunday Reverse Coed 4s');
      expect(heading?.getAttribute('aria-hidden')).toBe('true');
    });

    it('has no link and no heading element, so the page keeps one h1 and no extra tab stop', () => {
      const root = skeleton(NAMES);

      expect(root.querySelectorAll('a, button, h1, h2, h3, [role="heading"]')).toHaveLength(0);
      expect(text(root.querySelector('[role="status"]'))).toBe('Loading the league.');
    });

    it('sets the heading text with the loaded h1’s classes, so a wrapped name takes the height it will have', () => {
      const heading = skeleton(NAMES).querySelector('[data-testid="skeleton-heading"]');

      expect(heading?.className).toContain('text-3xl');
      expect(heading?.className).toContain('md:text-5xl');
    });

    it('shows the bars and no text without names', () => {
      const root = skeleton();

      expect(root.querySelector('[data-testid="skeleton-breadcrumb"]')).toBeNull();
      expect(root.querySelector('[data-testid="skeleton-heading"]')?.className).toContain('h-9');
      expect(rowCount(root)).toBe(1);
      expect(text(root.querySelector('[data-testid="skeleton-heading"]'))).toBe('');
    });
  });
});
