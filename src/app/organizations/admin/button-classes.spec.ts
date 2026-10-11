import { buttonVariants } from '../../ui/button/hlm-button';
import { DESTRUCTIVE_BUTTON, OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';

const tokens = (value: string) => value.split(' ').sort();

describe('the admin area button classes', () => {
  it('are the helm button output the mockup draws, at the 36px size', () => {
    expect(tokens(OUTLINE_BUTTON)).toEqual(
      tokens(buttonVariants({ variant: 'outline', size: 'lg' })),
    );
    expect(tokens(PRIMARY_BUTTON)).toEqual(tokens(buttonVariants({ size: 'lg' })));
    expect(tokens(DESTRUCTIVE_BUTTON)).toEqual(
      tokens(buttonVariants({ variant: 'destructive', size: 'lg' })),
    );
  });
});
