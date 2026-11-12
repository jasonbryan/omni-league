import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { expectBareCards } from '../ui/testing/card';
import { routerLinkState } from '../ui/testing/router-link-state';
import { expectSkeletonBoxes } from '../ui/testing/skeleton-boxes';
import { RegisterCard, RegisterSkeleton, rosterRange } from './register-card';
import type { RegistrationAnswer } from './register-team-state';

const SEASON = {
  leagueName: 'Coed 7v7 Rec',
  seasonName: 'Summer 2027',
  startDate: '2027-06-06',
  endDate: '2027-08-29',
  registrationDeadline: '2027-05-23',
  minimumRosterSize: 4,
} as NonNullable<RegistrationAnswer>;

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

describe('the registration cards', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('draws the season card as a bare helm card', () => {
    const fixture = TestBed.createComponent(RegisterCard);
    fixture.componentRef.setInput('season', SEASON);
    fixture.componentRef.setInput('kicker', 'Register a team');
    fixture.componentRef.setInput('seasonHref', '/seasons/summer-2027');
    fixture.detectChanges();
    expectBareCards(fixture.nativeElement as HTMLElement, ['mt-3 overflow-hidden']);
  });

  it('sets no navigation state on its link to the season page', () => {
    const fixture = TestBed.createComponent(RegisterCard);
    fixture.componentRef.setInput('season', SEASON);
    fixture.componentRef.setInput('kicker', 'Register a team');
    fixture.componentRef.setInput('seasonHref', '/seasons/summer-2027');
    fixture.detectChanges();
    const link = (fixture.nativeElement as HTMLElement).querySelector(
      'a[href="/seasons/summer-2027"]',
    );

    expect(routerLinkState(fixture, link)).toBeUndefined();
  });

  it('draws the loading placeholder as a bare helm card, with its test id kept', () => {
    const fixture = TestBed.createComponent(RegisterSkeleton);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expectBareCards(root, ['mt-3 overflow-hidden']);
    expect(
      root.querySelector('[data-testid="register-skeleton"] [data-slot="card"]'),
    ).not.toBeNull();
  });
});

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
