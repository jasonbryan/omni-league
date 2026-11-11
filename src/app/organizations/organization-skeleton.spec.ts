import { TestBed } from '@angular/core/testing';
import { OpenSeasonsSkeleton } from './organization-skeleton';
import { OPEN_SEASONS_INTRO } from './season-status';

function render(): HTMLElement {
  const fixture = TestBed.createComponent(OpenSeasonsSkeleton);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const classes = (element: Element | null | undefined) => [...(element?.classList ?? [])];

const cards = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(':scope > div > div')];

describe('OpenSeasonsSkeleton', () => {
  it('shows two cards and hides every bar from assistive technology', () => {
    const host = render();
    expect(cards(host)).toHaveLength(2);
    const spans = [...host.querySelectorAll('span')];
    expect(spans.length).toBeGreaterThan(10);
    for (const span of spans) expect(span.getAttribute('aria-hidden')).toBe('true');
  });

  it('has no md: height class on any element', () => {
    for (const element of render().querySelectorAll('*')) {
      expect(classes(element).filter((name) => /^md:(min-|max-)?h-/.test(name))).toEqual([]);
    }
  });

  describe('each card', () => {
    const card = () => cards(render())[0];

    it('drops gap-3 and keeps the card chrome', () => {
      expect(classes(card())).not.toContain('gap-3');
      expect(classes(card())).toEqual(expect.arrayContaining(['flex', 'flex-col', 'p-5']));
    });

    it('stacks a badge bar, a title row, a season bar and three detail rows as the loaded card does', () => {
      const rows = [...card().children];
      expect(rows).toHaveLength(5);
      const [badge, title, season, details, footer] = rows;
      expect(classes(badge)).toEqual(expect.arrayContaining(['h-5.5', 'rounded-full']));
      expect(classes(title)).toEqual(
        expect.arrayContaining(['mt-3', 'h-7', 'pointer-coarse:h-11']),
      );
      expect(classes(season)).toContain('h-5');
      expect(classes(details)).toEqual(expect.arrayContaining(['mt-4', 'space-y-2']));
      expect(
        [...details.children].map((row) => classes(row).filter((name) => name.startsWith('h-'))),
      ).toEqual([['h-5'], ['h-5'], ['h-5']]);
      expect(classes(footer)).toEqual(expect.arrayContaining(['mt-auto', 'pt-5']));
    });

    it('centres an h-6 bar in the title row', () => {
      const title = card().children[1];
      expect(classes(title)).toEqual(expect.arrayContaining(['flex', 'items-center']));
      expect(classes(title.firstElementChild)).toContain('h-6');
    });

    it('ends in a rule, a closes bar and a Register bar that is 36px, or 44px on touch', () => {
      const rule = card().children[4].firstElementChild!;
      expect(classes(rule)).toEqual(expect.arrayContaining(['border-t', 'pt-4']));
      const [closes, register] = [...rule.children];
      expect(classes(closes)).toContain('h-5');
      expect(classes(register)).toEqual(expect.arrayContaining(['h-9', 'pointer-coarse:h-11']));
    });
  });

  describe('intro', () => {
    const intro = () => render().firstElementChild!;

    it('is a muted text-sm block that fits its text, so it wraps where the loaded line does', () => {
      expect(classes(intro())).toEqual(
        expect.arrayContaining(['mt-1', 'w-fit', 'text-sm', 'bg-muted']),
      );
    });

    it('holds the intro copy invisibly and hidden from assistive technology', () => {
      const copy = intro().querySelector('span')!;
      expect(copy.textContent.trim()).toBe(OPEN_SEASONS_INTRO);
      expect(classes(copy)).toContain('invisible');
      expect(copy.getAttribute('aria-hidden')).toBe('true');
    });
  });
});
