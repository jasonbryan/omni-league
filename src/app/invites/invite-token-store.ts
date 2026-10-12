import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';

/** The `sessionStorage` key that holds the token of the invite link being accepted (#70). */
export const INVITE_TOKEN_KEY = 'omni.invite-token';

/**
 * What a token can look like: base64url, at most `MAX_INVITE_TOKEN_LENGTH` (convex/lib/
 * inviteToken.ts) characters. Anything else is not from an invite link, so it is never stored or
 * sent to the server.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Where the invite page keeps the token of its link (#70, ADR 0008). The link is
 * `<origin>/invites/accept#<token>`: a fragment never reaches a server or a `Referer`, but it would
 * ride along in `returnTo` or the address bar, so `captureInviteToken` moves it here and removes
 * it from the URL. It stays through sign-up and sign-in (the user may reload or switch accounts)
 * and is deleted once the invite is accepted or refused. It is never put in a URL or logged.
 * Storage that is missing or blocked behaves as storage that holds nothing.
 */
@Injectable({ providedIn: 'root' })
export class InviteTokenStore {
  private readonly inBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly saves = signal(0);

  /**
   * Counts the links captured so far. A page that is already open watches it to read the token
   * again, because opening a link on the open page (`/invites/accept#<new token>`) changes the
   * stored token without creating the page again.
   */
  readonly captured = this.saves.asReadonly();

  /**
   * Keeps `raw` as the token to accept and returns true, when it has the shape of a token. Anything
   * else (and a failure to store) forgets the earlier token too, so the page never offers an
   * older invite for a link that is broken.
   */
  save(raw: string): boolean {
    this.saves.update((count) => count + 1);
    this.clear();
    if (!this.inBrowser || !TOKEN_SHAPE.test(raw)) return false;
    try {
      sessionStorage.setItem(INVITE_TOKEN_KEY, raw);
      return true;
    } catch {
      return false;
    }
  }

  /** The stored token, or `null` when there is none (or it is not shaped like one). */
  read(): string | null {
    if (!this.inBrowser) return null;
    try {
      const stored = sessionStorage.getItem(INVITE_TOKEN_KEY);
      return stored !== null && TOKEN_SHAPE.test(stored) ? stored : null;
    } catch {
      return null;
    }
  }

  clear(): void {
    if (!this.inBrowser) return;
    try {
      sessionStorage.removeItem(INVITE_TOKEN_KEY);
    } catch {
      // Blocked storage holds nothing to remove.
    }
  }
}
