import { Component, type DebugElement } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TEXTAREA_CLASSES } from '../testing/field-class-literals';
import { HlmTextarea, HlmTextareaImports } from '.';

@Component({
  imports: [HlmTextareaImports],
  template: `
    <textarea hlmTextarea id="link" readonly class="resize-none font-mono break-all"></textarea>
    <textarea hlmTextarea id="plain"></textarea>
  `,
})
class Textareas {}

const tokens = (value: string) => value.split(/\s+/).filter(Boolean).sort();

describe('the helm textarea directive', () => {
  let root: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<Textareas>>;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Textareas);
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;
  });

  const textarea = (id: string) => root.querySelector<HTMLTextAreaElement>(`#${id}`)!;

  it('carries its own classes and data-slot, plus the template’s own', () => {
    expect(textarea('plain').getAttribute('data-slot')).toBe('textarea');
    expect(tokens(textarea('plain').className)).toEqual(tokens(TEXTAREA_CLASSES));
    expect(tokens(textarea('link').className)).toEqual(
      tokens(`${TEXTAREA_CLASSES} resize-none font-mono break-all`),
    );
  });

  it('has no focus ring, focus border, or outline reset: the focus-visible outline in base.css is the indicator', () => {
    const classes = TEXTAREA_CLASSES.split(' ');
    expect(classes.filter((name) => /^(focus|outline)/.test(name))).toEqual([]);
  });

  it('leaves id, ARIA, and invalid state to the page', () => {
    expect(textarea('plain').hasAttribute('aria-invalid')).toBe(false);
    expect(textarea('plain').hasAttribute('aria-describedby')).toBe(false);
    expect(textarea('plain').hasAttribute('data-matches-spartan-invalid')).toBe(false);
  });

  it('has no brain directive', () => {
    const brainTokens = (element: DebugElement) =>
      element.providerTokens
        .map((token) => String((token as { name?: unknown }).name))
        .filter((name) => name.startsWith('Brn'));
    expect(brainTokens(fixture.debugElement.query(By.directive(HlmTextarea)))).toEqual([]);
  });
});
