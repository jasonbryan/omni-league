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

const FORM_SLOTS = [
  'field-group',
  'field',
  'field-label',
  'input',
  'field-description',
  'field-content',
  'field-error',
];

const REPORTED_ATTRIBUTES = [
  'id',
  'name',
  'type',
  'autocomplete',
  'for',
  'role',
  'data-slot',
  'data-orientation',
  'aria-describedby',
  'aria-invalid',
  'data-invalid',
  'data-matches-spartan-invalid',
];

export const INVALID_ATTRIBUTES = {
  'data-invalid': 'true',
  'data-matches-spartan-invalid': 'true',
};

export interface FormShape {
  tag: string;
  classes: string[];
  attributes: Record<string, string>;
}

/** Signal forms number each form (`a.form12.email`), so the number depends on the specs that ran before. */
const withoutFormCounter = (name: string) => name.replace(/^a\.form\d+\./, 'form.');

const tokens = (value: string) => value.split(/\s+/).filter(Boolean).sort();

export function formShapes(root: ParentNode): FormShape[] {
  const selector = FORM_SLOTS.map((slot) => `[data-slot="${slot}"]`).join(',');
  return [...root.querySelectorAll(selector)].map((element) => ({
    tag: element.tagName.toLowerCase(),
    classes: tokens(element.getAttribute('class') ?? ''),
    attributes: Object.fromEntries(
      REPORTED_ATTRIBUTES.flatMap((name) => {
        const value = element.getAttribute(name);
        return value === null ? [] : [[name, name === 'name' ? withoutFormCounter(value) : value]];
      }),
    ),
  }));
}

const CLASSES_BY_SLOT: Record<string, string> = {
  'field-group': GROUP_CLASSES,
  field: FIELD_VERTICAL_CLASSES,
  'field-label': LABEL_CLASSES,
  input: INPUT_CLASSES,
  'field-description': DESCRIPTION_CLASSES,
  'field-content': CONTENT_CLASSES,
  'field-error': ERROR_CLASSES,
};

const TAG_BY_SLOT: Record<string, string> = {
  'field-group': 'div',
  field: 'div',
  'field-label': 'label',
  input: 'input',
  'field-description': 'p',
  'field-content': 'div',
  'field-error': 'div',
};

const ROLE_BY_SLOT: Record<string, string> = { field: 'group', 'field-error': 'alert' };

export function shapeOf(
  slot: string,
  attributes: Record<string, string> = {},
  ownClasses = '',
): FormShape {
  const horizontal = slot === 'field' && attributes['data-orientation'] === 'horizontal';
  const slotClasses = horizontal ? FIELD_HORIZONTAL_CLASSES : CLASSES_BY_SLOT[slot];
  const defaults: Record<string, string> = { 'data-slot': slot };
  if (slot in ROLE_BY_SLOT) defaults['role'] = ROLE_BY_SLOT[slot];
  if (slot === 'field') defaults['data-orientation'] = 'vertical';
  return {
    tag: TAG_BY_SLOT[slot],
    classes: tokens(`${slotClasses} ${ownClasses}`),
    attributes: { ...defaults, ...attributes },
  };
}

export function inputShape(
  id: string,
  attributes: Record<string, string>,
  invalid = false,
  ownClasses = '',
): FormShape {
  return shapeOf(
    'input',
    {
      id,
      name: `form.${id}`,
      ...attributes,
      ...(invalid ? { 'aria-invalid': 'true', ...INVALID_ATTRIBUTES } : {}),
    },
    ownClasses,
  );
}

export function fieldShape(invalid = false, orientation = 'vertical'): FormShape {
  return shapeOf('field', {
    'data-orientation': orientation,
    ...(invalid ? INVALID_ATTRIBUTES : {}),
  });
}
