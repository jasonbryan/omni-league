import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Id } from '../../../../convex/_generated/dataModel';
import { LeagueForm } from './league-form';

const id = (name: string) => name as Id<'locations'>;
const REDFISH = id('loc_redfish');
const PELICAN = id('loc_pelican');

describe('LeagueForm: the location default', () => {
  function create(initial: Id<'locations'>[]) {
    const available = signal<Id<'locations'>[]>(initial);
    const form = TestBed.runInInjectionContext(() => new LeagueForm(() => available()));
    return { form, available };
  }

  it('checks the only location', () => {
    const { form } = create([REDFISH]);
    expect(form.chosen()).toEqual([REDFISH]);
  });

  it('checks none of two or more locations', () => {
    const { form } = create([REDFISH, PELICAN]);
    expect(form.chosen()).toEqual([]);
  });

  it('checks nothing without locations, as before', () => {
    const { form } = create([]);
    expect(form.chosen()).toEqual([]);
    expect(form.selected().size).toBe(0);
  });

  it('checks the first location when it arrives', () => {
    const { form, available } = create([]);
    available.set([REDFISH]);
    expect(form.chosen()).toEqual([REDFISH]);
  });

  it('keeps the choice of a user who unchecked the only location when the list emits again', () => {
    const { form, available } = create([REDFISH]);
    form.toggleLocation(REDFISH, false);
    available.set([REDFISH]);
    expect(form.chosen()).toEqual([]);
  });

  it('leaves the choice alone when a second location arrives', () => {
    const { form, available } = create([REDFISH]);
    expect(form.chosen()).toEqual([REDFISH]);
    available.set([REDFISH, PELICAN]);
    expect(form.chosen()).toEqual([REDFISH]);
    form.toggleLocation(REDFISH, false);
    form.toggleLocation(PELICAN, true);
    expect(form.chosen()).toEqual([PELICAN]);
  });

  it('clear() goes back to the default: the only location checked, two or more none', () => {
    const one = create([REDFISH]);
    one.form.toggleLocation(REDFISH, false);
    one.form.clear();
    expect(one.form.chosen()).toEqual([REDFISH]);

    const two = create([REDFISH, PELICAN]);
    two.form.toggleLocation(PELICAN, true);
    two.form.clear();
    expect(two.form.chosen()).toEqual([]);

    const none = create([]);
    none.form.clear();
    expect(none.form.chosen()).toEqual([]);
  });
});
