import { TestBed } from '@angular/core/testing';
import { expectSkeletonBoxes } from '../ui/testing/skeleton-boxes';
import { RegisterSkeleton, rosterRange } from './register-card';

describe('RegisterSkeleton', () => {
  function render(withNameField: boolean) {
    const fixture = TestBed.createComponent(RegisterSkeleton);
    fixture.componentRef.setInput('withNameField', withNameField);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('draws every box through the skeleton, each with its own radius', () => {
    expectSkeletonBoxes(render(false), { 'rounded-lg': 1, 'rounded-md': 13 });
  });

  it('adds the name field bar, rounded-md, when the form has a team name', () => {
    expectSkeletonBoxes(render(true), { 'rounded-lg': 1, 'rounded-md': 14 });
  });
});

describe('rosterRange', () => {
  it('gives the minimum alone without a maximum', () => {
    expect(rosterRange(4)).toBe('At least 4 players');
  });

  it('gives the minimum to the maximum', () => {
    expect(rosterRange(4, 6)).toBe('4 to 6 players');
  });

  it('gives one number when the minimum and maximum are the same', () => {
    expect(rosterRange(6, 6)).toBe('6 players');
  });
});
