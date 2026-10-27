import { computed, signal, type Signal } from '@angular/core';
import type { Id } from '../../../../convex/_generated/dataModel';
import {
  deriveDivisionFromName,
  isLevelOfSport,
  isPlayersPerSideOfSport,
  type AgeGroup,
  type Gender,
  type StandardLevel,
} from '../../../../convex/lib/divisions';
import type { Sport } from '../../../../convex/lib/sports';

export type DivisionChoice = 'gender' | 'format' | 'level';

const CHOICES: readonly DivisionChoice[] = ['gender', 'format', 'level'];
const DEFAULT_GENDER: Gender = 'coed';
const DEFAULT_LEVEL: StandardLevel = 'rec';

export interface ChosenCustomLevel {
  customLevelId: Id<'customLevels'>;
  standardLevel: StandardLevel;
}

interface LevelChoice {
  level: StandardLevel;
  customLevelId: Id<'customLevels'> | null;
  byHand: boolean;
  filled: boolean;
}

export class LeagueDivision {
  readonly gender = signal<Gender>('coed');
  readonly playersPerSide = signal<number | null>(null);
  /** The level always holds the standard level the league filters as; a custom level only renames it. */
  readonly level = signal<StandardLevel>(DEFAULT_LEVEL);
  readonly customLevelId = signal<Id<'customLevels'> | null>(null);
  readonly ageGroup = signal<AgeGroup>('adult');
  readonly minimumText = signal('');

  private readonly chosenByHand = signal<ReadonlySet<DivisionChoice>>(new Set());
  private readonly filled = signal<ReadonlySet<DivisionChoice>>(new Set());
  private levelBeforeCustom: LevelChoice | null = null;

  readonly filledFromName: Signal<readonly DivisionChoice[]> = computed(() =>
    CHOICES.filter((choice) => this.filled().has(choice)),
  );

  /** Undefined when blank; NaN when the text is not a number, which the input check refuses. */
  readonly minimumRosterSize = computed(() => {
    const text = this.minimumText().trim();
    return text === '' ? undefined : Number(text);
  });

  chooseGender(gender: Gender): void {
    this.gender.set(gender);
    this.choseByHand('gender');
  }

  chooseFormat(playersPerSide: number): void {
    this.playersPerSide.set(playersPerSide);
    this.choseByHand('format');
  }

  chooseLevel(level: StandardLevel): void {
    this.level.set(level);
    this.customLevelId.set(null);
    this.choseByHand('level');
  }

  chooseCustomLevel({ customLevelId, standardLevel }: ChosenCustomLevel): void {
    this.levelBeforeCustom = {
      level: this.level(),
      customLevelId: this.customLevelId(),
      byHand: this.chosenByHand().has('level'),
      filled: this.filled().has('level'),
    };
    this.level.set(standardLevel);
    this.customLevelId.set(customLevelId);
    this.choseByHand('level');
  }

  /** Puts back the level chosen before the custom level, unless another level was chosen since. */
  undoCustomLevel(customLevelId: Id<'customLevels'>): void {
    const before = this.levelBeforeCustom;
    this.levelBeforeCustom = null;
    if (this.customLevelId() !== customLevelId) return;
    this.level.set(before?.level ?? DEFAULT_LEVEL);
    this.customLevelId.set(before?.customLevelId ?? null);
    this.forget('level');
    if (before?.byHand) this.chosenByHand.update((current) => new Set(current).add('level'));
    if (before?.filled) this.filled.update((current) => new Set(current).add('level'));
  }

  setAgeGroup(ageGroup: AgeGroup): void {
    this.ageGroup.set(ageGroup);
  }

  setMinimumText(text: string): void {
    this.minimumText.set(text);
  }

  sportChanged(sport: Sport): void {
    const format = this.playersPerSide();
    if (format !== null && !isPlayersPerSideOfSport(sport, format)) {
      this.playersPerSide.set(null);
      this.forget('format');
    }
    if (this.customLevelId() !== null || !isLevelOfSport(sport, this.level())) {
      this.level.set(DEFAULT_LEVEL);
      this.customLevelId.set(null);
      this.forget('level');
    }
  }

  fillFromName(name: string, sport: Sport | null): void {
    if (sport === null) return;
    const { gender, playersPerSide, level } = deriveDivisionFromName(name, sport);
    this.fillOrReset('gender', gender, DEFAULT_GENDER, (value) => this.gender.set(value));
    this.fillOrReset('format', playersPerSide, null, (value) => this.playersPerSide.set(value));
    this.fillOrReset('level', level, DEFAULT_LEVEL, (value) => this.level.set(value));
  }

  clear(): void {
    this.gender.set(DEFAULT_GENDER);
    this.playersPerSide.set(null);
    this.level.set(DEFAULT_LEVEL);
    this.customLevelId.set(null);
    this.levelBeforeCustom = null;
    this.ageGroup.set('adult');
    this.minimumText.set('');
    this.chosenByHand.set(new Set());
    this.filled.set(new Set());
  }

  // A value the name once stated and now does not goes back to its default, so the status line stays true.
  private fillOrReset<T>(
    choice: DivisionChoice,
    stated: T | undefined,
    fallback: T,
    set: (value: T) => void,
  ): void {
    if (this.chosenByHand().has(choice)) return;
    if (stated !== undefined) {
      set(stated);
      this.filled.update((current) => new Set(current).add(choice));
    } else if (this.filled().has(choice)) {
      set(fallback);
      this.filled.update((current) => withoutChoice(current, choice));
    }
  }

  private choseByHand(choice: DivisionChoice): void {
    this.chosenByHand.update((current) => new Set(current).add(choice));
    this.filled.update((current) => withoutChoice(current, choice));
  }

  private forget(choice: DivisionChoice): void {
    this.chosenByHand.update((current) => withoutChoice(current, choice));
    this.filled.update((current) => withoutChoice(current, choice));
  }
}

function withoutChoice(
  choices: ReadonlySet<DivisionChoice>,
  choice: DivisionChoice,
): ReadonlySet<DivisionChoice> {
  const next = new Set(choices);
  next.delete(choice);
  return next;
}

export function filledFromNameMessage(choices: readonly DivisionChoice[]): string | null {
  if (choices.length === 0) return null;
  const rest = [...choices];
  const last = rest.pop()!;
  const oxfordComma = rest.length > 1 ? ',' : '';
  const list = rest.length === 0 ? last : `${rest.join(', ')}${oxfordComma} and ${last}`;
  const sentence = `${list.charAt(0).toUpperCase()}${list.slice(1)}`;
  const verb = choices.length === 1 ? 'was' : 'were';
  return `${sentence} ${verb} filled in from the name. Change any that are wrong.`;
}
