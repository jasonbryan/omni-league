import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  DESCRIPTION,
  FIELD,
  FIELD_ERROR,
  FIELD_GROUP,
  INPUT,
  LABEL,
} from '../../organizations/admin/field-classes';
import { HlmInputImports } from '../input';
import { HlmFieldImports } from '.';

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
    </div>
  `,
})
class Fields {}

const tokens = (value: string) => value.split(/\s+/).filter(Boolean).sort();

describe('the vendored helm input and field directives', () => {
  let root: HTMLElement;

  beforeEach(async () => {
    const fixture = TestBed.createComponent(Fields);
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;
  });

  const slot = (name: string) => root.querySelector<HTMLElement>(`[data-slot="${name}"]`)!;

  it.each([
    ['field-group', FIELD_GROUP, ['mt-5']],
    ['field', FIELD, []],
    ['field-label', LABEL, []],
    ['input', INPUT, ['w-40']],
    ['field-description', DESCRIPTION, []],
    ['field-error', FIELD_ERROR, []],
  ])(
    '%s carries the classes the pages already draw, plus the template’s own',
    (name, classes, own) => {
      expect(tokens(slot(name).className)).toEqual(tokens(`${classes} ${own.join(' ')}`));
    },
  );

  it('sets the roles and orientation helm sets, and leaves ids and ARIA to the page', () => {
    expect(slot('field').getAttribute('role')).toBe('group');
    expect(slot('field').getAttribute('data-orientation')).toBe('vertical');
    expect(slot('field-error').getAttribute('role')).toBe('alert');
    expect(slot('input').id).toBe('name');
    expect(slot('input').hasAttribute('aria-invalid')).toBe(false);
    expect(slot('input').hasAttribute('aria-describedby')).toBe(false);
  });
});
