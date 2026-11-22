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
