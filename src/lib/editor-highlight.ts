// Syntax colours for the editor, driven by the active theme's CSS
// variables so every lumi theme (light and dark) applies unchanged.
//
// The same style serves both editing modes; the host sets mode tokens
// (NoteEditor.svelte): in Source headings are tinted and gently sized
// (`--ed-heading`, `--ed-h1`…), in Live Preview the line decorations
// size headings like the reader, so the span sizes fall back to 1em.
// Markdown markers (`#`, `**`, `>`, `-`, `[`, `](`) are dimmed.

import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const marker = 'var(--md-marker)';
const dim = 'var(--md-dim)';

export const lumiHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '700', color: 'var(--md-h1)', fontSize: 'var(--ed-h1, 1em)' },
  { tag: t.heading2, fontWeight: '680', color: 'var(--md-h2)', fontSize: 'var(--ed-h2, 1em)' },
  { tag: t.heading3, fontWeight: '650', color: 'var(--md-h3)', fontSize: 'var(--ed-h3, 1em)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '650', color: 'var(--md-h4)', fontSize: 'var(--ed-h4, 1em)' },
  { tag: t.heading, fontWeight: '650' },
  { tag: t.emphasis, fontStyle: 'italic', color: 'var(--md-em)' },
  { tag: t.strong, fontWeight: '680', color: 'var(--md-strong)' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: dim },
  { tag: t.link, color: 'var(--md-link)' },
  { tag: t.url, color: marker, textDecoration: 'underline', textDecorationColor: 'var(--md-rule)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', color: 'var(--md-code-fg)' },
  { tag: [t.processingInstruction, t.meta], color: marker, fontWeight: '400' },
  { tag: t.contentSeparator, color: marker },
  { tag: t.labelName, color: marker },
  { tag: t.quote, color: 'var(--md-quote-fg)' },
  { tag: t.list, color: 'inherit' },
  // Code inside fences.
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.atom, t.null], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--syn-tag)' },
  { tag: t.invalid, color: 'var(--color-error, red)' },
]);
