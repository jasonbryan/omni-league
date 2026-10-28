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

export type DivisionDetail = 'gender' | 'format' | 'level' | 'ageGroup' | 'minimumRosterSize';

const CHOICES: readonly DivisionChoice[] = ['gender', 'format', 'level'];
const DETAILS: readonly DivisionDetail[] = [
  'gender',
  'format',
  'level',
  'ageGroup',
  'minimumRosterSize',
];
const DETAIL_CHOICE: Partial<Record<DivisionDetail, DivisionChoice>> = {
  gender: 'gender',
  format: 'format',
  level: 'level',
};
const DEFAULT_GENDER: Gender = 'coed';
const DEFAULT_LEVEL: StandardLevel = 'rec';
const DEFAULT_AGE_GROUP: AgeGroup = 'adult';

export interface SavedDivision {
  gender: Gender;
  playersPerSide: number;
  level: StandardLevel;
  customLevelId?: Id<'customLevels'> | undefined;
  ageGroup: AgeGroup;
  minimumRosterSize?: number | undefined;
}

export interface ChosenCustomLevel {
  customLevelId: Id<'customLevels'>;
  standardLevel: StandardLevel;
}

interface DivisionValues {
  gender: Gender;
  playersPerSide: number | null;
  level: StandardLevel;
  customLevelId: Id<'customLevels'> | null;
  ageGroup: AgeGroup;
  minimumText: string;
}

function valuesOf(saved: SavedDivision | undefined): DivisionValues {
  return {
    gender: saved?.gender ?? DEFAULT_GENDER,
    playersPerSide: saved?.playersPerSide ?? null,
    level: saved?.level ?? DEFAULT_LEVEL,
    customLevelId: saved?.customLevelId ?? null,
    ageGroup: saved?.ageGroup ?? DEFAULT_AGE_GROUP,
    minimumText: saved?.minimumRosterSize === undefined ? '' : String(saved.minimumRosterSize),
  };
}

function differs(a: DivisionValues, b: DivisionValues, detail: DivisionDetail): boolean {
  switch (detail) {
    case 'gender':
      return a.gender !== b.gender;
    case 'format':
      return a.playersPerSide !== b.playersPerSide;
    case 'level':
      return a.level !== b.level || a.customLevelId !== b.customLevelId;
    case 'ageGroup':
      return a.ageGroup !== b.ageGroup;
    case 'minimumRosterSize':
      return a.minimumText !== b.minimumText;
  }
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
  readonly level = signal<StandardLevel>(DEFAULT_LEVEL);
  readonly customLevelId = signal<Id<'customLevels'> | null>(null);
  readonly ageGroup = signal<AgeGroup>('adult');
  readonly minimumText = signal('');

  private readonly chosenByHand = signal<ReadonlySet<DivisionChoice>>(new Set());
  private readonly filled = signal<ReadonlySet<DivisionChoice>>(new Set());
  private levelBeforeCustom: LevelChoice | null = null;
  // A saved division is not news when the name states it again.
  private loaded = false;
  private savedBaseline: SavedDivision | undefined;
  private baselineValues = valuesOf(undefined);
  private readonly savedByOthers = new Set<DivisionChoice>();

  readonly filledFromName: Signal<readonly DivisionChoice[]> = computed(() =>
    CHOICES.filter((choice) => this.filled().has(choice)),
  );

  /** Undefined when blank; NaN when the text is not a number, which the input check refuses. */
  readonly minimumRosterSize = computed(() => {
    const text = this.minimumText().trim();
    return text === '' ? undefined : Number(text);
  });

  get baseline(): SavedDivision | undefined {
    return this.savedBaseline;
  }

  edited(): ReadonlySet<DivisionDetail> {
    const current = this.values();
    return new Set(DETAILS.filter((detail) => differs(current, this.baselineValues, detail)));
  }

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

  undoCustomLevel(customLevelId: Id<'customLevels'>): void {
    const before = this.levelBeforeCustom;
    this.levelBeforeCustom = null;
    const choiceReplaced = this.customLevelId() !== customLevelId;
    if (choiceReplaced) return;
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

  /** A saved custom level counts as chosen by hand, so the name never replaces it. */
  load(saved: SavedDivision): void {
    this.gender.set(saved.gender);
    this.playersPerSide.set(saved.playersPerSide);
    this.level.set(saved.level);
    this.customLevelId.set(saved.customLevelId ?? null);
    this.ageGroup.set(saved.ageGroup);
    this.minimumText.set(
      saved.minimumRosterSize === undefined ? '' : String(saved.minimumRosterSize),
    );
    this.levelBeforeCustom = null;
    this.chosenByHand.set(new Set(saved.customLevelId === undefined ? [] : ['level']));
    this.filled.set(new Set());
    this.loaded = true;
    this.savedByOthers.clear();
    this.savedBaseline = saved;
    this.baselineValues = valuesOf(saved);
  }

  takeSavedByOthers(saved: SavedDivision): void {
    const next = valuesOf(saved);
    const edited = this.edited();
    for (const detail of DETAILS) {
      if (!differs(next, this.baselineValues, detail)) continue;
      const choice = DETAIL_CHOICE[detail];
      if (choice) this.savedByOthers.add(choice);
      if (!edited.has(detail)) this.take(detail, next);
    }
    this.savedBaseline = saved;
    this.baselineValues = next;
  }

  fillFromName(name: string, sport: Sport | null): void {
    if (sport === null) return;
    const { gender, playersPerSide, level } = deriveDivisionFromName(name, sport);
    this.fillOrReset('gender', gender, this.gender(), DEFAULT_GENDER, (value) =>
      this.gender.set(value),
    );
    this.fillOrReset('format', playersPerSide, this.playersPerSide(), null, (value) =>
      this.playersPerSide.set(value),
    );
    this.fillOrReset('level', level, this.level(), DEFAULT_LEVEL, (value) => this.level.set(value));
  }

  clear(): void {
    this.gender.set(DEFAULT_GENDER);
    this.playersPerSide.set(null);
    this.level.set(DEFAULT_LEVEL);
    this.customLevelId.set(null);
    this.levelBeforeCustom = null;
    this.ageGroup.set(DEFAULT_AGE_GROUP);
    this.minimumText.set('');
    this.chosenByHand.set(new Set());
    this.filled.set(new Set());
    this.loaded = false;
    this.savedByOthers.clear();
    this.savedBaseline = undefined;
    this.baselineValues = valuesOf(undefined);
  }

  private values(): DivisionValues {
    return {
      gender: this.gender(),
      playersPerSide: this.playersPerSide(),
      level: this.level(),
      customLevelId: this.customLevelId(),
      ageGroup: this.ageGroup(),
      minimumText: this.minimumText(),
    };
  }

  private take(detail: DivisionDetail, next: DivisionValues): void {
    switch (detail) {
      case 'gender':
        this.gender.set(next.gender);
        break;
      case 'format':
        this.playersPerSide.set(next.playersPerSide);
        break;
      case 'level':
        this.level.set(next.level);
        this.customLevelId.set(next.customLevelId);
        this.levelBeforeCustom = null;
        break;
      case 'ageGroup':
        this.ageGroup.set(next.ageGroup);
        break;
      case 'minimumRosterSize':
        this.minimumText.set(next.minimumText);
        break;
    }
    const choice = DETAIL_CHOICE[detail];
    if (choice) this.forget(choice);
  }

  // A value the name once stated and now does not goes back to its default, so the status line stays true.
  private fillOrReset<T>(
    choice: DivisionChoice,
    stated: T | undefined,
    current: T,
    fallback: T,
    set: (value: T) => void,
  ): void {
    if (this.chosenByHand().has(choice) || this.savedByOthers.has(choice)) return;
    if (this.loaded && stated === current) return;
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
