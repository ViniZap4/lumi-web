// The editor's markdown language without @codemirror/lang-markdown's
// `markdown()` helper. That helper imports @codemirror/lang-html
// statically (which pulls lang-css and lang-javascript, about 200 KB
// raw) only to highlight inline HTML. Here the same language is built
// from the exported pieces, and the HTML nested parser is an optional
// argument that the editor loads lazily (`loadHTMLSupport`) when a note
// actually holds HTML. Fenced code languages stay lazy too: they come
// from @codemirror/language-data descriptions, loaded on first use.
//
// What `markdown()` adds and this keeps: the GFM language, fenced-code
// nested parsing, heading section folding, the list-continuation
// keymap and paste-URL-as-link. HTML tag autocompletion is left out.

import { Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import {
  Language, LanguageSupport, LanguageDescription, ParseContext, foldService, syntaxTree,
} from '@codemirror/language';
import { markdownLanguage, markdownKeymap, pasteURLAsLink } from '@codemirror/lang-markdown';
import { parseCode, type MarkdownParser } from '@lezer/markdown';
import type { Parser } from '@lezer/common';
import type { SyntaxNode } from '@lezer/common';

function headingLevel(name: string): number | null {
  const m = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
  return m ? +m[1] : null;
}

function sectionEnd(heading: SyntaxNode, level: number): number {
  let last = heading;
  for (;;) {
    const next = last.nextSibling;
    if (!next) break;
    const l = headingLevel(next.name);
    if (l != null && l <= level) break;
    last = next;
  }
  return last.to;
}

/** Fold a heading's section (same as lang-markdown's headerIndent). */
const headingFold = foldService.of((state, start, end) => {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(end, -1); node; node = node.parent) {
    if (node.from < start) break;
    const level = headingLevel(node.name);
    if (level == null) continue;
    const upto = sectionEnd(node, level);
    if (upto > end) return { from: end, to: upto };
  }
  return null;
});

function codeParser(languages: readonly LanguageDescription[]) {
  return (info: string): Parser | null => {
    if (!info) return null;
    const name = /\S*/.exec(info)![0];
    const found = LanguageDescription.matchLanguageName(languages, name, true);
    if (!found) return null;
    return found.support ? found.support.language.parser : ParseContext.getSkippingParser(found.load());
  };
}

export interface HTMLSupport {
  parser: Parser;
  support: Extension;
}

/** Markdown (GFM) for the editor. `html`, when given, parses inline and
 *  block HTML as HTML (highlighting); without it HTML stays plain. */
export function lumiMarkdown(codeLanguages: readonly LanguageDescription[], html?: HTMLSupport): LanguageSupport {
  const parser = (markdownLanguage.parser as MarkdownParser).configure([parseCode({ codeParser: codeParser(codeLanguages), htmlParser: html?.parser })]);
  const lang = new Language(markdownLanguage.data, parser, [], 'markdown');
  const support: Extension[] = [headingFold, pasteURLAsLink, Prec.high(keymap.of(markdownKeymap))];
  if (html) support.push(html.support);
  return new LanguageSupport(lang, support);
}

let htmlP: Promise<HTMLSupport> | null = null;
/** The HTML nested parser, loaded once on demand. */
export function loadHTMLSupport(): Promise<HTMLSupport> {
  htmlP ??= import('@codemirror/lang-html').then(({ html }) => {
    const h = html({ matchClosingTags: false });
    return { parser: h.language.parser, support: h.support };
  });
  return htmlP;
}

/** The note has HTML worth highlighting (a tag or a comment). */
export function hasHTML(text: string): boolean {
  return /<(?:[a-zA-Z][\w-]*[\s/>]|!--)/.test(text);
}
