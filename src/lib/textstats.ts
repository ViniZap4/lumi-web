// Word / character counts for the editor status bar.

export interface EditorStats {
  words: number;
  chars: number;
  line: number;
  col: number;
}

/** Counts words in markdown text: runs of letters/digits (any script),
 *  so `**bold**`, `#` and list markers don't count as words. */
export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
  return m ? m.length : 0;
}

/** Reading time in whole minutes (≈230 wpm), at least 1 for any text. */
export function readingTime(words: number, wpm = 230): number {
  return words <= 0 ? 0 : Math.max(1, Math.round(words / wpm));
}
