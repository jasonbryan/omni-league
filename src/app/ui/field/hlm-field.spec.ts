import { Component, type DebugElement } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  CONTENT_CLASSES,
  DESCRIPTION_CLASSES,
  ERROR_CLASSES,
  FIELD_HORIZONTAL_CLASSES,
  FIELD_VERTICAL_CLASSES,
  GROUP_CLASSES,
  INPUT_CLASSES,
  LABEL_CLASSES,
} from '../testing/field-class-literals';
import { HlmInput, HlmInputImports } from '../input';
import { HlmField, HlmFieldImports } from '.';

@Component({
  imports: [HlmFieldImports, HlmInputImports],
  template: `
    <div hlmFieldGroup class="mt-5">
      <div hlmField>
        <label hlmFieldLabel for="name">Name</label>
        <input hlmInput id="name" class="w-40" />
        <p hlmFieldDescription id="name-description">Up to 60 characters.</p>
        <div hlmFieldError id="name-error">Enter a name.</div>
      </div>
      <div hlmField orientation="horizontal" id="agree-field">
        <div hlmFieldContent class="mt-1">
          <label hlmFieldLabel for="agree">I agree</label>
          <p hlmFieldDescription id="agree-description">Required.</p>
        </div>
      </div>
    </div>
  `,
})
class Fields {}

const tokens = (value: string) => value.split(/\s+/).filter(Boolean).sort();

describe('the helm input and field directives', () => {
  let root: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<Fields>>;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Fields);
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;
  });

  const slot = (name: string) => root.querySelector<HTMLElement>(`[data-slot="${name}"]`)!;
  const fieldById = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;

  it.each([
    ['field-group', GROUP_CLASSES, ['mt-5']],
    ['field', FIELD_VERTICAL_CLASSES, []],
    ['field-label', LABEL_CLASSES, []],
    ['input', INPUT_CLASSES, ['w-40']],
    ['field-description', DESCRIPTION_CLASSES, []],
    ['field-error', ERROR_CLASSES, []],
    ['field-content', CONTENT_CLASSES, ['mt-1']],
  ])('%s carries its own classes, plus the template’s own', (name, classes, own) => {
    expect(tokens(slot(name).className)).toEqual(tokens(`${classes} ${own.join(' ')}`));
  });

  it('is vertical unless the template says otherwise', () => {
    const field = slot('field');
    expect(field.getAttribute('data-orientation')).toBe('vertical');
    expect(tokens(field.className)).toEqual(tokens(FIELD_VERTICAL_CLASSES));
  });

  it('draws the horizontal orientation with its own classes and data-orientation', () => {
    const field = fieldById('agree-field');
    expect(field.getAttribute('data-orientation')).toBe('horizontal');
    expect(field.getAttribute('role')).toBe('group');
    expect(tokens(field.className)).toEqual(tokens(FIELD_HORIZONTAL_CLASSES));
  });

  it('sets the roles helm sets, and leaves ids and ARIA to the page', () => {
    expect(slot('field').getAttribute('role')).toBe('group');
    expect(slot('field-error').getAttribute('role')).toBe('alert');
    expect(slot('input').id).toBe('name');
    expect(slot('input').hasAttribute('aria-invalid')).toBe(false);
    expect(slot('input').hasAttribute('aria-describedby')).toBe(false);
    expect(slot('field').hasAttribute('data-matches-spartan-invalid')).toBe(false);
  });

  it('has no brain directive on the input or the field', () => {
    const brainTokens = (element: DebugElement) =>
      element.providerTokens
        .map((token) => String((token as { name?: unknown }).name))
        .filter((name) => name.startsWith('Brn'));
    expect(brainTokens(fixture.debugElement.query(By.directive(HlmInput)))).toEqual([]);
    expect(brainTokens(fixture.debugElement.query(By.directive(HlmField)))).toEqual([]);
  });
});
