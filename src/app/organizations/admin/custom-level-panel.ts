import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ConvexError } from 'convex/values';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCircleAlert, lucideLoaderCircle, lucidePlus } from '@ng-icons/lucide';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import {
  checkCustomLevelName,
  checkCustomLevelStandard,
  type CustomLevelField,
  type CustomLevelInputError,
} from '../../../../convex/lib/customLevelInput';
import { levelLabel, levelsOfSport, type StandardLevel } from '../../../../convex/lib/divisions';
import { SPORT_NAMES, type Sport } from '../../../../convex/lib/sports';
import { ConvexOfflineError, injectMutation, injectOnline } from '../../core/data/convex';
import { ShownUntilValid } from '../../core/forms/shown-errors';
import { AdminAlert } from './admin-alert';
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './button-classes';
import { DESCRIPTION, FIELD, FIELD_ERROR, INPUT, LABEL } from './field-classes';

export interface AddedCustomLevel {
  customLevelId: Id<'customLevels'>;
  name: string;
  standardLevel: StandardLevel;
}

type PanelAlert = 'offline' | 'failed';

type Status =
  | { kind: 'added'; level: AddedCustomLevel }
  | { kind: 'removed'; name: string }
  | { kind: 'refused'; message: string };

const PANEL_ALERTS = {
  failed: {
    title: 'The custom level could not be added.',
    description: 'Check your connection and try again.',
  },
  offline: {
    title: "You're offline. Nothing was sent.",
    description: "Your custom level is still here. Try again when you're connected.",
  },
} as const;

const FIELDS: readonly CustomLevelField[] = ['name', 'standardLevel'];
const UNCHOSEN = '';

function refusalOf(failure: unknown): CustomLevelInputError | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, code, message } = data as Record<string, unknown>;
  if (typeof field !== 'string' || !(FIELDS as readonly string[]).includes(field)) return null;
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return { field: field as CustomLevelField, code: code as CustomLevelInputError['code'], message };
}

/** Sits inside the create form's `<form>`, so its buttons are `type="button"` and Enter in the name adds the level. */
@Component({
  selector: 'app-custom-level-panel',
  imports: [AdminAlert, NgIcon],
  providers: [provideIcons({ lucideCheck, lucideCircleAlert, lucideLoaderCircle, lucidePlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (status(); as status) {
      <div
        #statusBox
        [attr.role]="status.kind === 'refused' ? 'alert' : 'status'"
        tabindex="-1"
        class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm"
        [class]="
          status.kind === 'refused'
            ? 'bg-card text-destructive'
            : 'bg-secondary text-secondary-foreground'
        "
      >
        <ng-icon
          [name]="status.kind === 'refused' ? 'lucideCircleAlert' : 'lucideCheck'"
          class="shrink-0 text-base"
          aria-hidden="true"
        />
        @switch (status.kind) {
          @case ('added') {
            <span
              ><span class="font-medium">{{ status.level.name }} added.</span> It filters as
              {{ label(status.level.standardLevel) }}.</span
            >
            <button
              type="button"
              class="inline-flex min-h-11 items-center rounded-md font-medium underline underline-offset-4 md:min-h-0"
              [attr.aria-disabled]="undoing() ? 'true' : null"
              (click)="undo(status.level)"
            >
              {{ undoing() ? 'Undoing…' : 'Undo' }}
            </button>
          }
          @case ('removed') {
            <span class="font-medium">{{ status.name }} removed.</span>
          }
          @case ('refused') {
            <span>{{ status.message }}</span>
          }
        }
      </div>
    }
    <button
      #toggle
      type="button"
      aria-controls="custom-level"
      [attr.aria-expanded]="open()"
      class="mt-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-primary underline underline-offset-4 pointer-coarse:min-h-11"
      (click)="toggleOpen()"
    >
      <ng-icon name="lucidePlus" class="text-base" aria-hidden="true" />Add a custom level
    </button>
    @if (open()) {
      <div id="custom-level" class="mt-3 space-y-4 rounded-lg bg-muted p-4">
        @if (alert(); as kind) {
          <app-admin-alert
            #failureAlert
            [kind]="kind === 'offline' ? 'offline' : 'error'"
            [title]="alerts[kind].title"
            [description]="alerts[kind].description"
          />
        }
        <div
          role="group"
          data-slot="field"
          data-orientation="vertical"
          [attr.data-matches-spartan-invalid]="nameError() ? 'true' : null"
          [class]="fieldClass"
        >
          <label for="custom-level-name" data-slot="field-label" [class]="labelClass"
            >Custom level</label
          >
          <input
            #nameInput
            id="custom-level-name"
            type="text"
            data-slot="input"
            autocomplete="off"
            [value]="name()"
            (input)="nameTyped($event)"
            (blur)="shownName.left()"
            (keydown.enter)="enterInName($event)"
            [attr.aria-describedby]="
              nameError()
                ? 'custom-level-name-description custom-level-name-error'
                : 'custom-level-name-description'
            "
            [attr.aria-invalid]="nameError() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="nameError() ? 'true' : null"
            [class]="inputClass"
          />
          <p
            data-slot="field-description"
            id="custom-level-name-description"
            [class]="descriptionClass"
          >
            As your players know it, such as Gold or Social. Saved for all your
            {{ sportName() }} leagues.
          </p>
          @if (nameError(); as error) {
            <div
              role="alert"
              data-slot="field-error"
              id="custom-level-name-error"
              [class]="errorClass"
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
          [attr.data-matches-spartan-invalid]="standardError() ? 'true' : null"
          [class]="fieldClass"
        >
          <label for="custom-level-maps" data-slot="field-label" [class]="labelClass"
            >Filters as</label
          >
          <select
            #standardSelect
            id="custom-level-maps"
            data-slot="input"
            (change)="standardChosen($event)"
            (blur)="shownStandard.left()"
            [attr.aria-describedby]="
              standardError()
                ? 'custom-level-maps-description custom-level-maps-error'
                : 'custom-level-maps-description'
            "
            [attr.aria-invalid]="standardError() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="standardError() ? 'true' : null"
            [class]="inputClass"
          >
            <option value="" [selected]="standard() === ''">Choose a standard level</option>
            @for (level of standardLevels(); track level) {
              <option [value]="level" [selected]="standard() === level">
                {{ label(level) }}
              </option>
            }
          </select>
          <p
            data-slot="field-description"
            id="custom-level-maps-description"
            [class]="descriptionClass"
          >
            Players who filter for this standard level find your league.
          </p>
          @if (standardError(); as error) {
            <div
              role="alert"
              data-slot="field-error"
              id="custom-level-maps-error"
              [class]="errorClass"
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
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            data-slot="button"
            [class]="addClass"
            [class.opacity-50]="!online() && !submitting()"
            [attr.aria-disabled]="submitting() || !online() ? 'true' : null"
            (click)="add()"
          >
            @if (submitting()) {
              <ng-icon
                name="lucideLoaderCircle"
                class="motion-safe:animate-spin"
                data-icon="inline-start"
                aria-hidden="true"
              />Adding…
            } @else {
              Add level
            }
          </button>
          <button type="button" data-slot="button" [class]="cancelClass" (click)="cancel()">
            Cancel
          </button>
        </div>
        <p role="status" class="sr-only">{{ submitting() ? 'Adding the custom level.' : '' }}</p>
      </div>
    }
  `,
})
export class CustomLevelPanel {
  private readonly injector = inject(Injector);
  private readonly createLevel = injectMutation(api.customLevels.create);
  private readonly removeLevel = injectMutation(api.customLevels.remove);

  readonly organizationId = input.required<Id<'organizations'>>();
  readonly sport = input.required<Sport>();

  readonly added = output<AddedCustomLevel>();
  readonly undone = output<Id<'customLevels'>>();

  protected readonly online = injectOnline();
  protected readonly alerts = PANEL_ALERTS;
  protected readonly fieldClass = FIELD;
  protected readonly labelClass = LABEL;
  protected readonly inputClass = INPUT;
  protected readonly descriptionClass = DESCRIPTION;
  protected readonly errorClass = FIELD_ERROR;
  protected readonly addClass = `${PRIMARY_BUTTON} h-11 md:h-9`;
  protected readonly cancelClass = `${OUTLINE_BUTTON} h-11 md:h-9`;

  protected readonly open = signal(false);
  protected readonly name = signal('');
  protected readonly standard = signal(UNCHOSEN);
  protected readonly submitting = signal(false);
  protected readonly undoing = signal(false);
  protected readonly alert = signal<PanelAlert | null>(null);
  protected readonly status = signal<Status | null>(null);

  protected readonly sportName = computed(() => SPORT_NAMES[this.sport()].toLowerCase());
  protected readonly standardLevels = computed(() => levelsOfSport(this.sport()));

  private readonly clientErrors = {
    name: computed(() => {
      const checked = checkCustomLevelName(this.sport(), this.name());
      return checked.ok ? null : checked.error.message;
    }),
    standardLevel: computed(() => {
      const checked = checkCustomLevelStandard(this.sport(), this.name(), this.standard());
      return checked.ok ? null : checked.error.message;
    }),
  };
  private readonly serverErrors = {
    name: signal<{ for: string; message: string } | null>(null),
    standardLevel: signal<{ for: string; message: string } | null>(null),
  };

  private readonly nameEdited = signal(false);
  protected readonly shownName = new ShownUntilValid(
    () => this.clientErrors.name() !== null,
    () => this.nameEdited(),
  );
  // Leaving the unchosen select is the whole interaction it has, so it counts as changed.
  protected readonly shownStandard = new ShownUntilValid(
    () => this.clientErrors.standardLevel() !== null,
    () => true,
  );

  protected readonly nameError = computed(() => {
    if (this.shownName.shown()) return this.clientErrors.name();
    const server = this.serverErrors.name();
    return server?.for === this.name() ? server.message : null;
  });
  protected readonly standardError = computed(() => {
    if (this.shownStandard.shown()) return this.clientErrors.standardLevel();
    const server = this.serverErrors.standardLevel();
    return server?.for === this.standard() ? server.message : null;
  });

  private readonly toggleButton = viewChild.required<ElementRef<HTMLButtonElement>>('toggle');
  private readonly nameField = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly standardField = viewChild<ElementRef<HTMLSelectElement>>('standardSelect');
  private readonly statusBox = viewChild<ElementRef<HTMLElement>>('statusBox');
  private readonly failureAlert = viewChild<AdminAlert>('failureAlert');

  protected label(level: StandardLevel): string {
    return levelLabel(level);
  }

  protected toggleOpen(): void {
    if (this.open()) {
      this.cancel();
      return;
    }
    this.status.set(null);
    this.open.set(true);
    this.focusAfterRender(() => this.nameField()?.nativeElement.focus());
  }

  protected cancel(): void {
    this.reset();
    this.focusAfterRender(() => this.toggleButton().nativeElement.focus());
  }

  /** Closes the panel and discards its input and status, as a change of sport does. */
  reset(): void {
    this.open.set(false);
    this.name.set('');
    this.nameEdited.set(false);
    this.standard.set(UNCHOSEN);
    this.alert.set(null);
    this.status.set(null);
    this.serverErrors.name.set(null);
    this.serverErrors.standardLevel.set(null);
    this.shownName.hide();
    this.shownStandard.hide();
  }

  protected nameTyped(event: Event): void {
    this.nameEdited.set(true);
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected standardChosen(event: Event): void {
    this.standard.set((event.target as HTMLSelectElement).value);
  }

  protected enterInName(event: Event): void {
    // Enter would submit the create form around the panel.
    event.preventDefault();
    void this.add();
  }

  protected async add(): Promise<void> {
    if (this.submitting()) return;
    this.alert.set(null);
    this.shownName.submitted();
    this.shownStandard.submitted();
    if (this.clientErrors.name() !== null) {
      this.focusAfterRender(() => this.nameField()?.nativeElement.focus());
      return;
    }
    if (this.clientErrors.standardLevel() !== null) {
      this.focusAfterRender(() => this.standardField()?.nativeElement.focus());
      return;
    }
    if (!this.online()) {
      this.showAlert('offline');
      return;
    }
    const sport = this.sport();
    const typed = this.name();
    const name = checkCustomLevelName(sport, typed);
    const standard = checkCustomLevelStandard(sport, typed, this.standard());
    if (!name.ok || !standard.ok) return;
    this.submitting.set(true);
    try {
      const customLevelId = await this.createLevel.run({
        organizationId: this.organizationId(),
        sport,
        name: name.name,
        standardLevel: standard.standardLevel,
      });
      this.created(sport, {
        customLevelId,
        name: name.name,
        standardLevel: standard.standardLevel,
      });
    } catch (failure) {
      this.failed(failure, typed, this.standard());
    } finally {
      this.submitting.set(false);
    }
  }

  protected async undo(level: AddedCustomLevel): Promise<void> {
    if (this.undoing()) return;
    if (!this.online()) {
      this.status.set({
        kind: 'refused',
        message: "You're offline. Nothing was removed. Try again when you're connected.",
      });
      this.focusStatus();
      return;
    }
    this.undoing.set(true);
    try {
      await this.removeLevel.run({ customLevelId: level.customLevelId });
      this.status.set({ kind: 'removed', name: level.name });
      this.undone.emit(level.customLevelId);
    } catch (failure) {
      const refusal = refusalOf(failure);
      this.status.set({
        kind: 'refused',
        message: refusal?.message ?? `${level.name} could not be removed. Try again.`,
      });
    } finally {
      this.undoing.set(false);
    }
    this.focusStatus();
  }

  private created(sport: Sport, level: AddedCustomLevel): void {
    // The level belongs to the sport it was added for; a sport changed meanwhile has closed the panel.
    if (this.sport() !== sport) return;
    this.reset();
    this.status.set({ kind: 'added', level });
    this.added.emit(level);
    this.focusStatus();
  }

  private failed(failure: unknown, name: string, standardLevel: string): void {
    if (failure instanceof ConvexOfflineError) {
      this.showAlert('offline');
      return;
    }
    const refusal = refusalOf(failure);
    if (!refusal) {
      this.showAlert('failed');
      return;
    }
    if (refusal.field === 'name') {
      this.serverErrors.name.set({ for: name, message: refusal.message });
      this.focusAfterRender(() => this.nameField()?.nativeElement.focus());
    } else {
      this.serverErrors.standardLevel.set({ for: standardLevel, message: refusal.message });
      this.focusAfterRender(() => this.standardField()?.nativeElement.focus());
    }
  }

  private showAlert(kind: PanelAlert): void {
    this.alert.set(kind);
    this.focusAfterRender(() => this.failureAlert()?.focus());
  }

  private focusStatus(): void {
    this.focusAfterRender(() => {
      this.statusBox()?.nativeElement.focus();
    });
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
