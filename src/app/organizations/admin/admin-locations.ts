import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideMapPinOff, lucidePlus } from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import { api, injectQuery, skipToken } from '../../core/data/convex';
import { isPlainClick } from '../../shell/follow-link';
import { AddLocationForm } from './add-location-form';
import { AdminAlert } from './admin-alert';
import { AdminContext, bindAdminTitle } from './admin-context';
import { adminPath } from './admin-path';
import { OUTLINE_BUTTON } from './button-classes';
import { LocationRow } from './location-row';

@Component({
  selector: 'app-admin-locations',
  imports: [AddLocationForm, AdminAlert, LocationRow, NgIcon],
  providers: [provideIcons({ lucideCircleAlert, lucideMapPinOff, lucidePlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8' },
  template: `
    @if (organization(); as organization) {
      <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div class="min-w-0">
          <p class="text-sm font-medium text-muted-foreground">{{ organization.name }}</p>
          <h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
            Locations
          </h1>
          <p class="mt-2 max-w-2xl text-sm text-muted-foreground">
            Where your leagues play. Changes show on your public page straight away.
          </p>
        </div>
        <!-- The fragment link is explicit: a bare #add-location would resolve against <base href="/"> to the home page. -->
        <a [href]="addPath()" data-slot="button" [class]="jumpClass" (click)="jumpToForm($event)"
          ><ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Add location</a
        >
      </div>
      <div class="mt-6 grid items-start gap-4 md:gap-6 lg:grid-cols-3">
        <section
          aria-labelledby="locations-heading"
          class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10 lg:col-span-2"
        >
          <div
            class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
          >
            <h2 id="locations-heading" class="font-semibold">Locations</h2>
          </div>
          @if (savedName(); as name) {
            <div class="border-b border-border px-4 py-3 md:px-5">
              <app-admin-alert kind="success" [title]="name + ' saved.'" />
            </div>
          }
          @if (failed()) {
            <div class="px-4 py-4 md:px-5">
              <app-admin-alert
                kind="error"
                title="The locations could not be loaded."
                description="Check your connection and try again."
              />
            </div>
          } @else if (rows(); as rows) {
            @if (rows.length > 0) {
              <ul id="locations-list" role="list" class="divide-y divide-border">
                @for (row of rows; track row.locationId) {
                  <app-location-row
                    [location]="row"
                    [editing]="editing() === row.locationId"
                    (editRequested)="startEdit(row.locationId)"
                    (closed)="stopEdit(row.locationId)"
                    (saved)="savedName.set($event)"
                  />
                }
              </ul>
            } @else {
              <div class="flex flex-col items-center px-6 py-10 text-center">
                <span
                  class="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                  ><ng-icon name="lucideMapPinOff" class="text-xl" aria-hidden="true"
                /></span>
                <p class="mt-4 font-medium">No locations yet</p>
                <p class="mt-1 max-w-xs text-sm text-balance text-muted-foreground">
                  Add the places where your leagues play. Each one appears on your public page.
                </p>
              </div>
            }
          } @else {
            <p role="status" class="sr-only">Loading the locations.</p>
            <div aria-hidden="true" class="divide-y divide-border">
              @for (placeholder of placeholders; track placeholder) {
                <div class="flex gap-3 px-4 py-3.5 md:px-5">
                  <div
                    aria-hidden="true"
                    class="rounded-md bg-muted motion-safe:animate-pulse size-9 shrink-0 rounded-lg"
                  ></div>
                  <div class="flex-1">
                    <div
                      aria-hidden="true"
                      class="rounded-md bg-muted motion-safe:animate-pulse h-4 w-48 max-w-full"
                    ></div>
                    <div
                      aria-hidden="true"
                      class="rounded-md bg-muted motion-safe:animate-pulse mt-2 h-3.5 w-64 max-w-full"
                    ></div>
                  </div>
                </div>
              }
            </div>
          }
        </section>
        <section
          #addSection
          id="add-location"
          aria-labelledby="add-location-heading"
          class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
        >
          <div
            class="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 md:px-5"
          >
            <h2 id="add-location-heading" class="font-semibold">Add a location</h2>
          </div>
          <app-add-location-form [organizationId]="organization.organizationId" />
        </section>
      </div>
    }
  `,
})
export class AdminLocations {
  private readonly context = inject(AdminContext);

  protected readonly organization = this.context.organization;
  protected readonly jumpClass = `${OUTLINE_BUTTON} lg:hidden`;
  protected readonly placeholders = [1, 2, 3];

  private readonly list = injectQuery(api.locations.listForAdmin, () => {
    const organization = this.context.organization();
    return organization ? { organizationId: organization.organizationId } : skipToken;
  });

  protected readonly rows = computed(() => this.list.value());
  protected readonly failed = computed(() => this.list.error() !== undefined);
  protected readonly addPath = computed(
    () => `${adminPath(this.context.slug(), 'locations')}#add-location`,
  );

  protected readonly editing = signal<Id<'locations'> | null>(null);
  protected readonly savedName = signal<string | null>(null);

  private readonly addSection = viewChild<ElementRef<HTMLElement>>('addSection');
  private readonly rowViews = viewChildren(LocationRow);
  private readonly saving = computed(() => this.rowViews().some((row) => row.saving()));

  constructor() {
    bindAdminTitle('Locations');
  }

  /** Ignored while a save runs, so the form that is saving is not replaced before it shows the outcome. */
  protected startEdit(id: Id<'locations'>): void {
    if (this.saving()) return;
    this.savedName.set(null);
    this.editing.set(id);
  }

  protected stopEdit(id: Id<'locations'>): void {
    if (this.editing() === id) this.editing.set(null);
  }

  protected jumpToForm(event: MouseEvent): void {
    if (!isPlainClick(event)) return;
    const section = this.addSection()?.nativeElement;
    if (!section) return;
    event.preventDefault();
    section.scrollIntoView();
    section.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  }
}
