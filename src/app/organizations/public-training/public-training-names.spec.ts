import { publicTrainingNames, readPublicTrainingNames } from './public-training-names';

const ROUTE = { orgSlug: 'acme', trainingSlug: 'clinic' };
const NAMED = {
  organization: { slug: 'acme', name: 'Acme' },
  training: { slug: 'clinic', name: 'Serving Clinic' },
};

describe('publicTrainingNames', () => {
  it('keeps only the slug and the name of each', () => {
    expect(
      publicTrainingNames({
        organization: { slug: 'acme', name: 'Acme', extra: 1 } as never,
        training: { slug: 'clinic', name: 'Serving Clinic', coachName: 'Dana' } as never,
      }),
    ).toEqual(NAMED);
  });
});

describe('readPublicTrainingNames', () => {
  it('reads the names a link carried when the slugs are the route’s', () => {
    expect(readPublicTrainingNames(NAMED, ROUTE)).toEqual(NAMED);
  });

  it.each([
    ['no state', undefined],
    ['null', null],
    ['a string', 'x'],
    ['no organization', { training: NAMED.training }],
    ['no training', { organization: NAMED.organization }],
    ['an empty name', { ...NAMED, training: { slug: 'clinic', name: '' } }],
    ['a number for a slug', { ...NAMED, organization: { slug: 1, name: 'Acme' } }],
    ['another organization', { ...NAMED, organization: { slug: 'other', name: 'Other' } }],
    ['another training program', { ...NAMED, training: { slug: 'other', name: 'Other' } }],
  ])('falls back to the plain skeleton for %s', (_, state) => {
    expect(readPublicTrainingNames(state, ROUTE)).toBeUndefined();
  });
});
