/** A link inside running text. */
export const INLINE_LINK = 'underline underline-offset-4 hover:text-foreground';

/** A link that is the only content of a row, so it needs a tap target. */
export const ROW_LINK = `inline-flex items-center ${INLINE_LINK} pointer-coarse:min-h-11`;
