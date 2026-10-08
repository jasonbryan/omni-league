import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The product name is "Omni League" (two words) in every user-visible place (owner, #10).
describe('src/index.html', () => {
  it('sets the document title to "Omni League"', () => {
    const html = readFileSync(join(process.cwd(), 'src/index.html'), 'utf8');
    const doc = new DOMParser().parseFromString(html, 'text/html');

    expect(doc.title).toBe('Omni League');
  });
});
