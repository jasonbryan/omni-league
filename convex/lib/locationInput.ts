// What an org admin may type when adding or editing a location (#65), checked in the browser and
// again by `locations.create` and `locations.update` with the same rules and messages
// (design/mockups/65-organization-admin-locations.html, "Location messages"). Imports nothing, so
// the app can import it (convex.md, Functions).

/** Longest location name, counted after trimming. */
export const MAX_LOCATION_NAME_LENGTH = 100;
/** Longest location address, counted after trimming. */
export const MAX_LOCATION_ADDRESS_LENGTH = 200;

export type LocationInputCode = 'nameEmpty' | 'nameTooLong' | 'addressEmpty' | 'addressTooLong';

/** A refusal about one field: the `data` of the `ConvexError` the mutations throw. */
export interface LocationInputError {
  field: 'name' | 'address';
  code: LocationInputCode;
  message: string;
}

export const LOCATION_MESSAGES = {
  nameEmpty: 'Enter the location’s name.',
  addressEmpty: 'Enter the location’s address.',
  nameTooLong: (length: number) =>
    `Use ${MAX_LOCATION_NAME_LENGTH} characters or fewer. This name has ${length}.`,
  addressTooLong: (length: number) =>
    `Use ${MAX_LOCATION_ADDRESS_LENGTH} characters or fewer. This address has ${length}.`,
} as const;

type Checked = { ok: true; value: string } | { ok: false; error: LocationInputError };

/** The name to store (trimmed), or the refusal. */
export function checkLocationName(name: string): Checked {
  const value = name.trim();
  if (value === '') {
    return {
      ok: false,
      error: { field: 'name', code: 'nameEmpty', message: LOCATION_MESSAGES.nameEmpty },
    };
  }
  if (value.length > MAX_LOCATION_NAME_LENGTH) {
    return {
      ok: false,
      error: {
        field: 'name',
        code: 'nameTooLong',
        message: LOCATION_MESSAGES.nameTooLong(value.length),
      },
    };
  }
  return { ok: true, value };
}

/** The address to store (trimmed), or the refusal. */
export function checkLocationAddress(address: string): Checked {
  const value = address.trim();
  if (value === '') {
    return {
      ok: false,
      error: { field: 'address', code: 'addressEmpty', message: LOCATION_MESSAGES.addressEmpty },
    };
  }
  if (value.length > MAX_LOCATION_ADDRESS_LENGTH) {
    return {
      ok: false,
      error: {
        field: 'address',
        code: 'addressTooLong',
        message: LOCATION_MESSAGES.addressTooLong(value.length),
      },
    };
  }
  return { ok: true, value };
}
