import { describe, it, expect } from 'vitest';
import {
  fuzzyScore,
  linkCandidates,
  relativeNotePath,
  markdownLink,
  resolveNoteHref,
  findNoteByHref,
  pastedUrl,
  linkFromPaste,
  encodeLinkPath,
} from './links.ts';
import type { NoteSummary } from './types.ts';

const note = (id: string, path: string, title: string): NoteSummary => ({
  id, vault_id: 'v', path, title, created_at: '', updated_at: '',
});
const NOTES = [
  note('roadmap', 'work/q3/roadmap.md', 'Roadmap Q3'),
  note('meeting', 'work/meeting-notes.md', 'Meeting notes'),
  note('ideas', 'ideas.md', 'Ideas'),
  note('reading', 'personal/reading list.md', 'Reading list'),
];

describe('fuzzyScore', () => {
  it('subsequence match, null otherwise; contiguous and word starts rank higher', () => {
    expect(fuzzyScore('rdmp', 'Roadmap')).not.toBeNull();
    expect(fuzzyScore('xyz', 'Roadmap')).toBeNull();
    expect(fuzzyScore('road', 'Roadmap')!).toBeGreaterThan(fuzzyScore('rdmp', 'Roadmap')!);
    expect(fuzzyScore('mn', 'Meeting notes')!).toBeGreaterThan(fuzzyScore('mn', 'common')!);
  });
});

describe('linkCandidates', () => {
  it('ranks by title and path, excludes the current note', () => {
    const c = linkCandidates(NOTES, 'road', { excludeID: 'ideas' });
    expect(c[0]).toMatchObject({ id: 'roadmap', folder: 'work/q3', path: 'work/q3/roadmap.md' });
    expect(linkCandidates(NOTES, 'q3/').map((x) => x.id)).toEqual(['roadmap']);
    expect(linkCandidates(NOTES, '', { excludeID: 'ideas' }).map((x) => x.id)).not.toContain('ideas');
  });
});

describe('relative links', () => {
  it('computes relative paths between folders', () => {
    expect(relativeNotePath('work/q3/roadmap.md', 'work/meeting-notes.md')).toBe('../meeting-notes.md');
    expect(relativeNotePath('ideas.md', 'work/q3/roadmap.md')).toBe('work/q3/roadmap.md');
    expect(relativeNotePath('work/a.md', 'work/b.md')).toBe('b.md');
    expect(relativeNotePath('a/b/c.md', 'x/y.md')).toBe('../../x/y.md');
  });
  it('builds the canonical markdown link, escaping label and destination', () => {
    expect(markdownLink('Reading list', 'ideas.md', 'personal/reading list.md')).toBe('[Reading list](personal/reading%20list.md)');
    expect(markdownLink('a [b]', 'x.md', 'y.md')).toBe('[a \\[b\\]](y.md)');
    expect(encodeLinkPath('ação (1).md')).toBe('ação%20%281%29.md');
  });
  it('resolves hrefs back to notes, round-tripping markdownLink', () => {
    expect(resolveNoteHref('work/q3/roadmap.md', '../meeting-notes.md')).toBe('work/meeting-notes.md');
    expect(resolveNoteHref('ideas.md', 'personal/reading%20list.md')).toBe('personal/reading list.md');
    expect(resolveNoteHref('work/a.md', '/ideas')).toBe('ideas.md');
    expect(resolveNoteHref('a.md', 'b.md#heading')).toBe('b.md');
    expect(resolveNoteHref('a.md', 'https://x.y/z.md')).toBeNull();
    expect(resolveNoteHref('a.md', 'javascript:alert(1)')).toBeNull();
    expect(resolveNoteHref('a.md', '#top')).toBeNull();
    expect(resolveNoteHref('a.md', '//evil.com/x')).toBeNull();
    for (const from of ['ideas.md', 'work/q3/roadmap.md', 'personal/reading list.md']) {
      for (const to of NOTES) {
        const link = markdownLink(to.title, from, to.path);
        const href = /\]\((.*)\)$/.exec(link)![1];
        expect(findNoteByHref(NOTES, from, href)?.id).toBe(to.id);
      }
    }
  });
});

describe('paste URL over selection', () => {
  it('detects single absolute URLs only', () => {
    expect(pastedUrl('https://lumi.dev/x?y=1')).toBe('https://lumi.dev/x?y=1');
    expect(pastedUrl('see https://x.y')).toBeNull();
    expect(pastedUrl('javascript:alert(1)')).toBeNull();
    expect(pastedUrl('not a url')).toBeNull();
  });
  it('wraps a single-line selection', () => {
    expect(linkFromPaste('lumi docs', 'https://lumi.dev')).toBe('[lumi docs](https://lumi.dev)');
    expect(linkFromPaste('', 'https://lumi.dev')).toBeNull();
    expect(linkFromPaste('two\nlines', 'https://lumi.dev')).toBeNull();
    expect(linkFromPaste('x', 'plain text')).toBeNull();
    expect(linkFromPaste('x', 'https://e.com/a(b)')).toBe('[x](https://e.com/a%28b%29)');
  });
});
