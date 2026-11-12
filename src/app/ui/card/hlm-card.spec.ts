import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CARD_CLASSES, FLOATING_CARD_CLASSES } from './card-classes';
import type { HlmCardSize } from './hlm-card';
import { HlmCardImports } from './index';

@Component({
  imports: [HlmCardImports],
  template: `
    <div hlmCard size="lg">
      <div hlmCardHeader>
        <h3 hlmCardTitle>Title</h3>
        <p hlmCardDescription>Description</p>
        <div hlmCardAction>Action</div>
      </div>
      <div hlmCardContent>Content</div>
    </div>
    <div hlmCard></div>
  `,
})
class Host {}

@Component({
  imports: [HlmCardImports],
  template: `<div hlmCard [size]="size()" class="mx-auto max-w-lg" [class.is-open]="open()"></div>`,
})
class Configurable {
  readonly size = signal<HlmCardSize>('default');
  readonly open = signal(true);
}

const BARE_SURFACE =
  'group/card rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10';
const LAYOUT_CLASSES = [
  'flex',
  'flex-col',
  'gap-4',
  'overflow-hidden',
  'py-(--card-spacing)',
  'text-sm',
];

const render = (size: HlmCardSize) => {
  const fixture = TestBed.createComponent(Configurable);
  fixture.componentInstance.size.set(size);
  fixture.detectChanges();
  const card = (fixture.nativeElement as HTMLElement).querySelector('div')!;
  return { fixture, card, classes: [...card.classList] };
};

const sorted = (classes: Iterable<string>) => [...classes].sort();

describe('HlmCard', () => {
  it('sets each part’s slot and the card’s size, defaulting to default', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const slots = [...root.querySelectorAll('[data-slot]')].map((e) => e.getAttribute('data-slot'));
    expect(slots).toEqual([
      'card',
      'card-header',
      'card-title',
      'card-description',
      'card-action',
      'card-content',
      'card',
    ]);
    const [large, plain] = root.querySelectorAll('[data-slot="card"]');
    expect(large?.getAttribute('data-size')).toBe('lg');
    expect(plain?.getAttribute('data-size')).toBe('default');
    expect(large?.classList).toContain('rounded-xl');
  });

  it('bare renders exactly the card surface, with no flex, gap, overflow, padding, or text size', () => {
    const { card, classes } = render('bare');
    expect(card.getAttribute('data-size')).toBe('bare');
    expect(
      sorted(
        classes.filter((name) => name !== 'mx-auto' && name !== 'max-w-lg' && name !== 'is-open'),
      ),
    ).toEqual(sorted(BARE_SURFACE.split(' ')));
    expect(sorted(CARD_CLASSES.split(' '))).toEqual(sorted(BARE_SURFACE.split(' ')));
  });

  it.each<HlmCardSize>(['default', 'lg'])('%s renders the helm card layout and surface', (size) => {
    const { classes } = render(size);
    expect(classes).toEqual(
      expect.arrayContaining([...LAYOUT_CLASSES, ...BARE_SURFACE.split(' ')]),
    );
    expect(classes).toContain('[--card-spacing:--spacing(5)]');
    expect(classes).toContain('data-[size=lg]:[--card-spacing:--spacing(6)]');
  });

  it('keeps the caller’s static class and its class binding beside the host class', () => {
    const { fixture, classes } = render('bare');
    expect(classes).toEqual(expect.arrayContaining(['mx-auto', 'max-w-lg', 'is-open', 'bg-card']));
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    const card = (fixture.nativeElement as HTMLElement).querySelector('div')!;
    expect(card.classList).not.toContain('is-open');
    expect(card.classList).toContain('mx-auto');
    expect(card.classList).toContain('group/card');
  });

  it('follows a change of size', () => {
    const { fixture, card } = render('bare');
    fixture.componentInstance.size.set('lg');
    fixture.detectChanges();
    expect(card.getAttribute('data-size')).toBe('lg');
    expect(card.classList).toContain('gap-4');
    expect(card.classList).toContain('mx-auto');
  });
});

describe('card classes', () => {
  it('floats the card on shadow-lg where the card sits at rest on shadow-xs', () => {
    expect(sorted(FLOATING_CARD_CLASSES.split(' '))).toEqual(
      sorted(BARE_SURFACE.replace('shadow-xs', 'shadow-lg').split(' ')),
    );
  });
});
