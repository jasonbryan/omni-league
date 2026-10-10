import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PlainTestPage, SidebarTestPage } from './testing/test-pages';

// The offline note in the shell (#88; design/mockups/88-offline-note.html). The note's own content
// and timing are covered in offline-note.spec.ts.

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

  it('moves the sticky offsets below the note while it shows, and back when it goes', async () => {
    const host = await render(SidebarTestPage);
    const header = host.querySelector('header');
    const sidebarColumn = host.querySelector('main')?.previousElementSibling?.firstElementChild;

    expect(classes(header)).toContain('[&,&_*]:-scroll-mt-18');
    expect(classes(sidebarColumn)).toEqual(
      expect.arrayContaining(['sticky', 'top-14', 'max-h-[calc(100dvh-3.5rem)]']),
    );

    setBrowserOnline(false);
    expect(classes(header)).toContain('[&,&_*]:-scroll-mt-27');
    expect(classes(header)).not.toContain('[&,&_*]:-scroll-mt-18');
    expect(classes(sidebarColumn)).toEqual(
      expect.arrayContaining(['sticky', 'top-23', 'max-h-[calc(100dvh-5.75rem)]']),
    );
    expect(classes(sidebarColumn)).not.toContain('top-14');

    setBrowserOnline(true);
    expect(classes(header)).toContain('[&,&_*]:-scroll-mt-18');
    expect(classes(sidebarColumn)).toContain('top-14');
  });
});
