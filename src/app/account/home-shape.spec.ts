import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../core/auth/auth.service';
import { ChangesInFlight } from '../core/changes-in-flight';
import { HomeShape } from './home-shape';

describe('HomeShape', () => {
  const signedIn = signal(true);
  const authEpoch = signal(0);
  const signedInByCheck = new Subject<void>();

  function create(startSignedIn = true) {
    signedIn.set(startSignedIn);
    authEpoch.set(0);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthService,
          useValue: {
            signedIn: signedIn.asReadonly(),
            authEpoch: authEpoch.asReadonly(),
            signedInByCheck,
          },
        },
      ],
    });
    const shape = TestBed.inject(HomeShape);
    return shape;
  }

  it('holds no shape until one is recorded', () => {
    expect(create().current()).toBeNull();
  });

  it.each(['nextStep', 'list', 'new'] as const)('remembers the recorded %s shape', (kind) => {
    const shape = create();
    shape.record(kind);
    expect(shape.current()).toBe(kind);
  });

  it('keeps the latest shape recorded', () => {
    const shape = create();
    shape.record('nextStep');
    shape.record('list');
    expect(shape.current()).toBe('list');
  });

  describe('a change this tab sends', () => {
    it('drops the shape when the change settles', async () => {
      const shape = create();
      shape.record('nextStep');
      await TestBed.inject(ChangesInFlight).track(() => Promise.resolve());
      expect(shape.current()).toBeNull();
    });

    it('drops the shape when the change fails', async () => {
      const shape = create();
      shape.record('list');
      await TestBed.inject(ChangesInFlight)
        .track(() => Promise.reject(new Error('refused')))
        .catch(() => undefined);
      expect(shape.current()).toBeNull();
    });

    it('keeps the shape while a change is still under way', () => {
      const shape = create();
      shape.record('list');
      const end = TestBed.inject(ChangesInFlight).begin();
      expect(shape.current()).toBe('list');
      end();
      expect(shape.current()).toBeNull();
    });
  });

  describe('the session', () => {
    it('shows no shape while signed out, and none after a sign-out from another tab and a sign-in', () => {
      const shape = create();
      shape.record('nextStep');
      signedIn.set(false);
      expect(shape.current()).toBeNull();
      signedInByCheck.next();
      signedIn.set(true);
      expect(shape.current()).toBeNull();
    });

    it('shows no shape once authEpoch has advanced past the one it was recorded in', () => {
      const shape = create();
      shape.record('nextStep');
      authEpoch.set(1);
      expect(shape.current()).toBeNull();
    });

    it('shows a shape recorded after authEpoch advanced', () => {
      const shape = create();
      authEpoch.set(1);
      shape.record('list');
      expect(shape.current()).toBe('list');
    });

    it('drops the shape when a check signs this tab in from signed out', () => {
      const shape = create();
      shape.record('nextStep');
      signedInByCheck.next();
      expect(shape.current()).toBeNull();
    });

    it('keeps the shape through a sign-in that changes no account, as a sign-up records it', () => {
      const shape = create(false);
      signedIn.set(true);
      shape.record('new');
      expect(shape.current()).toBe('new');
    });

    it('ignores a shape recorded while signed out, so the next account never gets the old one', () => {
      const shape = create();
      signedIn.set(false);
      shape.record('nextStep');
      signedIn.set(true);
      expect(shape.current()).toBeNull();
    });
  });
});
