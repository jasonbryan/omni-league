import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../core/auth/auth.service';
import { ChangesInFlight } from '../core/changes-in-flight';
import { HomeShape } from './home-shape';

describe('HomeShape', () => {
  const signedIn = signal(true);
  const authEpoch = signal(0);

  function create() {
    signedIn.set(true);
    authEpoch.set(0);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthService,
          useValue: { signedIn: signedIn.asReadonly(), authEpoch: authEpoch.asReadonly() },
        },
      ],
    });
    const shape = TestBed.inject(HomeShape);
    TestBed.tick();
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
    it('drops the shape when the user is signed out', () => {
      const shape = create();
      shape.record('nextStep');
      signedIn.set(false);
      TestBed.tick();
      expect(shape.current()).toBeNull();
    });

    it('drops the shape when authEpoch advances', () => {
      const shape = create();
      shape.record('nextStep');
      authEpoch.set(1);
      TestBed.tick();
      expect(shape.current()).toBeNull();
    });

    it('keeps the shape through a sign-in that leaves authEpoch alone, as a sign-up records it', () => {
      signedIn.set(false);
      authEpoch.set(0);
      TestBed.configureTestingModule({
        providers: [
          {
            provide: AuthService,
            useValue: { signedIn: signedIn.asReadonly(), authEpoch: authEpoch.asReadonly() },
          },
        ],
      });
      const shape = TestBed.inject(HomeShape);
      TestBed.tick();
      signedIn.set(true);
      shape.record('new');
      TestBed.tick();
      expect(shape.current()).toBe('new');
    });

    it('ignores a shape recorded while signed out, so the next account never gets the old one', () => {
      const shape = create();
      signedIn.set(false);
      shape.record('nextStep');
      expect(shape.current()).toBeNull();
      signedIn.set(true);
      TestBed.tick();
      expect(shape.current()).toBeNull();
    });
  });
});
