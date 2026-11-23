import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { yankSpans, yankFlashField } from './yank-flash.ts';

describe('yank flash', () => {
  it('normalises ranges: ordered, reversed fixed, clipped, empties dropped', () => {
    const doc = { length: 20 };
    expect(yankSpans(doc, [{ from: 10, to: 4 }, { from: 0, to: 2 }, { from: 5, to: 5 }, { from: 18, to: 40 }])).toEqual([
      { from: 0, to: 2 },
      { from: 4, to: 10 },
      { from: 18, to: 20 },
    ]);
    expect(yankSpans(doc, [])).toEqual([]);
  });
  it('the field starts empty and is purely visual', () => {
    const st = EditorState.create({ doc: 'hello', extensions: [yankFlashField] });
    expect(st.field(yankFlashField).size).toBe(0);
    const tr = st.update({ changes: { from: 0, insert: 'x' } });
    expect(tr.state.field(yankFlashField).size).toBe(0);
  });
});
