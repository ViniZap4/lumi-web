// Relative line numbers (vim `set number relativenumber`): the cursor
// line shows its absolute number, every other line its distance. A
// custom gutter because CodeMirror's stock line-number gutter only
// redraws on doc/viewport changes, not on cursor moves.

import { gutter, GutterMarker } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

class NumberMarker extends GutterMarker {
  constructor(readonly text: string) {
    super();
  }
  eq(o: NumberMarker): boolean {
    return o.text === this.text;
  }
  toDOM(): Node {
    return document.createTextNode(this.text);
  }
}

/** Label for line `n` with the cursor on line `cur`. */
export function relativeLabel(n: number, cur: number): string {
  return String(n === cur ? n : Math.abs(n - cur));
}

export function relativeLineNumbers(): Extension {
  return gutter({
    class: 'cm-lineNumbers cm-relativeNumbers',
    lineMarker(v, line) {
      const n = v.state.doc.lineAt(line.from).number;
      const cur = v.state.doc.lineAt(v.state.selection.main.head).number;
      return new NumberMarker(relativeLabel(n, cur));
    },
    lineMarkerChange: (u) => u.selectionSet || u.docChanged,
    initialSpacer: (v) => new NumberMarker(String(v.state.doc.lines)),
  });
}
