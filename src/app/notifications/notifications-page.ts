import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBell,
  lucideBellOff,
  lucideChevronRight,
  lucideLoaderCircle,
  lucideShare,
  lucideSmartphone,
  lucideSquarePlus,
} from '@ng-icons/lucide';
import { EMPTY } from 'rxjs';
import { isAllowedPushEndpoint } from '../../../convex/lib/pushSubscription';
import { AuthService } from '../core/auth/auth.service';
import {
  ConvexOfflineError,
  api,
  injectMutation,
  injectOnline,
  injectQuery,
  skipToken,
} from '../core/data/convex';
import { AdminAlert } from '../organizations/admin/admin-alert';
import { AdminOfflineAlert } from '../organizations/admin/admin-offline-alert';
import {
  BADGE_DEFAULT,
  BADGE_DESTRUCTIVE,
  BADGE_OUTLINE,
  BADGE_SECONDARY,
} from '../organizations/admin/field-classes';
import { Shell } from '../shell';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from '../ui/button/button-classes';
import { PUSH_DEVICE } from './push-device';

export type DeviceState = 'checking' | 'not-available' | 'install-first' | 'blocked' | 'off' | 'on';
type Busy = 'idle' | 'turning-on' | 'turning-off';
type Change = 'on' | 'off';
type Alert = { kind: 'offline' | 'failed'; change: Change } | null;

const CRUMB_LINK =
  'inline-flex items-center font-medium underline underline-offset-4 hover:text-foreground pointer-coarse:min-h-11';
const CURRENT_CRUMB_LINK =
  'inline-flex items-center font-medium text-foreground pointer-coarse:min-h-11';
const STEP_NUMBER =
  'flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground';

@Component({
  selector: 'app-notifications-page',
  imports: [AdminAlert, AdminOfflineAlert, NgIcon, RouterLink, Shell],
  providers: [
    provideIcons({
      lucideBell,
      lucideBellOff,
      lucideChevronRight,
      lucideLoaderCircle,
      lucideShare,
      lucideSmartphone,
      lucideSquarePlus,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <nav aria-label="Breadcrumb">
          <ol role="list" class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <li><a routerLink="/app" [class]="crumbLink">Home</a></li>
            <li aria-hidden="true">
              <ng-icon
                name="lucideChevronRight"
                class="translate-y-0.5 text-sm"
                aria-hidden="true"
              />
            </li>
            <li>
              <a routerLink="/app/notifications" aria-current="page" [class]="currentCrumbLink"
                >Notifications</a
              >
            </li>
          </ol>
        </nav>
        <h1 class="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">Notifications</h1>
        <p class="mt-1 max-w-xl text-sm text-muted-foreground">
          Game reminders, schedule changes, and score updates, on the phones and computers you
          choose.
        </p>
        <section
          aria-labelledby="device-heading"
          class="mt-6 max-w-xl overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
        >
          <div
            class="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5"
          >
            <h2 id="device-heading" class="font-semibold">This device</h2>
            @switch (state()) {
              @case ('checking') {
                <span
                  aria-hidden="true"
                  class="h-5 w-14 rounded-4xl bg-muted motion-safe:animate-pulse"
                ></span>
              }
              @case ('on') {
                <span data-slot="badge" [class]="badgeOn"
                  ><ng-icon name="lucideBell" data-icon="inline-start" aria-hidden="true" />On</span
                >
              }
              @case ('blocked') {
                <span data-slot="badge" [class]="badgeBlocked"
                  ><ng-icon
                    name="lucideBellOff"
                    data-icon="inline-start"
                    aria-hidden="true"
                  />Blocked</span
                >
              }
              @case ('not-available') {
                <span data-slot="badge" [class]="badgeSecondary">Not available</span>
              }
              @case ('install-first') {
                <span data-slot="badge" [class]="badgeSecondary"
                  ><ng-icon
                    name="lucideSmartphone"
                    data-icon="inline-start"
                    aria-hidden="true"
                  />Install first</span
                >
              }
              @default {
                <span data-slot="badge" [class]="badgeOff"
                  ><ng-icon
                    name="lucideBellOff"
                    data-icon="inline-start"
                    aria-hidden="true"
                  />Off</span
                >
              }
            }
          </div>
          <div class="flex flex-col items-start gap-4 px-4 py-4 md:px-5">
            @if (alert(); as alert) {
              @if (alert.kind === 'offline') {
                <app-admin-offline-alert
                  #offlineAlert
                  class="w-full"
                  [description]="refusedDescription(alert.change)"
                />
              } @else {
                <app-admin-alert
                  #failedAlert
                  class="w-full"
                  kind="error"
                  [title]="'Notifications could not be turned ' + alert.change + '.'"
                  description="Check your connection and try again."
                />
              }
            }
            @switch (state()) {
              @case ('checking') {
                <div aria-hidden="true" class="w-full space-y-3">
                  <div class="h-4 w-full rounded-md bg-muted motion-safe:animate-pulse"></div>
                  <div class="h-4 w-3/4 rounded-md bg-muted motion-safe:animate-pulse"></div>
                  <div class="h-9 w-52 rounded-lg bg-muted motion-safe:animate-pulse"></div>
                </div>
                <p role="status" class="sr-only">Checking notifications on this device.</p>
              }
              @case ('not-available') {
                <p class="text-sm">This browser can't show notifications from Omni League.</p>
                <p class="text-sm text-muted-foreground">
                  Try a current version of Chrome, Edge, Firefox, or Safari. On an iPhone or iPad,
                  you need iOS 16.4 or later.
                </p>
              }
              @case ('install-first') {
                <p class="text-sm">
                  On iPhone and iPad, notifications work only in the Omni League app on your Home
                  Screen.
                </p>
                <ol role="list" class="space-y-3 text-sm">
                  <li class="flex gap-3">
                    <span aria-hidden="true" [class]="stepNumber">1</span
                    ><span class="pt-0.5"
                      >In Safari, tap Share
                      <ng-icon
                        name="lucideShare"
                        class="translate-y-0.5 text-base"
                        aria-hidden="true"
                      />
                      in the toolbar.</span
                    >
                  </li>
                  <li class="flex gap-3">
                    <span aria-hidden="true" [class]="stepNumber">2</span
                    ><span class="pt-0.5"
                      >Tap Add to Home Screen
                      <ng-icon
                        name="lucideSquarePlus"
                        class="translate-y-0.5 text-base"
                        aria-hidden="true"
                      />, then Add.</span
                    >
                  </li>
                  <li class="flex gap-3">
                    <span aria-hidden="true" [class]="stepNumber">3</span
                    ><span class="pt-0.5"
                      >Open Omni League from your Home Screen, sign in, and come back to this
                      page.</span
                    >
                  </li>
                </ol>
                <p class="text-sm text-muted-foreground">
                  The Home Screen app keeps its own sign-in, separate from Safari, so you sign in
                  once more there. Needs iOS 16.4 or later.
                </p>
              }
              @case ('blocked') {
                <p class="text-sm">
                  Notifications for Omni League are blocked in this browser's settings, so they
                  can't be turned on from here.
                </p>
                <div>
                  <p class="text-sm font-medium">To allow them</p>
                  <ol role="list" class="mt-2 list-decimal space-y-1 ps-5 text-sm">
                    <li>
                      Open your browser's settings for this site. In most browsers, select the icon
                      at the start of the address bar.
                    </li>
                    <li>Set Notifications to Allow.</li>
                    <li>Come back to this page. It updates on its own.</li>
                  </ol>
                </div>
                <p class="text-sm text-muted-foreground">
                  On an iPhone or iPad: open Settings, then Notifications, then Omni League.
                </p>
              }
              @case ('on') {
                <p class="text-sm">
                  This device gets game reminders, schedule changes, and score updates.
                </p>
                <button
                  type="button"
                  data-slot="button"
                  [class]="offlineAware(outlineButton)"
                  [attr.aria-disabled]="busy() !== 'idle' || !online() ? 'true' : null"
                  [attr.aria-describedby]="online() ? null : 'device-help'"
                  (click)="turnOff()"
                >
                  @if (busy() === 'turning-off') {
                    <ng-icon
                      name="lucideLoaderCircle"
                      class="motion-safe:animate-spin"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />Turning off…
                  } @else {
                    <ng-icon name="lucideBellOff" data-icon="inline-start" aria-hidden="true" />Turn
                    off
                  }
                </button>
                @if (busy() === 'turning-off') {
                  <p role="status" class="sr-only">Turning off notifications.</p>
                } @else if (!online()) {
                  <p id="device-help" class="text-sm text-muted-foreground">
                    Connect to the internet to change this.
                  </p>
                }
              }
              @default {
                <p class="text-sm">
                  Get a notification on this device when a game is coming up, the schedule changes,
                  or a score is confirmed.
                </p>
                <button
                  type="button"
                  data-slot="button"
                  [class]="
                    offlineAware(primaryButton) + (controlled() ? '' : ' disabled:opacity-50')
                  "
                  [disabled]="!controlled()"
                  [attr.aria-disabled]="busy() !== 'idle' || !online() ? 'true' : null"
                  [attr.aria-describedby]="controlled() && online() ? null : 'device-help'"
                  (click)="turnOn()"
                >
                  @if (busy() === 'turning-on') {
                    <ng-icon
                      name="lucideLoaderCircle"
                      class="motion-safe:animate-spin"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />Turning on…
                  } @else {
                    <ng-icon name="lucideBell" data-icon="inline-start" aria-hidden="true" />Turn on
                    notifications
                  }
                </button>
                @if (!controlled()) {
                  <p
                    id="device-help"
                    role="status"
                    class="flex items-center gap-1.5 text-sm text-muted-foreground"
                  >
                    <ng-icon
                      name="lucideLoaderCircle"
                      class="motion-safe:animate-spin text-base"
                      aria-hidden="true"
                    />Getting this device ready. This takes a few seconds the first time.
                  </p>
                } @else if (busy() === 'turning-on') {
                  <p role="status" class="text-sm text-muted-foreground">
                    Choose Allow in your browser's prompt.
                  </p>
                } @else if (!online()) {
                  <p id="device-help" class="text-sm text-muted-foreground">
                    Connect to the internet to change this.
                  </p>
                } @else if (!alert()) {
                  <p class="text-sm text-muted-foreground">Your browser will ask for permission.</p>
                }
              }
            }
          </div>
        </section>
        <p class="mt-4 max-w-xl text-sm text-muted-foreground">
          This setting is for this device only. Turn notifications on in each browser or installed
          app where you want them. Signing out turns them off here.
        </p>
      </div>
    </app-shell>
  `,
})
export class NotificationsPage {
  private readonly auth = inject(AuthService);
  private readonly swPush = inject(SwPush);
  private readonly device = inject(PUSH_DEVICE);
  private readonly injector = inject(Injector);

  private readonly config = injectQuery(api.push.getConfig, () => ({}));
  // SwPush emits nothing until a worker controls the page, so an uncontrolled page has no subscription to show.
  private readonly subscription = toSignal(
    this.swPush.isEnabled ? this.swPush.subscription : EMPTY,
  );
  private readonly endpoint = computed(() => this.subscription()?.endpoint ?? null);
  private readonly status = injectQuery(api.push.getMyDeviceStatus, () => {
    const endpoint = this.endpoint();
    return endpoint && this.auth.convexAuthenticated() ? { endpoint } : skipToken;
  });
  private readonly save = injectMutation(api.push.subscribe);
  private readonly remove = injectMutation(api.push.unsubscribe);

  private readonly offlineAlert = viewChild(AdminOfflineAlert);
  private readonly failedAlert = viewChild(AdminAlert);

  /** The status query answers after the save; until then the endpoint just saved counts as on. */
  private readonly savedEndpoint = signal<string | null>(null);
  private readonly unlistedPushService = signal(false);

  protected readonly online = injectOnline();
  protected readonly controlled = this.device.controlled;
  protected readonly busy = signal<Busy>('idle');
  protected readonly alert = signal<Alert>(null);

  protected readonly state = computed<DeviceState>(() => {
    const config = this.config.value();
    if (config === undefined) return this.config.error() ? 'not-available' : 'checking';
    if (config.vapidPublicKey === null) return 'not-available';
    if (this.device.needsHomeScreenInstall) return 'install-first';
    if (!this.device.supported || !this.swPush.isEnabled || this.unlistedPushService()) {
      return 'not-available';
    }
    if (this.device.permission() === 'denied') return 'blocked';
    if (!this.controlled()) return 'off';
    const subscription = this.subscription();
    if (subscription === undefined) return 'checking';
    if (subscription === null) return 'off';
    if (this.savedEndpoint() === subscription.endpoint || this.status.value() === true) return 'on';
    if (this.status.value() === undefined && this.status.error() === undefined) return 'checking';
    return 'off';
  });

  protected readonly crumbLink = CRUMB_LINK;
  protected readonly currentCrumbLink = CURRENT_CRUMB_LINK;
  protected readonly stepNumber = STEP_NUMBER;
  protected readonly primaryButton = PRIMARY_BUTTON;
  protected readonly outlineButton = OUTLINE_BUTTON;
  protected readonly badgeOn = BADGE_DEFAULT;
  protected readonly badgeOff = `${BADGE_OUTLINE} bg-muted`;
  protected readonly badgeBlocked = BADGE_DESTRUCTIVE;
  protected readonly badgeSecondary = BADGE_SECONDARY;

  protected refusedDescription(change: Change): string {
    return `Notifications are still ${change === 'on' ? 'off' : 'on'}. Try again when you're connected.`;
  }

  protected offlineAware(classes: string): string {
    return this.online() ? classes : `${classes} opacity-50`;
  }

  protected turnOn(): void {
    if (this.busy() !== 'idle' || this.state() !== 'off' || !this.controlled()) return;
    if (!this.online()) {
      this.showAlert({ kind: 'offline', change: 'on' });
      return;
    }
    const key = this.config.value()?.vapidPublicKey;
    if (!key) return;
    // Before any await: Safari shows the prompt only from the user's own action.
    const permission = this.device.requestPermission();
    this.busy.set('turning-on');
    this.alert.set(null);
    void this.finishTurningOn(permission, key);
  }

  protected turnOff(): void {
    const endpoint = this.endpoint();
    if (this.busy() !== 'idle' || this.state() !== 'on' || !endpoint) return;
    if (!this.online()) {
      this.showAlert({ kind: 'offline', change: 'off' });
      return;
    }
    this.busy.set('turning-off');
    this.alert.set(null);
    void this.finishTurningOff(endpoint);
  }

  private async finishTurningOn(
    permission: Promise<NotificationPermission>,
    serverPublicKey: string,
  ): Promise<void> {
    try {
      if ((await permission) !== 'granted') return;
      let subscription: PushSubscription;
      try {
        subscription = await this.swPush.requestSubscription({ serverPublicKey });
      } catch {
        this.showAlert({ kind: 'failed', change: 'on' });
        return;
      }
      if (!isAllowedPushEndpoint(subscription.endpoint)) {
        await this.forgetBrowserSubscription();
        this.unlistedPushService.set(true);
        return;
      }
      const { keys } = subscription.toJSON();
      try {
        await this.save.run({
          endpoint: subscription.endpoint,
          expirationTime: subscription.expirationTime,
          keys: { p256dh: keys?.['p256dh'] ?? '', auth: keys?.['auth'] ?? '' },
        });
        this.savedEndpoint.set(subscription.endpoint);
      } catch (error) {
        // No row was saved, so a browser subscription left behind would show On after a reload.
        await this.forgetBrowserSubscription();
        this.showAlert({
          kind: error instanceof ConvexOfflineError ? 'offline' : 'failed',
          change: 'on',
        });
      }
    } finally {
      this.busy.set('idle');
    }
  }

  private async finishTurningOff(endpoint: string): Promise<void> {
    try {
      await this.remove.run({ endpoint });
    } catch (error) {
      this.busy.set('idle');
      this.showAlert({
        kind: error instanceof ConvexOfflineError ? 'offline' : 'failed',
        change: 'off',
      });
      return;
    }
    this.savedEndpoint.set(null);
    // The row is gone, so nothing is sent here even if the browser keeps its subscription.
    await this.forgetBrowserSubscription();
    this.busy.set('idle');
  }

  private async forgetBrowserSubscription(): Promise<void> {
    try {
      await this.swPush.unsubscribe();
    } catch {
      // Nothing to undo: the page shows what the server holds.
    }
  }

  private showAlert(alert: NonNullable<Alert>): void {
    this.alert.set(alert);
    afterNextRender(
      () => (alert.kind === 'offline' ? this.offlineAlert() : this.failedAlert())?.focus(),
      { injector: this.injector },
    );
  }
}
