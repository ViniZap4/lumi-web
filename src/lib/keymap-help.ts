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
    title: 'Explorer (floating — the only navigation)',
    rows: [
      ['-  ⟨leader⟩e  :explore', 'open at this note'],
      ['Explorer button  space', 'open with the mouse / palette'],
      ['j k  ↓ ↑', 'move'],
      ['h  ←  ⌫', 'up a folder (at the root: books)'],
      ['l  →', 'enter a folder / open'],
      ['⏎', 'open in this pane'],
      ['⌃v  ⌃s', 'open in a split right / below'],
      ['gg  G  ⌃d ⌃u  5j', 'jump, page, count'],
      ['H  L', 'folder history'],
      ['~  gh  zh', 'book root'],
      ['/  n N', 'filter, next / prev match'],
      ['e', 'edit the note under the cursor'],
      ['f  ⇧F10', 'hints, context menu'],
      ['Esc  q  click outside', 'close'],
    ],
  },
  {
    title: 'Files (in the explorer)',
    rows: [
      ['a', 'new note (a/b/name, dir/)'],
      ['r', 'rename / move (dir/name)'],
      ['d', 'delete (confirm y)'],
      ['y  p', 'yank / paste copy'],
      ['drag a note → folder', 'move it there'],
      ['.', 'show hidden'],
      ['zp', 'preview column'],
      ['R', 'refresh'],
    ],
  },
  {
    title: 'Books',
    rows: [
      ['gb  book button', 'books (accounts → books)'],
      ['h  l  ⏎', 'accounts / books, open'],
      ['[  ]', 'previous / next book'],
      ['g1–9  ⌃⌘1–9', 'book by number'],
    ],
  },
  {
    title: 'Note',
    rows: [
      ['i  e  ⌘E', 'edit (vim)'],
      ['j k  d u  f b', 'scroll'],
      ['gg  G', 'top / bottom'],
      ['-  h', 'explorer at this note'],
      ['a  r', 'new / rename (in the explorer)'],
      ['H  L', 'previous / next note'],
      ['q', 'close (back to the book home)'],
      ['y', 'copy note text'],
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
    title: 'Canvas & board modes',
    rows: [
      ['(opens in) Reading', 'look and navigate — nothing changes'],
      ['e  i  ⌘E  the switch', 'Edit: the interactive canvas / board'],
      ['Esc  q  ⌘E', 'back to Reading (nothing selected)'],
      ['Source', 'the raw JSON / markdown in the editor'],
      ['h j k l  + - 0  Tab', 'canvas: pan, zoom/fit, next node'],
      ['⏎  gf  ⌃w f', 'canvas: open the node (here / split)'],
      ['a f  H J K L  d  c1-6  u', 'canvas Edit: add, move, delete, color, undo'],
      ['h l  j k  ⏎  /', 'board: column, card, follow link, filter'],
      ['H L J K  a o A  x  dd', 'board Edit: move, new card/column, done, delete'],
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
      ['⌃w z  :zoom', 'zoom the pane to fill the note area, and back'],
      ['⌃w =', 'equal sizes'],
      ['⌃w < > + -', 'resize (or drag a divider)'],
      ['click', 'focus a pane (the click still acts)'],
      ['double-click a pane header', 'zoom / unzoom'],
      ['drag a note to a pane edge', 'split there (from the explorer)'],
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
