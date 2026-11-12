import type { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

/** The navigation `state` of the `RouterLink` on an anchor, which the DOM does not show. */
export function routerLinkState(
  fixture: ComponentFixture<unknown>,
  anchor: Element | null | undefined,
): unknown {
  const link = fixture.debugElement
    .queryAll(By.directive(RouterLink))
    .find((candidate) => candidate.nativeElement === anchor);
  if (!link) throw new Error('The element is not a RouterLink in the fixture.');
  return link.injector.get(RouterLink).state;
}
