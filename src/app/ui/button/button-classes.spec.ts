import { PRIMARY_BUTTON_LARGE } from './button-classes';
import { buttonVariants } from './hlm-button';

describe('the large primary button class', () => {
  it('is the helm button output at the 44px size', () => {
    expect(PRIMARY_BUTTON_LARGE.split(' ').sort()).toEqual(
      buttonVariants({ size: 'lg' }).split(' ').sort(),
    );
  });
});
