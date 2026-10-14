import { buttonVariants, type ButtonVariants } from './hlm-button';

const VARIANTS: NonNullable<ButtonVariants['variant']>[] = [
  'default',
  'outline',
  'secondary',
  'ghost',
  'destructive',
  'link',
];

// Helm's focus halo (`ring-ring/50` at 3px) is 2.25:1 and fails WCAG 1.4.11. The base layer's solid 2px `--ring` outline (src/styles/base.css) is the focus indicator,
// so the button must not remove or recolour it.
const REMOVED = ['outline-none', 'focus-visible:border-ring', 'focus-visible:ring-ring/50'];

describe('buttonVariants', () => {
  for (const variant of VARIANTS) {
    it(`${variant}: keeps the base layer's focus outline and has no focus halo`, () => {
      const classes = buttonVariants({ variant }).split(/\s+/);
      for (const removed of REMOVED) expect(classes).not.toContain(removed);
      expect(classes).not.toContain('focus-visible:ring-3');
    });
  }

  it('default: hovers a link-styled button to primary at 90%, not 80%', () => {
    const classes = buttonVariants({ variant: 'default' }).split(/\s+/);
    expect(classes).toContain('[a]:hover:bg-primary/90');
    expect(classes).not.toContain('[a]:hover:bg-primary/80');
    expect(classes.filter((name) => name.endsWith('/80'))).toEqual([]);
  });
});
