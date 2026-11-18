import { publicTrainingPath } from './public-training-path';

describe('publicTrainingPath', () => {
  it('builds the path from the slugs', () => {
    expect(publicTrainingPath('gulf-coast', 'tuesday-serving-clinic')).toBe(
      '/organizations/gulf-coast/training/tuesday-serving-clinic',
    );
  });

  it('encodes a slug that is not path-safe, never copying the current URL', () => {
    expect(publicTrainingPath('acme', 'a/b?c#d')).toBe(
      '/organizations/acme/training/a%2Fb%3Fc%23d',
    );
  });
});
