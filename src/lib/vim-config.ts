// Applies EditorSettings to the @replit/codemirror-vim engine.
//
// The vim API is a process-wide singleton: maps live in one global
// keymap shared by every editor. So we remember exactly what *we*
// mapped and unmap it before applying a new configuration — the
// user's own `:imap` from the ex line is left alone.
//
// Escape sequences (`jk`, `ff`, …) are insert-mode maps to <Esc>. The
// engine types the first key immediately (a lone `f` still inserts
// `f`); if the second key arrives within `insertModeEscKeysTimeout` ms
// it removes the typed prefix and leaves insert mode, otherwise the
// pending buffer is dropped and typing continues normally.

import type { EditorSettings, MapMode } from './editor-settings.ts';

/** The slice of the replit `Vim` API this module touches. */
export interface VimApiLike {
  map(lhs: string, rhs: string, ctx?: string): void;
  noremap(lhs: string, rhs: string, ctx?: string): void;
  unmap(lhs: string, ctx?: string): unknown;
  setOption(name: string, value: unknown): unknown;
}

export interface PlannedMap {
  lhs: string;
  rhs: string;
  ctx: MapMode;
  noremap: boolean;
}

/** Pure: the list of maps a settings object asks for, in apply order. */
export function planVimMappings(s: Pick<EditorSettings, 'escapeSequences' | 'mappings'>): PlannedMap[] {
  const out: PlannedMap[] = [];
  const seen = new Set<string>();
  const push = (m: PlannedMap) => {
    const k = m.ctx + '\u0000' + m.lhs;
    if (seen.has(k)) return; // first wins; avoids double-mapping one lhs
    seen.add(k);
    out.push(m);
  };
  for (const seq of s.escapeSequences) push({ lhs: seq, rhs: '<Esc>', ctx: 'insert', noremap: false });
  for (const m of s.mappings) push({ lhs: m.lhs, rhs: m.rhs, ctx: m.mode, noremap: m.noremap });
  return out;
}

let applied: PlannedMap[] = [];

/** Idempotently (re)apply the vim configuration. Bad user mappings are
 *  skipped individually (the engine throws on some malformed input). */
export function applyVimConfig(api: VimApiLike, s: Pick<EditorSettings, 'escapeSequences' | 'mappings' | 'escapeTimeout'>): PlannedMap[] {
  for (const m of applied) {
    try { api.unmap(m.lhs, m.ctx); } catch { /* already gone */ }
  }
  applied = [];
  try { api.setOption('insertModeEscKeysTimeout', s.escapeTimeout); } catch { /* old engine */ }
  for (const m of planVimMappings(s)) {
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

/** Test hook. */
export function _resetVimConfigForTests(): void {
  applied = [];
}
