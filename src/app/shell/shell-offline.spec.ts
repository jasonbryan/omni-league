import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PlainTestPage, SidebarTestPage } from './testing/test-pages';

async function render(page: Type<unknown>): Promise<HTMLElement> {
  TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: page }])] });
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

  it('puts the status region directly below the top bar, before the sidebar and main', async () => {
    const host = await render(SidebarTestPage);
    const header = host.querySelector('header');
    const region = header?.nextElementSibling;

    expect(region?.tagName).toBe('APP-OFFLINE-NOTE');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.nextElementSibling?.contains(host.querySelector('main'))).toBe(true);
  });

  it('shows the note on a page without a sidebar too', async () => {
    const host = await render(PlainTestPage);
    setBrowserOnline(false);

    expect(host.querySelector('header + [role="status"] [data-offline-note]')).not.toBeNull();
  });

  it('offsets the header scroll margin and the sidebar column by the note height variable', async () => {
    const host = await render(SidebarTestPage);
    const header = host.querySelector('header');
    const sidebarColumn = host.querySelector('main')?.previousElementSibling?.firstElementChild;
    const expectOffsets = () => {
      expect(classes(header)).toContain(
        '[&,&_*]:scroll-mt-[calc(-4.5rem-var(--offline-note-h,0px))]',
      );
      expect(classes(sidebarColumn)).toEqual(
        expect.arrayContaining([
          'sticky',
          'top-[calc(3.5rem+var(--offline-note-h,0px))]',
          'max-h-[calc(100dvh-3.5rem-var(--offline-note-h,0px))]',
        ]),
      );
    };

    expectOffsets();
    setBrowserOnline(false);
    expectOffsets();
  });
});
