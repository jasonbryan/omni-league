import { expect } from 'vitest';
import { TitleStrategy } from '@angular/router';
import { PageTitleStrategy } from '../../core/page-title';

export const BAR_TITLE_PROVIDER = { provide: TitleStrategy, useClass: PageTitleStrategy };

export function barText(root: Element): string | undefined {
  return root.querySelector('header p')?.textContent?.trim();
}

export function expectBar(root: Element, bar: string, tabFirstPart = bar): void {
  expect(barText(root)).toBe(bar);
  expect(document.title.split(' | ')[0]).toBe(tabFirstPart);
  expect(document.title.endsWith(' | Omni League')).toBe(true);
}
