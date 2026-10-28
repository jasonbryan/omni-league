import { OUTLINE_BUTTON_LARGE, PRIMARY_BUTTON_LARGE, SEARCH_BUTTON } from './button-classes';
import { buttonVariants } from './hlm-button';

const tokensOnlyIn = (classes: string, other: string) => {
  const otherTokens = other.split(' ');
  return classes
    .split(' ')
    .filter((token) => !otherTokens.includes(token))
    .sort();
};

describe('the large primary button class', () => {
  it('is the helm button output at the 44px size', () => {
    expect(PRIMARY_BUTTON_LARGE.split(' ').sort()).toEqual(
      buttonVariants({ size: 'lg' }).split(' ').sort(),
    );
  });
});

describe('the search button class', () => {
  const helm = buttonVariants({ size: 'lg' });

  it('adds to the helm large button only the pill shape, the 48px height, and the hover and press', () => {
    expect(tokensOnlyIn(SEARCH_BUTTON, helm)).toEqual([
      'active:translate-y-px',
      'h-12',
      'hover:bg-primary/90',
      'rounded-full',
    ]);
  });

  it('keeps the helm primary colours, layout, and icon rules', () => {
    const helmTokens = helm.split(' ');
    const kept = SEARCH_BUTTON.split(' ').filter((token) => helmTokens.includes(token));
    expect(kept).toEqual(
      expect.arrayContaining([
        'bg-primary',
        'text-primary-foreground',
        'border-transparent',
        'group/button',
        'inline-flex',
        'px-5',
        '[&_ng-icon]:shrink-0',
      ]),
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
