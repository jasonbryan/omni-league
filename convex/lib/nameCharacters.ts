// Imports nothing, so the app can import it.

// Bidi controls reorder the name on other pages. Other format characters (the zero-width joiner and non-joiner, emoji tag characters) are part of real names.
const CONTROL_OR_BIDI_CHARACTER = /[\p{Cc}؜‎‏‪-‮⁦-⁩]/u;

const VISIBLE_CHARACTER = /[^\p{Cf}\s]/u;

export const HIDDEN_CHARACTER_MESSAGE = 'Remove the hidden or control characters from the name.';

export function hasControlOrBidiCharacter(text: string): boolean {
  return CONTROL_OR_BIDI_CHARACTER.test(text);
}

/** False for a name of only whitespace and format characters, such as zero-width spaces. */
export function hasVisibleCharacter(text: string): boolean {
  return VISIBLE_CHARACTER.test(text);
}
