// Syntax colours for the editor, driven by the active theme's CSS
// variables so every lumi theme (light and dark) applies unchanged.

import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const dim = 'var(--color-text-dim, var(--color-muted))';

export const lumiHighlightStyle = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700', color: 'var(--color-primary)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--color-accent, var(--color-primary))' },
  { tag: t.url, color: 'var(--color-accent, var(--color-primary))', textDecoration: 'underline' },
  { tag: t.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: dim },
  { tag: t.quote, color: dim },
  { tag: t.list, color: 'var(--color-secondary, var(--color-primary))' },
  // Code inside fences.
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier], color: 'var(--color-secondary, var(--color-primary))' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--color-accent, var(--color-primary))' },
  { tag: [t.number, t.bool, t.atom, t.null], color: 'var(--color-warning, var(--color-accent))' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: dim, fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--color-info, var(--color-primary))' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--color-primary)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--color-info, var(--color-text))' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--color-error, var(--color-primary))' },
  { tag: t.invalid, color: 'var(--color-error, red)' },
]);
