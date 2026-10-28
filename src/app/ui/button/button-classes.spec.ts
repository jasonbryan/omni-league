import { OUTLINE_BUTTON_LARGE, PRIMARY_BUTTON_LARGE } from './button-classes';
import { buttonVariants } from './hlm-button';

describe('the large primary button class', () => {
  it('is the helm button output at the 44px size', () => {
    expect(PRIMARY_BUTTON_LARGE.split(' ').sort()).toEqual(
      buttonVariants({ size: 'lg' }).split(' ').sort(),
    );
  });
});

describe('the large outline button class', () => {
  it('is the helm outline button output at the 44px size', () => {
    expect(OUTLINE_BUTTON_LARGE.split(' ').sort()).toEqual(
      buttonVariants({ variant: 'outline', size: 'lg' }).split(' ').sort(),
    );
  });
});
