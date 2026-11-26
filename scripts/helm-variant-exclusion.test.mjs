import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readDarkExclusionInputs } from './dark-exclusion.mjs';
import { HELM_VARIANT_CLASSES, HELM_VARIANT_GROUPS } from './helm-variant-classes.mjs';
import {
  builtHelmVariantProblems,
  helmVariantClassesIn,
  helmVariantProblems,
} from './helm-variant-exclusion.mjs';

const ROOT = join(import.meta.dirname, '..');
const SHEET_CONTENT = 'src/app/ui/sheet/hlm-sheet-content.ts';
const BUTTON = 'src/app/ui/button/hlm-button.ts';

const exclusion = (...entries) =>
  `@import 'tailwindcss' source('.');\n@source not inline("${entries.join(' ')}");\n`;
const ALL_EXCLUDED = exclusion(...HELM_VARIANT_CLASSES);
const HELM_FILES = Object.fromEntries(
  HELM_VARIANT_GROUPS.map((group) => [group.helmFile, `'${group.classes.join(' ')}'`]),
);

const problems = (sources = {}, stylesCss = ALL_EXCLUDED) =>
  helmVariantProblems({ sources: { ...HELM_FILES, ...sources }, stylesCss });

const component = (template) => `@Component({ template: \`${template}\` }) export class A {}`;

describe('the helm variant exclusion in src/styles.css', () => {
  it('holds for the files on disk', async () => {
    const inputs = await readDarkExclusionInputs(ROOT);
    assert.ok(Object.keys(inputs.sources).length > 100, 'the source files were actually listed');
    assert.deepEqual(helmVariantProblems(inputs), []);
  });

  it('lists 36 classes, each named by one group', () => {
    assert.equal(HELM_VARIANT_CLASSES.size, 36);
    assert.equal(HELM_VARIANT_GROUPS.flatMap((group) => group.classes).length, 36);
  });

  it('names the file, the group, and the fix in each message', () => {
    const [found, ...rest] = problems({
      'src/app/a.ts': '<input class="aria-invalid:border-destructive">',
    });
    assert.equal(rest.length, 0);
    assert.match(found, /src\/app\/a\.ts/);
    assert.match(found, /badge as a control/);
    assert.match(found, /remove that group's classes from the exclusion/);
    assert.match(found, /src\/styles\.css/);
    assert.match(found, /scripts\/helm-variant-exclusion\.mjs/);
  });

  describe('a listed class outside its helm file', () => {
    it('fails for each of the 36 classes in a page', () => {
      for (const group of HELM_VARIANT_GROUPS) {
        for (const className of group.classes) {
          const found = problems({ 'src/app/a.ts': `const c = "flex ${className} p-2";` });
          assert.equal(found.length, 1, className);
          assert.match(found[0], /src\/app\/a\.ts/, className);
          assert.match(found[0], new RegExp(group.name), className);
        }
      }
    });

    it('fails in a .html file and in another helm file', () => {
      const found = problems({
        'src/app/a.html': '<i class="file:text-sm"></i>',
        'src/app/ui/badge/hlm-badge.ts': `${HELM_FILES['src/app/ui/badge/hlm-badge.ts']} 'file:h-6'`,
      });
      assert.equal(found.length, 2);
      assert.match(found[0], /src\/app\/a\.html/);
      assert.match(found[1], /src\/app\/ui\/badge\/hlm-badge\.ts/);
    });

    it('ignores a longer class that holds a listed class as a part', () => {
      assert.deepEqual(
        problems({
          'src/app/a.ts':
            "'md:file:text-sm dark:aria-invalid:border-destructive file:text-sm-x focus-visible:ring-ring/5'",
        }),
        [],
      );
    });
  });

  describe('sheet sides', () => {
    it('passes a sheet on the left or the bottom, bound or static, and brnSheet', () => {
      assert.deepEqual(
        problems({
          'src/app/a.ts': component(
            `<hlm-sheet [side]="'left'"></hlm-sheet><hlm-sheet side="bottom"></hlm-sheet>` +
              `<div brnSheet [side]="x ? 'left' : 'bottom'"></div>` +
              `<hlm-sheet-content [showCloseButton]="false"></hlm-sheet-content>` +
              `<button hlmSheetTrigger side="left"></button><button hlmSheetTrigger></button>`,
          ),
        }),
        [],
      );
    });

    for (const [title, template] of [
      ['an hlm-sheet with no side', '<hlm-sheet (closed)="x()"></hlm-sheet>'],
      ['a brnSheet with no side', '<div brnSheet></div>'],
      ['a side of right', `<hlm-sheet [side]="'right'"></hlm-sheet>`],
      ['a static side of top', '<hlm-sheet side="top"></hlm-sheet>'],
      ['a hlmSheetTrigger with side top', '<button hlmSheetTrigger side="top"></button>'],
      ['a brnSheetTrigger with a bound side', '<button brnSheetTrigger [side]="x"></button>'],
      [
        'a side that holds a right literal',
        `<hlm-sheet [side]="x ? 'left' : 'right'"></hlm-sheet>`,
      ],
    ]) {
      it(`fails on ${title}`, () => {
        const found = problems({ 'src/app/a.ts': component(template) });
        assert.equal(found.length, 1);
        assert.match(found[0], /src\/app\/a\.ts/);
        assert.match(found[0], /sheet sides/);
      });
    }

    it('fails on a write to sideState in a .ts file outside ui/sheet', () => {
      const found = problems({ 'src/app/a.ts': "sheet.sideState.set('right');" });
      assert.equal(found.length, 1);
      assert.match(found[0], /src\/app\/a\.ts/);
      assert.match(found[0], /sideState/);
      assert.match(found[0], /sheet sides/);
    });

    it('allows a read of sideState and any use inside ui/sheet', () => {
      assert.deepEqual(
        problems({
          'src/app/a.ts': 'const side = sheet.sideState();',
          'src/app/ui/sheet/b.ts': "this.sideState.set('left');",
        }),
        [],
      );
    });
  });

  describe('badge as a control', () => {
    it('passes a span badge and an hlm-badge element', () => {
      assert.deepEqual(
        problems({
          'src/app/a.ts': component(
            '<span hlmBadge variant="muted">x</span><hlm-badge>y</hlm-badge><span hlmBadge [attr.data-x]="z">w</span>',
          ),
        }),
        [],
      );
    });

    for (const template of [
      '<a hlmBadge>x</a>',
      '<button hlmBadge>x</button>',
      '<summary hlmBadge>x</summary>',
      '<span hlmBadge tabindex="0">x</span>',
      '<span hlmBadge [attr.tabindex]="0">x</span>',
      '<span hlmBadge contenteditable>x</span>',
      '<span hlmBadge [attr.aria-invalid]="x">x</span>',
      '<span hlmBadge aria-invalid="true">x</span>',
      '<span hlmBadge href="/a">x</span>',
      '<span hlmBadge routerLink="/a">x</span>',
      '<span hlmBadge [routerLink]="link">x</span>',
      '<hlm-badge tabindex="-1">x</hlm-badge>',
    ]) {
      it(`fails on ${template}`, () => {
        const found = problems({ 'src/app/a.ts': component(template) });
        assert.equal(found.length, 1);
        assert.match(found[0], /src\/app\/a\.ts/);
        assert.match(found[0], /badge as a control/);
      });
    }
  });

  describe('file input', () => {
    it('passes a text input, and a type bound to a ternary with no file literal', () => {
      assert.deepEqual(
        problems({
          'src/app/a.ts': component(
            `<input hlmInput type="email" /><input hlmInput [type]="showPassword() ? 'text' : 'password'" />` +
              `<input type="file" />`,
          ),
        }),
        [],
      );
    });

    for (const template of [
      '<input hlmInput type="file">',
      '<input hlmInput [attr.type]="\'file\'">',
      "<input hlmInput [type]=\"x ? 'file' : 'text'\">",
      '<input hlmInput [type]="inputType">',
      '<input hlmInput [attr.type]="kind()">',
    ]) {
      it(`fails on ${template}`, () => {
        const found = problems({ 'src/app/a.ts': component(template) });
        assert.equal(found.length, 1);
        assert.match(found[0], /src\/app\/a\.ts/);
        assert.match(found[0], /file input/);
      });
    }

    it('fails on a file input in a file that imports INPUT_CLASSES', () => {
      const found = problems({
        'src/app/a.ts':
          "import { INPUT_CLASSES } from '../ui/input';\n" +
          component('<input type="file" [class]="inputClass">'),
      });
      assert.equal(found.length, 1);
      assert.match(found[0], /src\/app\/a\.ts/);
      assert.match(found[0], /file input/);
    });

    it('fails on an input whose type cannot be read in a file that imports INPUT_CLASSES', () => {
      const found = problems({
        'src/app/a.ts':
          "import { INPUT_CLASSES } from '../ui/input';\n" +
          component('<input [type]="kind" [class]="inputClass">'),
      });
      assert.equal(found.length, 1);
    });

    it('passes a file input in a file that does not use INPUT_CLASSES or hlmInput', () => {
      assert.deepEqual(
        problems({
          'src/app/a.ts': component(
            '<input type="file" class="x"><select [class]="CHIP_INPUT_CLASSES">',
          ),
        }),
        [],
      );
    });
  });

  describe('small helm buttons', () => {
    it('passes the sizes that pages use, and an hlmBtn with no size', () => {
      assert.deepEqual(
        problems({
          'src/app/a.ts': component(
            `<button hlmBtn size="icon-lg"></button><a hlmBtn size="lg"></a><button hlmBtn></button>` +
              `<button hlmBtn [size]="'icon'"></button><button hlmBtn [size]="big ? 'lg' : 'md'"></button>`,
          ),
        }),
        [],
      );
    });

    for (const size of ['xs', 'sm', 'icon-xs', 'icon-sm']) {
      it(`fails on an hlmBtn of size ${size}`, () => {
        const found = problems({
          'src/app/a.ts': component(`<button hlmBtn size="${size}"></button>`),
        });
        assert.equal(found.length, 1);
        assert.match(found[0], /src\/app\/a\.ts/);
        assert.match(found[0], /small helm buttons/);
      });
    }

    for (const template of [
      `<button hlmBtn [size]="compact ? 'sm' : 'md'"></button>`,
      '<button hlmBtn [size]="compact">x</button>',
      `<button hlmBtn [size]="'xs'">x</button>`,
    ]) {
      it(`fails on ${template}`, () => {
        const found = problems({ 'src/app/a.ts': component(template) });
        assert.equal(found.length, 1);
        assert.match(found[0], /small helm buttons/);
      });
    }

    for (const call of [
      "provideBrnButtonConfig({ size: 'icon-xs' })",
      "provideBrnButtonConfig({ variant: 'ghost', size: 'sm' })",
      "buttonVariants({ size: 'xs' })",
      "buttonVariants({ size: compact ? 'sm' : 'md' })",
      'buttonVariants({ size })',
      'buttonVariants({ size: this.size() })',
      'buttonVariants({ ...options })',
      'buttonVariants(options)',
    ]) {
      it(`fails on ${call}`, () => {
        const found = problems({ 'src/app/a.ts': `const x = ${call};` });
        assert.equal(found.length, 1);
        assert.match(found[0], /src\/app\/a\.ts/);
        assert.match(found[0], /small helm buttons/);
      });
    }

    it('passes calls that set no small size', () => {
      assert.deepEqual(
        problems({
          'src/app/a.ts':
            "const a = buttonVariants({ variant: 'ghost', size: 'icon-lg' }); const b = buttonVariants(); " +
            "provideBrnButtonConfig({ variant: 'outline' }); const c = buttonVariants({ size: big ? 'lg' : 'md' });\n" +
            '// the specs compare buttonVariants() output\nexport function provideBrnButtonConfig(config) {}',
        }),
        [],
      );
    });

    it('fails on an hlm-sheet-content without [showCloseButton]="false"', () => {
      for (const content of [
        '<hlm-sheet-content></hlm-sheet-content>',
        '<hlm-sheet-content [showCloseButton]="true"></hlm-sheet-content>',
        '<hlm-sheet-content [showCloseButton]="shown"></hlm-sheet-content>',
      ]) {
        const found = problems({ 'src/app/a.ts': component(content) });
        assert.equal(found.length, 1, content);
        assert.match(found[0], /showCloseButton/);
        assert.match(found[0], /small helm buttons/);
      }
    });

    it('exempts the built-in close button in ui/sheet/hlm-sheet-content.ts, and only there', () => {
      const closeButton = component(
        '<button hlmBtn type="button" variant="ghost" size="icon-sm" class="absolute"></button>',
      );
      assert.deepEqual(
        problems({ [SHEET_CONTENT]: `${HELM_FILES[SHEET_CONTENT]}\n${closeButton}` }),
        [],
      );
      assert.equal(problems({ 'src/app/a.ts': closeButton }).length, 1);
    });

    it("exempts helm's own buttonVariants call in ui/button/hlm-button.ts, and only that call", () => {
      const own = 'buttonVariants({ variant: this.variant(), size: this.size() })';
      assert.deepEqual(problems({ [BUTTON]: `${HELM_FILES[BUTTON]}\n${own}` }), []);
      assert.deepEqual(
        problems({
          [BUTTON]: `${HELM_FILES[BUTTON]}\nbuttonVariants({\n  variant: this.variant(),\n  size: this.size(),\n})`,
        }),
        [],
      );
      assert.equal(problems({ 'src/app/a.ts': own }).length, 1);
      assert.equal(
        problems({ [BUTTON]: `${HELM_FILES[BUTTON]}\nbuttonVariants({ size: this.other() })` })
          .length,
        1,
      );
    });
  });

  describe('host directives', () => {
    for (const directive of ['HlmButton', 'HlmBadge', 'HlmInput']) {
      it(`fails on hostDirectives: [${directive}] outside src/app/ui`, () => {
        const found = problems({
          'src/app/a.ts': `@Component({ hostDirectives: [{ directive: ${directive} }, Other] }) class A {}`,
        });
        assert.equal(found.length, 1);
        assert.match(found[0], /src\/app\/a\.ts/);
        assert.match(found[0], /hostDirectives/);
      });
    }

    it('passes other host directives, and any list inside src/app/ui', () => {
      assert.deepEqual(
        problems({
          'src/app/a.ts': '@Component({ hostDirectives: [HlmFieldGroup, BrnX] }) class A {}',
          'src/app/ui/b.ts': '@Component({ hostDirectives: [HlmButton] }) class B {}',
        }),
        [],
      );
    });
  });

  describe('stale or unowned entries', () => {
    it('fails when a listed class is no longer in its helm file', () => {
      const [first] = HELM_VARIANT_GROUPS[2].classes;
      const found = problems({
        [HELM_VARIANT_GROUPS[2].helmFile]: `'${HELM_VARIANT_GROUPS[2].classes.slice(1).join(' ')}'`,
      });
      assert.equal(found.length, 1);
      assert.match(found[0], new RegExp(first));
      assert.match(found[0], /src\/app\/ui\/input\/hlm-input\.ts/);
      assert.match(found[0], /no longer/);
    });

    it('fails when a group class is missing from the exclusion', () => {
      const classes = [...HELM_VARIANT_CLASSES];
      const missing = classes.pop();
      const found = problems({}, exclusion(...classes));
      assert.equal(found.length, 1);
      assert.match(found[0], /src\/styles\.css/);
      assert.ok(found[0].includes(missing));
      assert.match(found[0], /missing from the exclusion/);
    });

    it('fails on an entry that no check owns, and names it', () => {
      const found = problems({}, exclusion(...HELM_VARIANT_CLASSES, 'bg-input/30'));
      assert.equal(found.length, 1);
      assert.match(found[0], /"bg-input\/30"/);
      assert.match(found[0], /src\/styles\.css/);
    });

    it('accepts dark classes and the outline entries as owned elsewhere', () => {
      assert.deepEqual(
        problems(
          {},
          exclusion(
            ...HELM_VARIANT_CLASSES,
            'dark:bg-input/30',
            'outline-destructive',
            'outline-muted',
          ),
        ),
        [],
      );
    });

    it('reads the exclusion from every @source not inline() in any quote style', () => {
      const classes = [...HELM_VARIANT_CLASSES];
      const stylesCss =
        `@source not inline('outline-muted');\n/* @source not inline("x y"); */\n` +
        `@source not inline("${classes.slice(0, 20).join(' ')}");\n` +
        `@source not inline("${classes.slice(20).join(' ')}");\n`;
      assert.deepEqual(problems({}, stylesCss), []);
    });
  });
});

describe('the production stylesheet matcher', () => {
  const FIXTURE = join(ROOT, 'scripts/fixtures/helm-variant-exclusion/unexcluded-styles.min.txt');

  it('finds all 36 classes in rules cut from a stylesheet built without the exclusion', async () => {
    const found = helmVariantClassesIn(await readFile(FIXTURE, 'utf8'));
    assert.deepEqual([...found].sort(), [...HELM_VARIANT_CLASSES].sort());
  });

  it('matches a class that is not first in its selector, and the minified ng-icon escapes', () => {
    const found = helmVariantClassesIn(
      ':where([data-slot=button-group]) .in-data-\\[slot\\=button-group\\]\\:rounded-lg{border-radius:var(--radius)}' +
        ".\\[\\&_ng-icon\\:not\\(\\[class\\*\\=\\'text-\\'\\]\\)\\]\\:text-\\[length\\:--spacing\\(3\\.5\\)\\] ng-icon:not([class*=text-]){font-size:1px}",
    );
    assert.deepEqual(
      [...found].sort(),
      [
        'in-data-[slot=button-group]:rounded-lg',
        "[&_ng-icon:not([class*='text-'])]:text-[length:--spacing(3.5)]",
      ].sort(),
    );
  });

  it('reads hex escapes', () => {
    assert.deepEqual(
      [...helmVariantClassesIn('.file\\3a h-6::file-selector-button{height:1px}')],
      ['file:h-6'],
    );
  });

  it('finds no class in a lookalike that is not listed', () => {
    const lookalikes =
      '.data-\\[side\\=bottom\\]\\:h-auto[data-side=bottom]{height:auto}' +
      '.file\\:h-60::file-selector-button{height:1px}.my-file\\:h-6{height:1px}' +
      '.text-\\[0\\.8rem\\]x{font-size:.8rem}.a{margin:.5rem}';
    assert.equal(helmVariantClassesIn(lookalikes).size, 0);
  });

  describe('builtHelmVariantProblems', () => {
    async function withBrowserDir(files, run) {
      const dir = await mkdtemp(join(tmpdir(), 'helm-variant-styles-'));
      try {
        for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
        return await run(dir);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }

    it('names the stylesheet and each class it holds', async () => {
      const found = await withBrowserDir(
        { 'styles-ABC123.css': await readFile(FIXTURE, 'utf8'), 'main-XYZ.js': '"file:h-6"' },
        builtHelmVariantProblems,
      );
      assert.equal(found.length, 36);
      for (const className of HELM_VARIANT_CLASSES) {
        assert.equal(found.filter((line) => line.includes(`"${className}"`)).length, 1, className);
      }
      assert.ok(found.every((line) => line.includes('styles-ABC123.css')));
    });

    it('passes a stylesheet with none of the classes, and reads the unhashed styles.css', async () => {
      assert.deepEqual(
        await withBrowserDir(
          { 'styles-ABC123.css': '.a{color:red}.data-\\[side\\=bottom\\]\\:h-auto{height:auto}' },
          builtHelmVariantProblems,
        ),
        [],
      );
      const found = await withBrowserDir(
        { 'styles.css': '.file\\:h-6::file-selector-button{height:1px}' },
        builtHelmVariantProblems,
      );
      assert.equal(found.length, 1);
    });

    it('fails when the build wrote no stylesheet', async () => {
      const found = await withBrowserDir({ 'main-XYZ.js': '' }, builtHelmVariantProblems);
      assert.equal(found.length, 1);
      assert.match(found[0], /no styles\.css or styles-\*\.css/);
    });
  });
});

describe('scripts/ng-convex.mjs', () => {
  it('fails the production build on a helm variant rule in the built stylesheet', async () => {
    const source = await readFile(join(ROOT, 'scripts', 'ng-convex.mjs'), 'utf8');
    const afterBuild = source.slice(source.indexOf('async function afterBuild()'));
    assert.match(source, /builtHelmVariantProblems[^;]*from '\.\/helm-variant-exclusion\.mjs'/s);
    assert.match(afterBuild, /builtHelmVariantProblems\(browserDir\)/);
    assert.match(afterBuild, /throw new Error\([^)]*helm-variant-exclusion\.mjs/s);
  });
});
