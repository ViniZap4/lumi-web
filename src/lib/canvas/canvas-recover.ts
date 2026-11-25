// Invalid canvas JSON: where it breaks, and the repairs the view offers
// (pure, DOM-free; native clients can port it).
//
// `locateJsonError` is a strict RFC 8259 scanner that reports the first
// error as an offset + 1-based line/column with a pt-BR message
// (engines word JSON.parse errors differently, and Safari gives no
// position at all). `splitJsonDocuments` recognises the one corruption
// a text CRDT produces on its own: two documents written concurrently
// at the same index, e.g. `{…}{…}` (canvas-merge.test.ts).

export interface JsonErrorAt {
  offset: number;
  /** 1-based. */
  line: number;
  /** 1-based, in UTF-16 units. */
  column: number;
  /** pt-BR. */
  message: string;
}

class ScanError {
  constructor(
    readonly offset: number,
    readonly message: string,
  ) {}
}

function isWs(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

function skipWs(s: string, i: number): number {
  while (i < s.length && isWs(s.charCodeAt(i))) i++;
  return i;
}

function describeAt(s: string, i: number): string {
  if (i >= s.length) return 'o texto termina antes do fim do JSON';
  const ch = s[i];
  const shown = ch === '\n' ? 'quebra de linha' : ch === '\t' ? 'tabulação' : `“${ch}”`;
  return `caractere inesperado ${shown}`;
}

function scanString(s: string, i: number): number {
  // s[i] === '"'
  i++;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 0x22) return i + 1;
    if (c === 0x5c) {
      const e = s[i + 1];
      if (e === 'u') {
        if (!/^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) throw new ScanError(i, 'escape \\u inválido');
        i += 6;
      } else if (e !== undefined && '"\\/bfnrt'.includes(e)) i += 2;
      else throw new ScanError(i, 'escape inválido no texto');
      continue;
    }
    if (c < 0x20) throw new ScanError(i, c === 0x0a ? 'texto (string) sem aspas de fechamento' : 'caractere de controle dentro de um texto');
    i++;
  }
  throw new ScanError(s.length, 'texto (string) sem aspas de fechamento');
}

function scanNumber(s: string, i: number): number {
  const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(s.slice(i, i + 400));
  if (!m) throw new ScanError(i, 'número inválido');
  return i + m[0].length;
}

function scanValue(s: string, i: number, depth: number): number {
  if (depth > 512) throw new ScanError(i, 'aninhamento profundo demais');
  i = skipWs(s, i);
  const c = s[i];
  if (c === '{') {
    i = skipWs(s, i + 1);
    if (s[i] === '}') return i + 1;
    for (;;) {
      i = skipWs(s, i);
      if (s[i] !== '"') throw new ScanError(i, s[i] === '}' ? 'vírgula sobrando antes de “}”' : `esperava o nome de uma chave entre aspas; ${describeAt(s, i)}`);
      i = skipWs(s, scanString(s, i));
      if (s[i] !== ':') throw new ScanError(i, `esperava “:”; ${describeAt(s, i)}`);
      i = skipWs(s, scanValue(s, i + 1, depth + 1));
      if (s[i] === ',') {
        i++;
        continue;
      }
      if (s[i] === '}') return i + 1;
      throw new ScanError(i, `esperava “,” ou “}”; ${describeAt(s, i)}`);
    }
  }
  if (c === '[') {
    i = skipWs(s, i + 1);
    if (s[i] === ']') return i + 1;
    for (;;) {
      i = skipWs(s, i);
      if (s[i] === ']') throw new ScanError(i, 'vírgula sobrando antes de “]”');
      i = skipWs(s, scanValue(s, i, depth + 1));
      if (s[i] === ',') {
        i++;
        continue;
      }
      if (s[i] === ']') return i + 1;
      throw new ScanError(i, `esperava “,” ou “]”; ${describeAt(s, i)}`);
    }
  }
  if (c === '"') return scanString(s, i);
  if (c === '-' || (c >= '0' && c <= '9')) return scanNumber(s, i);
  for (const lit of ['true', 'false', 'null']) if (s.startsWith(lit, i)) return i + lit.length;
  throw new ScanError(i, describeAt(s, i));
}

/** 1-based line/column of a UTF-16 offset. */
export function lineColumn(s: string, offset: number): { line: number; column: number } {
  let line = 1;
  let start = 0;
  const end = Math.min(offset, s.length);
  for (let i = 0; i < end; i++) {
    if (s.charCodeAt(i) === 0x0a) {
      line++;
      start = i + 1;
    }
  }
  return { line, column: end - start + 1 };
}

function errorAt(s: string, offset: number, message: string): JsonErrorAt {
  return { offset, ...lineColumn(s, offset), message };
}

/** First JSON syntax error in `s` (one top-level value expected), or
 *  null when `s` is valid JSON. Empty/whitespace-only is an error. */
export function locateJsonError(s: string): JsonErrorAt | null {
  try {
    const end = skipWs(s, scanValue(s, 0, 0));
    if (end < s.length) return errorAt(s, end, 'há conteúdo depois do fim do JSON');
    return null;
  } catch (e) {
    if (e instanceof ScanError) return errorAt(s, e.offset, e.message);
    throw e;
  }
}

export interface JsonDocument {
  /** The document's own text (no surrounding whitespace). */
  text: string;
  from: number;
  to: number;
}

/**
 * Exactly two valid top-level JSON objects one after the other (only
 * whitespace around and between them), else null.
 */
export function splitJsonDocuments(s: string): [JsonDocument, JsonDocument] | null {
  try {
    const out: JsonDocument[] = [];
    let i = skipWs(s, 0);
    while (i < s.length) {
      if (out.length === 2 || s[i] !== '{') return null;
      const end = scanValue(s, i, 0);
      out.push({ text: s.slice(i, end), from: i, to: end });
      i = skipWs(s, end);
    }
    return out.length === 2 ? [out[0], out[1]] : null;
  } catch {
    return null;
  }
}

/**
 * Which of two concatenated documents to keep as "the most recent":
 * the one that is not the last valid text this client saw (that one is
 * old state); when that does not decide it, the later one in the file.
 */
export function newerDocument(docs: readonly [JsonDocument, JsonDocument], lastValid: string | null): JsonDocument {
  const last = lastValid?.trim() ?? null;
  const [a, b] = docs;
  if (last != null && b.text === last && a.text !== last) return a;
  return b;
}

/** The full text that keeps only `doc`, preserving the trailing newline
 *  convention of the file. */
export function keepDocumentText(current: string, doc: JsonDocument): string {
  return doc.text + (/\n$/.test(current) ? '\n' : '');
}
