import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import { ConvexError } from 'convex/values';
import type { Id } from '../../../../convex/_generated/dataModel';
import {
  checkInviteEmail,
  checkInviteLeagues,
  type InviteField,
  type InviteInputError,
} from '../../../../convex/lib/inviteInput';
import type { Role } from '../../../../convex/lib/roles';
import { ConvexOfflineError } from '../../core/data/convex';
import { changedSince, focusLeftGroup, ShownUntilValid } from '../../core/forms/shown-errors';

export type { InviteField };
export const INVITE_FIELDS: readonly InviteField[] = ['email', 'leagues'];

export interface InviteTextModel {
  email: string;
}

export interface InviteValues {
  email: string;
  role: Role;
  leagueIds: Id<'leagues'>[];
}

export type InviteFormAlertKind = 'offline' | 'failed';

export const INVITE_FORM_ALERTS = {
  failed: {
    title: 'The invite could not be created.',
    description: 'Check your connection and try again.',
  },
  offline: {
    title: "You're offline. Nothing was sent.",
    description: "Your details are still here. Try again when you're connected.",
  },
} as const;

export type InviteSubmitOutcome<R> =
  | { sent: true; values: InviteValues; result: R }
  | { sent: false; focus: InviteField }
  | { sent: false; alert: InviteFormAlertKind };

function inputErrorOf(failure: unknown): InviteInputError | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, code, message } = data as Record<string, unknown>;
  if (typeof field !== 'string' || !(INVITE_FIELDS as readonly string[]).includes(field)) {
    return null;
  }
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return { field: field as InviteField, code: code as InviteInputError['code'], message };
}

/** Role defaults to League organizer, the least access; with no league in the organization it is Org admin and League organizer is unavailable. */
export class InviteForm {
  readonly model: WritableSignal<InviteTextModel> = signal({ email: '' });
  readonly fields: FieldTree<InviteTextModel>;
  readonly chosenRole = signal<Role>('leagueOrganizer');
  readonly selected = signal<ReadonlySet<Id<'leagues'>>>(new Set());
  readonly submitting = signal(false);
  readonly alert = signal<InviteFormAlertKind | null>(null);

  readonly canChooseOrganizer: Signal<boolean>;
  readonly role: Signal<Role>;
  readonly chosen: Signal<Id<'leagues'>[]>;

  private readonly clientErrors: Record<InviteField, Signal<string | null>>;
  private readonly shown: Record<InviteField, ShownUntilValid>;
  private readonly leaguesChanged = changedSince(() => this.selected());
  private readonly serverErrors: Record<InviteField, WritableSignal<string | null>>;

  readonly errors: Record<InviteField, Signal<string | null>>;

  constructor(available: () => readonly Id<'leagues'>[]) {
    // `required` puts the attribute on the input; the messages are ours (`inviteInput.ts`), so the
    // form and `invites.create` agree.
    this.fields = form(this.model, (path) => {
      required(path.email);
    });
    this.canChooseOrganizer = computed(() => available().length > 0);
    this.role = computed(() => (this.canChooseOrganizer() ? this.chosenRole() : 'orgAdmin'));
    this.chosen = computed(() => available().filter((id) => this.selected().has(id)));
    this.clientErrors = {
      email: computed(() => {
        const checked = checkInviteEmail(this.model().email);
        return checked.ok ? null : checked.error.message;
      }),
      leagues: computed(() =>
        this.role() === 'leagueOrganizer'
          ? (checkInviteLeagues(this.chosen().length)?.message ?? null)
          : null,
      ),
    };
    this.shown = {
      email: new ShownUntilValid(
        () => this.clientErrors.email() !== null,
        () => this.fields.email().dirty(),
      ),
      leagues: new ShownUntilValid(
        () => this.clientErrors.leagues() !== null,
        () => this.leaguesChanged(),
      ),
    };
    this.serverErrors = {
      email: this.untilChanged(() => this.model().email),
      leagues: this.untilChanged(() => [this.role(), this.chosen()]),
    };
    this.errors = {
      email: this.shownError('email'),
      leagues: this.shownError('leagues'),
    };
  }

  toggleLeague(id: Id<'leagues'>, checked: boolean): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  clear(): void {
    this.model.set({ email: '' });
    this.chosenRole.set('leagueOrganizer');
    this.selected.set(new Set());
    this.fields().reset();
    this.leaguesChanged.set(false);
    this.alert.set(null);
  }

  left(field: InviteField): void {
    this.shown[field].left();
  }

  leftGroup(field: InviteField, event: FocusEvent): void {
    if (focusLeftGroup(event)) this.left(field);
  }

  async submit<R>(
    online: boolean,
    send: (values: InviteValues) => Promise<R>,
  ): Promise<InviteSubmitOutcome<R>> {
    this.alert.set(null);
    let firstInvalid: InviteField | null = null;
    for (const field of INVITE_FIELDS) {
      this.shown[field].submitted();
      if (this.clientErrors[field]() !== null) firstInvalid ??= field;
    }
    if (firstInvalid) return { sent: false, focus: firstInvalid };

    if (!online) return this.showAlert('offline');

    const checked = checkInviteEmail(this.model().email);
    if (!checked.ok) return { sent: false, focus: 'email' };
    const role = this.role();
    const values: InviteValues = {
      email: checked.email,
      role,
      leagueIds: role === 'leagueOrganizer' ? this.chosen() : [],
    };
    this.submitting.set(true);
    try {
      const result = await send(values);
      return { sent: true, values, result };
    } catch (failure) {
      return this.failed(failure);
    } finally {
      this.submitting.set(false);
    }
  }

  private failed(failure: unknown): InviteSubmitOutcome<never> {
    if (failure instanceof ConvexOfflineError) return this.showAlert('offline');
    const refusal = inputErrorOf(failure);
    if (refusal) {
      this.serverErrors[refusal.field].set(refusal.message);
      return { sent: false, focus: refusal.field };
    }
    return this.showAlert('failed');
  }

  private showAlert(alert: InviteFormAlertKind): InviteSubmitOutcome<never> {
    this.alert.set(alert);
    return { sent: false, alert };
  }

  private untilChanged(value: () => unknown): WritableSignal<string | null> {
    return linkedSignal<unknown, string | null>({ source: value, computation: () => null });
  }

  private shownError(field: InviteField): Signal<string | null> {
    return computed(() =>
      this.shown[field].shown() ? this.clientErrors[field]() : this.serverErrors[field](),
    );
  }
}
