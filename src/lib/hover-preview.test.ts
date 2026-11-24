// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HoverIntent, HOVER_DELAY_MS, HOVER_HIDE_MS, previewExcerpt, stripFrontmatter, updatedLabel } from './hover-preview.ts';
import { renderBlocks, blocksToHTML } from './markdown.ts';

describe('hover timing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows after ~350 ms of hovering, not before', () => {
    const show = vi.fn();
    const h = new HoverIntent<string>(show, () => {});
    h.enter('a', 'a');
    vi.advanceTimersByTime(HOVER_DELAY_MS - 1);
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenCalledWith('a');
    expect(HOVER_DELAY_MS).toBe(350);
  });

  it('passing over a link quickly never shows a card', () => {
    const show = vi.fn();
    const h = new HoverIntent<string>(show, () => {});
    h.enter('a', 'a');
    vi.advanceTimersByTime(200);
    h.leave();
    vi.advanceTimersByTime(1000);
    expect(show).not.toHaveBeenCalled();
  });

  it('moving to another link restarts the delay', () => {
    const show = vi.fn();
    const h = new HoverIntent<string>(show, () => {});
    h.enter('a', 'a');
    vi.advanceTimersByTime(300);
    h.enter('b', 'b');
    vi.advanceTimersByTime(300);
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(show).toHaveBeenCalledWith('b');
  });

  it('leaving hides after a grace; moving onto the card keeps it', () => {
    const hide = vi.fn();
    const h = new HoverIntent<string>(() => {}, hide);
    h.enter('a', 'a');
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    h.leave();
    vi.advanceTimersByTime(HOVER_HIDE_MS / 2);
    h.hold(); // pointer reached the card
    vi.advanceTimersByTime(2000);
    expect(hide).not.toHaveBeenCalled();
    h.leave();
    vi.advanceTimersByTime(HOVER_HIDE_MS);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('K shows immediately; re-entering the shown link does not re-show', () => {
    const show = vi.fn();
    const h = new HoverIntent<string>(show, () => {});
    h.showNow('a', 'a');
    expect(show).toHaveBeenCalledTimes(1);
    h.enter('a', 'a');
    vi.advanceTimersByTime(1000);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('cancel drops pending timers (unmount)', () => {
    const show = vi.fn();
    const h = new HoverIntent<string>(show, () => {});
    h.enter('a', 'a');
    h.cancel();
    vi.advanceTimersByTime(1000);
    expect(show).not.toHaveBeenCalled();
  });
});

describe('preview excerpt', () => {
  it('drops frontmatter and keeps the first lines', () => {
    const body = '---\ntitle: x\n---\n\n' + Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
    const ex = previewExcerpt(body, 40);
    expect(ex.truncated).toBe(true);
    expect(ex.text.split('\n')).toHaveLength(40);
    expect(ex.text.startsWith('line 0')).toBe(true);
    expect(stripFrontmatter('no front\n---\n')).toBe('no front\n---\n');
  });

  it('closes a code fence left open at the cut', () => {
    const body = 'intro\n```js\n' + Array.from({ length: 50 }, () => 'x()').join('\n') + '\n```\nafter';
    const ex = previewExcerpt(body, 10);
    expect(ex.text.endsWith('```')).toBe(true);
    const html = blocksToHTML(renderBlocks(ex.text));
    expect(html).toContain('<pre');
  });

  it('renders through the shared sanitizer (no script, no javascript: links, no handlers)', () => {
    const ex = previewExcerpt('# Hi\n<script>alert(1)</script>\n<img src=x onerror="alert(1)">\n[bad](javascript:alert(1)) <a href="javascript:alert(2)">x</a>\n<iframe src="https://evil.example"></iframe>');
    const html = blocksToHTML(renderBlocks(ex.text));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(blocksToHTML(renderBlocks("[bad](javascript:alert(1))"))).not.toMatch(/href="javascript:/i);
    expect(html).not.toContain('evil.example');
  });
});

describe('updated label', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');
  it('is relative, then a date', () => {
    expect(updatedLabel('2026-11-24T11:59:50Z', now)).toBe('just now');
    expect(updatedLabel('2026-11-24T11:30:00Z', now)).toBe('30 min ago');
    expect(updatedLabel('2026-11-24T09:00:00Z', now)).toBe('3 h ago');
    expect(updatedLabel('2026-11-21T12:00:00Z', now)).toBe('3 days ago');
    expect(updatedLabel('2026-01-01T00:00:00Z', now)).toBe('2026-01-01');
    expect(updatedLabel('garbage', now)).toBe('');
  });
});
