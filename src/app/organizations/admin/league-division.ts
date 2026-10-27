import { computed, signal, type Signal } from '@angular/core';
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
const DEFAULT_LEVEL: StandardLevel = 'rec';

export class LeagueDivision {
  readonly gender = signal<Gender>('coed');
  readonly playersPerSide = signal<number | null>(null);
  readonly level = signal<StandardLevel>(DEFAULT_LEVEL);
  readonly ageGroup = signal<AgeGroup>('adult');
  readonly minimumText = signal('');

  private readonly chosenByHand = signal<ReadonlySet<DivisionChoice>>(new Set());
  private readonly filled = signal<ReadonlySet<DivisionChoice>>(new Set());

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
    this.choseByHand('level');
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
    if (!isLevelOfSport(sport, this.level())) {
      this.level.set(DEFAULT_LEVEL);
      this.forget('level');
    }
  }

  fillFromName(name: string, sport: Sport | null): void {
    if (sport === null) return;
    const { gender, playersPerSide, level } = deriveDivisionFromName(name, sport);
    if (gender !== undefined) this.fill('gender', () => this.gender.set(gender));
    if (playersPerSide !== undefined) {
      this.fill('format', () => this.playersPerSide.set(playersPerSide));
    }
    if (level !== undefined) this.fill('level', () => this.level.set(level));
  }

  clear(): void {
    this.gender.set('coed');
    this.playersPerSide.set(null);
    this.level.set(DEFAULT_LEVEL);
    this.ageGroup.set('adult');
    this.minimumText.set('');
    this.chosenByHand.set(new Set());
    this.filled.set(new Set());
  }

  private fill(choice: DivisionChoice, set: () => void): void {
    if (this.chosenByHand().has(choice)) return;
    set();
    this.filled.update((current) => new Set(current).add(choice));
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
