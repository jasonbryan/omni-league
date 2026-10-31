import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FakeAuthClient, provideFakeAuthClient } from './auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from './data/convex';
import { FakeConvexClient } from './data/convex/testing/fake-convex-client';
import { NotSavedView } from '../offline/not-saved-view';
import { PublicLayout } from '../public-layout/public-layout';
import { ServerErrorView } from '../server-error/server-error-view';
import { Shell } from '../shell/shell';

type Shown = 'content' | 'view' | 'other view';

@Component({
  selector: 'app-replaced-focus-test-page',
  imports: [NotSavedView, PublicLayout, ServerErrorView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-public-layout>
      <a href="/kept" id="kept">Kept link</a>
      <p id="blank">Text with no control</p>
      @switch (shown()) {
        @case ('content') {
          <div id="content"><a href="/next" id="pressed">Next page</a></div>
        }
        @case ('view') {
          @if (kind() === 'server-error') {
            <app-server-error-view retryHref="/here" />
          } @else {
            <app-not-saved-view retryHref="/here" />
          }
        }
        @case ('other view') {
          @if (kind() === 'server-error') {
            <app-not-saved-view retryHref="/here" />
          } @else {
            <app-server-error-view retryHref="/here" />
          }
        }
      }
    </app-public-layout>
  `,
})
class TestPage {
  readonly kind = input.required<'server-error' | 'not-saved'>();
  readonly shown = signal<Shown>('content');
}

const VIEWS: [string, 'server-error' | 'not-saved'][] = [
  ['the server-error view', 'server-error'],
  ['the not-saved view', 'not-saved'],
];

describe.each(VIEWS)('focus when %s replaces the content', (_label, kind) => {
  let fixture: ComponentFixture<TestPage>;

  async function open(shown: Shown = 'content'): Promise<void> {
    const auth = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: new FakeConvexClient() },
        provideRouter([]),
      ],
    });
    auth.emitSession(null);
    fixture = TestBed.createComponent(TestPage);
    fixture.componentRef.setInput('kind', kind);
    fixture.componentInstance.shown.set(shown);
    await settle();
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      TestBed.tick();
      await fixture.whenStable();
    }
  }

  async function show(shown: Shown): Promise<void> {
    fixture.componentInstance.shown.set(shown);
    await settle();
  }

  const page = () => fixture.nativeElement as HTMLElement;
  const find = (selector: string) => page().querySelector<HTMLElement>(selector)!;
  const viewHeading = () => find('main h1');
  const press = (element: HTMLElement) =>
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  const pressByKeyboard = (element: HTMLElement) => {
    element.focus();
    press(element);
  };

  afterEach(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  it('focuses its h1 when the focused link it replaced was removed with focus', async () => {
    await open();
    pressByKeyboard(find('#pressed'));
    await show('view');
    expect(document.activeElement).toBe(viewHeading());
    expect(viewHeading().getAttribute('tabindex')).toBe('-1');
  });

  it('focuses its h1 when the engine fires focusout with no target as it removes the focused link', async () => {
    await open();
    const link = find('#pressed');
    pressByKeyboard(link);
    link.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    fixture.componentInstance.shown.set('view');
    fixture.detectChanges();
    await settle();
    expect(document.activeElement).toBe(viewHeading());
  });

  it('focuses its h1 when the visitor switched tabs while the focused link waited, then the link was removed', async () => {
    await open();
    const link = find('#pressed');
    pressByKeyboard(link);
    link.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    await settle();
    expect(document.activeElement).toBe(link);
    await show('view');
    expect(document.activeElement).toBe(viewHeading());
  });

  it('focuses its h1 when the link it replaced was clicked without taking focus, as in WebKit', async () => {
    await open();
    press(find('#pressed'));
    expect(document.activeElement).toBe(document.body);
    await show('view');
    expect(document.activeElement).toBe(viewHeading());
  });

  it('takes no focus on a first render with nothing pressed or focused', async () => {
    await open('view');
    expect(document.activeElement).toBe(document.body);
  });

  it('takes no focus after a page load with nothing pressed, once the content gives way to it', async () => {
    await open();
    await show('view');
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves focus on a top-bar link', async () => {
    await open();
    press(find('#pressed'));
    const topBarLink = find('header a[href="/"]');
    topBarLink.focus();
    await show('view');
    expect(document.activeElement).toBe(topBarLink);
  });

  it('leaves focus on a link in main that is still on the page', async () => {
    await open();
    pressByKeyboard(find('#kept'));
    await show('view');
    expect(document.activeElement).toBe(find('#kept'));
  });

  it('takes no focus when the focused link lost focus to <body> before it was removed', async () => {
    await open();
    const link = find('#pressed');
    pressByKeyboard(link);
    link.blur();
    await settle();
    expect(document.activeElement).toBe(document.body);
    await show('view');
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus to #main when the content returns while its h1 has focus', async () => {
    await open();
    pressByKeyboard(find('#pressed'));
    await show('view');
    expect(document.activeElement).toBe(viewHeading());
    await show('content');
    expect(document.activeElement).toBe(find('main#main'));
  });

  it('moves focus to #main when the content returns while Try again has focus', async () => {
    await open();
    pressByKeyboard(find('#pressed'));
    await show('view');
    find('main a[data-slot="button"]').focus();
    await show('content');
    expect(document.activeElement).toBe(find('main#main'));
  });

  it('keeps focus on a top-bar link when the content returns', async () => {
    await open();
    pressByKeyboard(find('#pressed'));
    await show('view');
    const topBarLink = find('header a[href="/"]');
    topBarLink.focus();
    await show('content');
    expect(document.activeElement).toBe(topBarLink);
  });

  it('gives focus to the other view, not #main, when the other view replaces it while it holds focus', async () => {
    await open();
    pressByKeyboard(find('#pressed'));
    await show('view');
    const first = viewHeading();
    expect(document.activeElement).toBe(first);
    await show('other view');
    expect(viewHeading()).not.toBe(first);
    expect(document.activeElement).toBe(viewHeading());
  });
});

@Component({
  selector: 'app-replaced-focus-shell-test-page',
  imports: [NotSavedView, Shell, ServerErrorView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      @if (shown() === 'content') {
        <div id="content"><a href="/next" id="pressed">Next page</a></div>
      } @else if (kind() === 'server-error') {
        <app-server-error-view retryHref="/here" />
      } @else {
        <app-not-saved-view retryHref="/here" />
      }
    </app-shell>
  `,
})
class ShellTestPage {
  readonly kind = input.required<'server-error' | 'not-saved'>();
  readonly shown = signal<'content' | 'view'>('content');
}

describe.each(VIEWS)(
  'focus when %s replaces the content in the signed-in shell',
  (_label, kind) => {
    let fixture: ComponentFixture<ShellTestPage>;

    async function settle(): Promise<void> {
      for (let i = 0; i < 3; i++) {
        TestBed.tick();
        await fixture.whenStable();
      }
    }

    async function open(): Promise<void> {
      const auth = new FakeAuthClient();
      TestBed.configureTestingModule({
        providers: [
          provideFakeAuthClient(auth),
          { provide: CONVEX_CLIENT, useValue: new FakeConvexClient() },
          provideRouter([]),
        ],
      });
      auth.emitSession(null);
      fixture = TestBed.createComponent(ShellTestPage);
      fixture.componentRef.setInput('kind', kind);
      await settle();
    }

    async function show(shown: 'content' | 'view'): Promise<void> {
      fixture.componentInstance.shown.set(shown);
      await settle();
    }

    const find = (selector: string) =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector)!;
    const click = (element: HTMLElement) =>
      element.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );

    afterEach(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });

    it('focuses its h1 when the focused link it replaced was removed with focus', async () => {
      await open();
      find('#pressed').focus();
      click(find('#pressed'));
      await show('view');
      expect(document.activeElement).toBe(find('main h1'));
    });

    it('focuses its h1 when the link it replaced was clicked without taking focus, as in WebKit', async () => {
      await open();
      click(find('#pressed'));
      expect(document.activeElement).toBe(document.body);
      await show('view');
      expect(document.activeElement).toBe(find('main h1'));
    });

    it('moves focus to #main when the content returns while its h1 has focus', async () => {
      await open();
      find('#pressed').focus();
      await show('view');
      expect(document.activeElement).toBe(find('main h1'));
      await show('content');
      expect(document.activeElement).toBe(find('main#main'));
    });

    it('takes no focus when nothing in main was pressed or focused', async () => {
      await open();
      await show('view');
      expect(document.activeElement).toBe(document.body);
    });
  },
);
