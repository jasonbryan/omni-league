// @ts-check
// Must stay ESM: @convex-dev/eslint-plugin returns an eslintrc-shaped config under CommonJS.
import convexPlugin from '@convex-dev/eslint-plugin';
import eslint from '@eslint/js';
import angular from 'angular-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

// Selector regexes cannot contain `/`, so the `/` in names like `fs/promises` is `.`.
const BUILTIN_SOURCE = `/^(?:node:.*|${builtinModules.map((name) => name.replaceAll('/', '.')).join('|')})$/`;

// `@convex-dev/better-auth` makes npm install React as a required peer. React is not an approved
// framework here, so no file may import it. Every `no-restricted-imports` block below repeats
// these, because a later block's options replace an earlier one's for the files they share.
const REACT_MESSAGE =
  'React is installed only as a peer of @convex-dev/better-auth and is not an approved framework.';
const REACT_PATHS = ['react', 'react-dom', '@convex-dev/better-auth/react'].map((name) => ({
  name,
  message: REACT_MESSAGE,
}));
const REACT_PATTERNS = [{ group: ['react/*', 'react-dom/*'], message: REACT_MESSAGE }];

// A runtime import of either puts Convex's server code (its schema builder) in the browser bundle.
// Specs may import them at runtime: specs never ship in the browser bundle.
const CONVEX_SERVER_MESSAGE =
  'Import api and getFunctionName from the Convex adapter in src/app/core/data/convex/; only `import type` may name this module.';
const CONVEX_SERVER_PATHS = [
  { name: 'convex/server', message: CONVEX_SERVER_MESSAGE, allowTypeImports: true },
];
const CONVEX_SERVER_PATTERNS = [
  {
    regex: String.raw`(^|/)convex/_generated/api(\.js)?$`,
    message: CONVEX_SERVER_MESSAGE,
    allowTypeImports: true,
  },
];
const CONVEX_BROWSER_PATH = {
  name: 'convex/browser',
  message: 'Use the Convex adapter in src/app/core/data/convex/ (docs/conventions/angular.md).',
};

export default defineConfig([
  globalIgnores([
    'convex/_generated/',
    'dist/',
    '.angular/',
    'out-tsc/',
    'coverage/',
    'playwright-report/',
    'test-results/',
    'blob-report/',
    'e2e/screenshots/',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    '.yarn/',
    '.pnpm-store/',
    '**/.env*',
    '.convex/',
    '.convex-e2e/',
    // Agent worktrees inside the checkout; flat config does not read .gitignore.
    '.claude/worktrees/',
  ]),

  {
    files: ['**/*.{ts,mts,cts}'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ['src/**/*.ts'],
    extends: [angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-output-emitter-ref': 'error',
      '@angular-eslint/prefer-host-metadata-property': 'error',
      '@angular-eslint/no-uncalled-signals': 'error',
    },
  },

  // Vendored spartan helm code, copied from upstream and formatted by Prettier only.
  // Upstream uses `hlm*` selectors, untyped `inject(ElementRef)`, `input(…, { alias: 'class' })`,
  // and `state ?? signal('closed')` fallbacks on an optional signal; these rules are off here so a
  // re-copy from upstream stays a plain diff. Every other rule still applies.
  {
    files: ['src/app/ui/**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': 'off',
      '@angular-eslint/component-selector': 'off',
      '@angular-eslint/no-input-rename': 'off',
      '@angular-eslint/no-uncalled-signals': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },

  {
    files: ['**/*.{ts,mts,cts,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': ['error', { paths: REACT_PATHS, patterns: REACT_PATTERNS }],
    },
  },

  {
    files: ['src/**/*.ts'],
    ignores: ['src/app/core/data/convex/**', 'src/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [CONVEX_BROWSER_PATH, ...CONVEX_SERVER_PATHS, ...REACT_PATHS],
          patterns: [...CONVEX_SERVER_PATTERNS, ...REACT_PATTERNS],
        },
      ],
    },
  },

  {
    files: ['src/**/*.spec.ts'],
    ignores: ['src/app/core/data/convex/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [CONVEX_BROWSER_PATH, ...REACT_PATHS], patterns: REACT_PATTERNS },
      ],
    },
  },

  {
    files: ['src/app/core/data/convex/**/*.ts'],
    ignores: ['src/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...CONVEX_SERVER_PATHS, ...REACT_PATHS],
          patterns: [...CONVEX_SERVER_PATTERNS, ...REACT_PATTERNS],
        },
      ],
    },
  },

  // Server-entry files (src/server*.ts) and the app file they import
  // (src/app/core/url-serializer.ts) are bundled into the Netlify edge function: Web APIs only,
  // and no environment reads, because the production edge function can read the production deploy
  // key. A file added to that import graph needs a `files` entry here:
  // scripts/eslint-edge-runtime.test.mjs walks the imports and fails when one is missing.
  // This block replaces the options of the no-restricted-imports block above for these files, so
  // it repeats convex/browser and the Convex server modules.
  {
    files: ['src/server*.ts', 'src/app/core/url-serializer.ts'],
    ignores: ['src/**/*.spec.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'process',
          message: 'Server-entry files must not read the environment.',
        },
        {
          name: 'Netlify',
          message: 'Server-entry files must not read the environment.',
        },
        {
          name: 'Deno',
          message: 'Server-entry files must not read the environment.',
        },
        // The global object reaches the environment through casts and aliases
        // (`(globalThis as T).process`) that no-restricted-properties cannot see.
        ...['globalThis', 'self', 'window', 'global'].map((name) => ({
          name,
          message: 'Server-entry files must not use the global object: it reaches the environment.',
        })),
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Server-entry files must not read the environment.',
        },
        {
          object: 'Netlify',
          property: 'env',
          message: 'Server-entry files must not read the environment.',
        },
        {
          object: 'Deno',
          property: 'env',
          message: 'Server-entry files must not read the environment.',
        },
        // The edge function runs on Deno, where the plugin's polyfill assigns globalThis.process.
        ...['process', 'Netlify', 'Deno'].map((property) => ({
          object: 'globalThis',
          property,
          message: 'Server-entry files must not read the environment.',
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            CONVEX_BROWSER_PATH,
            ...CONVEX_SERVER_PATHS,
            // Un-prefixed built-ins (`fs`, `fs/promises`, ...), as exact names: a pattern like
            // `path` would also match a relative `./path` module.
            ...builtinModules.map((name) => ({
              name,
              message: 'Server-entry files are Web-API-only: no Node built-in imports.',
            })),
            ...REACT_PATHS,
          ],
          patterns: [
            {
              group: ['node:*'],
              message: 'Server-entry files are Web-API-only: no node: imports.',
            },
            ...CONVEX_SERVER_PATTERNS,
            ...REACT_PATTERNS,
          ],
        },
      ],
      // no-restricted-imports sees only static imports. A dynamic import() of a built-in is
      // refused by name, and one whose source is computed is refused outright, since its
      // module cannot be checked.
      'no-restricted-syntax': [
        'error',
        {
          selector: `ImportExpression[source.type='Literal'][source.value=${BUILTIN_SOURCE}]`,
          message: 'Server-entry files are Web-API-only: no Node built-in imports.',
        },
        {
          selector: `ImportExpression > TemplateLiteral[expressions.length=0] > TemplateElement[value.cooked=${BUILTIN_SOURCE}]`,
          message: 'Server-entry files are Web-API-only: no Node built-in imports.',
        },
        {
          selector:
            "ImportExpression:not([source.type='Literal']):not(:has(> TemplateLiteral[expressions.length=0]))",
          message:
            'Server-entry files must import from a fixed module name, so the module can be checked.',
        },
      ],
    },
  },

  {
    files: ['src/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/button-has-type': 'error',
      '@angular-eslint/template/no-positive-tabindex': 'error',
      '@angular-eslint/template/prefer-class-binding': 'error',
      '@angular-eslint/template/prefer-style-binding': 'error',
      '@angular-eslint/template/prefer-ngsrc': 'error',
    },
  },

  {
    files: ['convex/**/*.ts'],
    extends: [convexPlugin.configs.recommended],
    rules: {
      '@convex-dev/require-access-control': 'error',
    },
  },

  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [eslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
]);
