import { describe, expect, test } from 'vitest';
import {
  checkLocationAddress,
  checkLocationName,
  LOCATION_MESSAGES,
  MAX_LOCATION_ADDRESS_LENGTH,
  MAX_LOCATION_NAME_LENGTH,
} from './locationInput';

// The rules and messages of design/mockups/65-organization-admin-locations.html, "Location
// messages". The form and `locations.create` / `locations.update` share them.

describe('checkLocationName', () => {
  test('returns the trimmed name', () => {
    expect(checkLocationName('  Redfish Flats Fields \n')).toEqual({
      ok: true,
      value: 'Redfish Flats Fields',
    });
  });

  test('refuses an empty and a whitespace-only name with the mockup message', () => {
    for (const name of ['', '   ', ' \t\n ']) {
      expect(checkLocationName(name), JSON.stringify(name)).toEqual({
        ok: false,
        error: { field: 'name', code: 'nameEmpty', message: 'Enter the location’s name.' },
      });
    }
  });

  test('counts after trimming: 100 characters pass, 101 are refused with their count', () => {
    expect(MAX_LOCATION_NAME_LENGTH).toBe(100);
    expect(checkLocationName(` ${'n'.repeat(100)} `)).toEqual({ ok: true, value: 'n'.repeat(100) });
    expect(checkLocationName('n'.repeat(101))).toEqual({
      ok: false,
      error: {
        field: 'name',
        code: 'nameTooLong',
        message: 'Use 100 characters or fewer. This name has 101.',
      },
    });
  });
});

describe('checkLocationAddress', () => {
  test('returns the trimmed address', () => {
    expect(checkLocationAddress(' 880 Redfish Flats Ln, Rockport, TX 78382 ')).toEqual({
      ok: true,
      value: '880 Redfish Flats Ln, Rockport, TX 78382',
    });
  });

  test('refuses an empty and a whitespace-only address with the mockup message', () => {
    for (const address of ['', '   ', ' \t\n ']) {
      expect(checkLocationAddress(address), JSON.stringify(address)).toEqual({
        ok: false,
        error: { field: 'address', code: 'addressEmpty', message: 'Enter the location’s address.' },
      });
    }
  });

  test('counts after trimming: 200 characters pass, 201 are refused with their count', () => {
    expect(MAX_LOCATION_ADDRESS_LENGTH).toBe(200);
    expect(checkLocationAddress(` ${'a'.repeat(200)} `)).toEqual({
      ok: true,
      value: 'a'.repeat(200),
    });
    expect(checkLocationAddress('a'.repeat(201))).toEqual({
      ok: false,
      error: {
        field: 'address',
        code: 'addressTooLong',
        message: 'Use 200 characters or fewer. This address has 201.',
      },
    });
  });
});

test('the message table is the one the form prints', () => {
  expect(LOCATION_MESSAGES.nameEmpty).toBe('Enter the location’s name.');
  expect(LOCATION_MESSAGES.addressEmpty).toBe('Enter the location’s address.');
  expect(LOCATION_MESSAGES.nameTooLong(150)).toBe(
    'Use 100 characters or fewer. This name has 150.',
  );
  expect(LOCATION_MESSAGES.addressTooLong(250)).toBe(
    'Use 200 characters or fewer. This address has 250.',
  );
});
