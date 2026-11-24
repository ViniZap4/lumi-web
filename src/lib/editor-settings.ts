// Per-device editor preferences (vim, escape sequences, view mode,
// gutter, wrapping, font). Pure model + storage glue; the reactive
// store lives in editor-settings.svelte.ts.
//
// Stored in localStorage under `lumi.v2.editor` (same pattern as the
// theme store). Every read goes through `sanitizeSettings`, so a
// hand-edited or corrupt blob degrades field-by-field to defaults
// instead of breaking the editor. Nothing here is security-sensitive
// — but mappings end up in the vim engine, so they are length- and
// shape-limited.

import { sanitizeVimrc } from './vimrc.ts';

export type EditMode = 'live' | 'source';
export type OpenIn = 'reading' | 'editing';
export type MapMode = 'normal' | 'insert' | 'visual';
export type ProseFont = 'sans' | 'serif' | 'mono';

export interface VimMapping {
  mode: MapMode;
  lhs: string;
  rhs: string;
  /** Non-recursive (`noremap`). */
  noremap: boolean;
}

export interface EditorSettings {
  /** Vim keybindings on/off. */
  vim: boolean;
  /** Insert-mode key sequences that act as <Esc> (e.g. `jk`, `ff`). */
  escapeSequences: string[];
  /** ms the vim engine waits for the 2nd key of a sequence. */
  escapeTimeout: number;
  /** Extra user mappings applied to the vim engine. */
  mappings: VimMapping[];
  /** Editing flavour: Obsidian-like Live Preview or raw Source. */
  editMode: EditMode;
  /** What `Enter` on a note opens: the rendered reader or the editor. */
  openIn: OpenIn;
  lineNumbers: boolean;
  relativeLineNumbers: boolean;
  lineWrapping: boolean;
  /** Constrain the text column to a readable width. */
  readableWidth: boolean;
  fontSize: number;
  tabSize: number;
  /** User `.vimrc` text (safe subset, parsed — see vimrc.ts). Applied
   *  when vim is on. */
  vimrc: string;
  /** Which-key style command legend at the bottom of the window. */
  legend: boolean;
  /** Typeface for prose (reading view + live preview). */
  proseFont: ProseFont;
  /** Source mode: show the rendered note beside the source. */
  previewSplit: boolean;
  /** Source share of the split (0.25–0.75). */
  previewRatio: number;
  /** Settings → "Movimento": full (completo), soft (suave: less
   *  travel, no overshoot) or reduced (reduzido: instant). The OS
   *  `prefers-reduced-motion` always forces reduced. */
  motion: MotionSetting;
  /** Derived: motion === 'reduced' (kept for older readers). */
  reduceMotion: boolean;
  /** Ctrl-h/j/k/l move focus between panes (vim-tmux-navigator style).
   *  `Ctrl-w h/j/k/l/w/p` always work; explicit .vimrc maps of these
   *  keys win in the editor. */
  paneNav: boolean;
  /** Leaving the split preview by keyboard moves the editor cursor to
   *  the source line at the top of the preview. */
  previewCursorSync: boolean;
  /** Hovering a note link for ~350 ms shows a preview card (`K` always
   *  works from the keyboard). */
  hoverPreview: boolean;
  /** Reading measure for the reader, Live Preview and split preview
   *  ("Largura de leitura"): narrow 68ch, medium 84ch (default), wide
   *  110ch, full = the whole pane with a comfortable gutter. */
  readingWidth: ReadingWidth;
  /** Row density of the explorer and lists ("Densidade"). */
  density: Density;
}

export type MotionSetting = 'full' | 'soft' | 'reduced';
export const MOTION_SETTINGS: readonly MotionSetting[] = ['full', 'soft', 'reduced'];
export type ReadingWidth = 'narrow' | 'medium' | 'wide' | 'full';
export type Density = 'comfortable' | 'compact';
export const READING_WIDTHS: readonly ReadingWidth[] = ['narrow', 'medium', 'wide', 'full'];
export const DENSITIES: readonly Density[] = ['comfortable', 'compact'];
/** CSS value of --md-measure per reading width (app.css mirrors this). */
export const READING_MEASURE: Record<ReadingWidth, string> = { narrow: '68ch', medium: '84ch', wide: '110ch', full: '100%' };

export const STORAGE_KEY = 'lumi.v2.editor';

export const FONT_SIZE_MIN = 11;
export const FONT_SIZE_MAX = 24;
export const TAB_SIZES = [2, 4, 8] as const;
export const ESCAPE_TIMEOUT_MIN = 100;
export const ESCAPE_TIMEOUT_MAX = 1000;
export const MAX_ESCAPE_SEQUENCES = 8;
export const MAX_MAPPINGS = 32;
const MAX_KEYS_LEN = 32;

export const DEFAULT_SETTINGS: Readonly<EditorSettings> = Object.freeze({
  vim: true,
  escapeSequences: [],
  escapeTimeout: 200,
  mappings: [],
  editMode: 'live',
  openIn: 'reading',
  lineNumbers: false,
  relativeLineNumbers: false,
  lineWrapping: true,
  readableWidth: true,
  fontSize: 15,
  tabSize: 4,
  vimrc: '',
  legend: true,
  proseFont: 'sans',
  previewSplit: false,
  previewRatio: 0.5,
  motion: 'full',
  reduceMotion: false,
  paneNav: true,
  previewCursorSync: false,
  hoverPreview: true,
  readingWidth: 'medium',
  density: 'comfortable',
});

export const PREVIEW_RATIO_MIN = 0.25;
export const PREVIEW_RATIO_MAX = 0.75;

export function clampRatio(v: unknown, d = 0.5): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return d;
  return Math.round(Math.min(PREVIEW_RATIO_MAX, Math.max(PREVIEW_RATIO_MIN, v)) * 1000) / 1000;
}

export function defaultSettings(): EditorSettings {
  return { ...DEFAULT_SETTINGS, escapeSequences: [], mappings: [] };
}

/**
 * Validate one escape sequence. Returns the normalised sequence or an
 * error message. Rules: 2–4 printable characters, no whitespace, no
 * vim key notation (`<...>`) — the point is a typed chord like `jk`.
 */
export function validateEscapeSequence(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  const chars = Array.from(value);
  if (chars.length < 2) return { ok: false, error: 'Use at least 2 characters (e.g. jk).' };
  if (chars.length > 4) return { ok: false, error: 'Use at most 4 characters.' };
  if (/\s/.test(value)) return { ok: false, error: 'Spaces are not allowed.' };
  if (value.includes('<')) return { ok: false, error: 'Key notation (<…>) is not allowed here.' };
  // Control characters / unpaired surrogates.
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: 'Only printable characters.' };
  return { ok: true, value };
}

export function validateMapping(m: unknown): VimMapping | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  const mode = o.mode;
  if (mode !== 'normal' && mode !== 'insert' && mode !== 'visual') return null;
  if (typeof o.lhs !== 'string' || typeof o.rhs !== 'string') return null;
  const lhs = o.lhs.trim();
  const rhs = o.rhs.trim();
  if (!lhs || !rhs || lhs.length > MAX_KEYS_LEN || rhs.length > MAX_KEYS_LEN) return null;
  // Ex-command lhs (`:foo`) cannot be mode-scoped in the vim engine.
  if (lhs.startsWith(':')) return null;
  if (/[\u0000-\u001f\u007f]/.test(lhs + rhs)) return null;
  return { mode, lhs, rhs, noremap: o.noremap === true };
}

function bool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}

function clampInt(v: unknown, min: number, max: number, d: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return d;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Coerce anything (parsed JSON, partial objects) into valid settings. */
export function sanitizeSettings(input: unknown): EditorSettings {
  const d = defaultSettings();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return d;
  const o = input as Record<string, unknown>;

  const seqs: string[] = [];
  if (Array.isArray(o.escapeSequences)) {
    for (const s of o.escapeSequences) {
      if (typeof s !== 'string') continue;
      const r = validateEscapeSequence(s);
      if (r.ok && !seqs.includes(r.value)) seqs.push(r.value);
      if (seqs.length >= MAX_ESCAPE_SEQUENCES) break;
    }
  }

  const maps: VimMapping[] = [];
  if (Array.isArray(o.mappings)) {
    for (const m of o.mappings) {
      const v = validateMapping(m);
      if (v) maps.push(v);
      if (maps.length >= MAX_MAPPINGS) break;
    }
  }

  const tab = typeof o.tabSize === 'number' && (TAB_SIZES as readonly number[]).includes(o.tabSize) ? o.tabSize : d.tabSize;

  // Older settings stored a boolean "Reduce motion": it maps to reduced.
  const motion: MotionSetting = (MOTION_SETTINGS as readonly unknown[]).includes(o.motion)
    ? (o.motion as MotionSetting)
    : bool(o.reduceMotion, false) ? 'reduced' : d.motion;
  return {
    vim: bool(o.vim, d.vim),
    escapeSequences: seqs,
    escapeTimeout: clampInt(o.escapeTimeout, ESCAPE_TIMEOUT_MIN, ESCAPE_TIMEOUT_MAX, d.escapeTimeout),
    mappings: maps,
    editMode: o.editMode === 'source' || o.editMode === 'live' ? o.editMode : d.editMode,
    openIn: o.openIn === 'editing' || o.openIn === 'reading' ? o.openIn : d.openIn,
    lineNumbers: bool(o.lineNumbers, d.lineNumbers),
    relativeLineNumbers: bool(o.relativeLineNumbers, d.relativeLineNumbers),
    lineWrapping: bool(o.lineWrapping, d.lineWrapping),
    readableWidth: bool(o.readableWidth, d.readableWidth),
    fontSize: clampInt(o.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, d.fontSize),
    tabSize: tab,
    vimrc: sanitizeVimrc(o.vimrc),
    legend: bool(o.legend, d.legend),
    proseFont: o.proseFont === 'serif' || o.proseFont === 'mono' || o.proseFont === 'sans' ? o.proseFont : d.proseFont,
    previewSplit: bool(o.previewSplit, d.previewSplit),
    previewRatio: clampRatio(o.previewRatio, d.previewRatio),
    motion,
    reduceMotion: motion === 'reduced',
    paneNav: bool(o.paneNav, d.paneNav),
    previewCursorSync: bool(o.previewCursorSync, d.previewCursorSync),
    hoverPreview: bool(o.hoverPreview, d.hoverPreview),
    readingWidth: (READING_WIDTHS as readonly unknown[]).includes(o.readingWidth) ? (o.readingWidth as ReadingWidth) : d.readingWidth,
    density: (DENSITIES as readonly unknown[]).includes(o.density) ? (o.density as Density) : d.density,
  };
}

/** Minimal Storage surface (localStorage or a test double). */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): KVStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    // Access itself can throw (sandboxed iframes, blocked storage).
    return null;
  }
}

export function loadSettings(storage: KVStorage | null = defaultStorage()): EditorSettings {
  if (!storage) return defaultSettings();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: EditorSettings, storage: KVStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitizeSettings(s)));
  } catch {
    // Quota / private mode: settings just don't persist.
  }
}
