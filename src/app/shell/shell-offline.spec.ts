import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { PlainTestPage, SidebarTestPage } from './testing/test-pages';

async function render(page: Type<unknown>): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    providers: [
      { provide: CONVEX_CLIENT, useValue: new FakeConvexClient() },
      provideRouter([{ path: '**', component: page }]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/');
  return harness.fixture.nativeElement as HTMLElement;
}

function setBrowserOnline(online: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online);
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  TestBed.tick();
}

const classes = (element: Element | null | undefined) => element?.className.split(/\s+/) ?? [];

describe('Shell offline note', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('puts the status region directly below the slim bar, before main', async () => {
    const host = await render(SidebarTestPage);
    const header = host.querySelector('header');
    const region = header?.nextElementSibling;

    expect(region?.tagName).toBe('APP-OFFLINE-NOTE');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.nextElementSibling).toBe(host.querySelector('main'));
  });

  it('shows the note on a page without a sidebar too', async () => {
    const host = await render(PlainTestPage);
    setBrowserOnline(false);

    expect(host.querySelector('header + [role="status"] [data-offline-note]')).not.toBeNull();
  });

  it('offsets the slim bar scroll margin by the note height variable, and sticks the note to the page top from 1024px, where there is no bar', async () => {
    const host = await render(SidebarTestPage);
    const header = host.querySelector('header');
    const root = host.querySelector('main')?.parentElement?.parentElement;
    const expectOffsets = () => {
      expect(classes(header)).toContain(
        '[&,&_*]:scroll-mt-[calc(-4.5rem-var(--offline-note-h,0px))]',
      );
      expect(classes(root)).toContain('lg:[--top-bar-h:0px]');
    };

    expectOffsets();
    setBrowserOnline(false);
    expectOffsets();
  });
});
