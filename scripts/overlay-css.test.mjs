import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cdkOverlayProblems,
  declarations,
  loaderCalls,
  presetDrift,
  readCdkInputs,
  readPresetInputs,
} from './overlay-css.mjs';

const ROOT = import.meta.dirname + '/..';

describe('the vendored spartan preset', () => {
  it('equals the installed brain preset minus its CDK import, comments aside', async () => {
    const inputs = await readPresetInputs(ROOT);
    assert.equal(await presetDrift(inputs), null);
  });

  it('accepts a copy whose only change is a comment', async () => {
    const inputs = await readPresetInputs(ROOT);
    const copy = inputs.copy.replace('/* CDK fades', '/* A different note. CDK fades');
    assert.notEqual(copy, inputs.copy);
    assert.equal(await presetDrift({ ...inputs, copy }), null);
  });

  it('rejects a copy with one character of a rule changed and names both files', async () => {
    const inputs = await readPresetInputs(ROOT);
    const copy = inputs.copy.replace(
      '--spartan-overlay-backdrop-opacity, 1)',
      '--spartan-overlay-backdrop-opacity, 2)',
    );
    assert.notEqual(copy, inputs.copy);
    const message = await presetDrift({ ...inputs, copy });
    assert.match(message, /src\/styles\/spartan-preset\.css/);
    assert.match(message, /node_modules\/@spartan-ng\/brain\/hlm-tailwind-preset\.css/);
    assert.match(message, /Re-copy/);
  });

  it('rejects an upstream rule that the copy lacks', async () => {
    const inputs = await readPresetInputs(ROOT);
    const upstream = `${inputs.upstream}\n.added-upstream { color: red; }\n`;
    assert.match(await presetDrift({ ...inputs, upstream }), /Re-copy/);
  });
});

describe('the CDK overlay styles the app leaves out of its stylesheet', () => {
  it('are still added by createOverlayRef and getContainerElement, with every prebuilt rule', async () => {
    const inputs = await readCdkInputs(ROOT);
    assert.ok(inputs.chunk, 'the chunk that holds the loader was found');
    assert.deepEqual(cdkOverlayProblems(inputs), []);
  });

  it('read the declarations of overlay-prebuilt.css with the overlay layer ignored', async () => {
    const { prebuilt } = await readCdkInputs(ROOT);
    const found = declarations(prebuilt);
    assert.ok(found.has('.cdk-overlay-container { position: fixed }'));
    assert.ok(found.has('.cdk-overlay-container { z-index: 1000 }'));
    assert.ok(
      found.has(
        '@media (prefers-reduced-motion) .cdk-overlay-backdrop { transition-duration: 1ms }',
      ),
    );
    assert.deepEqual(
      declarations('@layer cdk-overlay { .a, .b { z-index: 1 } }'),
      new Set(['.a { z-index: 1 }', '.b { z-index: 1 }']),
    );
  });

  it('fails and names the CDK version when createOverlayRef no longer calls the loader', async () => {
    const inputs = await readCdkInputs(ROOT);
    const chunk = inputs.chunk.replace(
      'injector.get(_CdkPrivateStyleLoader).load(_CdkOverlayStyleLoader);',
      '',
    );
    assert.notEqual(chunk, inputs.chunk);
    assert.deepEqual(loaderCalls(chunk), { createOverlayRef: false, getContainerElement: true });
    const problems = cdkOverlayProblems({ ...inputs, chunk });
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(`@angular/cdk ${inputs.version}`));
    assert.match(problems[0], /createOverlayRef/);
    assert.match(problems[0], /restore the overlay-prebuilt\.css import/);
  });

  it('fails and names the CDK version when getContainerElement no longer calls the loader', async () => {
    const inputs = await readCdkInputs(ROOT);
    const chunk = inputs.chunk.replace(
      /getContainerElement\(\) \{\s*this\._loadStyles\(\);/,
      'getContainerElement() {',
    );
    assert.notEqual(chunk, inputs.chunk);
    assert.deepEqual(loaderCalls(chunk), { createOverlayRef: true, getContainerElement: false });
    const problems = cdkOverlayProblems({ ...inputs, chunk });
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(`@angular/cdk ${inputs.version}`));
    assert.match(problems[0], /getContainerElement/);
  });

  it('fails when the loader the method calls no longer loads the styles', async () => {
    const inputs = await readCdkInputs(ROOT);
    const chunk = inputs.chunk.replace(
      'this._styleLoader.load(_CdkOverlayStyleLoader);',
      'this._styleLoader.load(Other);',
    );
    assert.notEqual(chunk, inputs.chunk);
    assert.equal(loaderCalls(chunk).getContainerElement, false);
  });

  it('fails and names the CDK version for a prebuilt rule that the loader styles lack', async () => {
    const inputs = await readCdkInputs(ROOT);
    const prebuilt = `${inputs.prebuilt}\n.cdk-overlay-added-rule {\n  color: red;\n}\n`;
    const problems = cdkOverlayProblems({ ...inputs, prebuilt });
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(`@angular/cdk ${inputs.version}`));
    assert.match(problems[0], /\.cdk-overlay-added-rule \{ color: red \}/);
  });

  it('fails for a prebuilt declaration that the loader styles lack under a rule they hold', async () => {
    const inputs = await readCdkInputs(ROOT);
    const prebuilt = inputs.prebuilt.replace(
      '.cdk-overlay-container {\n  position: fixed;',
      '.cdk-overlay-container {\n  position: fixed;\n  contain: layout;',
    );
    assert.notEqual(prebuilt, inputs.prebuilt);
    const problems = cdkOverlayProblems({ ...inputs, prebuilt });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /\.cdk-overlay-container \{ contain: layout \}/);
  });
});
