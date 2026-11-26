// Vim ex commands of the note editor (`:q`, `:settings`, `:vsplit`…),
// registered once on the global Vim singleton and routed per editor.

import { Vim } from '@replit/codemirror-vim';
import { installYankFlash } from './yank-flash.ts';
import { installVimUndo } from './editor-undo.ts';
import { motionAllowed } from './motion.ts';

/** Per-editor ex handlers. Vim ex commands are registered once on
 *  the global Vim singleton; each dispatches to the editor it ran in
 *  (the engine passes that editor's adapter, `cm.cm6` is its view),
 *  so with several panes `:q` closes the right one. */
export interface ExHandlers {
  exit(): void;
  /** `:q` — the view decides: close the pane, or leave the editor. */
  quit(): void;
  settings(): void;
  toggleMode(): void;
  link(): void;
  split(): void;
  explore(): void;
  follow(): void;
  hover(): void;
  /** `:vsplit [note]` / `:split [note]` / `:only` / `:close`. */
  win(cmd: 'vsplit' | 'split' | 'only' | 'close' | 'zoom', arg: string): void;
}
const handlers = new WeakMap<object, ExHandlers>();
let lastFocused: ExHandlers | null = null;
function target(cm: unknown): ExHandlers | null {
  const v = (cm as { cm6?: object } | null)?.cm6;
  return (v && handlers.get(v)) || lastFocused;
}
type ExParams = { args?: string[]; argString?: string };
const argOf = (p: ExParams | undefined) => (p?.argString ?? p?.args?.join(' ') ?? '').trim();

let vimExRegistered = false;
export function registerVimEx(): void {
  if (vimExRegistered) return;
  vimExRegistered = true;
  // Edits are already persisted live; :w / :wq / :x just exit or no-op.
  Vim.defineEx('quit', 'q', (cm: unknown) => target(cm)?.quit());
  Vim.defineEx('wq', 'wq', (cm: unknown) => target(cm)?.exit());
  Vim.defineEx('xit', 'x', (cm: unknown) => target(cm)?.exit());
  Vim.defineEx('write', 'w', () => {});
  // :settings opens the editor settings; :preview flips live/source.
  Vim.defineEx('settings', 'settings', (cm: unknown) => target(cm)?.settings());
  // `:preview split` toggles the side-by-side preview (Source mode).
  Vim.defineEx('preview', 'preview', (cm: unknown, params: ExParams) => {
    if (params?.args?.[0] === 'split') target(cm)?.split();
    else target(cm)?.toggleMode();
  });
  // :link (and the default <leader>l) opens the markdown link helper.
  Vim.defineEx('link', 'link', (cm: unknown) => target(cm)?.link());
  // Panes (SPEC-PARTE2 §2–4): :explore (- and <leader>e), :follow (gf),
  // :hover (K), :vsplit / :split [note], :only, :close.
  Vim.defineEx('explore', 'exp', (cm: unknown) => target(cm)?.explore());
  Vim.defineEx('follow', 'fol', (cm: unknown) => target(cm)?.follow());
  Vim.defineEx('hover', 'hov', (cm: unknown) => target(cm)?.hover());
  Vim.defineEx('vsplit', 'vs', (cm: unknown, p: ExParams) => target(cm)?.win('vsplit', argOf(p)));
  Vim.defineEx('split', 'sp', (cm: unknown, p: ExParams) => target(cm)?.win('split', argOf(p)));
  Vim.defineEx('only', 'on', (cm: unknown) => target(cm)?.win('only', ''));
  Vim.defineEx('close', 'clo', (cm: unknown) => target(cm)?.win('close', ''));
  Vim.defineEx('zoom', 'zo', (cm: unknown) => target(cm)?.win('zoom', ''));
  // u / Ctrl-r / :undo / :redo → the session's Y.UndoManager.
  installVimUndo();
  // Neovim-style yank highlight (purely visual).
  installYankFlash(Vim as never, () => !motionAllowed());
}

/** `view`'s ex commands dispatch to `h`; it is also the fallback target. */
export function bindExHandlers(view: object, h: ExHandlers): void {
  handlers.set(view, h);
  lastFocused = h;
}

/** The editor with `h` took focus: ex commands without a view go to it. */
export function focusExHandlers(h: ExHandlers): void {
  lastFocused = h;
}

/** The editor with `h` is going away. */
export function releaseExHandlers(h: ExHandlers): void {
  if (lastFocused === h) lastFocused = null;
}
