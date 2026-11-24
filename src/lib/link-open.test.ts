import { describe, it, expect } from 'vitest';
import { whereFromClick, classifyLink, linkAt, findNoteByWiki, urlCard } from './link-open.ts';
import type { NoteSummary } from './types.ts';

const n = (id: string, path: string, title = id): NoteSummary => ({ id, vault_id: 'v', path, title, created_at: '', updated_at: '' });
const NOTES = [n('plan', 'projects/trip/plan.md', 'Plan'), n('sites', 'projects/trip/sites.md', 'Field sites'), n('w', 'welcome.md', 'Welcome')];
const click = (o: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }> = {}) => ({ metaKey: false, ctrlKey: false, shiftKey: false, ...o });

describe('link routing — clicks', () => {
  it('plain click → current pane; Cmd-click → vsplit; Shift-Cmd-click → hsplit (mac)', () => {
    expect(whereFromClick(click(), true)).toBe('current');
    expect(whereFromClick(click({ metaKey: true }), true)).toBe('vsplit');
    expect(whereFromClick(click({ metaKey: true, shiftKey: true }), true)).toBe('hsplit');
    // Ctrl-click is the context menu on a Mac: not a split.
    expect(whereFromClick(click({ ctrlKey: true }), true)).toBe('current');
  });
  it('Ctrl is the modifier elsewhere', () => {
    expect(whereFromClick(click({ ctrlKey: true }), false)).toBe('vsplit');
    expect(whereFromClick(click({ ctrlKey: true, shiftKey: true }), false)).toBe('hsplit');
  });
  it('middle / Alt / plain-Shift clicks are left to the browser', () => {
    expect(whereFromClick(click({ button: 1 }), true)).toBeNull();
    expect(whereFromClick(click({ altKey: true }), true)).toBeNull();
    expect(whereFromClick(click({ shiftKey: true }), true)).toBeNull();
  });
});

describe('link routing — targets', () => {
  it('relative note links resolve from the note folder', () => {
    expect(classifyLink(NOTES, 'projects/trip/plan.md', 'sites.md')).toEqual({ kind: 'note', note: NOTES[1] });
    expect(classifyLink(NOTES, 'projects/trip/plan.md', '../../welcome.md')).toEqual({ kind: 'note', note: NOTES[2] });
    expect(classifyLink(NOTES, 'welcome.md', 'nope.md')).toEqual({ kind: 'missing', path: 'nope.md' });
  });
  it('external, anchors and unsafe schemes', () => {
    expect(classifyLink(NOTES, '', 'https://x.org/a')).toEqual({ kind: 'external', url: 'https://x.org/a' });
    expect(classifyLink(NOTES, '', 'mailto:a@b.c').kind).toBe('external');
    expect(classifyLink(NOTES, '', '#goals')).toEqual({ kind: 'anchor', id: 'goals' });
    expect(classifyLink(NOTES, '', 'javascript:alert(1)').kind).toBe('unsafe');
    expect(classifyLink(NOTES, '', '//evil.example/x').kind).toBe('unsafe');
    expect(classifyLink(NOTES, '', 'data:text/html,x').kind).toBe('unsafe');
  });
  it('wiki links match path, title, then basename', () => {
    expect(findNoteByWiki(NOTES, 'Plan')?.id).toBe('plan');
    expect(findNoteByWiki(NOTES, 'projects/trip/sites')?.id).toBe('sites');
    expect(findNoteByWiki(NOTES, 'Field sites|the sites')?.id).toBe('sites');
    expect(findNoteByWiki(NOTES, 'welcome#top')?.id).toBe('w');
    expect(classifyLink(NOTES, '', 'Nope', true)).toEqual({ kind: 'missing', path: 'Nope' });
  });
});

describe('link under the cursor (gf / K / Ctrl-w f in the editor)', () => {
  const text = 'intro\nSee [the plan](projects/trip/plan.md "t") and [[Field sites]] or <https://a.org/x>.\nhttps://b.org/y, ![img](pic.png)';
  const at = (needle: string, d = 1) => text.indexOf(needle) + d;
  it('finds markdown, wiki, autolink and bare URLs', () => {
    expect(linkAt(text, at('the plan'))).toMatchObject({ href: 'projects/trip/plan.md', wiki: false });
    expect(linkAt(text, at('plan.md'))?.href).toBe('projects/trip/plan.md');
    expect(linkAt(text, at('Field sites'))).toMatchObject({ href: 'Field sites', wiki: true });
    expect(linkAt(text, at('a.org'))?.href).toBe('https://a.org/x');
    expect(linkAt(text, at('b.org'))?.href).toBe('https://b.org/y');
  });
  it('null off a link and on images; offsets are absolute', () => {
    expect(linkAt(text, at('intro'))).toBeNull();
    expect(linkAt(text, at(' and '))).toBeNull();
    expect(linkAt(text, at('pic.png'))).toBeNull();
    const l = linkAt(text, at('the plan'))!;
    expect(text.slice(l.from, l.to)).toBe('[the plan](projects/trip/plan.md "t")');
  });
});

describe('URL card', () => {
  it('shows host and path, never fetching', () => {
    expect(urlCard('https://lumi.example.org/docs/a?b=1')).toEqual({ host: 'lumi.example.org', path: '/docs/a?b=1', secure: true, mail: false });
    expect(urlCard('mailto:ana@x.org')?.mail).toBe(true);
    expect(urlCard('javascript:alert(1)')).toBeNull();
  });
});
