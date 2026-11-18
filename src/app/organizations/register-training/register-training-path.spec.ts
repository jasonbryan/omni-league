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

  it('names a class in the query, which the register page reads', () => {
    expect(registerTrainingPath('org', 'clinic', 'class_2')).toBe(
      '/app/organizations/org/training/clinic/register?class=class_2',
    );
  });

  it('encodes the class it is given', () => {
    expect(registerTrainingPath('org', 'clinic', 'a&b')).toBe(
      '/app/organizations/org/training/clinic/register?class=a%26b',
    );
  });
});
