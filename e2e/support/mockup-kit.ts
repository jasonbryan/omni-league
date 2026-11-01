import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A mockup whose inlined kit is the app's compiled CSS: tokens, base.css, and the classes in src/app. */
export const KIT_MOCKUP = join(
  process.cwd(),
  'design',
  'mockups',
  '300-public-site-league-form.html',
);
const KIT_BLOCK = /<style id="mockup-kit">([\s\S]*?)<\/style>/;

/** Empty when the mockup has no inlined kit (`npm run design:css` writes it). */
export const MOCKUP_KIT_CSS = KIT_BLOCK.exec(readFileSync(KIT_MOCKUP, 'utf8'))?.[1] ?? '';
