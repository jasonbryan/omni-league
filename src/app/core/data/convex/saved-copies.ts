import { DOCUMENT, Injectable, inject } from '@angular/core';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { convexToJson, jsonToConvex, type JSONValue, type Value } from 'convex/values';
import { OFFLINE_SAVED_QUERIES } from './offline-saved-queries';

/** Prefix of every saved-copy key in `localStorage`. */
export const SAVED_COPY_PREFIX = 'cvx-saved:';
/** At most this many saved copies; the least recently used goes first (ADR 0013 section 3). */
export const SAVED_COPY_MAX_ENTRIES = 50;
/** A saved copy older than this is not used, and is removed (ADR 0013 section 3). */
export const SAVED_COPY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * The saved copies' keys and values together stay under this many UTF-16 code units (about 2 MB),
 * well under the browser's `localStorage` quota, so they never crowd out the rest of the app's
 * storage (the sign-in session, ADR 0008). A single result larger than this is not saved.
 */
export const SAVED_COPY_MAX_TOTAL_LENGTH = 1_000_000;

/** A saved copy as `read()` returns it. */
export interface SavedCopy {
  readonly value: unknown;
  /** When the live result was saved, in epoch milliseconds. */
  readonly savedAt: number;
}

/** The stored value: the result as Convex JSON, when it was saved, and when it was last used. */
interface StoredCopy {
  v: JSONValue;
  savedAt: number;
  usedAt: number;
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

/** `cvx-saved:<function>:<JSON args with sorted keys>` (ADR 0013 section 3). */
export function savedCopyKey(query: FunctionReference<'query'>, args: object): string {
  return `${SAVED_COPY_PREFIX}${getFunctionName(query)}:${JSON.stringify(sortKeys(convexToJson(args as Value)))}`;
}

function parseStored(raw: string): StoredCopy | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('v' in parsed)) return undefined;
    const { v, savedAt, usedAt } = parsed as Partial<StoredCopy>;
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return undefined;
    return {
      v: v as JSONValue,
      savedAt,
      usedAt: typeof usedAt === 'number' && Number.isFinite(usedAt) ? usedAt : savedAt,
    };
  } catch {
    return undefined;
  }
}

/**
 * Saved copies of allow-listed public query results, kept in `localStorage` (ADR 0013 section 3,
 * #82). Browser only: the query helper injects it only when it has a live client, so a server
 * render never reads or writes storage.
 *
 * Reads are synchronous, so the first render of a page opened offline already shows its saved
 * copy. Every storage error (no storage in a private window, quota exceeded, a value that is not a
 * saved copy) is ignored: the page then behaves as if nothing were saved.
 */
@Injectable({ providedIn: 'root' })
export class ConvexSavedCopies {
  private readonly window = inject(DOCUMENT).defaultView;
  private readonly listed = new Set(OFFLINE_SAVED_QUERIES.map((query) => getFunctionName(query)));

  /** Whether `query` is on `OFFLINE_SAVED_QUERIES`. Nothing else is ever read or written. */
  isListed(query: FunctionReference<'query'>): boolean {
    return this.listed.has(getFunctionName(query));
  }

  /**
   * The saved copy for `query` and `args`, if one exists and is at most 14 days old; an older or
   * unreadable entry is removed. A read counts as a use for the least-recently-used limit.
   */
  read(query: FunctionReference<'query'>, args: object): SavedCopy | undefined {
    if (!this.isListed(query)) return undefined;
    const storage = this.storage();
    if (!storage) return undefined;
    try {
      const key = savedCopyKey(query, args);
      const raw = storage.getItem(key);
      if (raw === null) return undefined;
      const stored = parseStored(raw);
      const now = Date.now();
      if (!stored || now - stored.savedAt > SAVED_COPY_MAX_AGE_MS) {
        storage.removeItem(key);
        return undefined;
      }
      const value = jsonToConvex(stored.v);
      this.trySet(storage, key, JSON.stringify({ ...stored, usedAt: now }));
      return { value, savedAt: stored.savedAt };
    } catch {
      return undefined;
    }
  }

  /**
   * Saves a live result of `query` for `args`. A result of `null` or `undefined` (the record was
   * unpublished or deleted) removes the saved entry instead. Not listed: does nothing.
   */
  write(query: FunctionReference<'query'>, args: object, value: unknown): void {
    if (!this.isListed(query)) return;
    const storage = this.storage();
    if (!storage) return;
    try {
      const key = savedCopyKey(query, args);
      if (value === null || value === undefined) {
        storage.removeItem(key);
        return;
      }
      const now = Date.now();
      const stored: StoredCopy = { v: convexToJson(value as Value), savedAt: now, usedAt: now };
      const raw = JSON.stringify(stored);
      if (key.length + raw.length > SAVED_COPY_MAX_TOTAL_LENGTH) {
        storage.removeItem(key);
        return;
      }
      const previous = storage.getItem(key);
      if (!this.trySet(storage, key, raw)) return;
      // Only a new entry or a larger one can take the copies past a limit.
      if (previous === null || raw.length > previous.length) this.prune(storage, key);
    } catch {
      // Ignored (see the class comment).
    }
  }

  /**
   * Removes expired and unreadable entries, then the least recently used ones until at most
   * `SAVED_COPY_MAX_ENTRIES` remain within `SAVED_COPY_MAX_TOTAL_LENGTH`. `keep` (the entry just
   * written) counts as the most recently used.
   */
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
      const stored = raw === null ? undefined : parseStored(raw);
      if (!raw || !stored || now - stored.savedAt > SAVED_COPY_MAX_AGE_MS) {
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
