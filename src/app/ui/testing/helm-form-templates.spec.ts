import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONTENT_CLASSES,
  DESCRIPTION_CLASSES,
  ERROR_CLASSES,
  FIELD_HORIZONTAL_CLASSES,
  FIELD_SET_CLASSES,
  FIELD_VERTICAL_CLASSES,
  GROUP_CLASSES,
  INPUT_CLASSES,
  LABEL_CLASSES,
  LEGEND_CLASSES,
  TEXTAREA_CLASSES,
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

interface Parts {
  inputs?: number;
  nativeInputs?: number;
  fields?: number;
  labels?: number;
  descriptions?: number;
  errors?: number;
  contents?: number;
  fieldSets?: number;
  legends?: number;
  textareas?: number;
  horizontal?: number;
  handWritten?: string[];
}

const FORMS: Record<string, Parts> = {
  'src/app/organizations/admin/admin-details.ts': {
    inputs: 2,
    fields: 2,
    labels: 2,
    descriptions: 1,
    errors: 1,
  },
  'src/app/organizations/admin/location-fields.ts': {
    inputs: 1,
    fields: 1,
    labels: 1,
    descriptions: 1,
    errors: 1,
  },
  'src/app/organizations/admin/league-create-form.ts': {
    inputs: 2,
    fields: 3,
    labels: 3,
    descriptions: 3,
    errors: 3,
    contents: 1,
    fieldSets: 1,
    legends: 1,
    horizontal: 1,
    handWritten: ['field-set'],
  },
  'src/app/organizations/admin/tournament-create-form.ts': {
    inputs: 4,
    fields: 5,
    labels: 5,
    descriptions: 5,
    errors: 5,
    contents: 1,
    fieldSets: 1,
    legends: 1,
    horizontal: 1,
    handWritten: ['field-set'],
  },
  'src/app/organizations/league/league-details-form.ts': {
    inputs: 1,
    fields: 1,
    labels: 1,
    descriptions: 1,
    errors: 1,
    handWritten: ['field-group', 'field-set'],
  },
  'src/app/organizations/admin/league-division-fields.ts': {
    inputs: 1,
    fields: 2,
    labels: 2,
    descriptions: 2,
    errors: 2,
    handWritten: ['input'],
  },
  'src/app/organizations/admin/custom-level-panel.ts': {
    inputs: 1,
    fields: 2,
    labels: 2,
    descriptions: 2,
    errors: 2,
    handWritten: ['input'],
  },
  'src/app/organizations/admin/chip-radio-group.ts': { nativeInputs: 1, errors: 1 },
  'src/app/organizations/admin/staff-invite-panel.ts': {
    inputs: 1,
    fields: 5,
    labels: 5,
    descriptions: 5,
    errors: 2,
    contents: 3,
    fieldSets: 2,
    legends: 2,
    textareas: 1,
    horizontal: 3,
  },
  'src/app/organizations/admin/admin-logo.ts': { nativeInputs: 1, descriptions: 1, errors: 1 },
  'src/app/organizations/league/season-create-form.ts': {
    inputs: 5,
    fields: 5,
    labels: 5,
    descriptions: 6,
    errors: 5,
    fieldSets: 1,
    legends: 1,
  },
  'src/app/organizations/season-management/limit-edit-form.ts': {
    inputs: 1,
    fields: 1,
    labels: 1,
    descriptions: 1,
    errors: 1,
  },
  'src/app/organizations/season-management/place-free-agent-dialog.ts': {
    fields: 1,
    labels: 1,
    descriptions: 1,
    errors: 1,
    contents: 1,
    fieldSets: 1,
    legends: 1,
    horizontal: 1,
  },
  'src/app/teams/add-minor-panel.ts': {
    inputs: 1,
    fields: 1,
    labels: 1,
    descriptions: 1,
    errors: 1,
  },
  'src/app/teams/rename-minor-form.ts': {
    inputs: 1,
    fields: 1,
    labels: 1,
    descriptions: 1,
    errors: 1,
  },
  'src/app/teams/join-team-page.ts': {
    inputs: 1,
    fields: 3,
    labels: 3,
    descriptions: 4,
    errors: 2,
    contents: 2,
    fieldSets: 1,
    legends: 1,
    horizontal: 2,
  },
  'src/app/teams/team-invite-panel.ts': {
    inputs: 1,
    fields: 2,
    labels: 2,
    descriptions: 1,
    errors: 1,
    textareas: 1,
  },
};

const FIELD_CONSTANTS = [
  'FIELD',
  'FIELD_HORIZONTAL',
  'FIELD_GROUP',
  'LABEL',
  'INPUT',
  'DESCRIPTION',
  'FIELD_SET',
  'LEGEND',
  'FIELD_ERROR',
  'FIELD_CONTENT',
  'FIELD_NOTE',
];

describe.each(Object.entries(FORMS))('%s', (path, expected) => {
  const source = readFileSync(join(process.cwd(), path), 'utf8');
  const want = {
    inputs: 0,
    nativeInputs: 0,
    fields: 0,
    labels: 0,
    descriptions: 0,
    errors: 0,
    contents: 0,
    fieldSets: 0,
    legends: 0,
    textareas: 0,
    horizontal: 0,
    handWritten: [],
    ...expected,
  };

  it('imports none of the field class constants', () => {
    const imported = [...source.matchAll(/import \{([^}]*)\} from '[^']*field-classes'/g)].flatMap(
      (match) => match[1].split(',').map((name) => name.trim()),
    );
    expect(imported.filter((name) => FIELD_CONSTANTS.includes(name))).toEqual([]);
  });

  it.each([
    ['field group', GROUP_CLASSES],
    ['field set', FIELD_SET_CLASSES],
    ['legend', LEGEND_CLASSES],
    ['textarea', TEXTAREA_CLASSES],
    ['label', LABEL_CLASSES],
    ['input', INPUT_CLASSES],
    ['description', DESCRIPTION_CLASSES],
    ['error', ERROR_CLASSES],
  ])('has no %s class string written inline', (_, classes) => {
    expect(source).not.toContain(classes);
  });

  it('draws each part with its helm directive, and writes no slot or role of its own', () => {
    expect(count(source, /<input\b/g)).toBe(want.inputs + want.nativeInputs);
    expect(count(source, /<input\b[^>]*\bhlmInput\b/g)).toBe(want.inputs);
    expect(count(source, /<label\b[^>]*\bhlmFieldLabel\b/g)).toBe(want.labels);
    expect(count(source, /<div\b[^>]*\bhlmField\b(?!\w)/g)).toBe(want.fields);
    expect(count(source, /\bhlmFieldContent\b/g)).toBe(want.contents);
    expect(count(source, /\bhlmFieldDescription\b/g)).toBe(want.descriptions);
    expect(count(source, /\bhlmFieldError\b/g)).toBe(want.errors);
    expect(count(source, /<fieldset\b[^>]*\bhlmFieldSet\b/g)).toBe(want.fieldSets);
    expect(count(source, /<legend\b[^>]*\bhlmFieldLegend\b/g)).toBe(want.legends);
    expect(count(source, /<textarea\b[^>]*\bhlmTextarea\b/g)).toBe(want.textareas);
    expect(count(source, /\borientation="horizontal"/g)).toBe(want.horizontal);
    const written = source.matchAll(
      /data-slot="(field-group|field|field-label|input|field-description|field-content|field-error|field-set|field-legend|textarea)"/g,
    );
    expect([...written].map((match) => match[1]).sort()).toEqual(want.handWritten);
  });
});

describe('organizations/admin/field-classes.ts', () => {
  const path = join(process.cwd(), 'src/app/organizations/admin/field-classes.ts');
  const source = existsSync(path) ? readFileSync(path, 'utf8') : '';

  it.each(FIELD_CONSTANTS)('does not export %s', (name) => {
    expect(source).not.toMatch(new RegExp(`export const ${name}\\b`));
  });
});
