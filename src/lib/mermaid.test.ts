// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real renderer needs a layout engine; these suites check lumi's
// side (detection, sanitising, caching, error card) around it.
const renderMermaid = vi.fn();
vi.mock('./mermaid-render.ts', () => ({ renderMermaid: (...a: unknown[]) => renderMermaid(...a) }));

import { mermaidInfo, mermaidKind, mermaidLabel, isMermaidLang } from './mermaid-detect.ts';
import { renderBlocks, renderMarkdown } from './markdown.ts';
import {
  sanitizeMermaidSvg,
  scopeDiagramCss,
  paintMermaid,
  enhanceMermaid,
  clearMermaidCache,
  mermaidStats,
  createMermaidBlock,
  setMermaidSource,
  svgInstance,
  mixHex,
  currentMermaidTheme,
  errorText,
} from './mermaid.ts';
import { enhanceRendered } from './rendered-enhance.ts';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('detection', () => {
  it('recognises the fence language', () => {
    expect(isMermaidLang('mermaid')).toBe(true);
    expect(isMermaidLang('Mermaid  {.wide}')).toBe(true);
    expect(isMermaidLang('mermaidx')).toBe(false);
    expect(isMermaidLang('')).toBe(false);
  });

  it.each([
    ['graph TD\nA-->B', 'flowchart'],
    ['flowchart LR\nA-->B', 'flowchart'],
    ['sequenceDiagram\nA->>B: hi', 'sequence'],
    ['classDiagram\nA <|-- B', 'class'],
    ['stateDiagram-v2\n[*] --> A', 'state'],
    ['erDiagram\nA ||--o{ B : has', 'er'],
    ['gantt\ntitle Plan', 'gantt'],
    ['pie title Pets\n"Dogs" : 3', 'pie'],
    ['mindmap\n  root', 'mindmap'],
    ['journey\ntitle Day', 'journey'],
    ['gitGraph\ncommit', 'git'],
    ['timeline\ntitle T', 'timeline'],
    ['xychart-beta\nx-axis [a]', 'xychart'],
    ['something else', 'diagram'],
  ])('%s → %s', (src, kind) => {
    expect(mermaidKind(src)).toBe(kind);
  });

  it('skips front matter, directives, comments and blank lines', () => {
    const src = '\n---\ntitle: "Checkout flow"\nconfig:\n  theme: forest\n---\n%%{init: {"theme":"dark"}}%%\n%% a comment\n\nsequenceDiagram\n  Alice->>Bob: Hello';
    expect(mermaidInfo(src)).toEqual({ kind: 'sequence', title: 'Checkout flow', firstLine: 'Alice->>Bob: Hello' });
  });

  it('labels from the title, else the first statement', () => {
    expect(mermaidLabel('pie title Pets adopted\n"Dogs": 3')).toBe('Pie chart: Pets adopted');
    expect(mermaidLabel('gantt\n  title Release plan\n  section A')).toBe('Gantt chart: Release plan');
    expect(mermaidLabel('flowchart TD\n  accTitle: Login\n  A-->B')).toBe('Flowchart: Login');
    expect(mermaidLabel('flowchart TD\n  A[Start] --> B')).toBe('Flowchart: A[Start] --> B');
    expect(mermaidLabel('mindmap')).toBe('Mind map');
    expect(mermaidLabel('nonsense')).toBe('Mermaid diagram');
  });
});

describe('markdown renderer', () => {
  it('emits a mermaid block (escaped source, kind) instead of a code block', () => {
    const html = renderMarkdown('```mermaid\ngraph TD\nA["<script>alert(1)</script>"] --> B\n```');
    const div = document.createElement('div');
    div.innerHTML = html;
    const block = div.querySelector<HTMLElement>('.md-mermaid')!;
    expect(block).not.toBeNull();
    expect(block.dataset.kind).toBe('flowchart');
    expect(div.querySelector('.md-code')).toBeNull();
    expect(div.querySelector('script')).toBeNull();
    expect(block.querySelector('.md-mermaid-src > code')!.textContent).toContain('<script>alert(1)</script>');
  });

  it('leaves other fences alone and keeps line mapping', () => {
    const blocks = renderBlocks('para\n\n```mermaid\npie\n"a": 1\n```\n\n```js\nx\n```');
    expect(blocks.map((b) => b.line)).toEqual([0, 2, 7]);
    expect(blocks[1].html).toContain('md-mermaid');
    expect(blocks[2].html).toContain('md-code');
  });
});

const ID = 'lumimmd7q';
const wrap = (inner: string, style = `#${ID}{fill:red}`) =>
  `<svg id="${ID}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" style="max-width: 100px;"><style>${style}</style>${inner}</svg>`;

describe('SVG sanitising', () => {
  it('keeps the drawing: shapes, text, markers, local refs, scoped CSS', () => {
    const out = sanitizeMermaidSvg(
      wrap(
        '<defs><marker id="lumimmd7q_end"><path d="M0,0L10,5"/></marker></defs><g class="node"><rect width="10" height="10" style="fill:#f9f"/><text>Hi</text></g><path marker-end="url(#lumimmd7q_end)" d="M0 0L5 5"/><use href="#lumimmd7q_end"/>',
      ),
      ID,
    );
    const d = document.createElement('div');
    d.innerHTML = out;
    expect(d.querySelector('svg')!.id).toBe(ID);
    expect(d.querySelector('rect')!.getAttribute('style')).toBe('fill:#f9f');
    expect(d.querySelector('path[marker-end]')!.getAttribute('marker-end')).toBe('url(#lumimmd7q_end)');
    expect(d.querySelector('use')!.getAttribute('href')).toBe('#lumimmd7q_end');
    expect(d.querySelector('text')!.textContent).toBe('Hi');
    expect(d.querySelector('style')!.textContent).toContain(`#${ID}`);
    expect(d.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('removes script elements and event handlers', () => {
    const out = sanitizeMermaidSvg(
      wrap('<script>alert(1)</script><g onclick="alert(2)" onmouseover="alert(3)"><rect onload="alert(4)" width="1"/></g><svg onload="alert(5)"></svg>'),
      ID,
    );
    expect(out).not.toMatch(/script|onclick|onmouseover|onload|alert/i);
    expect(out).toContain('<rect');
  });

  it('drops javascript: and remote links (keeps the label text)', () => {
    const out = sanitizeMermaidSvg(
      wrap('<a href="javascript:alert(1)"><text>A</text></a><a xlink:href="https://evil.example/"><text>B</text></a><use href="https://evil.example/x.svg#a"/><use xlink:href="javascript:alert(1)"/>'),
      ID,
    );
    expect(out).not.toMatch(/javascript|evil\.example|<a[\s>]/i);
    expect(out).toContain('>A<');
    expect(out).toContain('>B<');
  });

  it('keeps a linked node in place (the link becomes a group)', () => {
    const out = sanitizeMermaidSvg(wrap('<a xlink:href="https://evil.example/" target="_blank" transform="translate(10,20)"><g class="node"><text>N</text></g></a>'), ID);
    const d = document.createElement('div');
    d.innerHTML = out;
    expect(d.querySelector('a')).toBeNull();
    const g = d.querySelector('svg > g')!;
    expect(g.getAttribute('transform')).toBe('translate(10,20)');
    expect(out).not.toMatch(/evil|target/);
    expect(g.textContent).toBe('N');
  });

  it('removes foreignObject HTML, images, iframes and animation', () => {
    const out = sanitizeMermaidSvg(
      wrap(
        '<foreignObject width="100" height="20"><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"><iframe src="https://evil.example"></iframe>label</div></foreignObject><image href="https://evil.example/t.png"/><animate attributeName="href" to="javascript:alert(1)"/><set attributeName="onclick" to="alert(1)"/>',
      ),
      ID,
    );
    expect(out).not.toMatch(/foreignObject|<img|<iframe|<image|<animate|<set|evil|alert/i);
  });

  it('drops remote url() in attributes and inline styles', () => {
    const out = sanitizeMermaidSvg(
      wrap('<rect fill="url(https://evil.example/p.svg#g)" style="fill:url(https://evil.example/a)"/><rect style="background:expression(alert(1))"/><rect fill="url(#lumimmd7q_g)"/>'),
      ID,
    );
    expect(out).not.toMatch(/evil|expression/);
    expect(out).toContain('url(#lumimmd7q_g)');
  });

  it('scopes embedded CSS to the diagram', () => {
    const css = scopeDiagramCss(
      `#${ID} .node rect{fill:#123456}#${ID} .a,#${ID} .b{stroke:red}@import url(https://evil.example/x.css);body{display:none}#${ID} .x, .app{color:red}#${ID} .y{background:url(https://evil.example/leak)}@keyframes dash{to{stroke-dashoffset:0}}@font-face{font-family:x;src:url(https://evil.example/f.woff)}`,
      ID,
    );
    expect(css).toContain('#123456');
    expect(css).toMatch(/\.a.*\.b/);
    expect(css).toContain('@keyframes dash');
    expect(css).not.toMatch(/evil|body|\.app|display: ?none|@import|@font-face/);
  });

  it('a crafted classDef cannot break out of the diagram style', () => {
    const out = sanitizeMermaidSvg(wrap('<g/>', `#${ID} .x{fill:red} } body { visibility:hidden } #${ID} .y{fill:blue}`), ID);
    expect(out).not.toMatch(/body|visibility/);
  });

  it('returns empty for non-SVG output', () => {
    expect(sanitizeMermaidSvg('<div>nope</div><script>x</script>', ID)).toBe('');
  });

  it('gives every copy fresh ids', () => {
    const r = { svg: `<svg id="${ID}"><style>#${ID} .a{}</style><path marker-end="url(#${ID}_end)"/></svg>`, id: ID };
    const a = svgInstance(r);
    const b = svgInstance(r);
    expect(a).not.toContain(ID);
    expect(a).not.toBe(b);
    expect(a.match(/lumimmd\d+i/g)!.every((x, _i, all) => x === all[0])).toBe(true);
  });
});

describe('theme', () => {
  it('mixes colours', () => {
    expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mixHex('#fff', '#000', 1)).toBe('#ffffff');
    expect(mixHex('nope', '#000000', 0.5)).toBe('#000000');
  });
  it('derives a key that changes with light/dark', () => {
    document.documentElement.dataset.theme = 'dark';
    const d = currentMermaidTheme();
    document.documentElement.dataset.theme = 'light';
    const l = currentMermaidTheme();
    expect(d.key).not.toBe(l.key);
    expect(l.dark).toBe(false);
    expect(d.vars.primaryColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(d.vars.pie1).toMatch(/^#[0-9a-f]{6}$/);
    document.documentElement.dataset.theme = 'dark';
  });
});

describe('painting, cache and errors', () => {
  beforeEach(() => {
    clearMermaidCache();
    renderMermaid.mockReset();
    document.body.innerHTML = '';
    document.documentElement.dataset.theme = 'dark';
  });

  const okSvg = (src: string) => {
    let n = 0;
    renderMermaid.mockImplementation(async () => {
      const id = `lumimmd${100 + ++n}q`;
      return { svg: `<svg id="${id}" viewBox="0 0 10 10"><style>#${id} .n{fill:red}</style><text>${src}</text></svg>`, id };
    });
  };

  it('draws a block, labels it and hides nothing it should not', async () => {
    okSvg('ok');
    const block = createMermaidBlock('flowchart TD\n  A[Start] --> B');
    document.body.append(block);
    paintMermaid(block);
    expect(block.dataset.state).toBe('pending');
    expect(block.getAttribute('aria-busy')).toBe('true');
    await flush();
    await flush();
    expect(block.dataset.state).toBe('done');
    const fig = block.querySelector('.md-mermaid-fig')!;
    expect(fig.getAttribute('role')).toBe('img');
    expect(fig.getAttribute('aria-label')).toBe('Flowchart: A[Start] --> B');
    expect(fig.querySelector('svg')).not.toBeNull();
    expect(block.querySelector('.md-mermaid-head .md-code-lang')!.textContent).toBe('◇ mermaid · flowchart');
    expect(block.querySelectorAll('button[data-mmd]').length).toBe(4);
    // The source is still in the DOM (Source toggle, copy).
    expect(block.querySelector('.md-mermaid-src code')!.textContent).toContain('A[Start]');
  });

  it('shows an error card with the message and keeps the source', async () => {
    renderMermaid.mockRejectedValue(new Error('Parse error on line 2:\n...A-->\n-----^\nExpecting NODE_STRING'));
    const block = createMermaidBlock('flowchart TD\n  A-->');
    document.body.append(block);
    paintMermaid(block);
    await flush();
    await flush();
    expect(block.dataset.state).toBe('error');
    const card = block.querySelector('.md-mermaid-error')!;
    expect(card.getAttribute('role')).toBe('note');
    expect(card.textContent).toContain("Couldn't draw this diagram");
    expect(card.querySelector('.md-mermaid-error-msg')!.textContent).toContain('Parse error on line 2');
    expect(block.querySelector('.md-mermaid-src code')!.textContent).toBe('flowchart TD\n  A-->');
    expect(block.querySelector('.md-mermaid-fig svg')).toBeNull();
  });

  it('error text is plain text (no markup injection)', async () => {
    renderMermaid.mockRejectedValue(new Error('<img src=x onerror=alert(1)>'));
    const block = createMermaidBlock('graph TD\nA');
    document.body.append(block);
    paintMermaid(block);
    await flush();
    await flush();
    expect(block.querySelector('img')).toBeNull();
    expect(block.querySelector('.md-mermaid-error-msg')!.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(errorText({ str: 'x' })).toBe('x');
  });

  it('caches by (source, theme): same source renders once, sync on remount', async () => {
    okSvg('c');
    const src = 'sequenceDiagram\nA->>B: hi';
    const a = createMermaidBlock(src);
    const b = createMermaidBlock(src);
    document.body.append(a, b);
    enhanceMermaid(document.body);
    await flush();
    await flush();
    expect(renderMermaid).toHaveBeenCalledTimes(1);
    expect(a.dataset.state).toBe('done');
    expect(b.dataset.state).toBe('done');
    // Copies get distinct ids.
    expect(a.querySelector('svg')!.id).not.toBe(b.querySelector('svg')!.id);

    // A remount (new DOM for the same block) paints synchronously.
    const c = createMermaidBlock(src);
    document.body.append(c);
    paintMermaid(c);
    expect(c.dataset.state).toBe('done');
    expect(renderMermaid).toHaveBeenCalledTimes(1);

    // Re-painting the same block is a no-op.
    const svgBefore = a.querySelector('svg');
    paintMermaid(a);
    expect(a.querySelector('svg')).toBe(svgBefore);

    // Another theme is another cache entry.
    document.documentElement.dataset.theme = 'light';
    paintMermaid(a);
    await flush();
    await flush();
    expect(renderMermaid).toHaveBeenCalledTimes(2);
    expect(mermaidStats().cached).toBe(2);
    // …and back again is a hit.
    document.documentElement.dataset.theme = 'dark';
    paintMermaid(a);
    expect(renderMermaid).toHaveBeenCalledTimes(2);
  });

  it('does not render empty or oversized sources', async () => {
    const e = createMermaidBlock('   ');
    const big = createMermaidBlock('graph TD\n' + 'A-->B\n'.repeat(10_000));
    document.body.append(e, big);
    enhanceMermaid(document.body);
    await flush();
    expect(renderMermaid).not.toHaveBeenCalled();
    expect(e.dataset.state).toBe('error');
    expect(big.querySelector('.md-mermaid-error')!.textContent).toContain('too large');
  });

  it('debounces repaints and keeps the old drawing meanwhile', async () => {
    okSvg('d');
    const block = createMermaidBlock('graph TD\nA-->B');
    document.body.append(block);
    paintMermaid(block);
    await flush();
    await flush();
    expect(renderMermaid).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    try {
      for (const s of ['graph TD\nA-->C', 'graph TD\nA-->CD', 'graph TD\nA-->CDE']) {
        setMermaidSource(block, s);
        paintMermaid(block, { debounce: 300 });
        vi.advanceTimersByTime(100);
      }
      expect(renderMermaid).toHaveBeenCalledTimes(1);
      expect(block.querySelector('.md-mermaid-fig svg')).not.toBeNull();
      vi.advanceTimersByTime(300);
    } finally {
      vi.useRealTimers();
    }
    await flush();
    await flush();
    expect(renderMermaid).toHaveBeenCalledTimes(2);
    expect(renderMermaid.mock.calls[1][0]).toBe('graph TD\nA-->CDE');
  });

  it('a stale result never paints over a newer source', async () => {
    let release!: () => void;
    renderMermaid.mockImplementationOnce(
      () => new Promise((r) => (release = () => r({ svg: '<svg id="lumimmd900q"><text>old</text></svg>', id: 'lumimmd900q' }))),
    );
    const block = createMermaidBlock('graph TD\nA');
    document.body.append(block);
    paintMermaid(block);
    setMermaidSource(block, 'graph TD\nB');
    await flush();
    release();
    await flush();
    await flush();
    expect(block.textContent).not.toContain('old');
  });

  it('runs from the rendered-markdown DOM pass', async () => {
    okSvg('e');
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown('# T\n\n```mermaid\npie title P\n"a": 1\n```');
    document.body.append(root);
    enhanceRendered(root, { canToggle: false, highlight: false });
    await flush();
    await flush();
    const block = root.querySelector<HTMLElement>('.md-mermaid')!;
    expect(block.dataset.state).toBe('done');
    expect(block.querySelector('.md-mermaid-fig')!.getAttribute('aria-label')).toBe('Pie chart: P');
    // No generic code-block chrome on a diagram.
    expect(root.querySelector('.md-mermaid button[data-action="copy-code"]')).toBeNull();
  });

  it('Source toggle and copy buttons act on the block', async () => {
    okSvg('f');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const block = createMermaidBlock('graph TD\nA-->B');
    document.body.append(block);
    paintMermaid(block);
    await flush();
    await flush();
    block.querySelector<HTMLButtonElement>('button[data-mmd="source"]')!.click();
    expect(block.classList.contains('show-src')).toBe(true);
    block.querySelector<HTMLButtonElement>('button[data-mmd="copy-source"]')!.click();
    expect(writeText).toHaveBeenLastCalledWith('graph TD\nA-->B');
    block.querySelector<HTMLButtonElement>('button[data-mmd="copy-svg"]')!.click();
    expect(writeText.mock.calls.at(-1)![0]).toMatch(/^<svg/);
    expect(writeText.mock.calls.at(-1)![0]).not.toContain('aria-hidden');
  });

  it('the lightbox opens on click and closes on Escape, restoring focus', async () => {
    okSvg('g');
    const block = createMermaidBlock('graph TD\nA-->B');
    document.body.append(block);
    paintMermaid(block);
    await flush();
    await flush();
    const fig = block.querySelector<HTMLElement>('.md-mermaid-fig')!;
    fig.focus();
    fig.click();
    const dlg = document.querySelector<HTMLElement>('.mmd-lightbox')!;
    expect(dlg).not.toBeNull();
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-label')).toBe('Flowchart: A-->B');
    // A different id from the inline copy.
    expect(dlg.querySelector('svg')!.id).not.toBe(fig.querySelector('svg')!.id);
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    dlg.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
    expect(outer).not.toHaveBeenCalled(); // modal: the shell never sees keys
    dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.removeEventListener('keydown', outer);
    expect(document.querySelector('.mmd-lightbox')).toBeNull();
    expect(document.activeElement).toBe(fig);
  });
});
