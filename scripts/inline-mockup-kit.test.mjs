// Unit tests for scripts/inline-mockup-kit.mjs (#58). Run with `npm run test:scripts` (node:test).
// They use the committed fixture in scripts/fixtures/mockup-kit/ and need no Angular build.
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check } from 'prettier';
import { inlineKitIntoFile, inlineKitIntoHtml, inlineFonts } from './inline-mockup-kit.mjs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mockup-kit');
const kitCss = join(fixtures, 'kit.css');

async function withTempPage(run) {
  const dir = await mkdtemp(join(tmpdir(), 'mockup-kit-'));
  try {
    const page = join(dir, 'page.html');
    await cp(join(fixtures, 'page.html'), page);
    return await run(page);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('inlineKitIntoFile on the committed fixture', () => {
  it('adds a <style id="mockup-kit"> block preceded by <!-- prettier-ignore -->', async () => {
    await withTempPage(async (page) => {
      await inlineKitIntoFile(page, kitCss);
      const html = await readFile(page, 'utf8');
      assert.equal(html.match(/<style id="mockup-kit">/g)?.length, 1);
      assert.match(html, /<!-- prettier-ignore -->\n\s*<style id="mockup-kit">/);
      assert.match(html, /\.fixture-only-class\s*\{/);
      assert.ok(html.indexOf('<style id="mockup-kit">') < html.indexOf('</head>'));
    });
  });

  it('rewrites every font url(...) as a data: URI and leaves no file reference', async () => {
    await withTempPage(async (page) => {
      await inlineKitIntoFile(page, kitCss);
      const html = await readFile(page, 'utf8');
      const urls = [...html.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1].replace(/['"]/g, ''));
      assert.ok(urls.length > 0, 'the block keeps a font url(...)');
      for (const url of urls) assert.match(url, /^data:font\/woff2;base64,/);
      const latin = Buffer.from('fixture latin font bytes, not a real font\n').toString('base64');
      assert.ok(html.includes(latin), 'the Latin font bytes are embedded');
      assert.ok(!html.includes('./media/'));
    });
  });

  it('drops @font-face rules for non-Latin subsets, so the file stays small', async () => {
    await withTempPage(async (page) => {
      await inlineKitIntoFile(page, kitCss);
      const html = await readFile(page, 'utf8');
      const cyrillic = Buffer.from('fixture cyrillic font bytes, not a real font\n').toString(
        'base64',
      );
      assert.ok(!html.includes(cyrillic));
      assert.ok(!html.includes('U+0400-045F'));
      assert.equal(html.match(/@font-face/g)?.length, 1);
    });
  });

  it('leaves the file byte-identical on a second run', async () => {
    await withTempPage(async (page) => {
      await inlineKitIntoFile(page, kitCss);
      const first = await readFile(page);
      await inlineKitIntoFile(page, kitCss);
      const second = await readFile(page);
      assert.ok(first.equals(second));
    });
  });

  it('replaces the block, not duplicates it, when the kit CSS changed', async () => {
    await withTempPage(async (page) => {
      await inlineKitIntoFile(page, kitCss);
      const changed = join(dirname(page), 'kit.css');
      await cp(join(fixtures, 'media'), join(dirname(page), 'media'), { recursive: true });
      const css = await readFile(kitCss, 'utf8');
      await writeFile(changed, css.replace('#123456', '#654321'));
      await inlineKitIntoFile(page, changed);
      const html = await readFile(page, 'utf8');
      assert.equal(html.match(/<style id="mockup-kit">/g)?.length, 1);
      assert.equal(html.match(/<!-- prettier-ignore -->/g)?.length, 1);
      assert.ok(html.includes('#654321'));
      assert.ok(!html.includes('#123456'));
    });
  });

  it('produces a file Prettier leaves unchanged (format:check)', async () => {
    await withTempPage(async (page) => {
      await inlineKitIntoFile(page, kitCss);
      const html = await readFile(page, 'utf8');
      assert.equal(await check(html, { parser: 'html', printWidth: 100, singleQuote: true }), true);
    });
  });
});

describe('inlineFonts', () => {
  it('keeps data: URIs as they are', () => {
    const css = '@font-face{src:url(data:font/woff2;base64,AAAA) format("woff2")}';
    assert.equal(inlineFonts(css, fixtures), css);
  });

  it('refuses a remote url(...): a mockup must open offline', () => {
    assert.throws(
      () => inlineFonts('a{background:url(https://example.com/x.woff2)}', fixtures),
      /remote/i,
    );
  });

  it('names the file when a referenced font is missing', () => {
    assert.throws(() => inlineFonts('a{src:url(./media/nope.woff2)}', fixtures), /nope\.woff2/);
  });
});

describe('inlineKitIntoHtml', () => {
  it('refuses a page with no </head> to put the block in', () => {
    assert.throws(() => inlineKitIntoHtml('<p>no head</p>', 'a{}'), /<\/head>/);
  });
});
