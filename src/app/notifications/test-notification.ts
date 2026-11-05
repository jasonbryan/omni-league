import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBellRing, lucideLoaderCircle } from '@ng-icons/lucide';
import { TEST_SEND_LIMIT, TEST_SEND_WINDOW_MINUTES } from '../../../convex/lib/pushTestSend';
import { ConvexOfflineError, api, injectMutation, injectOnline } from '../core/data/convex';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { AdminOfflineAlert } from '../organizations/admin/admin-offline-alert';
import { OUTLINE_BUTTON } from '../ui/button/button-classes';

type Result =
  | { kind: 'sent'; devices: number }
  | { kind: 'noDevice' }
  | { kind: 'rateLimited'; minutes: number }
  | { kind: 'unconfigured' }
  | { kind: 'offline' }
  | { kind: 'failed' };

const SECONDS_PER_MINUTE = 60;

@Component({
  selector: 'app-test-notification',
  imports: [AdminAlert, AdminOfflineAlert, NgIcon],
  providers: [provideIcons({ lucideBellRing, lucideLoaderCircle })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex flex-col items-start gap-4 border-t border-border pt-4">
      <p class="text-sm text-muted-foreground">
        Check that notifications arrive. The test goes to every device where you turned them on.
      </p>
      <button
        type="button"
        data-slot="button"
        [class]="online() ? outlineButton : outlineButton + ' opacity-50'"
        [attr.aria-disabled]="pending() || !online() ? 'true' : null"
        [attr.aria-describedby]="online() ? null : 'test-notification-help'"
        (click)="send()"
      >
        @if (pending()) {
          <ng-icon
            name="lucideLoaderCircle"
            class="motion-safe:animate-spin"
            data-icon="inline-start"
            aria-hidden="true"
          />Sending…
        } @else {
          <ng-icon name="lucideBellRing" data-icon="inline-start" aria-hidden="true" />Send a test
          notification
        }
      </button>
      @if (pending()) {
        <p role="status" class="sr-only">Sending the test notification.</p>
      } @else if (!online()) {
        <p id="test-notification-help" class="text-sm text-muted-foreground">
          Connect to the internet to send a test.
        </p>
      }
      @if (result(); as result) {
        @switch (result.kind) {
          @case ('sent') {
            <app-admin-alert
              class="w-full"
              kind="success"
              title="Test notification sent."
              [description]="sentDescription(result.devices)"
            />
          }
          @case ('noDevice') {
            <app-admin-alert
              class="w-full"
              kind="error"
              title="No device to send to."
              description="Turn notifications on for a device, then try again."
            />
          }
          @case ('rateLimited') {
            <app-admin-alert
              class="w-full"
              kind="error"
              title="Too many tests."
              [description]="rateLimitedDescription(result.minutes)"
            />
          }
          @case ('unconfigured') {
            <app-admin-alert
              class="w-full"
              kind="error"
              title="The test notification could not be sent."
              description="Notifications are not available right now. Try again later."
            />
          }
          @case ('offline') {
            <app-admin-offline-alert
              class="w-full"
              description="Try again when you're connected."
            />
          }
          @default {
            <app-admin-alert
              class="w-full"
              kind="error"
              title="The test notification could not be sent."
              description="Check your connection and try again."
            />
          }
        }
      }
    </div>
  `,
})
export class TestNotification {
  private readonly sendTest = injectMutation(api.push.sendTest);

  protected readonly online = injectOnline();
  protected readonly pending = signal(false);
  protected readonly result = signal<Result | null>(null);
  protected readonly outlineButton = OUTLINE_BUTTON;

  protected sentDescription(devices: number): string {
    const where = devices === 1 ? 'your device' : `your ${devices} devices`;
    return `It should arrive on ${where} in a few seconds.`;
  }

  protected rateLimitedDescription(minutes: number): string {
    const unit = minutes === 1 ? 'minute' : 'minutes';
    return `You can send ${TEST_SEND_LIMIT} tests every ${TEST_SEND_WINDOW_MINUTES} minutes. Try again in ${minutes} ${unit}.`;
  }

  protected async send(): Promise<void> {
    if (this.pending()) return;
    if (!this.online()) {
      this.result.set({ kind: 'offline' });
      return;
    }
    this.pending.set(true);
    this.result.set(null);
    try {
      const answer = await this.sendTest.run({});
      this.result.set(
        answer.status === 'rateLimited'
          ? {
              kind: 'rateLimited',
              minutes: Math.max(1, Math.ceil(answer.retryAfterSeconds / SECONDS_PER_MINUTE)),
            }
          : answer.status === 'sent'
            ? { kind: 'sent', devices: answer.devices }
            : { kind: answer.status },
      );
    } catch (error) {
      this.result.set({ kind: error instanceof ConvexOfflineError ? 'offline' : 'failed' });
    } finally {
      this.pending.set(false);
    }
  }
}
