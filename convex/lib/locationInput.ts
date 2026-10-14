// Imports nothing, so the app can import it.

export const MAX_LOCATION_NAME_LENGTH = 100;
export const MAX_LOCATION_ADDRESS_LENGTH = 200;

export type LocationInputCode = 'nameEmpty' | 'nameTooLong' | 'addressEmpty' | 'addressTooLong';

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
