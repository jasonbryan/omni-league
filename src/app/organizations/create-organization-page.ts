import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
  viewChild,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { FormField, form, required } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucideCircleAlert,
  lucideLoaderCircle,
  lucideWifiOff,
} from '@ng-icons/lucide';
import { ConvexError } from 'convex/values';
import { api } from '../../../convex/_generated/api';
import {
  checkOrganizationName,
  checkOrganizationSlug,
  ORGANIZATION_MESSAGES,
  type OrganizationInputError,
} from '../../../convex/lib/organizationInput';
import { slugify } from '../../../convex/lib/slugs';
import { ConvexOfflineError, injectMutation, injectOnline } from '../core/data/convex';
import { ShownUntilValid } from '../core/forms/shown-errors';
import { Shell } from '../shell';
import { adminPath } from './admin/admin-path';

export const MESSAGES = {
  failedTitle: 'The organization could not be created.',
  failedDescription: 'Check your connection and try again.',
  offlineTitle: "You're offline. Nothing was sent.",
  offlineDescription: "Your details are still here. Try again when you're connected.",
} as const;

const RESERVED_SLUG = 'new';

type FieldName = 'name' | 'slug';
const FIELDS: readonly FieldName[] = ['name', 'slug'];

interface CreateModel {
  name: string;
  slug: string;
}

type FormAlert = 'offline' | 'failed';

interface ServerError {
  text: string;
  taken: string | null;
}

function inputErrorOf(failure: unknown): OrganizationInputError | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, code, message } = data as Record<string, unknown>;
  if ((field !== 'name' && field !== 'slug') || typeof code !== 'string') return null;
  if (typeof message !== 'string') return null;
  return { field, code: code as OrganizationInputError['code'], message };
}

// Class strings are the approved mockup's, written as static attributes so Angular sets them before the element is inserted; the buttons carry unmerged `buttonVariants` output.

@Component({
  selector: 'app-create-organization-page',
  imports: [FormField, NgIcon, RouterLink, Shell],
  providers: [
    provideIcons({ lucideArrowLeft, lucideCircleAlert, lucideLoaderCircle, lucideWifiOff }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16">
        <div class="mx-auto w-full max-w-lg">
          <a
            routerLink="/app"
            class="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground"
            ><ng-icon name="lucideArrowLeft" class="text-base" aria-hidden="true" />Your
            organizations</a
          >
          <div
            class="mt-3 overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
          >
            <div class="px-5 pt-6 md:px-8 md:pt-8">
              <h1 id="create-heading" class="text-2xl font-semibold tracking-tight">
                Create an organization
              </h1>
              <p class="mt-2 text-sm text-muted-foreground">
                You&rsquo;ll be its first org admin. Next you can add its locations, leagues, and
                staff.
              </p>
            </div>
            <form
              novalidate
              aria-labelledby="create-heading"
              class="px-5 pt-5 pb-6 md:px-8 md:pb-8"
              (submit)="submit($event)"
            >
              @if (formAlert(); as alert) {
                <div
                  #alert
                  data-slot="alert"
                  role="alert"
                  id="form-error"
                  tabindex="-1"
                  class="group/alert relative w-full grid gap-0.5 rounded-lg border px-2.5 py-2 text-start text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>ng-icon]:grid-cols-[auto_1fr] has-[>ng-icon]:gap-x-2 *:[ng-icon]:row-span-2 *:[ng-icon]:translate-y-0.5 *:[ng-icon]:text-current *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] text-destructive bg-card *:data-[slot=alert-description]:text-destructive/90 mb-5"
                >
                  <ng-icon
                    [name]="alert === 'offline' ? 'lucideWifiOff' : 'lucideCircleAlert'"
                    aria-hidden="true"
                  />
                  <div
                    data-slot="alert-title"
                    class="font-medium group-has-[>ng-icon]/alert:col-start-2 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3"
                  >
                    {{ alert === 'offline' ? messages.offlineTitle : messages.failedTitle }}
                  </div>
                  <div
                    data-slot="alert-description"
                    class="text-muted-foreground text-sm text-balance md:text-pretty [&_p:not(:last-child)]:mb-4 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3"
                  >
                    {{
                      alert === 'offline' ? messages.offlineDescription : messages.failedDescription
                    }}
                  </div>
                </div>
              }
              <div
                data-slot="field-group"
                class="group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4"
              >
                <div
                  role="group"
                  data-slot="field"
                  data-orientation="vertical"
                  [attr.data-matches-spartan-invalid]="errors.name() ? 'true' : null"
                  [attr.data-invalid]="errors.name() ? 'true' : null"
                  class="group/field flex w-full flex-col *:w-full [&>.sr-only]:w-auto data-[matches-spartan-invalid=true]:text-destructive gap-2"
                >
                  <label
                    for="name"
                    data-slot="field-label"
                    class="flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed gap-2 text-sm font-medium group-data-[disabled=true]:opacity-50 peer-disabled:opacity-50 group/field-label peer/field-label w-fit has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-data-checked:bg-primary/5 has-data-checked:border-primary/30 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10 leading-snug group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border *:data-[slot=field]:p-2.5"
                    >Name</label
                  >
                  <input
                    #name
                    id="name"
                    type="text"
                    data-slot="input"
                    autocomplete="organization"
                    [formField]="fields.name"
                    (blur)="left('name')"
                    (input)="nameTyped($event)"
                    [attr.aria-describedby]="describedBy('name', 'name-description')"
                    [attr.aria-invalid]="errors.name() ? 'true' : null"
                    [attr.data-invalid]="errors.name() ? 'true' : null"
                    [attr.data-matches-spartan-invalid]="errors.name() ? 'true' : null"
                    class="file:text-foreground placeholder:text-muted-foreground w-full min-w-0 file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 border-input data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-9 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors file:h-6 file:text-sm file:font-medium data-[matches-spartan-invalid=true]:ring-3 md:text-sm"
                  />
                  <p
                    data-slot="field-description"
                    id="name-description"
                    class="text-muted-foreground text-start text-sm [[data-variant=legend]+&]:-mt-1.5 leading-normal font-normal group-has-data-horizontal/field:text-balance last:mt-0 nth-last-2:-mt-1 [&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4"
                  >
                    Shown on your public page. Up to 100 characters.
                  </p>
                  @if (errors.name(); as error) {
                    <div
                      role="alert"
                      data-slot="field-error"
                      id="name-error"
                      class="text-destructive text-sm font-normal flex items-start gap-1.5"
                    >
                      <ng-icon
                        name="lucideCircleAlert"
                        class="mt-0.5 shrink-0 text-base"
                        aria-hidden="true"
                      />
                      <span>{{ error }}</span>
                    </div>
                  }
                </div>
                <div
                  role="group"
                  data-slot="field"
                  data-orientation="vertical"
                  [attr.data-matches-spartan-invalid]="errors.slug() ? 'true' : null"
                  [attr.data-invalid]="errors.slug() ? 'true' : null"
                  class="group/field flex w-full flex-col *:w-full [&>.sr-only]:w-auto data-[matches-spartan-invalid=true]:text-destructive gap-2"
                >
                  <label
                    for="slug"
                    data-slot="field-label"
                    class="flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed gap-2 text-sm font-medium group-data-[disabled=true]:opacity-50 peer-disabled:opacity-50 group/field-label peer/field-label w-fit has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-data-checked:bg-primary/5 has-data-checked:border-primary/30 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10 leading-snug group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border *:data-[slot=field]:p-2.5"
                    >Slug</label
                  >
                  <input
                    #slug
                    id="slug"
                    type="text"
                    data-slot="input"
                    autocomplete="off"
                    spellcheck="false"
                    autocapitalize="none"
                    [formField]="fields.slug"
                    (blur)="left('slug')"
                    (input)="slugEdited.set(true)"
                    [attr.aria-describedby]="describedBy('slug', 'slug-description')"
                    [attr.aria-invalid]="errors.slug() ? 'true' : null"
                    [attr.data-invalid]="errors.slug() ? 'true' : null"
                    [attr.data-matches-spartan-invalid]="errors.slug() ? 'true' : null"
                    class="file:text-foreground placeholder:text-muted-foreground w-full min-w-0 file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 border-input data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 h-9 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors file:h-6 file:text-sm file:font-medium data-[matches-spartan-invalid=true]:ring-3 md:text-sm"
                  />
                  <p
                    data-slot="field-description"
                    id="slug-description"
                    class="text-muted-foreground text-start text-sm [[data-variant=legend]+&]:-mt-1.5 leading-normal font-normal group-has-data-horizontal/field:text-balance last:mt-0 nth-last-2:-mt-1 [&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4"
                  >
                    3 to 60 lowercase letters and digits, with single hyphens between them. Your
                    public page will be at
                    <span class="block break-words text-foreground"
                      >{{ host }}/<wbr />organizations/<wbr /><strong class="font-semibold">{{
                        addressSlug()
                      }}</strong></span
                    >
                  </p>
                  @if (errors.slug(); as error) {
                    <div
                      role="alert"
                      data-slot="field-error"
                      id="slug-error"
                      class="text-destructive text-sm font-normal flex items-start gap-1.5"
                    >
                      <ng-icon
                        name="lucideCircleAlert"
                        class="mt-0.5 shrink-0 text-base"
                        aria-hidden="true"
                      />
                      @if (takenSlug(); as taken) {
                        <span
                          ><strong class="font-semibold">{{ taken }}</strong> is already taken.
                          Choose another slug.</span
                        >
                      } @else if (reservedParts(); as parts) {
                        <span
                          >{{ parts.before }}<strong class="font-semibold">new</strong
                          >{{ parts.after }}</span
                        >
                      } @else {
                        <span>{{ error }}</span>
                      }
                    </div>
                  }
                </div>
              </div>
              <button
                type="submit"
                data-slot="button"
                class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 bg-primary text-primary-foreground [a]:hover:bg-primary/90 h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3 mt-6 w-full"
                [class.opacity-50]="!online() && !submitting()"
                [attr.aria-disabled]="submitting() || !online() ? 'true' : null"
              >
                @if (submitting()) {
                  <ng-icon
                    name="lucideLoaderCircle"
                    class="motion-safe:animate-spin"
                    data-icon="inline-start"
                    aria-hidden="true"
                  />Creating organization…
                } @else {
                  Create organization
                }
              </button>
              <p role="status" class="sr-only">
                {{ submitting() ? 'Creating the organization.' : '' }}
              </p>
            </form>
          </div>
        </div>
      </div>
    </app-shell>
  `,
})
export class CreateOrganizationPage {
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly create = injectMutation(api.organizations.create);

  protected readonly messages = MESSAGES;
  protected readonly online = injectOnline();
  protected readonly host = inject(DOCUMENT).location.host;

  private readonly model = signal<CreateModel>({ name: '', slug: '' });
  // `required` puts the attribute on both inputs; the messages are ours (checkOrganizationName and
  // checkOrganizationSlug), so the page and `organizations.create` agree.
  protected readonly fields = form(this.model, (path) => {
    required(path.name);
    required(path.slug);
  });

  protected readonly slugEdited = signal(false);
  protected readonly submitting = signal(false);
  protected readonly formAlert = signal<FormAlert | null>(null);

  protected readonly addressSlug = computed(() => this.model().slug || 'your-slug');

  private readonly clientErrors: Record<FieldName, Signal<string | null>> = {
    name: computed(() => {
      const checked = checkOrganizationName(this.model().name);
      return checked.ok ? null : checked.error.message;
    }),
    slug: computed(() => checkOrganizationSlug(this.model().slug)?.message ?? null),
  };

  private readonly shown: Record<FieldName, ShownUntilValid> = {
    name: new ShownUntilValid(
      () => this.clientErrors.name() !== null,
      () => this.fields.name().dirty(),
    ),
    slug: new ShownUntilValid(
      () => this.clientErrors.slug() !== null,
      () => this.fields.slug().dirty() || this.fields.name().dirty(),
    ),
  };

  private readonly serverErrors: Record<FieldName, WritableSignal<ServerError | null>> = {
    name: this.untilChanged(() => this.model().name),
    slug: this.untilChanged(() => this.model().slug),
  };

  protected readonly errors: Record<FieldName, Signal<string | null>> = {
    name: this.shownError('name'),
    slug: this.shownError('slug'),
  };

  protected readonly takenSlug = computed(() =>
    this.shown.slug.shown() ? null : (this.serverErrors.slug()?.taken ?? null),
  );

  protected readonly reservedParts = computed(() => {
    if (this.errors.slug() !== ORGANIZATION_MESSAGES.slugInvalid) return null;
    const message = ORGANIZATION_MESSAGES.slugInvalid;
    const at = message.indexOf(` ${RESERVED_SLUG},`) + 1;
    if (at === 0) return null;
    return { before: message.slice(0, at), after: message.slice(at + RESERVED_SLUG.length) };
  });

  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('name');
  private readonly slugInput = viewChild.required<ElementRef<HTMLInputElement>>('slug');
  private readonly alert = viewChild<ElementRef<HTMLElement>>('alert');

  protected describedBy(field: FieldName, description: string): string {
    return this.errors[field]() ? `${description} ${field}-error` : description;
  }

  protected left(field: FieldName): void {
    this.shown[field].left();
  }

  protected nameTyped(event: Event): void {
    if (this.slugEdited()) return;
    // Read from the event, so the order of this handler and the form field's does not matter.
    const name = (event.target as HTMLInputElement).value;
    this.model.update((m) => ({ ...m, name, slug: name.trim() === '' ? '' : slugify(name) }));
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting()) return;
    this.formAlert.set(null);

    let firstInvalid: FieldName | null = null;
    for (const field of FIELDS) {
      const invalid = this.clientErrors[field]() !== null;
      this.shown[field].submitted();
      if (invalid) firstInvalid ??= field;
    }
    if (firstInvalid) {
      this.focusAfterRender(firstInvalid);
      return;
    }

    if (!this.online()) {
      this.showAlert('offline');
      return;
    }

    const { name, slug } = this.model();
    this.submitting.set(true);
    try {
      await this.create.run({ name: name.trim(), slug });
    } catch (failure) {
      this.submitting.set(false);
      this.showFailure(failure, slug);
      return;
    }
    await this.router.navigateByUrl(adminPath(slug));
    this.submitting.set(false);
  }

  private showFailure(failure: unknown, slug: string): void {
    if (failure instanceof ConvexOfflineError) {
      this.showAlert('offline');
      return;
    }
    const refusal = inputErrorOf(failure);
    if (refusal) {
      this.serverErrors[refusal.field].set({
        text: refusal.message,
        taken: refusal.code === 'slugTaken' ? slug : null,
      });
      this.focusAfterRender(refusal.field);
      return;
    }
    this.showAlert('failed');
  }

  private showAlert(alert: FormAlert): void {
    this.formAlert.set(alert);
    afterNextRender(() => this.alert()?.nativeElement.focus(), { injector: this.injector });
  }

  private focusAfterRender(field: FieldName): void {
    const inputs = { name: this.nameInput, slug: this.slugInput };
    afterNextRender(() => inputs[field]().nativeElement.focus(), { injector: this.injector });
  }

  private untilChanged(value: () => unknown): WritableSignal<ServerError | null> {
    return linkedSignal<unknown, ServerError | null>({ source: value, computation: () => null });
  }

  private shownError(field: FieldName): Signal<string | null> {
    return computed(() =>
      this.shown[field].shown()
        ? this.clientErrors[field]()
        : (this.serverErrors[field]()?.text ?? null),
    );
  }
}
