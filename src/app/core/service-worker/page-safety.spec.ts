import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ChangesInFlight } from '../changes-in-flight';
import { PageSafety } from './page-safety';

@Component({ template: '' })
class EmptyPage {}

describe('PageSafety', () => {
  let safety: PageSafety;
  let added: HTMLElement[];

  function add<T extends HTMLElement>(element: T): T {
    document.body.append(element);
    added.push(element);
    return element;
  }

  function field(tag: 'input' | 'select' | 'textarea' = 'input') {
    return add(document.createElement(tag));
  }

  function type(element: HTMLElement): void {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function role(name: string): HTMLElement {
    const host = add(document.createElement('app-checkbox'));
    const button = document.createElement('button');
    button.setAttribute('role', name);
    host.append(button);
    return button;
  }

  beforeEach(() => {
    added = [];
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: EmptyPage }])],
    });
    safety = TestBed.inject(PageSafety);
    safety.watch();
  });

  afterEach(() => {
    for (const element of added) element.remove();
  });

  it('is safe with nothing typed and nothing in flight', () => {
    expect(safety.hasUnsavedField()).toBe(false);
    expect(safety.isSafe()).toBe(true);
  });

  it('counts a text input after an input event', () => {
    type(field());

    expect(safety.hasUnsavedField()).toBe(true);
    expect(safety.isSafe()).toBe(false);
  });

  it('counts a textarea after an input event', () => {
    type(field('textarea'));
    expect(safety.hasUnsavedField()).toBe(true);
  });

  it('counts a select after a change event', () => {
    field('select').dispatchEvent(new Event('change', { bubbles: true }));
    expect(safety.hasUnsavedField()).toBe(true);
  });

  it.each(['checkbox', 'radio', 'switch'])('counts a click on a role=%s control', (name) => {
    role(name).click();
    expect(safety.hasUnsavedField()).toBe(true);
  });

  it('counts a click on a child of a role=checkbox control', () => {
    const box = role('checkbox');
    const icon = document.createElement('span');
    box.append(icon);

    icon.click();

    expect(safety.hasUnsavedField()).toBe(true);
  });

  it('does not count a click on a plain button or a link', () => {
    add(document.createElement('button')).click();
    add(document.createElement('a')).click();

    expect(safety.hasUnsavedField()).toBe(false);
  });

  it('stops counting a field when it leaves the DOM', () => {
    const input = field();
    type(input);
    expect(safety.hasUnsavedField()).toBe(true);

    input.remove();

    expect(safety.hasUnsavedField()).toBe(false);
    expect(safety.isSafe()).toBe(true);
  });

  it('keeps counting a field that stays on screen while another one leaves', () => {
    const staying = field();
    const leaving = field();
    type(staying);
    type(leaving);

    leaving.remove();

    expect(safety.hasUnsavedField()).toBe(true);
  });

  it('keeps counting a field when an unrelated change resolves', () => {
    const changes = TestBed.inject(ChangesInFlight);
    type(field());

    changes.begin()();

    expect(safety.hasUnsavedField()).toBe(true);
  });

  it('keeps counting a field through a query-only navigation', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/league');
    type(field());

    await router.navigateByUrl('/league?tab=teams');

    expect(safety.hasUnsavedField()).toBe(true);
  });

  it('is unsafe while a change is in flight, and safe again when it ends', () => {
    const end = TestBed.inject(ChangesInFlight).begin();
    expect(safety.isSafe()).toBe(false);
    expect(safety.hasUnsavedField()).toBe(false);

    end();

    expect(safety.isSafe()).toBe(true);
  });

  it('emits when a field starts counting', () => {
    const marked = vi.fn();
    safety.fieldMarked.subscribe(marked);

    type(field());

    expect(marked).toHaveBeenCalledTimes(1);
  });

  describe('interaction', () => {
    it('is false until a pointer, key, wheel, or touch event', () => {
      expect(safety.interacted()).toBe(false);
    });

    it.each(['pointerdown', 'keydown', 'wheel', 'touchstart'])('is true after %s', (type) => {
      document.dispatchEvent(new Event(type, { bubbles: true }));
      expect(safety.interacted()).toBe(true);
    });

    it('is not set by scroll, focus, or mouse movement', () => {
      for (const name of ['scroll', 'focusin', 'pointermove', 'mousemove']) {
        document.dispatchEvent(new Event(name, { bubbles: true }));
      }
      expect(safety.interacted()).toBe(false);
    });
  });

  it('watch() twice adds no second set of listeners', () => {
    const marked = vi.fn();
    safety.fieldMarked.subscribe(marked);
    safety.watch();

    type(field());

    expect(marked).toHaveBeenCalledTimes(1);
  });

  it('stops listening when its injector is destroyed', () => {
    const marked = vi.fn();
    safety.fieldMarked.subscribe(marked);
    TestBed.resetTestingModule();

    type(field());

    expect(marked).not.toHaveBeenCalled();
  });
});
