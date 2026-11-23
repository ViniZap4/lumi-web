// @vitest-environment jsdom
//
// Sanitisation suite for the markdown renderer. The CSP shipped in
// 4.6 is defence-in-depth — this module is the *primary* gate against
// DOM XSS through user-authored note content. Each test maps to a
// specific way a malicious note could try to escape:
//   - <script> / event handlers / inline styles → must be stripped
//   - iframes from arbitrary hosts → must be stripped by the
//     uponSanitizeElement hook's allow-list
//   - iframes from YouTube / Vimeo → kept and sandboxed
//   - bare ![alt](youtube|vimeo) paragraphs → lifted to safe iframes
//
// DOMPurify needs a window/document — that's the jsdom environment
// pragma at the top of the file.

import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown.ts';

describe('renderMarkdown — XSS surface', () => {
  it('strips <script> tags entirely', () => {
    const out = renderMarkdown('# hi\n\n<script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('strips onclick / onload event handlers', () => {
    const out = renderMarkdown('<a href="x" onclick="alert(1)">click</a>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('alert(1)');
  });

  it('strips inline style attributes', () => {
    const out = renderMarkdown('<p style="background:url(javascript:alert(1))">x</p>');
    expect(out).not.toContain('style=');
    expect(out).not.toContain('javascript:');
  });

  it('drops <object>, <embed>, <form>, <meta>, <link>', () => {
    const evil = '<object data="x"></object><embed src="x"><form><meta><link>';
    const out = renderMarkdown(evil);
    for (const tag of ['<object', '<embed', '<form', '<meta', '<link']) {
      expect(out).not.toContain(tag);
    }
  });
});

describe('renderMarkdown — iframe allow-list', () => {
  it('keeps a youtube-nocookie iframe and sandboxes it', () => {
    const src = 'https://www.youtube-nocookie.com/embed/abc123';
    const out = renderMarkdown(`<iframe src="${src}"></iframe>`);
    expect(out).toContain(src);
    expect(out).toContain('sandbox=');
  });

  it('keeps a www.youtube.com iframe', () => {
    const out = renderMarkdown('<iframe src="https://www.youtube.com/embed/abc123"></iframe>');
    expect(out).toContain('youtube.com/embed/abc123');
  });

  it('keeps a player.vimeo.com iframe', () => {
    const out = renderMarkdown('<iframe src="https://player.vimeo.com/video/12345"></iframe>');
    expect(out).toContain('player.vimeo.com/video/12345');
  });

  it('drops an iframe from any other host', () => {
    const out = renderMarkdown('<iframe src="https://evil.example.com/track"></iframe>');
    expect(out).not.toContain('iframe');
    expect(out).not.toContain('evil.example.com');
  });

  it('drops an iframe with an unparseable src', () => {
    const out = renderMarkdown('<iframe src="not a url"></iframe>');
    expect(out).not.toContain('iframe');
  });

  it('drops an iframe with no src at all', () => {
    const out = renderMarkdown('<iframe></iframe>');
    expect(out).not.toContain('iframe');
  });
});

describe('renderMarkdown — media-embed lifting', () => {
  it('lifts ![alt](youtube watch url) into a youtube-nocookie iframe', () => {
    const out = renderMarkdown('![v](https://www.youtube.com/watch?v=abc123)');
    expect(out).toContain('youtube-nocookie.com/embed/abc123');
    expect(out).not.toContain('<img');
  });

  it('lifts ![alt](youtu.be short url) too', () => {
    const out = renderMarkdown('![v](https://youtu.be/abc123)');
    expect(out).toContain('youtube-nocookie.com/embed/abc123');
  });

  it('lifts ![alt](vimeo url) into a vimeo iframe', () => {
    const out = renderMarkdown('![v](https://vimeo.com/12345)');
    expect(out).toContain('player.vimeo.com/video/12345');
  });

  it('does NOT lift inline image references mid-paragraph', () => {
    // The lift regex anchors on whole-paragraph image syntax. An
    // image-style link inside flowing prose stays an <img> tag so
    // ordinary screenshots embedded in a sentence don't get rewritten
    // to iframes pointing at the same URL.
    const out = renderMarkdown('Here is a thumb ![v](https://www.youtube.com/watch?v=abc123) inline.');
    expect(out).not.toContain('iframe');
  });
});

describe('renderMarkdown — happy path', () => {
  it('renders standard markdown structures', () => {
    const out = renderMarkdown('# Heading\n\n**bold** and _italic_ and `code`.\n');
    expect(out).toContain('<h1');
    expect(out).toContain('<strong>');
    expect(out).toContain('<em>');
    expect(out).toContain('<code>');
  });

  it('renders GFM tables and fenced code blocks', () => {
    const md = [
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '```js',
      'console.log(1)',
      '```',
    ].join('\n');
    const out = renderMarkdown(md);
    expect(out).toContain('<table');
    expect(out).toContain('<pre');
  });

  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });
});

import { renderBlocks, taskMarkers, taskToggle, slugify, renderStats } from './markdown.ts';

describe('renderBlocks — source lines + incremental cache', () => {
  const md = '# Title\n\nFirst para\nstill first\n\n- a\n- b\n\n```ts\nconst x = 1\n```\n';
  it('tags each top-level block with the line it starts at', () => {
    const b = renderBlocks(md);
    expect(b.map((x) => x.line)).toEqual([0, 2, 5, 8]);
    expect(b[1].endLine).toBe(4);
    expect(b[0].html).toContain('<h1');
  });
  it('re-parses only the changed block', () => {
    renderBlocks(md);
    const before = renderStats().parsed;
    renderBlocks(md.replace('First para', 'First paragraph'));
    expect(renderStats().parsed - before).toBe(1);
  });
  it('wraps blocks with data-line in the joined HTML', () => {
    expect(renderMarkdown(md)).toContain('<div class="md-b" data-line="5">');
  });
});

describe('renderMarkdown — rich blocks', () => {
  it('renders task items as disabled checkboxes (inputs otherwise stripped)', () => {
    const out = renderMarkdown('- [x] done\n- [ ] todo\n\n<input type="text" value="x"><input type="checkbox" onclick="alert(1)" name="n">');
    expect(out.match(/type="checkbox"/g)?.length).toBe(3);
    expect(out).not.toContain('type="text"');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('name=');
    for (const m of out.match(/<input[^>]*>/g) ?? []) expect(m).toContain('disabled');
  });
  it('renders Obsidian callouts, foldable with +/-', () => {
    const out = renderMarkdown('> [!warning] Careful\n> body **text**');
    expect(out).toContain('data-callout="warning"');
    expect(out).toContain('Careful');
    expect(out).toContain('<strong>text</strong>');
    expect(renderMarkdown('> [!tip]- Hidden\n> x')).toContain('<details');
    expect(renderMarkdown('> plain quote')).toContain('<blockquote');
  });
  it('adds heading ids + anchor links', () => {
    const out = renderMarkdown('## Hello World!');
    expect(out).toContain('id="h-hello-world"');
    expect(out).toContain('href="#h-hello-world"');
    expect(slugify('Ação rápida')).toBe('h-acao-rapida');
  });
  it('labels code blocks with their language and wraps tables', () => {
    const out = renderMarkdown('```TypeScript\nlet a\n```\n\n| a |\n|---|\n| 1 |');
    expect(out).toContain('data-lang="typescript"');
    expect(out).toContain('class="language-typescript"');
    expect(out).toContain('<div class="md-table"><table');
  });
  it('captions titled images and lazy-loads them', () => {
    const out = renderMarkdown('![a cat](cat.png "Our cat")');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('class="md-caption"');
  });
  it('renders footnotes with back links, ignoring definitions in code', () => {
    const out = renderMarkdown('Claim[^1] and more[^n].\n\n[^1]: Source one.\n[^n]: *Second*.\n\n```\n[^x]: not a note\n```');
    expect(out).toContain('href="#fn-1"');
    expect(out).toContain('class="md-footnotes"');
    expect(out).toContain('<em>Second</em>');
    expect(out).toContain('[^x]: not a note');
  });
});

describe('task toggling — single-character ranged change', () => {
  const src = '# T\n- [ ] one\n  - [x] nested\n```\n- [ ] in code\n```\n1. [X] ordered\n> - [ ] quoted';
  it('finds markers in document order, skipping fenced code', () => {
    const m = taskMarkers(src);
    expect(m.map((p) => src[p])).toEqual([' ', 'x', 'X', ' ']);
    expect(m.length).toBe(4);
  });
  it('toggles exactly one character', () => {
    const c = taskToggle(src, 0)!;
    expect(c.to - c.from).toBe(1);
    expect(c.insert).toBe('x');
    const next = src.slice(0, c.from) + c.insert + src.slice(c.to);
    expect(next.length).toBe(src.length);
    expect(next).toContain('- [x] one');
    expect(taskToggle(src, 2)!.insert).toBe(' ');
    expect(taskToggle(src, 9)).toBeNull();
  });
  it('matches the number of rendered checkboxes', () => {
    const out = renderMarkdown(src);
    expect(out.match(/<input/g)?.length).toBe(taskMarkers(src).length);
  });
});

describe('startsWithTitle + ==highlight==', async () => {
  const { startsWithTitle, renderMarkdown } = await import('./markdown.ts');
  it('detects a leading H1 equal to the title', () => {
    expect(startsWithTitle('# Field notes\n\ntext', 'Field notes')).toBe(true);
    expect(startsWithTitle('\n\n#  field NOTES  #\n', 'Field notes')).toBe(true);
    expect(startsWithTitle('# *Field* notes', 'Field notes')).toBe(true);
    expect(startsWithTitle('## Field notes', 'Field notes')).toBe(false);
    expect(startsWithTitle('Intro\n# Field notes', 'Field notes')).toBe(false);
    expect(startsWithTitle('# Other', 'Field notes')).toBe(false);
    expect(startsWithTitle('# x', '')).toBe(false);
  });
  it('renders ==text== as <mark> (inline markdown inside), not across lines', () => {
    expect(renderMarkdown('a ==b **c**== d')).toContain('<mark>b <strong>c</strong></mark>');
    expect(renderMarkdown('a == b == c')).not.toContain('<mark>');
    expect(renderMarkdown('x ==a\nb== y')).not.toContain('<mark>');
  });
});
