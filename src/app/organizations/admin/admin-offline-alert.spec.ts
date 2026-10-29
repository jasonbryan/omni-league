import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { lucideWifiOff } from '@ng-icons/lucide';
import { CONVEX_CLIENT, ConvexConnection } from '../../core/data/convex';
import { FakeConvexClient } from '../../core/data/convex/testing/fake-convex-client';
import { AdminOfflineAlert } from './admin-offline-alert';

@Component({
  imports: [AdminOfflineAlert],
  template: `
    <app-admin-offline-alert description="Try again when you're connected."
      ><a href="/undo">Undo</a></app-admin-offline-alert
    >
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly alert = viewChild.required(AdminOfflineAlert);
}

async function render(connected: boolean) {
  const client = new FakeConvexClient();
  client.setConnected(connected);
  TestBed.configureTestingModule({ providers: [{ provide: CONVEX_CLIENT, useValue: client }] });
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  return { client, fixture, host: fixture.nativeElement as HTMLElement };
}

const paths = (svg: Element | null) =>
  Array.from(svg?.querySelectorAll('path') ?? []).map((path) => path.getAttribute('d'));

describe('the admin offline alert', () => {
  const title = (host: HTMLElement) =>
    host.querySelector('[data-slot="alert-title"]')?.textContent.trim();

  it('takes its title from the connection cause', async () => {
    const { fixture, host } = await render(false);
    expect(title(host)).toBe("You're offline. Nothing was sent.");

    TestBed.inject(ConvexConnection).markSiteReached();
    await fixture.whenStable();
    expect(title(host)).toBe("Can't reach Omni League right now. Nothing was sent.");
  });

  it('keeps the unreachable title when the socket reconnects, and drops it when the socket next goes down', async () => {
    const { client, fixture, host } = await render(false);
    TestBed.inject(ConvexConnection).markSiteReached();

    client.setConnected(true);
    await fixture.whenStable();
    expect(title(host)).toBe("Can't reach Omni League right now. Nothing was sent.");

    client.setConnected(false);
    await fixture.whenStable();
    expect(title(host)).toBe("You're offline. Nothing was sent.");
  });

  it('is a destructive role="alert" box with the description, the projected content, and the wifi-off icon', async () => {
    const { host } = await render(false);
    const box = host.querySelector('[data-slot="alert"]')!;
    expect(box.getAttribute('role')).toBe('alert');
    expect(box.className.split(' ')).toContain('text-destructive');
    expect(box.className).not.toContain('focus:outline-2');
    const description = host.querySelector('[data-slot="alert-description"]')!;
    expect(description.textContent).toContain("Try again when you're connected.");
    expect(description.querySelector('a')?.textContent).toBe('Undo');
    const expected = new DOMParser()
      .parseFromString(lucideWifiOff, 'image/svg+xml')
      .querySelector('svg');
    expect(paths(host.querySelector('ng-icon svg'))).toEqual(paths(expected));
  });

  it('takes focus through focus()', async () => {
    const { fixture, host } = await render(false);
    fixture.componentInstance.alert().focus();
    expect(document.activeElement).toBe(host.querySelector('[data-slot="alert"]'));
  });
});
