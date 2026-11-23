// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { CompletionContext, type Completion } from '@codemirror/autocomplete';
import { linkCompletionSource, wikiTriggerChange, destTriggerChange, insertLink, linkHelper } from './link-helper.ts';
import type { NoteSummary } from './types.ts';

const note = (id: string, path: string, title: string): NoteSummary => ({ id, vault_id: 'v', path, title, created_at: '', updated_at: '' });
const NOTES = [note('road', 'work/q3/roadmap.md', 'Roadmap'), note('self', 'work/me.md', 'Me'), note('idea', 'ideas.md', 'Ideas')];
const deps = { notes: () => NOTES, fromPath: () => 'work/me.md', selfID: () => 'self' };

function complete(doc: string) {
  const state = EditorState.create({ doc });
  const r = linkCompletionSource(deps)(new CompletionContext(state, doc.length, false));
  return { state, r };
}

function applyOption(doc: string, pick: (o: readonly Completion[]) => Completion, after = '') {
  const view = new EditorView({ state: EditorState.create({ doc: doc + after }), parent: document.body });
  const r = linkCompletionSource(deps)(new CompletionContext(view.state, doc.length, false))!;
  const opt = pick(r.options);
  (opt.apply as (v: EditorView, c: Completion, f: number, t: number) => void)(view, opt, r.from, doc.length);
  const out = view.state.doc.toString();
  view.destroy();
  return out;
}

describe('link completion source', () => {
  it('[[ lists ranked notes (excluding the current one) with their folder', () => {
    const { r } = complete('see [[road');
    expect(r!.options[0]).toMatchObject({ label: 'Roadmap', detail: 'work/q3/' });
    expect(r!.options.map((o) => o.label)).not.toContain('Me');
    expect(r!.from).toBe('see [['.length);
  });
  it('[[ + pick rewrites to a relative markdown link (and eats a typed ]])', () => {
    expect(applyOption('see [[road', (o) => o[0])).toBe('see [Roadmap](q3/roadmap.md)');
    expect(applyOption('see [[ide', (o) => o[0], ']] end')).toBe('see [Ideas](../ideas.md) end');
  });
  it('](: completes the destination; empty label takes the title', () => {
    expect(applyOption('a [the plan](road', (o) => o[0])).toBe('a [the plan](q3/roadmap.md)');
    expect(applyOption('a [](ide', (o) => o[0], ')')).toBe('a [Ideas](../ideas.md)');
  });
  it('stays out of URLs, images and plain text', () => {
    expect(complete('[x](https://ex').r).toBeNull();
    expect(complete('![img](road').r).toBeNull();
    expect(complete('just text').r).toBeNull();
  });
});

describe('ranged changes', () => {
  it('only the trigger range is replaced', () => {
    const doc = Text.of(['abc [[q]] xyz']);
    expect(wikiTriggerChange(doc, 4, 7, { title: 'T', path: 'x.md' }, 'y.md')).toEqual({ from: 4, to: 9, insert: '[T](x.md)' });
    const d2 = Text.of(['[l](q) z']);
    expect(destTriggerChange(d2, 0, 'l', 4, 5, { title: 'T', path: 'a/b.md' }, 'c.md')).toEqual({ from: 4, to: 6, insert: 'a/b.md)' });
  });
});

describe('insertLink', () => {
  it('at a cursor inserts [[ and opens the picker; around a selection makes [sel](', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'hello world', extensions: [linkHelper(deps)] }), parent: document.body });
    view.dispatch({ selection: { anchor: 5 } });
    insertLink(view, {});
    expect(view.state.doc.toString()).toBe('hello[[ world');
    expect(view.state.selection.main.head).toBe(7);
    view.dispatch({ changes: { from: 5, to: 7 }, selection: { anchor: 6, head: 11 } });
    insertLink(view, {});
    expect(view.state.doc.toString()).toBe('hello [world](');
    expect(view.state.selection.main.head).toBe(14);
    view.destroy();
  });
});
