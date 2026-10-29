import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CONVEX_CLIENT, ConvexConnection } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { InviteOfflineAlert } from './invite-offline-alert';

@Component({
  imports: [InviteOfflineAlert],
  template: `<app-invite-offline-alert description="Try again when you're connected." />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly alert = viewChild.required(InviteOfflineAlert);
}

async function render(connected: boolean) {
  const client = new FakeConvexClient();
  client.setConnected(connected);
  TestBed.configureTestingModule({ providers: [{ provide: CONVEX_CLIENT, useValue: client }] });
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  return { client, fixture, host: fixture.nativeElement as HTMLElement };
}

describe('the invite offline alert', () => {
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

  it('is a destructive role="alert" box that shows the focus ring and takes focus through focus()', async () => {
    const { fixture, host } = await render(false);
    const box = host.querySelector('[data-slot="alert"]')!;
    expect(box.getAttribute('role')).toBe('alert');
    expect(box.className.split(' ')).toEqual(
      expect.arrayContaining([
        'text-destructive',
        'outline-offset-2',
        'focus:outline-2',
        'focus:outline-ring',
      ]),
    );
    expect(host.querySelector('[data-slot="alert-description"]')?.textContent.trim()).toBe(
      "Try again when you're connected.",
    );

    fixture.componentInstance.alert().focus();
    expect(document.activeElement).toBe(box);
  });
});
