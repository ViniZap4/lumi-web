// Deterministic synthetic notes for the micro-benchmarks
// (docs/phase3/research/03-performance.md §a.2). The block-dense note
// repeats a heading, a paragraph, two tasks and a callout about every
// 130 B, the worst case for block counts. Every few units it also
// carries a table and a fenced code block so the block layer has work.

const WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor'.split(' ');

function words(seed: number, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(WORDS[(seed * 7 + i * 3) % WORDS.length]);
  return out.join(' ');
}

/** Block-dense markdown of about `bytes` bytes. */
export function blockDenseNote(bytes: number): string {
  const parts: string[] = [];
  let size = 0;
  for (let i = 0; size < bytes; i++) {
    let unit = `## Item ${i}\n\n${words(i, 5)} **${WORDS[i % WORDS.length]}** and \`c${i}\`.\n\n- [ ] task ${i}\n- [x] done ${i}\n\n> [!note] ${words(i + 1, 3)}\n\n`;
    if (i % 25 === 7) unit += `| a | b |\n|---|---|\n| ${i} | ${i + 1} |\n\n`;
    if (i % 40 === 13) unit += '```js\nlet x = ' + i + ';\n```\n\n';
    parts.push(unit);
    size += unit.length;
  }
  return parts.join('');
}

/** Offset of a paragraph position near the middle of `doc`. */
export function midParagraph(doc: string): number {
  const i = doc.indexOf('## Item', Math.floor(doc.length / 2));
  return doc.indexOf('\n\n', i) + 2 + 3; // inside the paragraph line
}
