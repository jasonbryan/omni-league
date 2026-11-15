import { trainingPath } from './training-path';

describe('trainingPath', () => {
  it('is the training program’s management page under the organization', () => {
    expect(trainingPath('gulf-coast', 'tuesday-serving-clinic')).toBe(
      '/app/organizations/gulf-coast/training/tuesday-serving-clinic',
    );
  });

  it('encodes a slug, so it cannot add a segment, a query string, or a fragment', () => {
    expect(trainingPath('gulf-coast', 'a/b?c#d')).toBe(
      '/app/organizations/gulf-coast/training/a%2Fb%3Fc%23d',
    );
  });
});
