import { DOCUMENT, Injectable, inject } from '@angular/core';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { convexToJson, jsonToConvex, type JSONValue, type Value } from 'convex/values';
import { matchesValidator } from './matches-validator';
import { OFFLINE_SAVED_QUERIES, type OfflineSavedQuery } from './offline-saved-queries';

export const SAVED_COPY_PREFIX = 'cvx-saved:';
export const SAVED_COPY_MAX_ENTRIES = 50;
export const SAVED_COPY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * A saved time later than now by more than this is not used, and is removed: the device clock was
 * set back, or the entry was not written by this app. The margin covers small clock corrections.
 */
export const SAVED_COPY_MAX_FUTURE_MS = 60 * 1000;
/**
 * The saved copies' keys and values together stay under this many UTF-16 code units (about 2 MB), well under the browser's `localStorage` quota,
 * so they never crowd out the rest of the app's storage (the sign-in session). A single result larger than this is not saved.
 */
export const SAVED_COPY_MAX_TOTAL_LENGTH = 1_000_000;

export interface SavedCopy {
  readonly value: unknown;
  readonly savedAt: number;
}

interface StoredCopy {
  v: JSONValue;
  savedAt: number;
  usedAt: number;
  version: number;
}

/** Convex JSON with every object's keys sorted, so equal args always give one string. */
function sortKeys(value: JSONValue): JSONValue {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

export function savedCopyKey(query: FunctionReference<'query'>, args: object): string {
  return `${SAVED_COPY_PREFIX}${getFunctionName(query)}:${JSON.stringify(sortKeys(convexToJson(args as Value)))}`;
}

/** Args are always a JSON object, so the function name ends at `:{`. */
function functionNameOf(key: string): string {
  const rest = key.slice(SAVED_COPY_PREFIX.length);
  const end = rest.indexOf(':{');
  return end < 0 ? rest : rest.slice(0, end);
}

function parseStored(raw: string, entry: OfflineSavedQuery, now: number): StoredCopy | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('v' in parsed)) return undefined;
    const { v, savedAt, usedAt, version } = parsed as Partial<StoredCopy>;
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return undefined;
    if (now - savedAt > SAVED_COPY_MAX_AGE_MS || savedAt - now > SAVED_COPY_MAX_FUTURE_MS) {
      return undefined;
    }
    if (version !== entry.version) return undefined;
    return {
      v: v as JSONValue,
      savedAt,
      usedAt: typeof usedAt === 'number' && Number.isFinite(usedAt) ? usedAt : savedAt,
      version,
    };
  } catch {
    return undefined;
  }
}

function decodeValue(stored: StoredCopy, entry: OfflineSavedQuery): { value: Value } | undefined {
  try {
    const value = jsonToConvex(stored.v);
    // `write` never stores null (a live null removes the entry), so a stored null is not ours.
    if (value === null || !matchesValidator(value, entry.returns)) return undefined;
    return { value };
  } catch {
    return undefined;
  }
}

/**
 * Every storage error (no storage in a private window, quota exceeded, a value that is not a saved copy) is ignored:
 * the page then behaves as if nothing were saved.
 */
@Injectable({ providedIn: 'root' })
export class ConvexSavedCopies {
  private readonly window = inject(DOCUMENT).defaultView;
  private readonly listed = new Map(
    OFFLINE_SAVED_QUERIES.map((entry) => [getFunctionName(entry.query), entry]),
  );

  isListed(query: FunctionReference<'query'>): boolean {
    return this.listed.has(getFunctionName(query));
  }

  read(query: FunctionReference<'query'>, args: object): SavedCopy | undefined {
    const entry = this.listed.get(getFunctionName(query));
    if (!entry) return undefined;
    const storage = this.storage();
    if (!storage) return undefined;
    try {
      const key = savedCopyKey(query, args);
      const raw = storage.getItem(key);
      if (raw === null) return undefined;
      const now = Date.now();
      const stored = parseStored(raw, entry, now);
      const decoded = stored && decodeValue(stored, entry);
      if (!stored || !decoded) {
        storage.removeItem(key);
        return undefined;
      }
      this.trySet(storage, key, JSON.stringify({ ...stored, usedAt: now }));
      return { value: decoded.value, savedAt: stored.savedAt };
    } catch {
      return undefined;
    }
  }

  write(query: FunctionReference<'query'>, args: object, value: unknown): void {
    const entry = this.listed.get(getFunctionName(query));
    if (!entry) return;
    const storage = this.storage();
    if (!storage) return;
    try {
      const key = savedCopyKey(query, args);
      if (value === null || value === undefined || !matchesValidator(value, entry.returns)) {
        storage.removeItem(key);
        return;
      }
      const now = Date.now();
      const stored: StoredCopy = {
        v: convexToJson(value as Value),
        savedAt: now,
        usedAt: now,
        version: entry.version,
      };
      const raw = JSON.stringify(stored);
      if (key.length + raw.length > SAVED_COPY_MAX_TOTAL_LENGTH) {
        storage.removeItem(key);
        return;
      }
      const previous = storage.getItem(key);
      if (!this.trySet(storage, key, raw)) return;
      if (previous === null || raw.length > previous.length) this.prune(storage, key);
    } catch {
      // A storage error leaves the page as if nothing were saved.
    }
  }

  private prune(storage: Storage, keep: string): void {
    const now = Date.now();
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(SAVED_COPY_PREFIX)) keys.push(key);
    }
    const entries: { key: string; usedAt: number; length: number }[] = [];
    for (const key of keys) {
      const raw = storage.getItem(key);
      const entry = this.listed.get(functionNameOf(key));
      const stored = raw === null || !entry ? undefined : parseStored(raw, entry, now);
      if (!raw || !stored) {
        storage.removeItem(key);
        continue;
      }
      entries.push({
        key,
        usedAt: key === keep ? Infinity : stored.usedAt,
        length: key.length + raw.length,
      });
    }
    entries.sort((a, b) => b.usedAt - a.usedAt);
    let count = 0;
    let total = 0;
    let evicting = false;
    for (const entry of entries) {
      if (
        !evicting &&
        count < SAVED_COPY_MAX_ENTRIES &&
        total + entry.length <= SAVED_COPY_MAX_TOTAL_LENGTH
      ) {
        count++;
        total += entry.length;
      } else {
        evicting = true;
        storage.removeItem(entry.key);
      }
    }
  }

  private trySet(storage: Storage, key: string, raw: string): boolean {
    try {
      storage.setItem(key, raw);
      return true;
    } catch {
      return false;
    }
  }

  /** `localStorage`, or `null` when it is missing or blocked (its getter can throw). */
  private storage(): Storage | null {
    try {
      return this.window?.localStorage ?? null;
    } catch {
      return null;
    }
  }
}
