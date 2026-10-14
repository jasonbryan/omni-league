import { SERVICE_WORKER_BUILD, serviceWorkerRegistration } from './service-worker-build';

describe('serviceWorkerRegistration', () => {
  it('registers in a production build with the serviceWorker option, 30 s after the app is stable', () => {
    expect(serviceWorkerRegistration(true, false)).toEqual({
      enabled: true,
      registrationStrategy: 'registerWhenStable:30000',
    });
  });

  it('registers nothing in a production build without the option (the kill switch)', () => {
    expect(serviceWorkerRegistration(false, false).enabled).toBe(false);
  });

  it('registers nothing in a development build, with or without the option', () => {
    expect(serviceWorkerRegistration(true, true).enabled).toBe(false);
    expect(serviceWorkerRegistration(false, true).enabled).toBe(false);
  });
});

describe('SERVICE_WORKER_BUILD', () => {
  it('is false where the define is absent (unit tests)', () => {
    expect(SERVICE_WORKER_BUILD).toBe(false);
  });
});
