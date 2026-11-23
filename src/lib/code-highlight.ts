// Syntax highlighting for fenced code in rendered markdown. Lazy
// chunk: the language parsers come from @codemirror/language-data
// (the editor already ships them), loaded per language on first use.
// Output is `tok-*` class spans (classHighlighter) coloured by theme
// tokens in app.css — no inline styles, so the CSP stays strict.

import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightCode, classHighlighter } from '@lezer/highlight';

const ALIASES: Record<string, string> = { ts: 'typescript', js: 'javascript', sh: 'shell', bash: 'shell', zsh: 'shell', yml: 'yaml', py: 'python', rs: 'rust', golang: 'go', md: 'markdown', 'c++': 'cpp', 'c#': 'csharp', kt: 'kotlin', rb: 'ruby' };

const MAX_CHARS = 60_000;

export async function highlightElement(code: HTMLElement, lang: string): Promise<boolean> {
  const text = code.textContent ?? '';
  if (!text || text.length > MAX_CHARS) return false;
  const name = ALIASES[lang] ?? lang;
  const desc = LanguageDescription.matchLanguageName(languages, name, true);
  if (!desc) return false;
  const support = desc.support ?? (await desc.load());
  const tree = support.language.parser.parse(text);
  const frag = document.createDocumentFragment();
  highlightCode(
    text,
    tree,
    classHighlighter,
    (t, cls) => {
      if (!cls) frag.append(document.createTextNode(t));
      else {
        const s = document.createElement('span');
        s.className = cls;
        s.textContent = t;
        frag.append(s);
      }
    },
    () => frag.append(document.createTextNode('\n')),
  );
  // The block may have been replaced while the parser loaded.
  if (!code.isConnected || code.textContent !== text) return false;
  code.replaceChildren(frag);
  return true;
}
