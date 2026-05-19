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
