// A safe `.vimrc` subset for the web editor.
//
// The text is PARSED, never evaluated: every line is matched against a
// small grammar and turned into data (key mappings, a leader, a few
// `set` options). Anything outside the grammar is reported per line —
// as an error (malformed), a warning (understood but not supported
// here) or an info (accepted, nothing to do) — and otherwise ignored.
// No line can run JavaScript, load a file or reach the network: the
// output only ever feeds `Vim.map/noremap/unmap` (key strings) and the
// editor's own settings.
//
// Supported:
//   " comments, blank lines, a leading `:` on any line
//   map nmap imap vmap xmap  noremap nnoremap inoremap vnoremap xnoremap
//   unmap nunmap iunmap vunmap xunmap   (removes a mapping defined above)
//   <silent> <nowait> <unique> <buffer> map arguments (ignored)
//   let mapleader = ","   let maplocalleader = " "   ("\<Space>" too)
//   set number relativenumber wrap expandtab (no…/! forms), tabstop=N,
//       shiftwidth=N, softtabstop=N (accepted), ignorecase smartcase
//       hlsearch incsearch (always on in this engine)
//   syntax / filetype / colorscheme / nocompatible lines (ignored)
//
// Key notation is normalised to what @replit/codemirror-vim expects:
// `<cr>` → `<CR>`, `<esc>` → `<Esc>`, `<c-D>` → `<C-d>`, `<leader>` →
// the leader in effect at that line (vim semantics).

export type VimrcMode = 'all' | 'normal' | 'insert' | 'visual';

export interface VimrcMap {
  mode: VimrcMode;
  lhs: string;
  rhs: string;
  noremap: boolean;
  /** 1-based source line. */
  line: number;
  /** lhs began with `<leader>`: `lhs` then holds the keys AFTER the
   *  leader (the engine binds them behind a private leader token, see
   *  vim-config.ts). */
  leader?: boolean;
}

export interface VimrcOptions {
  number?: boolean;
  relativenumber?: boolean;
  wrap?: boolean;
  expandtab?: boolean;
  tabstop?: number;
  shiftwidth?: number;
}

export type Severity = 'error' | 'warning' | 'info';

export interface VimrcDiagnostic {
  line: number;
  severity: Severity;
  message: string;
}

export interface ParsedVimrc {
  maps: VimrcMap[];
  options: VimrcOptions;
  /** Leader in key notation (`\`, `,`, `<Space>`). */
  leader: string;
  diagnostics: VimrcDiagnostic[];
}

export const MAX_VIMRC_BYTES = 16 * 1024;
export const MAX_VIMRC_MAPS = 200;
export const MAX_LHS_LEN = 48;
export const MAX_RHS_LEN = 256;
export const DEFAULT_LEADER = '\\';

const MAP_COMMANDS: Record<string, { mode: VimrcMode; noremap: boolean }> = {
  map: { mode: 'all', noremap: false },
  nmap: { mode: 'normal', noremap: false },
  nm: { mode: 'normal', noremap: false },
  imap: { mode: 'insert', noremap: false },
  im: { mode: 'insert', noremap: false },
  vmap: { mode: 'visual', noremap: false },
  vm: { mode: 'visual', noremap: false },
  xmap: { mode: 'visual', noremap: false },
  xm: { mode: 'visual', noremap: false },
  noremap: { mode: 'all', noremap: true },
  no: { mode: 'all', noremap: true },
  nnoremap: { mode: 'normal', noremap: true },
  nn: { mode: 'normal', noremap: true },
  inoremap: { mode: 'insert', noremap: true },
  ino: { mode: 'insert', noremap: true },
  vnoremap: { mode: 'visual', noremap: true },
  vn: { mode: 'visual', noremap: true },
  xnoremap: { mode: 'visual', noremap: true },
  xn: { mode: 'visual', noremap: true },
};

const UNMAP_COMMANDS: Record<string, VimrcMode> = {
  unmap: 'all',
  unm: 'all',
  nunmap: 'normal',
  nun: 'normal',
  iunmap: 'insert',
  iu: 'insert',
  vunmap: 'visual',
  vu: 'visual',
  xunmap: 'visual',
  xu: 'visual',
};

const IGNORED_COMMANDS = new Set(['syntax', 'syn', 'filetype', 'filet', 'colorscheme', 'colo', 'set nocompatible']);
const SCRIPT_COMMANDS = new Set([
  'source', 'so', 'runtime', 'ru', 'function', 'fu', 'function!', 'endfunction', 'endf', 'call', 'cal',
  'execute', 'exe', 'autocmd', 'au', 'augroup', 'aug', 'command', 'command!', 'com', 'if', 'endif', 'else',
  'for', 'endfor', 'while', 'endwhile', 'lua', 'python', 'py', 'python3', 'py3', 'ruby', 'perl', 'normal', 'norm',
  'normal!', 'norm!', 'silent', 'sil', 'silent!', 'packadd', 'Plug', 'plug#begin', 'call plug#begin',
]);

/** Map-command argument flags that change nothing for us. */
const MAP_FLAGS = new Set(['<silent>', '<nowait>', '<unique>', '<buffer>', '<special>', '<script>']);

// Canonical names for `<…>` key notation (lower-case key → engine name).
const KEY_NAMES: Record<string, string> = {
  cr: 'CR', enter: 'CR', return: 'CR',
  esc: 'Esc', escape: 'Esc',
  space: 'Space',
  tab: 'Tab',
  bs: 'BS', backspace: 'BS',
  del: 'Del', delete: 'Del',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown',
  ins: 'Ins', insert: 'Ins',
  lt: 'lt',
};
const LITERAL_NAMES: Record<string, string> = { bar: '|', bslash: '\\' };
const FN_KEY = /^f([1-9]|1[0-2])$/;

export interface KeyNormResult {
  keys: string;
  error?: string;
}

/**
 * Normalise vim key notation to the engine's spelling, expanding
 * `<leader>`/`<localleader>`. Unknown `<…>` names are errors (they
 * would silently never match). A lone `<` that does not start a key
 * name is kept literally.
 */
export function normalizeKeys(raw: string, leader = DEFAULT_LEADER, localLeader = leader): KeyNormResult {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '<') {
      const close = raw.indexOf('>', i + 1);
      const body = close > i ? raw.slice(i + 1, close) : '';
      if (close > i && /^[A-Za-z0-9-]+$/.test(body) && body.length <= 16) {
        const lower = body.toLowerCase();
        if (lower === 'leader') {
          out += leader;
        } else if (lower === 'localleader') {
          out += localLeader;
        } else if (LITERAL_NAMES[lower]) {
          out += LITERAL_NAMES[lower];
        } else {
          const r = normalizeNamedKey(body);
          if (r == null) return { keys: out, error: `unknown key <${body}>` };
          out += r;
        }
        i = close + 1;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return { keys: out };
}

function normalizeNamedKey(body: string): string | null {
  const parts = body.split('-');
  const keyPart = parts.pop() ?? '';
  if (!keyPart) {
    // `<C-->`: the key is '-'.
    if (body.endsWith('--')) parts.pop();
    else return null;
  }
  const mods: string[] = [];
  for (const p of parts) {
    const m = p.toLowerCase();
    if (m === 'c') mods.push('C');
    else if (m === 's') mods.push('S');
    else if (m === 'a' || m === 'm') mods.push(m === 'a' ? 'A' : 'M');
    else if (m === 'd') mods.push('M'); // <D-…> (mac command) — the engine names it M-
    else return null;
  }
  let key: string;
  const lower = (keyPart || '-').toLowerCase();
  if (KEY_NAMES[lower]) key = KEY_NAMES[lower];
  else if (FN_KEY.test(lower)) key = lower.toUpperCase();
  else if ((keyPart || '-').length === 1) {
    if (mods.length === 0) return null; // `<x>` is not a key name
    // <C-D> and <C-d> are the same key in vim; the engine sees lower case.
    key = mods.includes('S') ? keyPart : keyPart.toLowerCase();
  } else return null;
  if (key === 'lt' && mods.length > 0) return null;
  // Engine order: C- A- M- S- (see vimKeyFromEvent).
  const order = ['C', 'A', 'M', 'S'];
  const sorted = order.filter((m) => mods.includes(m));
  return '<' + sorted.map((m) => m + '-').join('') + key + '>';
}

/** Parse a `let mapleader = …` value into key notation, or null. */
export function parseLeaderValue(raw: string): string | null {
  const v = raw.trim();
  let s: string | null = null;
  const dq = /^"((?:[^"\\]|\\.)*)"$/.exec(v);
  const sq = /^'((?:[^']|'')*)'$/.exec(v);
  if (dq) {
    s = dq[1].replace(/\\<space>/gi, ' ').replace(/\\<([^>]+)>/g, '<$1>').replace(/\\(.)/g, '$1');
  } else if (sq) {
    s = sq[1].replace(/''/g, "'");
  } else {
    return null;
  }
  if (s === ' ') return '<Space>';
  if (/^<[^>]+>$/.test(s)) {
    const n = normalizeKeys(s);
    return n.error ? null : n.keys;
  }
  if (Array.from(s).length !== 1 || /[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

const BOOL_OPTS: Record<string, keyof VimrcOptions | 'ignorecase' | 'smartcase' | 'hlsearch' | 'incsearch'> = {
  number: 'number', nu: 'number',
  relativenumber: 'relativenumber', rnu: 'relativenumber',
  wrap: 'wrap',
  expandtab: 'expandtab', et: 'expandtab',
  ignorecase: 'ignorecase', ic: 'ignorecase',
  smartcase: 'smartcase', scs: 'smartcase',
  hlsearch: 'hlsearch', hls: 'hlsearch',
  incsearch: 'incsearch', is: 'incsearch',
};
const ALWAYS_ON = new Set(['ignorecase', 'smartcase', 'hlsearch', 'incsearch']);
const NUM_OPTS: Record<string, 'tabstop' | 'shiftwidth' | 'softtabstop'> = {
  tabstop: 'tabstop', ts: 'tabstop',
  shiftwidth: 'shiftwidth', sw: 'shiftwidth',
  softtabstop: 'softtabstop', sts: 'softtabstop',
};
const IGNORED_OPTS = new Set(['nocompatible', 'compatible', 'cp', 'nocp', 'encoding', 'enc', 'fileencoding', 'fenc', 'syntax', 'background', 'bg', 'termguicolors', 'tgc', 'mouse']);

/** Strip a trailing `" comment` (only for set/let lines; in maps `"` is a key). */
function stripTrailingComment(s: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) {
      // A `"` preceded by whitespace and not opening a string value
      // starts a comment.
      const prev = s.slice(0, i);
      if (/\s$/.test(prev) && !/=\s*$/.test(prev) && !inDouble) return prev.trimEnd();
      inDouble = !inDouble;
    }
  }
  return s;
}

export function parseVimrc(text: string): ParsedVimrc {
  const out: ParsedVimrc = { maps: [], options: {}, leader: DEFAULT_LEADER, diagnostics: [] };
  let localLeader = DEFAULT_LEADER;
  const diag = (line: number, severity: Severity, message: string) => out.diagnostics.push({ line, severity, message });

  let src = text ?? '';
  if (new TextEncoder().encode(src).length > MAX_VIMRC_BYTES) {
    diag(1, 'error', `vimrc is larger than ${MAX_VIMRC_BYTES / 1024} KB; only the first ${MAX_VIMRC_BYTES / 1024} KB are read`);
    src = src.slice(0, MAX_VIMRC_BYTES);
  }
  const lines = src.split(/\r?\n/);

  for (let idx = 0; idx < lines.length; idx++) {
    const n = idx + 1;
    let line = lines[idx].replace(/\t/g, ' ').trim();
    if (!line) continue;
    if (line.startsWith('"')) continue; // comment
    if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(line)) {
      diag(n, 'error', 'control characters are not allowed');
      continue;
    }
    line = line.replace(/^:+\s*/, '');
    if (!line) continue;
    if (line.startsWith('\\')) {
      diag(n, 'error', 'line continuations (\\) are not supported');
      continue;
    }

    const m = /^(\S+)\s*(.*)$/.exec(line)!;
    const cmd = m[1];
    const rest = m[2];

    if (MAP_COMMANDS[cmd]) {
      if (out.maps.length >= MAX_VIMRC_MAPS) {
        diag(n, 'error', `more than ${MAX_VIMRC_MAPS} mappings; ignored`);
        continue;
      }
      const { mode, noremap } = MAP_COMMANDS[cmd];
      let args = rest;
      let flag: RegExpExecArray | null;
      let bad = false;
      while ((flag = /^(<[a-z]+>)\s*/i.exec(args))) {
        const f = flag[1].toLowerCase();
        if (f === '<expr>') {
          diag(n, 'error', '<expr> mappings evaluate code and are not supported');
          bad = true;
          break;
        }
        if (!MAP_FLAGS.has(f)) break; // a key like <C-d>, not a flag
        args = args.slice(flag[0].length);
      }
      if (bad) continue;
      const parts = /^(\S+)\s+(.+)$/.exec(args);
      if (!parts) {
        diag(n, 'error', args.trim() ? `${cmd}: missing right-hand side` : `${cmd}: listing mappings is not supported here`);
        continue;
      }
      const leaderPrefixed = /^<leader>/i.test(parts[1]) && mode !== 'insert';
      const lhsN = normalizeKeys(leaderPrefixed ? parts[1].slice(8) : parts[1], out.leader, localLeader);
      const rhsN = normalizeKeys(parts[2].trim(), out.leader, localLeader);
      if (lhsN.error || rhsN.error) {
        diag(n, 'error', (lhsN.error ?? rhsN.error)!);
        continue;
      }
      if ((!lhsN.keys && !leaderPrefixed) || !rhsN.keys) {
        diag(n, 'error', `${cmd}: empty key`);
        continue;
      }
      if (lhsN.keys.length > MAX_LHS_LEN || rhsN.keys.length > MAX_RHS_LEN) {
        diag(n, 'error', `mapping too long (max ${MAX_LHS_LEN} keys left, ${MAX_RHS_LEN} right)`);
        continue;
      }
      if (lhsN.keys.startsWith(':') && lhsN.keys !== ':') {
        if (mode !== 'all') {
          diag(n, 'error', 'ex-command aliases (:Name) need plain map/noremap, not a mode-specific map');
          continue;
        }
        if (!/^:[A-Za-z][A-Za-z0-9]*$/.test(lhsN.keys)) {
          diag(n, 'error', 'ex-command alias must be a word, e.g. map :W :write');
          continue;
        }
      }
      // Replace an earlier mapping of the same lhs/mode (vim semantics).
      out.maps = out.maps.filter((x) => !(x.lhs === lhsN.keys && x.mode === mode && !!x.leader === leaderPrefixed));
      out.maps.push({ mode, lhs: lhsN.keys, rhs: rhsN.keys, noremap, line: n, ...(leaderPrefixed ? { leader: true } : {}) });
      continue;
    }

    if (UNMAP_COMMANDS[cmd]) {
      const mode = UNMAP_COMMANDS[cmd];
      const arg = rest.replace(/^(<(silent|buffer|nowait)>\s*)+/i, '').trim();
      if (!arg) {
        diag(n, 'error', `${cmd}: missing key`);
        continue;
      }
      const leaderPrefixed = /^<leader>/i.test(arg);
      const lhsN = normalizeKeys(leaderPrefixed ? arg.slice(8) : arg, out.leader, localLeader);
      if (lhsN.error) {
        diag(n, 'error', lhsN.error);
        continue;
      }
      const before = out.maps.length;
      out.maps = out.maps.filter(
        (x) => !(x.lhs === lhsN.keys && !!x.leader === leaderPrefixed && (mode === 'all' || x.mode === mode || x.mode === 'all')),
      );
      if (out.maps.length === before) {
        diag(n, 'warning', `no mapping of ${lhsN.keys} above; built-in keys cannot be removed`);
      }
      continue;
    }

    if (cmd === 'let') {
      const lm = /^(g:)?(mapleader|maplocalleader)\s*=\s*(.+)$/.exec(stripTrailingComment(rest).trim());
      if (!lm) {
        diag(n, 'warning', 'only `let mapleader` / `let maplocalleader` are supported (variables are never evaluated)');
        continue;
      }
      const v = parseLeaderValue(lm[3]);
      if (v == null) {
        diag(n, 'error', `${lm[2]} must be one quoted key, e.g. " " or ","`);
        continue;
      }
      if (lm[2] === 'mapleader') out.leader = v;
      else localLeader = v;
      continue;
    }

    if (cmd === 'set' || cmd === 'se' || cmd === 'setlocal' || cmd === 'setl' || cmd === 'setglobal') {
      const body = stripTrailingComment(rest).trim();
      if (!body) {
        diag(n, 'error', 'set: missing option');
        continue;
      }
      for (const tok of body.split(/\s+/)) parseSetToken(tok, n, out, diag);
      continue;
    }

    if (IGNORED_COMMANDS.has(cmd) || IGNORED_COMMANDS.has(line)) {
      diag(n, 'info', 'ignored: lumi handles syntax and colours itself');
      continue;
    }
    if (SCRIPT_COMMANDS.has(cmd) || cmd.startsWith('call') || /^[A-Z]/.test(cmd)) {
      diag(n, 'warning', `\`${cmd}\` is not supported: this vimrc never runs scripts or plugins`);
      continue;
    }
    diag(n, 'error', `unknown command \`${cmd}\``);
  }
  return out;
}

function parseSetToken(
  tok: string,
  n: number,
  out: ParsedVimrc,
  diag: (line: number, s: Severity, m: string) => void,
): void {
  const eq = /^([a-z]+)\s*[=:]\s*(.*)$/.exec(tok);
  if (eq) {
    const name = eq[1];
    const key = NUM_OPTS[name];
    if (!key) {
      diag(n, IGNORED_OPTS.has(name) ? 'info' : 'warning', `option \`${name}\` is not supported`);
      return;
    }
    const v = Number(eq[2]);
    if (!/^\d+$/.test(eq[2]) || v < 1 || v > 16) {
      diag(n, 'error', `${name} must be a number from 1 to 16`);
      return;
    }
    if (key === 'softtabstop') {
      diag(n, 'info', 'softtabstop accepted (indent follows shiftwidth)');
      return;
    }
    out.options[key] = v;
    return;
  }
  if (/[+^-]=/.test(tok)) {
    diag(n, 'warning', `\`${tok}\`: += / -= / ^= are not supported`);
    return;
  }
  let name = tok;
  let value = true;
  if (name.endsWith('!') || name.startsWith('inv')) {
    diag(n, 'warning', `\`${tok}\`: toggling (! / inv) is not supported; use the plain or no… form`);
    return;
  }
  if (name.endsWith('?') || name.endsWith('&')) {
    diag(n, 'info', `\`${tok}\` ignored`);
    return;
  }
  let opt = BOOL_OPTS[name];
  if (!opt && name.startsWith('no')) {
    opt = BOOL_OPTS[name.slice(2)];
    if (opt) {
      value = false;
      name = name.slice(2);
    }
  }
  if (!opt) {
    if (NUM_OPTS[name]) diag(n, 'error', `${name} needs a value, e.g. ${name}=4`);
    else diag(n, IGNORED_OPTS.has(tok) ? 'info' : 'warning', `option \`${tok}\` is not supported`);
    return;
  }
  if (ALWAYS_ON.has(opt)) {
    diag(n, value ? 'info' : 'warning', value ? `${opt} is always on in this editor` : `${opt} cannot be turned off in this editor`);
    return;
  }
  out.options[opt as keyof VimrcOptions] = value as never;
}

/** Display form of a map's lhs (`<leader>` resolved). */
export function displayLhs(m: Pick<VimrcMap, 'lhs' | 'leader'>, leader: string): string {
  return m.leader ? leader + m.lhs : m.lhs;
}

/** Number of error diagnostics (the UI blocks nothing on warnings). */
export function errorCount(p: ParsedVimrc): number {
  return p.diagnostics.filter((d) => d.severity === 'error').length;
}

/** Sanitise stored vimrc text: string, size-capped, no control chars
 *  except tab/newline. */
export function sanitizeVimrc(v: unknown): string {
  if (typeof v !== 'string') return '';
  let s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  while (new TextEncoder().encode(s).length > MAX_VIMRC_BYTES) s = s.slice(0, Math.floor(s.length * 0.9));
  return s;
}

export const VIMRC_EXAMPLE = `" lumi vimrc — a safe subset, parsed (never executed)
let mapleader = " "

" leave insert mode with jj
inoremap jj <Esc>

" move by display lines
nnoremap j gj
nnoremap k gk

" <leader>l opens the link helper, <leader>w saves
nnoremap <leader>w :w<CR>

set relativenumber
set tabstop=2 shiftwidth=2 expandtab
`;
