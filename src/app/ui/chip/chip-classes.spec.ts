import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  CHIP_CHOICE_INPUT_CLASSES,
  CHIP_CHOICE_LABEL_CLASSES,
  CHIP_CHOICE_WRAPPER_CLASSES,
  chipLinkClasses,
} from './chip-classes';

const names = (classes: string): string[] => classes.split(/\s+/);

const FINE_POINTER_HEIGHT = 'h-9';
const COARSE_POINTER_HEIGHT = 'pointer-coarse:h-11';
const FORCED_COLORS_OUTLINE = ['outline-2', 'outline-[Highlight]'];

describe('chipLinkClasses', () => {
  for (const current of [false, true]) {
    it(`${current ? 'current' : 'other'} chip: 36px on fine pointers and 44px on touch screens`, () => {
      const classes = names(chipLinkClasses(current));
      expect(classes).toContain(FINE_POINTER_HEIGHT);
      expect(classes).toContain(COARSE_POINTER_HEIGHT);
      expect(classes).not.toContain('h-11');
      expect(classes).toEqual(expect.arrayContaining(['rounded-full', 'border']));
    });
  }

  it('other chip: --input edge, hover fill, and no current fill', () => {
    const classes = names(chipLinkClasses(false));
    expect(classes).toEqual(expect.arrayContaining(['border-input', 'hover:bg-muted']));
    expect(classes).not.toContain('bg-foreground');
    expect(classes.filter((name) => name.startsWith('forced-colors:'))).toEqual([]);
  });

  it('current chip: --background on --foreground, with a Highlight outline in forced colors', () => {
    const classes = names(chipLinkClasses(true));
    expect(classes).toEqual(
      expect.arrayContaining(['border-foreground', 'bg-foreground', 'text-background']),
    );
    for (const outline of FORCED_COLORS_OUTLINE) {
      expect(classes).toContain(`forced-colors:${outline}`);
    }
    expect(classes).not.toContain('border-input');
  });
});

describe('choice chip classes', () => {
  const label = names(CHIP_CHOICE_LABEL_CLASSES);

  it('is 36px on fine pointers and 44px on touch screens', () => {
    expect(label).toContain(FINE_POINTER_HEIGHT);
    expect(label).toContain(COARSE_POINTER_HEIGHT);
    expect(label).not.toContain('h-11');
    expect(label).toEqual(expect.arrayContaining(['rounded-full', 'border', 'border-input']));
  });

  it('draws the checked chip as --background on --foreground', () => {
    expect(label).toEqual(
      expect.arrayContaining([
        'peer-checked:border-foreground',
        'peer-checked:bg-foreground',
        'peer-checked:text-background',
        'peer-checked:hover:bg-foreground',
      ]),
    );
  });

  it('keeps a visible focus ring from the hidden input', () => {
    expect(label).toEqual(
      expect.arrayContaining([
        'peer-focus-visible:outline-2',
        'peer-focus-visible:outline-offset-2',
        'peer-focus-visible:outline-ring',
      ]),
    );
  });

  it('keeps the checked state visible in forced colors', () => {
    for (const outline of FORCED_COLORS_OUTLINE) {
      expect(label).toContain(`peer-checked:forced-colors:${outline}`);
    }
  });

  it('hides the native input with sr-only, as the peer of the label', () => {
    const input = names(CHIP_CHOICE_INPUT_CLASSES);
    expect(input).toEqual(['peer', 'sr-only']);
  });

  it('anchors the hidden input to its chip', () => {
    expect(names(CHIP_CHOICE_WRAPPER_CLASSES)).toEqual(['relative', 'inline-flex']);
  });
});

@Component({
  template: `
    <fieldset>
      <legend>Sport</legend>
      @for (sport of sports; track sport) {
        <label [class]="wrapper">
          <input type="radio" name="sport" [value]="sport" [class]="input" />
          <span [class]="chip">{{ sport }}</span>
        </label>
      }
    </fieldset>
    <label [class]="wrapper">
      <input type="checkbox" name="open" [class]="input" />
      <span [class]="chip">Open</span>
    </label>
  `,
})
class ChipMarkupHost {
  protected readonly sports = ['Beach volleyball', 'Soccer', 'Softball'];
  protected readonly wrapper = CHIP_CHOICE_WRAPPER_CLASSES;
  protected readonly input = CHIP_CHOICE_INPUT_CLASSES;
  protected readonly chip = CHIP_CHOICE_LABEL_CLASSES;
}

describe('choice chip markup', () => {
  function render(): HTMLElement {
    const fixture = TestBed.createComponent(ChipMarkupHost);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('groups the radios in one fieldset with a legend and one shared name', () => {
    const fieldset = render().querySelector('fieldset');
    expect(fieldset?.querySelector('legend')?.textContent).toBe('Sport');
    const radios = [...(fieldset?.querySelectorAll<HTMLInputElement>('input') ?? [])];
    expect(radios).toHaveLength(3);
    expect(radios.every((radio) => radio.type === 'radio')).toBe(true);
    expect(new Set(radios.map((radio) => radio.name))).toEqual(new Set(['sport']));
  });

  it('uses native inputs hidden with sr-only, never hidden or display: none', () => {
    const inputs = [...render().querySelectorAll<HTMLInputElement>('input')];
    expect(inputs.map((input) => input.type)).toEqual(['radio', 'radio', 'radio', 'checkbox']);
    for (const input of inputs) {
      expect(input.classList.contains('sr-only')).toBe(true);
      expect(input.hidden).toBe(false);
      expect(input.classList.contains('hidden')).toBe(false);
    }
  });

  it('puts the focus-ring classes on the chip that follows each input', () => {
    const inputs = [...render().querySelectorAll('input')];
    expect(inputs).toHaveLength(4);
    for (const input of inputs) {
      const chip = input.nextElementSibling;
      expect(chip?.classList.contains('peer-focus-visible:outline-2')).toBe(true);
      expect(chip?.classList.contains('peer-focus-visible:outline-ring')).toBe(true);
    }
  });
});
