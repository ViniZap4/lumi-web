// CodeMirror glue for the markdown link helper (lib/links.ts).
//
//   - typing `[[` opens a note picker; picking rewrites `[[query` (and a
//     closing `]]`, if typed) to `[Title](relative/path.md)`
//   - typing `[label](` opens the same picker for the destination
//   - `insertLink` (⌘/Ctrl-K, vim `:link` / `<leader>l`) starts either
//     flow: with a selection it becomes `[selection](` + picker
//   - pasting a URL over a single-line selection makes `[sel](url)`
//
// Every edit is ONE ranged change over exactly the text being replaced
// (CRDT client protocol: never replace the document), so y-codemirror
// forwards a minimal Y.Text delete+insert.

import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  autocompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { NoteSummary } from './types.ts';
import { linkCandidates, linkDestination, linkFromPaste, markdownLink, type LinkCandidate } from './links.ts';

export interface LinkHelperDeps {
  notes: () => readonly NoteSummary[];
  /** Path of the note being edited (links are relative to it). */
  fromPath: () => string;
  selfID: () => string | null;
  /** Put the editor in a state where typing inserts at `pos` (vim:
   *  leave visual/normal mode). Optional. */
  ensureInsert?: (view: EditorView, pos: number) => void;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const WIKI_RE = /\[\[[^\]\n]{0,120}$/;
const DEST_RE = /\[([^\]\n]{0,200})\]\(([^)\s]{0,200})$/;

function option(c: LinkCandidate, apply: Completion['apply']): Completion {
  return { label: c.title, detail: c.folder ? c.folder + '/' : '/', type: 'text', apply, boost: 0 };
}

/** Change for a `[[query` trigger: replaces `[[query` (+ `]]`). */
export function wikiTriggerChange(
  doc: { sliceString(from: number, to: number): string },
  triggerFrom: number,
  to: number,
  c: Pick<LinkCandidate, 'title' | 'path'>,
  fromPath: string,
): { from: number; to: number; insert: string } {
  const end = doc.sliceString(to, to + 2) === ']]' ? to + 2 : to;
  return { from: triggerFrom, to: end, insert: markdownLink(c.title, fromPath, c.path) };
}

/** Change for a `[label](query` trigger. An empty label takes the
 *  note title; a `)` already after the cursor is reused. */
export function destTriggerChange(
  doc: { sliceString(from: number, to: number): string },
  linkFrom: number,
  label: string,
  queryFrom: number,
  to: number,
  c: Pick<LinkCandidate, 'title' | 'path'>,
  fromPath: string,
): { from: number; to: number; insert: string } {
  const end = doc.sliceString(to, to + 1) === ')' ? to + 1 : to;
  if (!label) return { from: linkFrom, to: end, insert: markdownLink(c.title, fromPath, c.path) };
  return { from: queryFrom, to: end, insert: linkDestination(fromPath, c.path) + ')' };
}

export function linkCompletionSource(deps: LinkHelperDeps) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const wiki = ctx.matchBefore(WIKI_RE);
    if (wiki) {
      const q = wiki.text.slice(2);
      const cands = linkCandidates(deps.notes(), q, { excludeID: deps.selfID(), limit: 40 });
      if (cands.length === 0) return null;
      return {
        from: wiki.from + 2,
        filter: false,
        options: cands.map((c) =>
          option(c, (view, _completion, _from, to) => {
            const ch = wikiTriggerChange(view.state.doc, wiki.from, to, c, deps.fromPath());
            view.dispatch({ changes: ch, selection: { anchor: ch.from + ch.insert.length }, userEvent: 'input.complete' });
          }),
        ),
      };
    }
    const dest = ctx.matchBefore(DEST_RE);
    if (dest) {
      const m = DEST_RE.exec(dest.text)!;
      const label = m[1];
      const q = m[2];
      if (SCHEME_RE.test(q) || q.startsWith('#')) return null; // a URL / anchor
      const linkFrom = dest.from;
      if (linkFrom > 0 && ctx.state.sliceDoc(linkFrom - 1, linkFrom) === '!') return null; // image
      const queryFrom = ctx.pos - q.length;
      const cands = linkCandidates(deps.notes(), q.replace(/%20/g, ' '), { excludeID: deps.selfID(), limit: 40 });
      if (cands.length === 0) return null;
      return {
        from: queryFrom,
        filter: false,
        options: cands.map((c) =>
          option(c, (view, _completion, _from, to) => {
            const ch = destTriggerChange(view.state.doc, linkFrom, label, queryFrom, to, c, deps.fromPath());
            view.dispatch({ changes: ch, selection: { anchor: ch.from + ch.insert.length }, userEvent: 'input.complete' });
          }),
        ),
      };
    }
    return null;
  };
}

/** ⌘K / `:link`: start the link flow at the cursor or around the
 *  selection. Returns true (always handled). */
export function insertLink(view: EditorView, deps: Pick<LinkHelperDeps, 'ensureInsert'>): boolean {
  const sel = view.state.selection.main;
  const text = view.state.sliceDoc(sel.from, sel.to);
  let cursor: number;
  if (!sel.empty && !text.includes('\n')) {
    // `[selection](` + picker for the destination.
    view.dispatch({
      changes: [
        { from: sel.from, insert: '[' },
        { from: sel.to, insert: '](' },
      ],
      userEvent: 'input',
    });
    cursor = sel.to + 3;
  } else {
    view.dispatch({ changes: { from: sel.head, insert: '[[' }, userEvent: 'input' });
    cursor = sel.head + 2;
  }
  view.dispatch({ selection: { anchor: cursor } });
  deps.ensureInsert?.(view, cursor);
  view.focus();
  startCompletion(view);
  return true;
}

/** Paste a URL over a selection → `[selection](url)`. */
export function pasteLinkHandler(): Extension {
  return EditorView.domEventHandlers({
    paste(e, view) {
      const sel = view.state.selection.main;
      if (sel.empty || view.state.selection.ranges.length > 1) return false;
      const link = linkFromPaste(view.state.sliceDoc(sel.from, sel.to), e.clipboardData?.getData('text/plain') ?? '');
      if (!link) return false;
      e.preventDefault();
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: link },
        selection: { anchor: sel.from + link.length },
        userEvent: 'input.paste',
      });
      return true;
    },
  });
}

/** The editor extension: completion (link sources only) + paste. */
export function linkHelper(deps: LinkHelperDeps): Extension {
  return [
    autocompletion({
      override: [linkCompletionSource(deps)],
      activateOnTyping: true,
      icons: false,
      closeOnBlur: true,
      maxRenderedOptions: 40,
    }),
    pasteLinkHandler(),
    EditorView.theme({
      '.cm-tooltip.cm-tooltip-autocomplete': {
        background: 'var(--color-overlay-bg, var(--color-background))',
        border: '1px solid var(--color-border)',
        borderRadius: '8px',
        boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
        padding: '4px',
        fontFamily: 'var(--font-ui)',
        fontSize: '13px',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul': { maxHeight: '18em', fontFamily: 'inherit' },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
        padding: '4px 8px',
        borderRadius: '5px',
        display: 'flex',
        gap: '10px',
        alignItems: 'baseline',
      },
      '.cm-tooltip-autocomplete ul li[aria-selected]': {
        background: 'var(--color-selected-bg)',
        color: 'var(--color-text)',
      },
      '.cm-completionLabel': { color: 'var(--color-text)' },
      '.cm-completionDetail': {
        marginLeft: 'auto',
        fontStyle: 'normal',
        color: 'var(--color-text-dim)',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
      },
      '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--color-primary)' },
    }),
  ];
}
