import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import { ConvexError } from 'convex/values';
import type { Id } from '../../../../convex/_generated/dataModel';
import {
  checkLeagueLocations,
  checkLeagueName,
  checkLeagueSlug,
  LEAGUE_MESSAGES,
  type LeagueField,
  type LeagueInputError,
} from '../../../../convex/lib/leagueInput';
import { slugify } from '../../../../convex/lib/slugs';
import type { Sport } from '../../../../convex/lib/sports';
import { ConvexOfflineError } from '../../core/data/convex';
import { changedSince, focusLeftGroup, ShownUntilValid } from '../../core/forms/shown-errors';

export type { LeagueField };
export const LEAGUE_FIELDS: readonly LeagueField[] = ['name', 'slug', 'sport', 'locations'];

export interface LeagueTextModel {
  name: string;
  slug: string;
}

export interface LeagueValues {
  name: string;
  slug: string;
  sport: Sport;
  locationIds: Id<'locations'>[];
}

export type LeagueFormAlertKind = 'offline' | 'failed';

export const LEAGUE_FORM_ALERTS = {
  failed: {
    title: 'The league could not be created.',
    description: 'Check your connection and try again.',
  },
  offline: {
    title: "You're offline. Nothing was sent.",
    description: "Your details are still here. Try again when you're connected.",
  },
} as const;

export type LeagueSubmitOutcome =
  | { sent: true; values: LeagueValues }
  | { sent: false; focus: LeagueField }
  | { sent: false; alert: LeagueFormAlertKind };

const RESERVED_SLUG = 'new';

interface ServerError {
  text: string;
  taken: string | null;
}

function inputErrorOf(failure: unknown): LeagueInputError | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, code, message } = data as Record<string, unknown>;
  if (typeof field !== 'string' || !(LEAGUE_FIELDS as readonly string[]).includes(field)) {
    return null;
  }
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return { field: field as LeagueField, code: code as LeagueInputError['code'], message };
}

export class LeagueForm {
  readonly model: WritableSignal<LeagueTextModel> = signal({ name: '', slug: '' });
  readonly fields: FieldTree<LeagueTextModel>;
  readonly sport = signal<Sport | null>(null);
  readonly selected: WritableSignal<ReadonlySet<Id<'locations'>>>;
  readonly slugEdited = signal(false);
  readonly submitting = signal(false);
  readonly alert = signal<LeagueFormAlertKind | null>(null);

  readonly chosen: Signal<Id<'locations'>[]>;

  private readonly defaultSelected: () => ReadonlySet<Id<'locations'>>;
  private readonly clientErrors: Record<LeagueField, Signal<string | null>>;
  private readonly shown: Record<LeagueField, ShownUntilValid>;
  private readonly locationsChanged = changedSince(() => this.selected());
  private readonly serverErrors: Record<LeagueField, WritableSignal<ServerError | null>>;

  readonly errors: Record<LeagueField, Signal<string | null>>;

  readonly takenSlug: Signal<string | null>;

  readonly reservedParts: Signal<{ before: string; after: string } | null>;

  constructor(available: () => readonly Id<'locations'>[]) {
    // `required` puts the attribute on both inputs; the messages are ours (`leagueInput.ts`), so
    // the form and `leagues.create` agree.
    this.fields = form(this.model, (path) => {
      required(path.name);
      required(path.slug);
    });
    // The source is the only location's id, not the list, so a list that emits again with the same
    // single location does not undo the user's choice.
    const onlyLocation = computed(() => {
      const ids = available();
      return ids.length === 1 ? ids[0] : null;
    });
    this.defaultSelected = (): ReadonlySet<Id<'locations'>> => {
      const only = onlyLocation();
      return new Set(only === null ? [] : [only]);
    };
    this.selected = linkedSignal<Id<'locations'> | null, ReadonlySet<Id<'locations'>>>({
      source: onlyLocation,
      computation: (only, previous) =>
        only === null ? (previous?.value ?? new Set()) : new Set([only]),
    });
    this.chosen = computed(() => available().filter((id) => this.selected().has(id)));
    this.clientErrors = {
      name: computed(() => {
        const checked = checkLeagueName(this.model().name);
        return checked.ok ? null : checked.error.message;
      }),
      slug: computed(() => checkLeagueSlug(this.model().slug)?.message ?? null),
      sport: computed(() => (this.sport() === null ? LEAGUE_MESSAGES.sportEmpty : null)),
      locations: computed(() => checkLeagueLocations(this.chosen().length)?.message ?? null),
    };
    const slugChanged = () => this.fields.slug().dirty() || this.fields.name().dirty();
    const changed: Record<LeagueField, () => boolean> = {
      name: () => this.fields.name().dirty(),
      slug: slugChanged,
      // A chosen radio is always valid, so leaving it cannot show an error.
      sport: () => false,
      locations: () => this.locationsChanged(),
    };
    this.shown = Object.fromEntries(
      LEAGUE_FIELDS.map((field) => [
        field,
        new ShownUntilValid(() => this.clientErrors[field]() !== null, changed[field]),
      ]),
    ) as Record<LeagueField, ShownUntilValid>;
    this.serverErrors = {
      name: this.untilChanged(() => this.model().name),
      slug: this.untilChanged(() => this.model().slug),
      sport: this.untilChanged(() => this.sport()),
      locations: this.untilChanged(() => this.chosen()),
    };
    this.errors = {
      name: this.shownError('name'),
      slug: this.shownError('slug'),
      sport: this.shownError('sport'),
      locations: this.shownError('locations'),
    };
    this.takenSlug = computed(() =>
      this.shown.slug.shown() ? null : (this.serverErrors.slug()?.taken ?? null),
    );
    this.reservedParts = computed(() => {
      if (this.errors.slug() !== LEAGUE_MESSAGES.slugInvalid) return null;
      const message = LEAGUE_MESSAGES.slugInvalid;
      const at = message.indexOf(` ${RESERVED_SLUG},`) + 1;
      if (at === 0) return null;
      return { before: message.slice(0, at), after: message.slice(at + RESERVED_SLUG.length) };
    });
  }

  nameTyped(name: string): void {
    if (this.slugEdited()) return;
    this.model.update((m) => ({ ...m, name, slug: name.trim() === '' ? '' : slugify(name) }));
  }

  toggleLocation(id: Id<'locations'>, checked: boolean): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  clear(): void {
    this.model.set({ name: '', slug: '' });
    this.slugEdited.set(false);
    this.sport.set(null);
    this.selected.set(this.defaultSelected());
    this.fields().reset();
    this.locationsChanged.set(false);
  }

  left(field: LeagueField): void {
    this.shown[field].left();
  }

  leftGroup(field: LeagueField, event: FocusEvent): void {
    if (focusLeftGroup(event)) this.left(field);
  }

  async submit(
    online: boolean,
    send: (values: LeagueValues) => Promise<unknown>,
  ): Promise<LeagueSubmitOutcome> {
    this.alert.set(null);
    let firstInvalid: LeagueField | null = null;
    for (const field of LEAGUE_FIELDS) {
      this.shown[field].submitted();
      if (this.clientErrors[field]() !== null) firstInvalid ??= field;
    }
    if (firstInvalid) return { sent: false, focus: firstInvalid };

    const pressedOffline = !online;
    if (pressedOffline) return this.showAlert('offline');

    const { name, slug } = this.model();
    const values: LeagueValues = {
      name: name.trim(),
      slug,
      sport: this.sport()!,
      locationIds: this.chosen(),
    };
    this.submitting.set(true);
    try {
      await send(values);
    } catch (failure) {
      return this.failed(failure, slug);
    } finally {
      this.submitting.set(false);
    }
    return { sent: true, values };
  }

  private failed(failure: unknown, slug: string): LeagueSubmitOutcome {
    if (failure instanceof ConvexOfflineError) return this.showAlert('offline');
    const refusal = inputErrorOf(failure);
    if (refusal) {
      this.serverErrors[refusal.field].set({
        text: refusal.message,
        taken: refusal.code === 'slugTaken' ? slug : null,
      });
      return { sent: false, focus: refusal.field };
    }
    return this.showAlert('failed');
  }

  private showAlert(alert: LeagueFormAlertKind): LeagueSubmitOutcome {
    this.alert.set(alert);
    return { sent: false, alert };
  }

  private untilChanged(value: () => unknown): WritableSignal<ServerError | null> {
    return linkedSignal<unknown, ServerError | null>({ source: value, computation: () => null });
  }

  private shownError(field: LeagueField): Signal<string | null> {
    return computed(() =>
      this.shown[field].shown()
        ? this.clientErrors[field]()
        : (this.serverErrors[field]()?.text ?? null),
    );
  }
}
