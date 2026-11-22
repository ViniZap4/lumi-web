// Incremental text/event-stream parser (WHATWG HTML §9.2.6 subset).
//
// Fed with decoded text chunks of arbitrary size — a chunk may end in
// the middle of a field, a line or a CRLF pair. Handles LF, CR and CRLF
// line endings, `:` comment lines, multi-line `data:` (joined with
// "\n"), a single optional space after the colon, a leading BOM, and
// ignores unknown fields. `id:`/`retry:` are parsed but unused: the
// lumi feed has no replay (SPEC-LIVROS §3.2).

export interface SSEMessage {
  /** `event:` field, default "message". */
  event: string;
  data: string;
}

export class SSEParser {
  private buf = '';
  private sawFirst = false;
  /** A chunk ended in '\r': the next '\n' belongs to the same break. */
  private pendingCR = false;
  private eventType = '';
  private data: string[] = [];
  private hasData = false;
  /** Number of comment lines seen (": ping" keep-alives). */
  comments = 0;

  /** Push a decoded chunk; returns the messages it completed. */
  push(chunk: string): SSEMessage[] {
    if (!chunk) return [];
    if (!this.sawFirst) {
      this.sawFirst = true;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
    }
    if (this.pendingCR && chunk[0] === '\n') chunk = chunk.slice(1);
    this.pendingCR = false;
    this.buf += chunk;
    const out: SSEMessage[] = [];
    let start = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const c = this.buf[i];
      if (c !== '\n' && c !== '\r') continue;
      const line = this.buf.slice(start, i);
      if (c === '\r') {
        if (i + 1 < this.buf.length) {
          if (this.buf[i + 1] === '\n') i++;
        } else {
          this.pendingCR = true;
        }
      }
      start = i + 1;
      const msg = this.line(line);
      if (msg) out.push(msg);
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  /** End of stream: per spec an unterminated event is discarded. */
  end(): void {
    this.buf = '';
    this.reset();
  }

  private reset(): void {
    this.eventType = '';
    this.data = [];
    this.hasData = false;
  }

  private line(line: string): SSEMessage | null {
    if (line === '') {
      // Dispatch.
      if (!this.hasData) {
        this.reset();
        return null;
      }
      const msg = { event: this.eventType || 'message', data: this.data.join('\n') };
      this.reset();
      return msg;
    }
    if (line[0] === ':') {
      this.comments++;
      return null;
    }
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value[0] === ' ') value = value.slice(1);
    switch (field) {
      case 'event':
        this.eventType = value;
        break;
      case 'data':
        this.data.push(value);
        this.hasData = true;
        break;
      default:
        // id / retry / unknown: ignored (no replay in the lumi feed).
        break;
    }
    return null;
  }
}
