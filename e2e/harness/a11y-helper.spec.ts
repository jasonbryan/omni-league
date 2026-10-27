import { axeScan, checkReflow, expectAccessible, tabWalk } from '../support/a11y';
import { expect, test } from '../support/fixtures';

const fixture = (body: string, head = ''): string =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  `<title>Fixture</title>${head}</head><body><main>${body}</main></body></html>`;

test.describe('axe helper checks', () => {
  test('a clean page passes axe, the Tab walk, and reflow', async ({ page }) => {
    await page.setContent(
      fixture('<h1>Clean</h1><a href="#x">Link</a> <button type="button">Button</button>'),
    );
    await expectAccessible(page);
  });

  test('axe names the rule for an img without alt', async ({ page }) => {
    await page.setContent(
      fixture('<h1>Image</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">'),
    );
    const results = await axeScan(page);
    expect(results.violations.map((v) => v.id)).toContain('image-alt');
  });

  test('1.4.10: a 400px-wide block fails reflow at 320px', async ({ page }) => {
    await page.setContent(fixture('<h1>Wide</h1><div style="width:400px;height:10px"></div>'));
    const before = page.viewportSize();
    const reflow = await checkReflow(page);
    expect(reflow).toMatchObject({ width: 320, clientWidth: 320, passed: false });
    expect(reflow.scrollWidth).toBeGreaterThanOrEqual(400);
    expect(page.viewportSize()).toEqual(before);
  });

  // `checkReflow` waits for running animations to finish, so a control that is still transitioning
  // two frames after the resize is measured settled. The waiting must not hide an overflow.
  const slowShrink =
    '<style>.t{width:600px;height:10px;transition:width 600ms linear}' +
    '@media (max-width:400px){.t{width:100px}}</style>';

  test('1.4.10: a transition that settles inside 320px passes, measured after it ends', async ({
    page,
  }) => {
    await page.setContent(fixture('<h1>Shrinking</h1><div class="t"></div>', slowShrink));
    const reflow = await checkReflow(page);
    expect(reflow).toMatchObject({ width: 320, clientWidth: 320, passed: true });
  });

  test('1.4.10: a transition that settles wider than 320px still fails', async ({ page }) => {
    await page.setContent(
      fixture(
        '<h1>Growing</h1><div class="t"></div>',
        '<style>.t{width:100px;height:10px;transition:width 600ms linear}' +
          '@media (max-width:400px){.t{width:700px}}</style>',
      ),
    );
    const reflow = await checkReflow(page);
    expect(reflow).toMatchObject({ width: 320, clientWidth: 320, passed: false });
    expect(reflow.scrollWidth).toBeGreaterThanOrEqual(700);
  });

  test('1.4.10: an infinite animation (animate-pulse, animate-spin) does not hang reflow or expectAccessible', async ({
    page,
  }) => {
    test.setTimeout(15_000);
    await page.setContent(
      fixture(
        '<h1>Pulse</h1><div class="pulse" style="width:100px;height:10px;background:#444"></div>' +
          '<p>Loading the list.</p>',
        '<style>@keyframes pulse{50%{opacity:.5}}.pulse{animation:pulse 2s cubic-bezier(.4,0,.6,1) infinite}</style>',
      ),
    );
    expect(await page.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0);
    expect(await checkReflow(page)).toMatchObject({ width: 320, passed: true });
    await expectAccessible(page);
  });

  test('1.4.10: a real overflow still fails while an infinite animation runs beside it', async ({
    page,
  }) => {
    test.setTimeout(15_000);
    await page.setContent(
      fixture(
        '<h1>Growing and pulsing</h1><div class="pulse" style="width:100px;height:10px;background:#444"></div>' +
          '<div class="t"></div>',
        '<style>@keyframes pulse{50%{opacity:.5}}.pulse{animation:pulse 2s linear infinite}' +
          '.t{width:100px;height:10px;transition:width 600ms linear}' +
          '@media (max-width:400px){.t{width:700px}}</style>',
      ),
    );
    const reflow = await checkReflow(page);
    expect(reflow).toMatchObject({ width: 320, clientWidth: 320, passed: false });
    expect(reflow.scrollWidth).toBeGreaterThanOrEqual(700);
  });

  test('2.4.7: outline: none with no other focus style fails', async ({ page }) => {
    await page.setContent(
      fixture('<h1>Outline</h1><button type="button" style="outline:none">No ring</button>'),
    );
    const walk = await tabWalk(page);
    expect(walk.failures).toEqual([
      expect.stringMatching(/^2\.4\.7 Focus visible: button "No ring"/),
    ]);
  });

  test('2.4.7: a box-shadow focus style instead of an outline passes', async ({ page }) => {
    await page.setContent(
      fixture(
        '<h1>Shadow</h1><button type="button" class="b">Shadow ring</button>',
        // WebKit drops box-shadow on natively styled buttons, so the fixture opts out of it.
        '<style>.b{appearance:none;border:1px solid #333;background:#fff;color:#000;outline:none}' +
          '.b:focus-visible{box-shadow:0 0 0 3px #1a56db}</style>',
      ),
    );
    expect((await tabWalk(page)).failures).toEqual([]);
  });

  test('2.4.11: a sticky element covering the focused control fails', async ({ page }) => {
    await page.setContent(
      fixture(
        '<div style="position:sticky;top:0;height:60px;background:#fff;z-index:1">Banner</div>' +
          '<button type="button" style="position:relative;top:-50px">Covered</button>',
      ),
    );
    const walk = await tabWalk(page);
    expect(walk.failures).toEqual([
      expect.stringMatching(
        /^2\.4\.11 Focus not obscured: button "Covered" is covered by div "Banner"/,
      ),
    ]);
  });

  const hiddenRadioChip =
    '<label style="position:relative;display:inline-flex">' +
    '<input type="radio" name="g" style="position:absolute;width:1px;height:1px;margin:-1px;' +
    'padding:0;border:0;overflow:hidden;clip:rect(0,0,0,0)">' +
    '<span style="display:inline-flex;height:36px;padding:0 16px;border:1px solid #000">Chip</span>' +
    '</label>';

  test('2.4.11: a visually hidden radio drawn by its own label is not obscured by that label', async ({
    page,
  }) => {
    await page.setContent(fixture(hiddenRadioChip));
    expect((await tabWalk(page)).failures).toEqual([]);
  });

  test('2.4.11: a sticky element covering a visually hidden radio and its label fails', async ({
    page,
  }) => {
    await page.setContent(
      fixture(
        '<div style="position:sticky;top:0;height:60px;background:#fff;z-index:1">Banner</div>' +
          `<div style="position:relative;top:-50px">${hiddenRadioChip}</div>`,
      ),
    );
    const walk = await tabWalk(page);
    expect(walk.failures).toEqual([
      expect.stringMatching(/^2\.4\.11 Focus not obscured: input .* is covered by div "Banner"/),
    ]);
  });

  test('2.4.11: a visually hidden radio whose chip another chip covers fails', async ({ page }) => {
    const chip = (name: string, label: string) =>
      '<label style="position:relative;display:inline-flex;width:80px;height:36px;background:#eee">' +
      `<input type="radio" name="${name}" style="position:absolute;width:1px;height:1px;margin:-1px;` +
      'padding:0;border:0;overflow:hidden;clip:rect(0,0,0,0)">' +
      `<span>${label}</span></label>`;
    await page.setContent(
      fixture(
        `<div style="display:flex">${chip('a', 'First')}</div>` +
          `<div style="position:relative;top:-36px;display:flex">${chip('b', 'Second')}</div>`,
      ),
    );
    const walk = await tabWalk(page);
    expect(walk.failures).toEqual([
      expect.stringMatching(/^2\.4\.11 Focus not obscured: input .* is covered by span "Second"/),
    ]);
  });

  test('2.4.11: an inline link that wraps over lines is not obscured by the text around it', async ({
    page,
  }) => {
    // The link's bounding box is the union of its line boxes, so its centre can fall in the gap
    // beside the shorter line, on the paragraph. The link is visible on every line.
    await page.setContent(
      fixture(
        '<p id="p" style="width:200px;font:16px/24px sans-serif;margin:0">' +
          '<span style="display:inline-block;width:120px"></span>' +
          '<a href="#x">Publish<br>league</a>, then come back.</p>',
      ),
    );
    const lines = await page.evaluate(() => document.querySelector('a')!.getClientRects().length);
    expect(lines).toBeGreaterThan(1);
    const centreOnParagraph = await page.evaluate(() => {
      const box = document.querySelector('a')!.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit?.id === 'p';
    });
    expect(centreOnParagraph).toBe(true);
    expect((await tabWalk(page)).failures).toEqual([]);
  });

  // A wrapped link is partly obscured when a fixed banner covers one of its lines, which WCAG
  // 2.4.11 (AA) allows; it fails only when no part of it is visible.
  const wrappedLink = (bannerHeight: number): string =>
    fixture(
      `<div style="position:fixed;top:0;left:0;right:0;height:${bannerHeight}px;background:#fff;z-index:1">Banner</div>` +
        '<p style="width:90px;font:16px/24px sans-serif;margin:0">' +
        '<a href="#x">Publish league</a>, then come back.</p>',
      '<style>body{margin:0}</style>',
    );

  test('2.4.11: a wrapped link with one line under a banner and the other visible passes', async ({
    page,
  }) => {
    await page.setContent(wrappedLink(30));
    expect(await page.evaluate(() => document.querySelector('a')!.getClientRects().length)).toBe(2);
    const covered = await page.evaluate(() => {
      const box = document.querySelector('a')!.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.tagName;
    });
    expect(covered).toBe('DIV');
    expect((await tabWalk(page)).failures).toEqual([]);
  });

  test('2.4.11: a wrapped link with every line under a banner fails', async ({ page }) => {
    await page.setContent(wrappedLink(60));
    expect(await page.evaluate(() => document.querySelector('a')!.getClientRects().length)).toBe(2);
    const walk = await tabWalk(page);
    expect(walk.failures).toEqual([
      expect.stringMatching(
        /^2\.4\.11 Focus not obscured: a "Publish league" is covered by div "Banner"/,
      ),
    ]);
  });

  test('2.1.2: a Tab keydown handler that calls preventDefault fails the trap check', async ({
    page,
  }) => {
    await page.setContent(
      fixture(
        '<h1>Trap</h1><button type="button">One</button><button type="button">Two</button>' +
          "<script>document.addEventListener('keydown', (e) => { if (e.key === 'Tab') e.preventDefault(); });</script>",
      ),
    );
    const walk = await tabWalk(page);
    expect(walk.failures).toEqual([expect.stringMatching(/^2\.1\.2 No keyboard trap: /)]);
  });

  test('2.1.2: a native date field takes one Tab press per segment and is not a trap', async ({
    page,
  }) => {
    await page.setContent(
      fixture(
        '<h1>Dates</h1><label for="d">Start</label><input id="d" type="date">' +
          '<button type="button">After</button>',
      ),
    );
    const walk = await tabWalk(page);
    expect(walk.failures).toEqual([]);
    expect(walk.order).toEqual(['input#d ""', 'button "After"']);
  });

  // The date-field allowance must not hide a real trap: each fixture traps focus next to a date
  // field or on it.
  const TRAP = /^2\.1\.2 No keyboard trap: /;
  const dateAndTrap = (trapScript: string, extra = ''): string =>
    fixture(
      '<h1>Dates and a trap</h1><label for="d">Start</label><input id="d" type="date">' +
        `${extra}<button type="button" id="after">After</button><button type="button">Last</button>` +
        `<script>${trapScript}</script>`,
    );

  test('2.1.2: a button that keeps focus on Tab, right after a date field, is still a trap', async ({
    page,
  }) => {
    await page.setContent(
      dateAndTrap(
        "document.getElementById('after').addEventListener('keydown', (e) => { if (e.key === 'Tab') e.preventDefault(); });",
      ),
    );
    const walk = await tabWalk(page);
    expect(walk.failures).toEqual([expect.stringMatching(TRAP)]);
  });

  test('2.1.2: a date field that keeps focus on Tab is still a trap', async ({ page }) => {
    await page.setContent(
      dateAndTrap(
        "document.getElementById('d').addEventListener('keydown', (e) => { if (e.key === 'Tab') e.preventDefault(); });",
      ),
    );
    const walk = await tabWalk(page);
    expect(walk.failures).toEqual([expect.stringMatching(TRAP)]);
  });

  test('2.1.2: a date field that takes focus back on blur is still a trap', async ({ page }) => {
    await page.setContent(
      dateAndTrap(
        "const d = document.getElementById('d'); d.addEventListener('blur', () => setTimeout(() => d.focus(), 0));",
      ),
    );
    const walk = await tabWalk(page);
    expect(walk.failures).toEqual([expect.stringMatching(TRAP)]);
  });

  test('2.1.2: two buttons that pass focus back and forth, on a page with a date field, are still a trap', async ({
    page,
  }) => {
    await page.setContent(
      fixture(
        '<h1>Ping-pong</h1><input id="d" type="date" aria-label="Start">' +
          '<button type="button" id="a">A</button><button type="button" id="b">B</button>' +
          '<script>' +
          "const a = document.getElementById('a'), b = document.getElementById('b');" +
          "b.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); a.focus(); } });" +
          '</script>',
      ),
    );
    const walk = await tabWalk(page);
    expect(walk.failures).toEqual([expect.stringMatching(TRAP)]);
  });

  test('2.1.2: a trap on a button before the date field is still a trap', async ({ page }) => {
    await page.setContent(
      fixture(
        '<h1>Trap first</h1><button type="button" id="t">Trap</button>' +
          '<input id="d" type="date" aria-label="Start"><button type="button">After</button>' +
          "<script>document.getElementById('t').addEventListener('keydown', (e) => { if (e.key === 'Tab') e.preventDefault(); });</script>",
      ),
    );
    const walk = await tabWalk(page);
    expect(walk.failures).toEqual([expect.stringMatching(TRAP)]);
  });

  test('2.1.2: three date fields in a row, with no trap, still pass', async ({ page }) => {
    await page.setContent(
      fixture(
        '<h1>Dates</h1><input id="a" type="date" aria-label="A"><input id="b" type="date" aria-label="B">' +
          '<input id="c" type="date" aria-label="C"><button type="button">After</button>',
      ),
    );
    const walk = await tabWalk(page);
    expect(walk.failures).toEqual([]);
    expect(walk.order).toEqual(['input#a "A"', 'input#b "B"', 'input#c "C"', 'button "After"']);
  });

  test('2.4.3: an order different from the expected order fails; the matching order passes', async ({
    page,
  }) => {
    await page.setContent(
      fixture(
        '<h1>Order</h1><button type="button" id="a">A</button><button type="button" id="b">B</button>' +
          '<button type="button" id="c">C</button>',
      ),
    );
    const mismatch = await tabWalk(page, { expectedOrder: ['#b', '#a', '#c'] });
    expect(mismatch.failures).toEqual([
      expect.stringMatching(/^2\.4\.3 Focus order: .*\(expected order\)/),
    ]);
    const match = await tabWalk(page, { expectedOrder: ['#a', '#b', '#c'] });
    expect(match).toEqual({
      order: ['button#a "A"', 'button#b "B"', 'button#c "C"'],
      failures: [],
    });
  });

  test('2.4.3: tabindex="1" on the second button fails in DOM-order mode', async ({ page }) => {
    await page.setContent(
      fixture(
        '<h1>Tabindex</h1><button type="button" id="first">First</button>' +
          '<button type="button" id="second" tabindex="1">Second</button>',
      ),
    );
    const walk = await tabWalk(page);
    expect(walk.order).toEqual(['button#second "Second"', 'button#first "First"']);
    expect(walk.failures).toEqual([expect.stringMatching(/^2\.4\.3 Focus order: .*\(DOM order\)/)]);
  });

  test('2.4.3: tabindex 0 or absent passes in DOM-order mode', async ({ page }) => {
    await page.setContent(
      fixture(
        '<h1>Tabindex</h1><button type="button" id="first">First</button>' +
          '<button type="button" id="second" tabindex="0">Second</button>' +
          '<div id="third" tabindex="0" style="outline:none" class="f">Third</div>' +
          '<button type="button" tabindex="-1">Skipped</button><button type="button" disabled>Off</button>' +
          '<div inert><button type="button">Inert</button></div><button type="button" hidden>Hidden</button>',
        '<style>.f:focus-visible{box-shadow:0 0 0 2px #000}</style>',
      ),
    );
    const walk = await tabWalk(page);
    expect(walk).toEqual({
      order: ['button#first "First"', 'button#second "Second"', 'div#third "Third"'],
      failures: [],
    });
  });

  test('a page with no focusable elements passes reflow and the Tab walk', async ({ page }) => {
    await page.setContent(fixture('<h1>Nothing to focus</h1><p>Text only.</p>'));
    expect(await tabWalk(page)).toEqual({ order: [], failures: [] });
    expect((await checkReflow(page)).passed).toBe(true);
  });
});
