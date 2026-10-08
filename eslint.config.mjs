// @ts-check
// Lint configuration per ADR 0002. Must stay ESM: @convex-dev/eslint-plugin
// returns an eslintrc-shaped config under CommonJS.
import convexPlugin from '@convex-dev/eslint-plugin';
import eslint from '@eslint/js';
import angular from 'angular-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    '.yarn/',
    '.pnpm-store/',
    '**/.env*',
    '.convex/',
    // Agent worktrees inside the checkout; flat config does not read .gitignore.
    '.claude/worktrees/',
  ]),

  // Rule set 1: all TypeScript, type-aware. Root tooling files are typed by tsconfig.tooling.json.
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

  // Rule set 2: Angular TypeScript, including the SSR files.
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

  // Restricted imports: only the Convex adapter folder may import convex/browser (#11).
  {
    files: ['src/**/*.ts'],
    ignores: ['src/app/core/data/convex/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'convex/browser',
              message:
                'Use the Convex adapter in src/app/core/data/convex/ (docs/conventions/angular.md).',
            },
          ],
        },
      ],
    },
  },

  // Server-entry files (src/server.ts and its error module) are bundled into the Netlify edge
  // function: Web APIs only, and no environment reads, because the production edge function can
  // read the production deploy key (ADR 0010, #37). This block replaces the options of the
  // no-restricted-imports block above for these files, so it repeats convex/browser.
  {
    files: ['src/server*.ts'],
    ignores: ['src/**/*.spec.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'process',
          message: 'Server-entry files must not read the environment (ADR 0010).',
        },
        {
          name: 'Netlify',
          message: 'Server-entry files must not read the environment (ADR 0010).',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Server-entry files must not read the environment (ADR 0010).',
        },
        {
          object: 'Netlify',
          property: 'env',
          message: 'Server-entry files must not read the environment (ADR 0010).',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'convex/browser',
              message:
                'Use the Convex adapter in src/app/core/data/convex/ (docs/conventions/angular.md).',
            },
          ],
          patterns: [
            {
              group: ['node:*'],
              message: 'Server-entry files are Web-API-only: no node: imports (ADR 0010).',
            },
          ],
        },
      ],
    },
  },

  // Rule set 3: Angular templates (external and inline), with accessibility rules.
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

  // Rule set 4: Convex functions.
  {
    files: ['convex/**/*.ts'],
    extends: [convexPlugin.configs.recommended],
    rules: {
      '@convex-dev/require-access-control': 'error',
    },
  },

  // Rule set 5: all JavaScript (config files, Node scripts), no type information.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [eslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
]);
