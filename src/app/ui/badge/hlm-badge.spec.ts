import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HlmBadge, type HlmBadgeSize, type HlmBadgeVariant } from './hlm-badge';

@Component({
  imports: [HlmBadge],
  template: `<span hlmBadge variant="secondary" class="extra">Captain</span
    ><span hlmBadge>Default</span>`,
})
class Host {}

@Component({
  imports: [HlmBadge],
  template: `<span hlmBadge [variant]="variant" [size]="size">Badge</span>`,
})
class Configurable {
  variant: HlmBadgeVariant = 'default';
  size: HlmBadgeSize = 'default';
}

const render = (variant: HlmBadgeVariant, size: HlmBadgeSize = 'default') => {
  const fixture = TestBed.createComponent(Configurable);
  fixture.componentInstance.variant = variant;
  fixture.componentInstance.size = size;
  fixture.detectChanges();
  const badge = (fixture.nativeElement as HTMLElement).querySelector('span')!;
  return { badge, classes: [...badge.classList] };
};

const FILLED: readonly HlmBadgeVariant[] = [
  'default',
  'secondary',
  'destructive',
  'ghost',
  'link',
  'muted',
];
const OUTLINED: readonly HlmBadgeVariant[] = ['outline', 'outline-destructive', 'outline-muted'];

describe('HlmBadge', () => {
  it('sets the slot, the variant, and the variant’s classes, and keeps the caller’s class', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const [secondary, plain] = [...(fixture.nativeElement as HTMLElement).querySelectorAll('span')];
    expect(secondary?.getAttribute('data-slot')).toBe('badge');
    expect(secondary?.getAttribute('data-variant')).toBe('secondary');
    expect(secondary?.classList).toContain('bg-secondary');
    expect(secondary?.classList).toContain('rounded-4xl');
    expect(secondary?.classList).toContain('extra');
    expect(plain?.getAttribute('data-variant')).toBe('default');
    expect(plain?.classList).toContain('bg-primary');
    expect(plain?.classList).not.toContain('bg-secondary');
  });

  it.each(FILLED)('%s carries border-transparent and no border colour', (variant) => {
    const { classes } = render(variant);
    expect(classes).toContain('border-transparent');
    expect(classes).not.toContain('border-border');
  });

  it.each(OUTLINED)('%s draws border-border and never border-transparent', (variant) => {
    const { classes } = render(variant);
    expect(classes).toContain('border-border');
    expect(classes).not.toContain('border-transparent');
  });

  it('gives the local variants the app’s badge colours', () => {
    expect(render('outline-destructive').classes).toEqual(
      expect.arrayContaining(['border-border', 'text-destructive']),
    );
    expect(render('outline-destructive').classes).not.toContain('text-foreground');
    expect(render('outline-muted').classes).toEqual(
      expect.arrayContaining(['border-border', 'bg-muted', 'text-foreground']),
    );
    expect(render('muted').classes).toEqual(
      expect.arrayContaining(['bg-muted', 'text-muted-foreground']),
    );
    expect(render('muted').classes.some((name) => name.startsWith('[a]:hover:'))).toBe(false);
  });

  it('draws the variants’ hover colours on links only', () => {
    expect(render('secondary').classes).toContain('[a]:hover:bg-secondary/80');
    expect(render('outline').classes).toContain('[a]:hover:bg-muted');
  });

  it.each([...FILLED, ...OUTLINED])('%s is 20px tall by default and has no height at fit', (v) => {
    expect(render(v).classes).toContain('h-5');
    expect(render(v, 'fit').classes.filter((name) => name.startsWith('h-'))).toEqual([]);
  });

  it('keeps the same classes in both sizes apart from the height', () => {
    const sized = render('secondary').classes.filter((name) => name !== 'h-5');
    expect(render('secondary', 'fit').classes.sort()).toEqual(sized.sort());
  });

  it('leaves no empty class names in either size', () => {
    expect(render('outline').badge.getAttribute('class')).not.toMatch(/ {2}|^ | $/);
    expect(render('outline', 'fit').badge.getAttribute('class')).not.toMatch(/ {2}|^ | $/);
  });

  it('indents the start of a badge with a start icon by 6px, as helm does', () => {
    expect(render('secondary').classes).toContain('has-data-[icon=inline-start]:ps-1.5');
  });
});
