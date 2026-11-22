import { describe, it, expect } from 'vitest';
import { SSEParser } from './sse.ts';

const STREAM =
  'event: hello\ndata: {"protocol":1,"vaults":[]}\n\n' +
  ': ping\n\n' +
  'event: vault.head\r\ndata: {"vault_id":"a","seq":2}\r\n\r\n' +
  'event: multi\rdata: line1\rdata:line2\r\r' +
  'data: no-event-name\n\n' +
  'id: 7\nretry: 10\nunknown: x\nevent: vault.revoked\ndata: {"vault_id":"a","reason":"removed"}\n\n';

const EXPECTED = [
  { event: 'hello', data: '{"protocol":1,"vaults":[]}' },
  { event: 'vault.head', data: '{"vault_id":"a","seq":2}' },
  { event: 'multi', data: 'line1\nline2' },
  { event: 'message', data: 'no-event-name' },
  { event: 'vault.revoked', data: '{"vault_id":"a","reason":"removed"}' },
];

describe('SSEParser', () => {
  it('parses LF, CRLF and CR streams, comments, multi-line data', () => {
    const p = new SSEParser();
    expect(p.push(STREAM)).toEqual(EXPECTED);
    expect(p.comments).toBe(1);
  });

  it('gives the same result for every possible split point (chunk cuts)', () => {
    for (let i = 0; i <= STREAM.length; i++) {
      const p = new SSEParser();
      const out = [...p.push(STREAM.slice(0, i)), ...p.push(STREAM.slice(i))];
      expect(out, `split at ${i}`).toEqual(EXPECTED);
    }
  });

  it('works one character at a time', () => {
    const p = new SSEParser();
    const out = [];
    for (const ch of STREAM) out.push(...p.push(ch));
    expect(out).toEqual(EXPECTED);
  });

  it('strips a leading BOM and drops an unterminated trailing event', () => {
    const p = new SSEParser();
    expect(p.push('﻿event: a\ndata: 1\n\nevent: b\ndata: 2')).toEqual([{ event: 'a', data: '1' }]);
    p.end();
    expect(p.push('\n\n')).toEqual([]);
  });

  it('ignores events without data', () => {
    const p = new SSEParser();
    expect(p.push('event: x\n\n')).toEqual([]);
  });
});
