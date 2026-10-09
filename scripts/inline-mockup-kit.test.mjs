// Unit tests for scripts/inline-mockup-kit.mjs (#58). Run with `npm run test:scripts` (node:test).
// They use the committed fixture in scripts/fixtures/mockup-kit/ and need no Angular build.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import { check } from 'prettier';
import {
  KIT_SOURCES,
  inlineFonts,
  inlineKitIntoFile,
  inlineKitIntoHtml,
  main,
  prepareKitSources,
  stripKitFromHtml,
} from './inline-mockup-kit.mjs';

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

describe('stripKitFromHtml', () => {
  it('removes the block and its <!-- prettier-ignore --> line, and nothing else', () => {
    const page = '<html>\n  <head>\n    <title>x</title>\n  </head>\n</html>\n';
    const withKit = inlineKitIntoHtml(page, '.leading-tight{line-height:1.25}');
    assert.notEqual(withKit, page);
    assert.equal(stripKitFromHtml(withKit), page);
  });

  it('leaves a page without a block unchanged', () => {
    assert.equal(stripKitFromHtml('<p>hi</p>'), '<p>hi</p>');
  });
});

// The build itself is `ng build`; here the same Tailwind engine (@tailwindcss/postcss, as in the
// Angular build) runs on a stand-in entry, which is fast enough for `ci`. The full two-run proof with
// the real build is recorded in the PR evidence for #58.
describe('the kit build reads mockups without their own earlier kit block', () => {
  const entryFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'design', 'kit-test.css');

  async function buildKitCss(sourceDir) {
    const entry = `@import 'tailwindcss' source(none);\n@source '${sourceDir}';\n`;
    const result = await postcss([tailwindcss()]).process(entry, { from: entryFile });
    return result.css;
  }

  /** One `npm run design:css` pass, with Tailwind standing in for `ng build`. */
  async function designCss(mockupsDir, sourcesDir, pages) {
    await prepareKitSources(mockupsDir, sourcesDir);
    const css = await buildKitCss(sourcesDir);
    for (const page of pages) {
      const before = await readFile(page, 'utf8');
      await writeFile(page, inlineKitIntoHtml(before, css));
    }
  }

  async function withMockups(run) {
    const dir = await mkdtemp(join(tmpdir(), 'mockup-kit-build-'));
    try {
      const mockups = join(dir, 'mockups');
      await mkdir(join(mockups, 'nested'), { recursive: true });
      const page = join(mockups, 'page.html');
      const nested = join(mockups, 'nested', 'other.html');
      const html = (classes) =>
        `<html>\n  <head>\n    <title>x</title>\n  </head>\n  <body>\n    <p class="${classes}">x</p>\n  </body>\n</html>\n`;
      await writeFile(page, html('leading-tight table'));
      await writeFile(nested, html('shimmer-never-defined bg-destructive'));
      return await run({ mockups, sources: join(dir, 'sources'), page, nested, html });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('copies every mockup, nested ones included, with the block removed', async () => {
    await withMockups(async ({ mockups, sources, page, nested }) => {
      await designCss(mockups, sources, [page, nested]);
      assert.match(await readFile(page, 'utf8'), /<style id="mockup-kit">/);
      assert.equal(await prepareKitSources(mockups, sources), 2);
      for (const file of ['page.html', join('nested', 'other.html')]) {
        assert.ok(!(await readFile(join(sources, file), 'utf8')).includes('mockup-kit'));
      }
    });
  });

  it('a second full run leaves every mockup byte-identical', async () => {
    await withMockups(async ({ mockups, sources, page, nested }) => {
      await designCss(mockups, sources, [page, nested]);
      const first = [await readFile(page), await readFile(nested)];
      assert.match(first[0].toString(), /\.leading-tight\s*\{/);
      await designCss(mockups, sources, [page, nested]);
      await designCss(mockups, sources, [page, nested]);
      assert.ok((await readFile(page)).equals(first[0]));
      assert.ok((await readFile(nested)).equals(first[1]));
    });
  });

  it('a class removed from a mockup disappears from its block on the next run', async () => {
    await withMockups(async ({ mockups, sources, page, nested, html }) => {
      await designCss(mockups, sources, [page, nested]);
      assert.match(await readFile(page, 'utf8'), /\.leading-tight\s*\{/);
      await writeFile(page, html('table'));
      await designCss(mockups, sources, [page, nested]);
      const after = await readFile(page, 'utf8');
      assert.doesNotMatch(after, /\.leading-tight\s*\{/);
      assert.match(after, /\.table\s*\{/);
      assert.equal(after.match(/<style id="mockup-kit">/g)?.length, 1);
    });
  });

  it('scanning the mockups directly keeps the removed class (the bug this guards against)', async () => {
    await withMockups(async ({ mockups, page }) => {
      const css = await buildKitCss(mockups);
      await writeFile(page, inlineKitIntoHtml(await readFile(page, 'utf8'), css));
      const edited = (await readFile(page, 'utf8')).replace(
        'class="leading-tight table"',
        'class="table"',
      );
      await writeFile(page, edited);
      assert.match(await buildKitCss(mockups), /\.leading-tight\s*\{/);
    });
  });
});

describe('the real kit entry and the real orchestration', () => {
  const kitDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'design', 'mockup-kit');
  const mockupsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'design', 'mockups');

  it('design/mockup-kit/mockup-kit.css scans the stripped copy, never design/mockups', async () => {
    const css = await readFile(join(kitDir, 'mockup-kit.css'), 'utf8');
    const sources = [...css.matchAll(/^@source\s+['"]([^'"]+)['"]\s*;/gm)].map((m) =>
      resolve(kitDir, m[1]),
    );
    assert.ok(sources.includes(KIT_SOURCES), `no @source resolves to ${KIT_SOURCES}`);
    for (const source of sources) {
      assert.ok(
        source !== mockupsDir && !source.startsWith(`${mockupsDir}/`),
        `@source ${source} reads design/mockups, which holds the earlier kit block`,
      );
    }
  });

  async function withFixture(run) {
    const dir = await mkdtemp(join(tmpdir(), 'mockup-kit-main-'));
    try {
      const mockups = join(dir, 'mockups');
      const output = join(dir, 'out');
      await mkdir(mockups, { recursive: true });
      await mkdir(output, { recursive: true });
      await cp(join(fixtures, 'page.html'), join(mockups, 'page.html'));
      await writeFile(join(output, 'mockup-kit.css'), '.kit-built{color:red}');
      // Put an earlier kit block in the mockup, as a second run would find it.
      await main(['--skip-build'], {
        mockupsDir: mockups,
        kitOutput: output,
        kitSources: join(dir, 'sources'),
        log: () => {},
      });
      return await run({ mockups, output, sources: join(dir, 'sources') });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('main() strips the kit blocks into the scanned directory before it runs the build', async () => {
    await withFixture(async ({ mockups, output, sources }) => {
      assert.match(await readFile(join(mockups, 'page.html'), 'utf8'), /<style id="mockup-kit">/);
      let scannedAtBuild;
      const build = async () => {
        scannedAtBuild = await readFile(join(sources, 'page.html'), 'utf8').catch(() => null);
        await writeFile(join(output, 'mockup-kit.css'), '.kit-built{color:blue}');
      };
      await main([], {
        mockupsDir: mockups,
        kitOutput: output,
        kitSources: sources,
        build,
        log: () => {},
      });
      assert.ok(scannedAtBuild, 'the build ran before the scanned copy existed');
      assert.ok(!scannedAtBuild.includes('mockup-kit'), 'the scanned copy still has a kit block');
      const page = await readFile(join(mockups, 'page.html'), 'utf8');
      assert.match(page, /\.kit-built\{color:blue\}/);
    });
  });

  it('main() with --skip-build does not run the build', async () => {
    await withFixture(async ({ mockups, output, sources }) => {
      let built = false;
      const build = async () => {
        built = true;
      };
      await main(['--skip-build'], {
        mockupsDir: mockups,
        kitOutput: output,
        kitSources: sources,
        build,
        log: () => {},
      });
      assert.equal(built, false);
    });
  });
});
