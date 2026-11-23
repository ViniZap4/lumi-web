// Applies EditorSettings (+ the parsed .vimrc) to the
// @replit/codemirror-vim engine.
//
// The vim API is a process-wide singleton: maps live in one global
// keymap shared by every editor. So we remember exactly what *we*
// mapped and unmap it before applying a new configuration — the
// user's own `:imap` from the ex line is left alone, and a mapping
// removed from the vimrc really disappears on the next save.
//
// Escape sequences (`jk`, `ff`, …) are insert-mode maps to <Esc>. The
// engine types the first key immediately (a lone `f` still inserts
// `f`); if the second key arrives within `insertModeEscKeysTimeout` ms
// it removes the typed prefix and leaves insert mode, otherwise the
// pending buffer is dropped and typing continues normally.
//
// Apply order (first wins per mode+lhs): escape sequences, the
// settings' mapping list, the vimrc, then lumi's own defaults
// (`<leader>l` → link helper) — so the vimrc can rebind them.

import type { EditorSettings, MapMode } from './editor-settings.ts';
import { parseVimrc, DEFAULT_LEADER, type ParsedVimrc, type VimrcMode } from './vimrc.ts';

/** The slice of the replit `Vim` API this module touches. */
export interface VimApiLike {
  map(lhs: string, rhs: string, ctx?: string): void;
  noremap(lhs: string, rhs: string, ctx?: string): void;
  unmap(lhs: string, ctx?: string): unknown;
  setOption(name: string, value: unknown): unknown;
}

/** Private key name the leader key is fed to the engine as. The engine
 *  runs a full match immediately, so a leader that is itself a command
 *  (`<Space>` = `l`, `,` = repeat `f`) would never reach a multi-key
 *  mapping; NoteEditor intercepts the leader in normal/visual mode and
 *  feeds this token instead (see `feedLeader`). F35 cannot be typed. */
export const LEADER_TOKEN = '<F35>';

export interface PlannedMap {
  /** Engine lhs (leader maps start with LEADER_TOKEN). */
  lhs: string;
  rhs: string;
  /** undefined = every mode (`map`/`noremap`). */
  ctx: MapMode | undefined;
  noremap: boolean;
  source: 'escape' | 'settings' | 'vimrc' | 'default';
  /** Human form (`<Space>w`) for legends and help. */
  display?: string;
}

type ConfigInput = Pick<EditorSettings, 'escapeSequences' | 'mappings'> & Partial<Pick<EditorSettings, 'vimrc' | 'vim'>>;

function ctxOf(m: VimrcMode): MapMode | undefined {
  return m === 'all' ? undefined : m;
}

/** lumi's built-in leader bindings (user vimrc maps win). */
export function defaultLeaderMaps(leader: string): PlannedMap[] {
  return [{ lhs: `${LEADER_TOKEN}l`, rhs: ':link<CR>', ctx: 'normal', noremap: false, source: 'default', display: `${leader}l` }];
}

/** Pure: the list of maps a settings object asks for, in apply order. */
export function planVimMappings(s: ConfigInput, parsed: ParsedVimrc | null = s.vimrc ? parseVimrc(s.vimrc) : null): PlannedMap[] {
  const out: PlannedMap[] = [];
  const seen = new Set<string>();
  const push = (m: PlannedMap) => {
    const k = (m.ctx ?? '*') + '\u0000' + m.lhs;
    if (seen.has(k)) return; // first wins; avoids double-mapping one lhs
    seen.add(k);
    out.push(m);
  };
  for (const seq of s.escapeSequences) push({ lhs: seq, rhs: '<Esc>', ctx: 'insert', noremap: false, source: 'escape' });
  for (const m of s.mappings) push({ lhs: m.lhs, rhs: m.rhs, ctx: m.mode, noremap: m.noremap, source: 'settings' });
  if (parsed) {
    for (const m of parsed.maps) {
      push({
        lhs: m.leader ? LEADER_TOKEN + m.lhs : m.lhs,
        rhs: m.rhs,
        ctx: ctxOf(m.mode),
        noremap: m.noremap,
        source: 'vimrc',
        ...(m.leader ? { display: parsed.leader + m.lhs } : {}),
      });
    }
  }
  for (const m of defaultLeaderMaps(parsed?.leader ?? DEFAULT_LEADER)) push(m);
  return out;
}

let applied: PlannedMap[] = [];

function unmapOne(api: VimApiLike, m: PlannedMap): void {
  // Ex aliases (`:W`) live in the ex command map and refuse a context.
  if (m.ctx === undefined) api.unmap(m.lhs);
  else api.unmap(m.lhs, m.ctx);
}

/** Idempotently (re)apply the vim configuration. Bad user mappings are
 *  skipped individually (the engine throws on some malformed input). */
export function applyVimConfig(api: VimApiLike, s: ConfigInput & Pick<EditorSettings, 'escapeTimeout'>): PlannedMap[] {
  for (const m of applied) {
    try { unmapOne(api, m); } catch { /* already gone */ }
  }
  applied = [];
  try { api.setOption('insertModeEscKeysTimeout', s.escapeTimeout); } catch { /* old engine */ }
  const plan = planVimMappings(s.vim === false ? { ...s, vimrc: '' } : s);
  for (const m of plan) {
    try {
      if (m.noremap) api.noremap(m.lhs, m.rhs, m.ctx);
      else api.map(m.lhs, m.rhs, m.ctx);
      applied.push(m);
    } catch {
      // skip this mapping
    }
  }
  return applied.slice();
}

/** Minimal vim state the leader interceptor reads. */
export interface VimStateLike {
  insertMode?: boolean;
  inputState?: { keyBuffer?: unknown[] | string; operator?: unknown } | null;
}

/** Engine key name for a keydown (`' '` → `<Space>`), as the leader
 *  setting spells it; null for modified keys. */
export function leaderKeyName(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === ' ') return '<Space>';
  return e.key.length === 1 ? e.key : null;
}

/**
 * Leader interception: when `key` is the leader, vim is in normal or
 * visual mode with nothing pending, and some applied mapping starts
 * with the leader, feed LEADER_TOKEN instead. Returns true if handled.
 */
export function feedLeader(
  handleKey: (token: string) => unknown,
  vim: VimStateLike | null | undefined,
  key: string | null,
  leader: string,
  maps: readonly PlannedMap[] = applied,
): boolean {
  if (!key || key !== leader || !vim || vim.insertMode) return false;
  const buf = vim.inputState?.keyBuffer;
  if ((buf && buf.length > 0) || vim.inputState?.operator) return false;
  if (!maps.some((m) => m.lhs.startsWith(LEADER_TOKEN))) return false;
  handleKey(LEADER_TOKEN);
  return true;
}

/** What is currently applied (legend: leader hints). */
export function appliedMappings(): readonly PlannedMap[] {
  return applied;
}

/** Test hook. */
export function _resetVimConfigForTests(): void {
  applied = [];
}

// ---- effective editor settings ------------------------------------------------

export interface EffectiveSettings extends EditorSettings {
  /** Indent width (vim `shiftwidth`); defaults to tabSize. */
  indentWidth: number;
  /** Indent with spaces (`expandtab`). */
  indentWithSpaces: boolean;
  /** Settings fields a vimrc `set` overrode (UI shows "set by .vimrc"). */
  overridden: ReadonlyArray<keyof EditorSettings>;
  leader: string;
}

/** Merge the vimrc's `set` options over the device settings. The vimrc
 *  only applies while vim is on. */
export function effectiveSettings(s: EditorSettings, parsed: ParsedVimrc | null = s.vimrc ? parseVimrc(s.vimrc) : null): EffectiveSettings {
  const eff: EffectiveSettings = {
    ...s,
    indentWidth: s.tabSize,
    indentWithSpaces: true,
    overridden: [],
    leader: parsed?.leader ?? DEFAULT_LEADER,
  };
  if (!s.vim || !parsed) return { ...eff, leader: s.vim ? eff.leader : DEFAULT_LEADER };
  const o = parsed.options;
  const over: Array<keyof EditorSettings> = [];
  if (o.number !== undefined) {
    eff.lineNumbers = o.number;
    over.push('lineNumbers');
  }
  if (o.relativenumber !== undefined) {
    eff.relativeLineNumbers = o.relativenumber;
    over.push('relativeLineNumbers');
  }
  if (o.wrap !== undefined) {
    eff.lineWrapping = o.wrap;
    over.push('lineWrapping');
  }
  if (o.tabstop !== undefined) {
    eff.tabSize = o.tabstop;
    over.push('tabSize');
  }
  eff.indentWidth = o.shiftwidth ?? eff.tabSize;
  if (o.expandtab !== undefined) eff.indentWithSpaces = o.expandtab;
  eff.overridden = over;
  return eff;
}
