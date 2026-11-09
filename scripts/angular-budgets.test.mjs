import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const angularJson = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'angular.json'), 'utf8'),
);
const configurations = Object.values(angularJson.projects)
  .map((project) => project.architect?.build?.configurations)
  .find(Boolean);

const budget = (type) => configurations.production.budgets.find((entry) => entry.type === type);

// An error budget makes `ng build` exit non-zero, which fails `ci`, the local build, and every
// Netlify deploy; a warning alone passes silently.
describe('angular.json production budgets', () => {
  it('fails the build when the initial bundle passes 500 kB and warns from 490 kB', () => {
    assert.deepEqual(budget('initial'), {
      type: 'initial',
      maximumWarning: '490kB',
      maximumError: '500kB',
    });
  });

  it('keeps the component style budget at 4 kB warning and 8 kB error', () => {
    assert.deepEqual(budget('anyComponentStyle'), {
      type: 'anyComponentStyle',
      maximumWarning: '4kB',
      maximumError: '8kB',
    });
  });

  it('sets no other production budget', () => {
    assert.equal(configurations.production.budgets.length, 2);
  });

  it('sets no budgets on the development configuration', () => {
    assert.equal(configurations.development.budgets, undefined);
  });
});
