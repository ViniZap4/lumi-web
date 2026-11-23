// The full keymap, for the `?` overlay and Settings → Keys. Mirrors the
// Apple client's KeymapHelp sections so both clients document one map.

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
      ['⌘-click link', 'open linked note'],
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
      [':settings  ⌘⇧,', 'editor settings'],
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
