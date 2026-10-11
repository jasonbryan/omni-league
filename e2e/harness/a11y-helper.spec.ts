// Self-tests of the axe helper's checks (#13): reflow (1.4.10) and the Tab walk (2.1.2, 2.4.3,
// 2.4.7, 2.4.11), on fixture pages loaded with page.setContent.
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
  // two frames after the resize is measured settled (#63). The waiting must not hide an overflow.
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
