// The full keymap, for the `?` overlay and Settings → Keys. Mirrors the
// Apple client's KeymapHelp sections so both clients document one map.
// Written in macOS glyphs; `keymapFor` renders it per platform.

import { keyLabel, MAC } from './platform.ts';

export interface KeymapSection {
  title: string;
  rows: ReadonlyArray<readonly [keys: string, label: string]>;
}

export const KEYMAP: readonly KeymapSection[] = [
  {
    title: 'Explore',
    rows: [
      ['j k  ↓ ↑', 'move'],
      ['h  ←  -  ⌫', 'up a folder'],
      ['l  →  ⏎', 'open / enter'],
      ['gg  G', 'top / bottom'],
      ['⌃d ⌃u', 'half page'],
      ['5j  12k', 'count'],
      ['H  L', 'folder history'],
      ['~  gh  zh', 'book root'],
      ['/', 'filter in place'],
      ['n  N', 'next / prev match'],
      ['Esc  q', 'clear filter / back'],
    ],
  },
  {
    title: 'Files',
    rows: [
      ['a', 'new note (a/b/name, dir/)'],
      ['r', 'rename / move (dir/name)'],
      ['d', 'delete (confirm y)'],
      ['y  p', 'yank / paste copy'],
      ['.', 'show hidden'],
      ['zp', 'preview column'],
      ['R', 'refresh'],
    ],
  },
  {
    title: 'Note',
    rows: [
      ['⏎  l', 'read'],
      ['i  e  ⌘E', 'edit (vim)'],
      ['q  h  Esc', 'back to explorer'],
      ['j k  d u  f b', 'scroll'],
      ['gg  G', 'top / bottom'],
      ['y', 'copy note text'],
      ['-', 'floating explorer here'],
    ],
  },
  {
    title: 'Links',
    rows: [
      ['gf  ⏎  click', 'follow in this pane'],
      ['⌃w f  ⌃w ⏎  ⌘-click', 'follow in a split (right)'],
      ['⌃w F  ⇧⌘-click', 'follow in a split (below)'],
      ['K  hover', 'preview card'],
      ['j k  ⏎  Esc', 'card: scroll, open, close'],
    ],
  },
  {
    title: 'Floating explorer',
    rows: [
      ['-  ⟨leader⟩e  :explore', 'open at this note'],
      ['j k h l  /', 'move, folders, filter'],
      ['⏎', 'open in this pane'],
      ['⌃v  ⌃s', 'open in a split right / below'],
      ['a r d y p', 'file operations'],
      ['Esc  q  click outside', 'close'],
    ],
  },
  {
    title: 'Editor',
    rows: [
      ['[[  ](', 'link a note'],
      ['⌘K  :link  ⟨leader⟩l', 'link helper'],
      ['⌘V on selection', 'URL → [text](url)'],
      [':q  :wq  ⌘E', 'leave the editor'],
      ['⌘⇧E  :preview', 'live / source'],
      [':settings', 'settings'],
    ],
  },
  {
    title: 'Panes',
    rows: [
      ['⌃h ⌃j ⌃k ⌃l', 'pane left / below / above / right'],
      ['⌃w h j k l', 'same, vim window keys'],
      ['⌃w w  ⌃w p', 'next / previous pane'],
      ['⌃w v  :vsplit [note]', 'split right'],
      ['⌃w s  :split [note]', 'split below'],
      ['⌃w q  :q  :close', 'close pane'],
      ['⌃w o  :only', 'keep only this pane'],
      ['⌃w =', 'equal sizes'],
      ['⌃w < > + -', 'resize (or drag a divider)'],
      ['click', 'focus a pane'],
    ],
  },
  {
    title: 'Split preview',
    rows: [
      ['⌃l  ⌃w l', 'read the preview'],
      ['j k  d u', 'scroll'],
      ['{ }  [[ ]]', 'previous / next heading'],
      ['gg  G', 'top / bottom'],
      ['/  n N', 'find, next / prev'],
      ['f', 'hints: links, tasks, copy'],
      ['⏎', 'open the focused link'],
      ['y', 'copy selection / note'],
      ['q  Esc  ⌃h', 'back to the editor'],
    ],
  },
  {
    title: 'App',
    rows: [
      ['space  :  ⌘K', 'command palette'],
      ['[  ]', 'previous / next book'],
      ['g1–9  ⌃⌘1–9', 'book by number'],
      ['gb', 'all books'],
      [',', 'settings'],
      ['?', 'this help'],
    ],
  },
];

/** Shortcuts that exist on macOS only (⌃⌘1–9: Ctrl+1–9 is the
 *  browser's tab switcher elsewhere). */
const MAC_ONLY = /\s*⌃⌘1–9/;

/** KEYMAP with platform-correct labels (⌘K vs Ctrl+K). */
export function keymapFor(mac: boolean = MAC): KeymapSection[] {
  return KEYMAP.map((sec) => ({
    title: sec.title,
    rows: sec.rows.map(([k, label]) => [keyLabel(mac ? k : k.replace(MAC_ONLY, ''), mac), label] as const),
  }));
}
