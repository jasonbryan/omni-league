import { readFileSync } from 'node:fs';

const KIT_BLOCK = /<style id="mockup-kit">([\s\S]*?)<\/style>/;

/** The app's compiled CSS (tokens, base.css, the classes in src/app) inlined in a page; empty when it has none, and `npm run design:css` writes it. */
export function inlinedKitCss(page: string): string {
  return KIT_BLOCK.exec(readFileSync(page, 'utf8'))?.[1] ?? '';
}
