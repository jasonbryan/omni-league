import { registerTrainingPath } from './register-training-path';

describe('registerTrainingPath', () => {
  it('is the signed-in route of the training program', () => {
    expect(registerTrainingPath('gulf-coast-sport-social', 'tuesday-serving-clinic')).toBe(
      '/app/organizations/gulf-coast-sport-social/training/tuesday-serving-clinic/register',
    );
  });

  it('encodes what it is given', () => {
    expect(registerTrainingPath('org', 'a&b')).toBe(
      '/app/organizations/org/training/a%26b/register',
    );
  });
});
