import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CONVEX_CLIENT, ConvexConnection } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { InviteAlert } from './invite-alert';

@Component({
  imports: [InviteAlert],
  template: `
    <app-invite-alert
      kind="offline"
      title="Ignored"
      description="Try again when you're connected."
    />
    <app-invite-alert
      kind="error"
      title="The invite could not be accepted."
      description="Try again."
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {}

describe('the invite alert', () => {
  const titles = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('[data-slot="alert-title"]')).map((title) =>
      title.textContent.trim(),
    );

  it('titles an offline alert from the connection cause and leaves an error alert on its own title', async () => {
    const client = new FakeConvexClient();
    client.setConnected(false);
    TestBed.configureTestingModule({ providers: [{ provide: CONVEX_CLIENT, useValue: client }] });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(titles(host)).toEqual([
      "You're offline. Nothing was sent.",
      'The invite could not be accepted.',
    ]);

    TestBed.inject(ConvexConnection).markSiteReached();
    await fixture.whenStable();

    expect(titles(host)).toEqual([
      "Can't reach Omni League right now. Nothing was sent.",
      'The invite could not be accepted.',
    ]);
  });

  it('keeps the unreachable title when the socket reconnects, and drops it when the socket next goes down', async () => {
    const client = new FakeConvexClient();
    client.setConnected(false);
    TestBed.configureTestingModule({ providers: [{ provide: CONVEX_CLIENT, useValue: client }] });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    TestBed.inject(ConvexConnection).markSiteReached();

    client.setConnected(true);
    await fixture.whenStable();
    expect(titles(host)[0]).toBe("Can't reach Omni League right now. Nothing was sent.");

    client.setConnected(false);
    await fixture.whenStable();
    expect(titles(host)[0]).toBe("You're offline. Nothing was sent.");
  });
});
