import { describe, it, expect } from 'vitest';
import { healMissingCommas, keepDocumentText, lineColumn, locateJsonError, newerDocument, splitJsonDocuments } from './canvas-recover.ts';
import { parseCanvas } from './canvas.ts';

describe('locateJsonError', () => {
  it('valid JSON → null', () => {
    expect(locateJsonError('{"nodes":[],"edges":[]}\n')).toBeNull();
    expect(locateJsonError('{"a":[1,-2.5e3,true,null,"x\\n\\u00e9"]}')).toBeNull();
  });

  it('points at the first error with a 1-based line and column (pt-BR)', () => {
    const t = '{\n\t"nodes":[\n\t\t{"id":"a"}\n\t\t{"id":"b"}\n\t]\n}';
    const e = locateJsonError(t)!;
    expect(e).toMatchObject({ line: 4, column: 3 });
    expect(t[e.offset]).toBe('{');
    expect(e.message).toMatch(/esperava “,” ou “]”/);
    expect(locateJsonError('{"a":1,}')!.message).toMatch(/vírgula sobrando/);
    expect(locateJsonError('{"a":')!.message).toMatch(/termina antes/);
    expect(locateJsonError('')!.offset).toBe(0);
  });

  it('two concatenated documents: the error is the start of the second', () => {
    const e = locateJsonError('{"a":1}\n{"b":2}\n')!;
    expect(e).toMatchObject({ line: 2, column: 1, message: 'há conteúdo depois do fim do JSON' });
  });

  it('lineColumn counts UTF-16 units', () => {
    expect(lineColumn('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
  });

  it('parseCanvas reports the position in pt-BR', () => {
    const p = parseCanvas('{"nodes":[}');
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.at).toMatchObject({ line: 1, column: 11 });
      expect(p.error).toMatch(/\(linha 1, coluna 11\)$/);
    }
  });
});

describe('splitJsonDocuments / newerDocument', () => {
  const A = '{"nodes":[{"id":"a"}],"edges":[]}';
  const B = '{"nodes":[{"id":"b"}],"edges":[]}';

  it('exactly two objects (whitespace allowed) → both, with their ranges', () => {
    const d = splitJsonDocuments(`${A}\n${B}\n`)!;
    expect(d.map((x) => x.text)).toEqual([A, B]);
    expect(d[1].from).toBe(A.length + 1);
    expect(splitJsonDocuments(A)).toBeNull();
    expect(splitJsonDocuments(`${A}${B}${A}`)).toBeNull();
    expect(splitJsonDocuments(`${A}x${B}`)).toBeNull();
    expect(splitJsonDocuments(`${A}[1]`)).toBeNull();
  });

  it('the newer one is the one that is not the last valid text; else the later one', () => {
    const d = splitJsonDocuments(`${A}${B}`)!;
    expect(newerDocument(d, B).text).toBe(A);
    expect(newerDocument(d, A).text).toBe(B);
    expect(newerDocument(d, null).text).toBe(B);
    expect(keepDocumentText(`${A}${B}\n`, d[0])).toBe(A + '\n');
  });
});

describe('healMissingCommas', () => {
  it('adds a comma only between two objects of an array', () => {
    expect(healMissingCommas('{"nodes":[\n\t\t{"id":"a"}\n\t\n\t\t{"id":"b"}\n\t]}')).toBe('{"nodes":[\n\t\t{"id":"a"},\n\t\n\t\t{"id":"b"}\n\t]}');
    expect(healMissingCommas('{"a":[{"x":1}{"y":2}{"z":3}]}')).toBe('{"a":[{"x":1},{"y":2},{"z":3}]}');
  });
  it('leaves everything else alone (top-level documents, strings, other errors)', () => {
    expect(healMissingCommas('{"a":1}{"b":2}')).toBeNull();
    expect(healMissingCommas('{"t":"}{"}')).toBeNull();
    expect(healMissingCommas('{"a":[1 2]}')).toBeNull();
    expect(healMissingCommas('{"a":{"b":1}}')).toBeNull();
    expect(parseCanvas('{"nodes":[{"id":"a"} 7]}').ok).toBe(false);
  });
});
