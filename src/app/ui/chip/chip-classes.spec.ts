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
const COARSE_POINTER_WIDTH = 'pointer-coarse:min-w-11';
const COARSE_POINTER_CENTRED = 'pointer-coarse:justify-center';
const FORCED_COLORS_FILL = ['forced-color-adjust-none', 'bg-[Highlight]', 'text-[HighlightText]'];

describe('chipLinkClasses', () => {
  for (const current of [false, true]) {
    it(`${current ? 'current' : 'other'} chip: 36px on fine pointers and 44px on touch screens`, () => {
      const classes = names(chipLinkClasses(current));
      expect(classes).toContain(FINE_POINTER_HEIGHT);
      expect(classes).toContain(COARSE_POINTER_HEIGHT);
      expect(classes).not.toContain('h-11');
      expect(classes).toEqual(expect.arrayContaining(['rounded-full', 'border']));
    });

    it(`${current ? 'current' : 'other'} chip: at least 44px wide on touch screens only, label centred`, () => {
      const classes = names(chipLinkClasses(current));
      expect(classes).toContain(COARSE_POINTER_WIDTH);
      expect(classes).toContain(COARSE_POINTER_CENTRED);
      expect(classes).not.toContain('min-w-11');
      expect(classes).not.toContain('justify-center');
    });
  }

  it('other chip: --input edge, hover fill, and no current fill', () => {
    const classes = names(chipLinkClasses(false));
    expect(classes).toEqual(expect.arrayContaining(['border-input', 'hover:bg-muted']));
    expect(classes).not.toContain('bg-foreground');
    expect(classes.filter((name) => name.includes('Highlight'))).toEqual([]);
  });

  it('current chip: --background on --foreground, with a Highlight fill in forced colors', () => {
    const classes = names(chipLinkClasses(true));
    expect(classes).toEqual(
      expect.arrayContaining(['border-foreground', 'bg-foreground', 'text-background']),
    );
    for (const fill of FORCED_COLORS_FILL) expect(classes).toContain(`forced-colors:${fill}`);
    expect(classes).not.toContain('border-input');
  });

  it('keeps the focus ring in a system colour in forced colors, for every chip link', () => {
    for (const current of [false, true]) {
      expect(names(chipLinkClasses(current))).toContain(
        'forced-colors:focus-visible:outline-[CanvasText]',
      );
    }
  });

  it('draws the current chip with no outline of its own in forced colors', () => {
    const forced = names(chipLinkClasses(true)).filter((name) => name.startsWith('forced-colors:'));
    expect(forced.filter((name) => name.includes('outline-2'))).toEqual([]);
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

  it('is at least 44px wide on touch screens only, with the label centred', () => {
    expect(label).toContain(COARSE_POINTER_WIDTH);
    expect(label).toContain(COARSE_POINTER_CENTRED);
    expect(label).not.toContain('min-w-11');
    expect(label).not.toContain('justify-center');
  });

  it('hovers only an unchecked chip, so a checked chip keeps its fill', () => {
    expect(label).toContain('not-peer-checked:hover:bg-muted');
    expect(label).not.toContain('hover:bg-muted');
  });

  it('draws the checked chip as --background on --foreground', () => {
    expect(label).toEqual(
      expect.arrayContaining([
        'peer-checked:border-foreground',
        'peer-checked:bg-foreground',
        'peer-checked:text-background',
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

  it('shows the ring on any focus of the hidden input in WebKit only, where an arrow key gives no :focus-visible', () => {
    const webkit = 'supports-[-webkit-backdrop-filter:none]';
    expect(label).toEqual(
      expect.arrayContaining([
        `${webkit}:peer-focus:outline-2`,
        `${webkit}:peer-focus:outline-offset-2`,
        `${webkit}:peer-focus:outline-ring`,
      ]),
    );
    expect(label.filter((name) => name.startsWith('peer-focus:'))).toEqual([]);
  });

  it('keeps the checked state visible in forced colors as a Highlight fill', () => {
    for (const fill of FORCED_COLORS_FILL)
      expect(label).toContain(`peer-checked:forced-colors:${fill}`);
  });

  it('shows focus in forced colors as a system-colour outline, not as the checked state', () => {
    expect(label).toContain('peer-focus-visible:forced-colors:outline-[CanvasText]');
    expect(
      label.filter((name) => name.includes('forced-colors') && name.includes('outline-2')),
    ).toEqual([]);
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
