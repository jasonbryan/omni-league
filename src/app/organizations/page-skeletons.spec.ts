import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FindSkeleton } from '../find/find-skeleton';
import { expectBareCard } from '../ui/testing/card';
import { radiusClasses } from '../ui/testing/radius-classes';
import {
  OpenSeasonsSkeleton,
  OrganizationRowsSkeleton,
  OrganizationSkeleton,
} from './organization-skeleton';
import { PublicLeagueSkeleton } from './public-league/public-league-skeleton';
import type { PublicPageNames } from './public-league/public-page-names';
import { REGISTRATION_CARD_CLASS } from './public-league/public-season-header-classes';
import { registrationCard, registrationLines } from './public-season/public-season-registration';
import { PublicSeasonSkeleton } from './public-season/public-season-skeleton';
import { SUMMER_2027 } from './public-season/testing/season-data';
import { PublicTournamentSkeleton } from './public-tournament/public-tournament-skeleton';

const SEASON_NAMES: PublicPageNames = {
  organization: { slug: 'gulf-coast-sport-social', name: 'Gulf Coast Sport & Social' },
  league: {
    slug: 'sunday-reverse-coed-4s',
    name: 'Sunday Reverse Coed 4s',
    sportName: 'Beach volleyball',
  },
  season: { slug: 'summer-2027', name: 'Summer 2027' },
};

const OPEN_NAMES: PublicPageNames = {
  ...SEASON_NAMES,
  season: {
    slug: 'summer-2027',
    name: 'Summer 2027',
    registration: { deadline: '2027-05-23', startDate: '2027-06-06', isFull: false },
  },
};
const FULL_NAMES: PublicPageNames = {
  ...SEASON_NAMES,
  season: {
    slug: 'summer-2027',
    name: 'Summer 2027',
    registration: { deadline: '2027-05-23', startDate: '2027-06-06', isFull: true },
  },
};
const BEFORE_DEADLINE = Date.parse('2027-05-01T00:00:00Z');
const AFTER_DEADLINE = Date.parse('2027-05-30T00:00:00Z');

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
      ['tournament', PublicTournamentSkeleton, {}, { 'rounded-md': 14, 'rounded-lg': 4 }],
      [
        'season given names',
        PublicSeasonSkeleton,
        { names: SEASON_NAMES },
        { 'rounded-md': 12, 'rounded-full': 2, 'rounded-lg': 4 },
      ],
      [
        'season given an open registration',
        PublicSeasonSkeleton,
        { names: OPEN_NAMES, now: BEFORE_DEADLINE },
        { 'rounded-md': 10, 'rounded-full': 2, 'rounded-lg': 6 },
      ],
      [
        'season given a full registration',
        PublicSeasonSkeleton,
        { names: FULL_NAMES, now: BEFORE_DEADLINE },
        { 'rounded-md': 10, 'rounded-full': 2, 'rounded-lg': 6 },
      ],
      ['find', FindSkeleton, {}, { 'rounded-md': 7, 'rounded-xl': 3, 'rounded-full': 6 }],
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
    ['tournament', PublicTournamentSkeleton],
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

  describe('cards', () => {
    const render = (skeleton: Type<unknown>) => {
      const fixture = TestBed.createComponent(skeleton);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };

    it('the league skeleton draws its registration card as a bare helm card', () => {
      const cards = render(PublicLeagueSkeleton).querySelectorAll('[data-slot="card"]');
      expect(cards).toHaveLength(1);
      expectBareCard(cards[0], 'mt-5 flex flex-col gap-3 p-5 md:p-6');
    });

    it('the season skeleton draws its registration card as a bare helm card, with its test id kept', () => {
      const cards = render(PublicSeasonSkeleton).querySelectorAll('[data-slot="card"]');
      expect(cards).toHaveLength(1);
      expect(cards[0].getAttribute('data-testid')).toBe('season-skeleton-card');
      expectBareCard(cards[0], 'p-5 md:p-6');
    });
  });

  describe('tournament card', () => {
    it('the tournament skeleton draws its registration card as a bare helm card', () => {
      const fixture = TestBed.createComponent(PublicTournamentSkeleton);
      fixture.detectChanges();
      const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('[data-slot="card"]');
      expect(cards).toHaveLength(1);
      expectBareCard(cards[0], 'p-5 md:p-6');
    });
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
      ['tournament', PublicTournamentSkeleton, 1],
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

  describe('the season skeleton given names', () => {
    const skeleton = (names?: PublicPageNames) => {
      const fixture = TestBed.createComponent(PublicSeasonSkeleton);
      fixture.componentRef.setInput('names', names);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };
    const text = (element: Element | null) =>
      (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const HEADING = '[data-testid="season-skeleton-heading"]';

    it('shows the organization, league, and season as breadcrumb text and the league and season as the heading text, all hidden from assistive technology', () => {
      const root = skeleton(SEASON_NAMES);
      const crumbs = root.querySelector('[data-testid="skeleton-breadcrumb"]');
      const heading = root.querySelector(HEADING);

      expect([...(crumbs?.querySelectorAll('li > span') ?? [])].map(text)).toEqual([
        'Gulf Coast Sport & Social',
        'Sunday Reverse Coed 4s',
        'Summer 2027',
      ]);
      expect(crumbs?.getAttribute('aria-hidden')).toBe('true');
      expect(text(heading)).toBe('Sunday Reverse Coed 4s · Summer 2027');
      expect(heading?.getAttribute('aria-hidden')).toBe('true');
    });

    it('has no link and no heading element, so the page keeps one h1 and no extra tab stop, and its status still reads Loading the season.', () => {
      const root = skeleton(SEASON_NAMES);

      expect(root.querySelectorAll('a, button, h1, h2, h3, [role="heading"]')).toHaveLength(0);
      expect(text(root.querySelector('[role="status"]'))).toBe('Loading the season.');
    });

    it('sets the heading text with the loaded h1’s classes, so a wrapped name takes the height it will have', () => {
      const heading = skeleton(SEASON_NAMES).querySelector(HEADING);

      expect(heading?.className).toContain('text-3xl');
      expect(heading?.className).toContain('md:text-5xl');
    });

    it('draws no breadcrumb row and no heading bar', () => {
      const root = skeleton(SEASON_NAMES);

      expect(rowCount(root)).toBe(0);
      expect(root.querySelectorAll(`${HEADING}[data-slot="skeleton"]`)).toHaveLength(0);
    });

    it('keeps the badge placeholders, the registration card, and the details as bars', () => {
      const root = skeleton(SEASON_NAMES);

      expect(root.querySelectorAll('[data-testid="season-skeleton-card"]')).toHaveLength(1);
      expect(root.querySelectorAll('[data-testid="season-skeleton-details"]')).toHaveLength(1);
      expect(root.querySelectorAll('span.h-5\\.5')).toHaveLength(2);
    });

    it('shows the bars and no text without names, as the mockup’s Season loading state draws them', () => {
      const root = skeleton();

      expect(root.querySelector('[data-testid="skeleton-breadcrumb"]')).toBeNull();
      expect(root.querySelector(HEADING)?.className).toContain('h-7');
      expect(rowCount(root)).toBe(2);
      expect(text(root.querySelector(HEADING))).toBe('');
    });
  });
  describe('the season skeleton registration card', () => {
    const skeleton = (names?: PublicPageNames, now?: number) => {
      const fixture = TestBed.createComponent(PublicSeasonSkeleton);
      fixture.componentRef.setInput('names', names);
      fixture.componentRef.setInput('now', now);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };
    const text = (element: Element | null | undefined) =>
      (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const card = (root: HTMLElement) => root.querySelector('[data-testid="season-skeleton-card"]')!;
    const bars = (root: HTMLElement) =>
      [...card(root).querySelectorAll('[data-slot="skeleton"]')].map((bar) => ({
        text: text(bar),
        buttonBar: bar.classList.contains('h-11'),
      }));
    const lines = (kind: 'open' | 'full') => {
      const season = kind === 'full' ? { ...SUMMER_2027, isFull: true } : SUMMER_2027;
      const registration = registrationCard(season, BEFORE_DEADLINE);
      if (registration?.kind !== kind) throw new Error(`expected a ${kind} card`);
      return registrationLines(registration);
    };
    const CLOSED_BARS = [
      { text: '', buttonBar: false },
      { text: '', buttonBar: false },
      { text: '', buttonBar: false },
      { text: '', buttonBar: true },
    ];

    it('draws the open card’s title, two button bars, and note, each text as the card’s own words in a bar', () => {
      const root = skeleton(OPEN_NAMES, BEFORE_DEADLINE);
      const { title, note } = lines('open');

      expect(bars(root)).toEqual([
        { text: title, buttonBar: false },
        { text: '', buttonBar: true },
        { text: '', buttonBar: true },
        { text: note, buttonBar: false },
      ]);
      expect(title).toBe('Registration open · closes May 23, 2027');
    });

    it('draws the full card’s title, note, and two button bars', () => {
      const root = skeleton(FULL_NAMES, BEFORE_DEADLINE);
      const { title, note } = lines('full');

      expect(bars(root)).toEqual([
        { text: title, buttonBar: false },
        { text: note, buttonBar: false },
        { text: '', buttonBar: true },
        { text: '', buttonBar: true },
      ]);
    });

    it.each([
      ['open', OPEN_NAMES],
      ['full', FULL_NAMES],
    ] as const)(
      'sets the %s card’s text in the card’s classes, wrapping as it does, with the text kept out of sight',
      (kind, names) => {
        const root = skeleton(names, BEFORE_DEADLINE);
        const [title, note] = [...card(root).querySelectorAll('p')];

        expect(title.className).toBe('text-lg font-semibold tracking-tight');
        expect(note.className).toContain('text-sm');
        for (const bar of card(root).querySelectorAll('p > [data-slot="skeleton"]')) {
          expect(bar.classList).toContain('box-decoration-clone');
          expect(bar.classList).toContain('rounded-md');
          expect(bar.classList).not.toContain('block');
          expect(bar.children).toHaveLength(1);
          expect(bar.children[0].classList).toContain('invisible');
        }
      },
    );

    it.each([
      ['open', OPEN_NAMES],
      ['full', FULL_NAMES],
    ] as const)(
      'gives the %s card the loaded card’s classes, so it takes the loaded card’s height',
      (kind, names) => {
        expectBareCard(card(skeleton(names, BEFORE_DEADLINE)), REGISTRATION_CARD_CLASS[kind]);
      },
    );

    it('hides the card’s words from assistive technology, so only Loading the season. is read', () => {
      for (const names of [OPEN_NAMES, FULL_NAMES]) {
        const root = skeleton(names, BEFORE_DEADLINE);
        const readable = root.cloneNode(true) as HTMLElement;
        readable.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());

        expect(card(root).getAttribute('aria-hidden')).toBe('true');
        expect(text(readable)).toBe('Loading the season.');
        expect(root.querySelectorAll('a, button, h1, h2, h3, [role="heading"]')).toHaveLength(0);
      }
    });

    it('draws the closed bars when the link’s site said open and the deadline has passed', () => {
      const root = skeleton(OPEN_NAMES, AFTER_DEADLINE);

      expect(bars(root)).toEqual(CLOSED_BARS);
      expectBareCard(card(root), 'p-5 md:p-6');
    });

    it('draws the closed bars when the link’s site said full and the deadline has passed', () => {
      expect(bars(skeleton(FULL_NAMES, AFTER_DEADLINE))).toEqual(CLOSED_BARS);
    });

    it('draws the closed bars for names with no registration, and for no names', () => {
      expect(bars(skeleton(SEASON_NAMES, BEFORE_DEADLINE))).toEqual(CLOSED_BARS);
      expect(bars(skeleton(undefined, BEFORE_DEADLINE))).toEqual(CLOSED_BARS);
    });

    it('draws the closed bars when the page gives no clock', () => {
      expect(bars(skeleton(OPEN_NAMES))).toEqual(CLOSED_BARS);
    });
  });
});
