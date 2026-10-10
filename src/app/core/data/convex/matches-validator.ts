import type { GenericValidator } from 'convex/values';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof ArrayBuffer)
  );
}

/**
 * Whether `value` (a Convex value, as `jsonToConvex` returns it) has the shape `validator`
 * describes, so a page can read it as the query's result (#82, saved copies). The check walks the
 * same validator object the Convex function declares as `returns`.
 *
 * One difference from Convex's own check: an object may carry fields the validator does not name.
 * A page reads only the fields its build knows, so a copy saved by a build whose result gained a
 * field (the expand step of ADR 0013 section 4's 14-day compatibility) still reads. A validator
 * kind this function does not know fails the check.
 */
export function matchesValidator(value: unknown, validator: GenericValidator): boolean {
  switch (validator.kind) {
    case 'any':
      return value !== undefined;
    case 'null':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
    case 'id':
      return typeof value === 'string';
    case 'float64':
      return typeof value === 'number';
    case 'int64':
      return typeof value === 'bigint';
    case 'bytes':
      return value instanceof ArrayBuffer;
    case 'literal':
      return value === validator.value;
    case 'array':
      return (
        Array.isArray(value) && value.every((item) => matchesValidator(item, validator.element))
      );
    case 'object':
      return (
        isPlainObject(value) &&
        Object.entries(validator.fields).every(([name, field]) => {
          const fieldValue = Object.hasOwn(value, name) ? value[name] : undefined;
          return fieldValue === undefined
            ? field.isOptional === 'optional'
            : matchesValidator(fieldValue, field);
        })
      );
    case 'record':
      return (
        isPlainObject(value) &&
        Object.entries(value).every(
          ([key, item]) =>
            matchesValidator(key, validator.key) && matchesValidator(item, validator.value),
        )
      );
    case 'union':
      return validator.members.some((member) => matchesValidator(value, member));
    default:
      return false;
  }
}
