import { readFileSync } from 'node:fs';

const KIT_BLOCK = /<style id="mockup-kit">([\s\S]*?)<\/style>/;

/** Empty rather than a throw when the page has no kit block, so the caller's assertion names the page. */
export function inlinedKitCss(page: string): string {
  return KIT_BLOCK.exec(readFileSync(page, 'utf8'))?.[1] ?? '';
}
