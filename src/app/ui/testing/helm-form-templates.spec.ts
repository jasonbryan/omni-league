import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONTENT_CLASSES,
  DESCRIPTION_CLASSES,
  ERROR_CLASSES,
  FIELD_HORIZONTAL_CLASSES,
  FIELD_VERTICAL_CLASSES,
  GROUP_CLASSES,
  INPUT_CLASSES,
  LABEL_CLASSES,
} from './field-class-literals';

const PAGES = {
  'src/app/sign-in/sign-in-page.ts': { inputs: 2, fields: 2, labels: 2, contents: 0 },
  'src/app/sign-up/sign-up-page.ts': { inputs: 3, fields: 4, labels: 4, contents: 1 },
  'src/app/organizations/create-organization-page.ts': {
    inputs: 3,
    fields: 3,
    labels: 3,
    contents: 0,
  },
};

const FIELD_STRINGS = {
  'field group': GROUP_CLASSES,
  'vertical field': FIELD_VERTICAL_CLASSES,
  'horizontal field': FIELD_HORIZONTAL_CLASSES,
  label: LABEL_CLASSES,
  input: INPUT_CLASSES,
  description: DESCRIPTION_CLASSES,
  'field content': CONTENT_CLASSES,
  error: ERROR_CLASSES,
};

const count = (source: string, pattern: RegExp) => source.match(pattern)?.length ?? 0;

describe.each(Object.entries(PAGES))('%s', (path, expected) => {
  const source = readFileSync(join(process.cwd(), path), 'utf8');

  it.each(Object.entries(FIELD_STRINGS))('has no %s class string written inline', (_, classes) => {
    expect(source).not.toContain(classes);
  });

  it('draws each input, field, label, and field content with its helm directive', () => {
    expect(count(source, /<input\b/g)).toBe(expected.inputs);
    expect(count(source, /<input\b[^>]*\bhlmInput\b/g)).toBe(expected.inputs);
    expect(count(source, /<label\b[^>]*\bhlmFieldLabel\b/g)).toBe(expected.labels);
    expect(count(source, /<div\b[^>]*\bhlmField\b(?!\w)/g)).toBe(expected.fields);
    expect(count(source, /\bhlmFieldContent\b/g)).toBe(expected.contents);
    expect(count(source, /\bhlmFieldGroup\b/g)).toBe(1);
  });

  it('draws each description and error with its helm directive, and writes no slot or role of its own', () => {
    expect(
      count(
        source,
        /data-slot="(?:field-group|field|field-label|input|field-description|field-content|field-error)"/g,
      ),
    ).toBe(0);
    expect(count(source, /\bhlmFieldError\b/g)).toBe(
      count(source, /\bid="(?!form-)[a-zA-Z]+-error"/g),
    );
    expect(count(source, /\bhlmFieldDescription\b/g)).toBe(
      count(source, /id="[a-zA-Z]+-description"/g),
    );
  });
});

describe('sign-up-page.ts', () => {
  it('draws the 18+ field horizontally', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/sign-up/sign-up-page.ts'), 'utf8');
    expect(source).toMatch(/<div\b[^>]*\bhlmField\b[^>]*\borientation="horizontal"/);
  });
});
