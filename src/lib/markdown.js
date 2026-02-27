/**
 * Improved markdown renderer — line-by-line processing matching the TUI's
 * codeBlockLines + mdLineStyle approach. Returns HTML with semantic CSS classes
 * that map to theme-aware styles defined in app.css.
 */

/**
 * Escape HTML entities in a string.
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Process inline markdown formatting within a line.
 * Handles: bold-italic, bold, italic, strikethrough, code spans, wikilinks, standard links.
 */
function processInline(line) {
  // Code spans first (so inner formatting is not processed)
  let result = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      const end = line.indexOf('`', i + 1);
      if (end !== -1) {
        result += `<span class="md-code">${escapeHtml(line.slice(i + 1, end))}</span>`;
        i = end + 1;
        continue;
      }
    }
    result += line[i];
    i++;
  }

  line = result;

  // Wikilinks: [[target|display]] and [[target]]
  line = line.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<a class="md-link md-wikilink" data-note="$1">$2</a>');
  line = line.replace(/\[\[([^\]]+)\]\]/g, '<a class="md-link md-wikilink" data-note="$1">$1</a>');

  // Standard links: [text](url) — external opens in new tab, relative treated as note link
  line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
      return `<a class="md-link" href="${url}" target="_blank" rel="noopener">${text}</a>`;
    }
    return `<a class="md-link md-wikilink" data-note="${url}">${text}</a>`;
  });

  // Bold-italic: ***text*** or ___text___
  line = line.replace(/\*\*\*(.*?)\*\*\*/g, '<span class="md-bold-italic">$1</span>');
  line = line.replace(/___(.*?)___/g, '<span class="md-bold-italic">$1</span>');

  // Bold: **text** or __text__
  line = line.replace(/\*\*(.*?)\*\*/g, '<span class="md-bold">$1</span>');
  line = line.replace(/__(.*?)__/g, '<span class="md-bold">$1</span>');

  // Italic: *text* or _text_
  line = line.replace(/\*([^*]+)\*/g, '<span class="md-italic">$1</span>');
  line = line.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<span class="md-italic">$1</span>');

  // Strikethrough: ~~text~~
  line = line.replace(/~~(.*?)~~/g, '<span class="md-strike">$1</span>');

  return line;
}

// ── Syntax highlighting ────────────────────────────────────────────

const KEYWORDS = new Set([
  // JS/TS
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'new', 'this', 'class', 'extends', 'super',
  'import', 'export', 'from', 'default', 'async', 'await', 'yield', 'try', 'catch',
  'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void',
  // Go
  'package', 'func', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'defer',
  'select', 'range', 'fallthrough', 'goto',
  // Python
  'def', 'lambda', 'with', 'as', 'pass', 'raise', 'except', 'global', 'nonlocal',
  'elif', 'is', 'not', 'and', 'or', 'from', 'yield', 'assert',
  // Rust
  'fn', 'mod', 'use', 'pub', 'crate', 'impl', 'trait', 'enum', 'match', 'mut',
  'ref', 'self', 'move', 'unsafe', 'where', 'loop',
  // Shared
  'true', 'false', 'null', 'nil', 'undefined', 'None', 'True', 'False',
  'static', 'abstract', 'final', 'private', 'public', 'protected', 'override',
]);

const BUILTINS = new Set([
  'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Promise', 'Map', 'Set', 'Error', 'RegExp', 'Date', 'Symbol', 'parseInt',
  'parseFloat', 'isNaN', 'require', 'module', 'exports', 'process',
  'fmt', 'os', 'io', 'log', 'strings', 'strconv', 'filepath', 'errors',
  'print', 'println', 'len', 'cap', 'make', 'append', 'copy', 'close',
  'int', 'string', 'bool', 'float64', 'float32', 'byte', 'rune', 'error',
]);

/**
 * Lightweight syntax highlighter — tokenizes code into spans with classes.
 * Covers keywords, strings, comments, numbers, and function calls.
 */
function highlightCode(code, lang) {
  const escaped = escapeHtml(code);
  const lines = escaped.split('\n');
  let inBlockComment = false;

  const isHashComment = ['python', 'py', 'ruby', 'rb', 'bash', 'sh', 'zsh',
    'yaml', 'yml', 'toml', 'dockerfile', 'makefile', 'r', 'perl', 'pl'].includes(lang);
  const isDoubleSlash = ['javascript', 'js', 'typescript', 'ts', 'go', 'rust', 'rs',
    'c', 'cpp', 'java', 'kotlin', 'swift', 'dart', 'scala', 'php', 'css', 'scss',
    'json', 'jsonc', 'zig', 'odin'].includes(lang);
  const isDashComment = ['lua', 'sql', 'haskell', 'hs', 'elm'].includes(lang);
  const hasBlockComment = isDoubleSlash || ['css', 'scss'].includes(lang);

  return lines.map(line => {
    let result = '';
    let i = 0;

    while (i < line.length) {
      // Block comment continuation
      if (inBlockComment) {
        const end = line.indexOf('*/', i);
        if (end === -1) {
          result += `<span class="hl-comment">${line.slice(i)}</span>`;
          i = line.length;
        } else {
          result += `<span class="hl-comment">${line.slice(i, end + 2)}</span>`;
          i = end + 2;
          inBlockComment = false;
        }
        continue;
      }

      // Block comment start
      if (hasBlockComment && line[i] === '/' && line[i + 1] === '*') {
        const end = line.indexOf('*/', i + 2);
        if (end === -1) {
          result += `<span class="hl-comment">${line.slice(i)}</span>`;
          i = line.length;
          inBlockComment = true;
        } else {
          result += `<span class="hl-comment">${line.slice(i, end + 2)}</span>`;
          i = end + 2;
        }
        continue;
      }

      // Single-line comments
      if (isDoubleSlash && line[i] === '/' && line[i + 1] === '/') {
        result += `<span class="hl-comment">${line.slice(i)}</span>`;
        break;
      }
      if (isHashComment && line[i] === '#') {
        result += `<span class="hl-comment">${line.slice(i)}</span>`;
        break;
      }
      if (isDashComment && line[i] === '-' && line[i + 1] === '-') {
        result += `<span class="hl-comment">${line.slice(i)}</span>`;
        break;
      }

      // Strings (double-quoted)
      if (line[i] === '"' || line[i] === "'") {
        const quote = line[i];
        let j = i + 1;
        while (j < line.length && line[j] !== quote) {
          if (line[j] === '\\') j++; // skip escaped
          j++;
        }
        j = Math.min(j + 1, line.length);
        result += `<span class="hl-string">${line.slice(i, j)}</span>`;
        i = j;
        continue;
      }

      // Backtick strings (template literals)
      if (line[i] === '`') {
        let j = i + 1;
        while (j < line.length && line[j] !== '`') {
          if (line[j] === '\\') j++;
          j++;
        }
        j = Math.min(j + 1, line.length);
        result += `<span class="hl-string">${line.slice(i, j)}</span>`;
        i = j;
        continue;
      }

      // Numbers
      if (/[0-9]/.test(line[i]) && (i === 0 || /[\s(,=+\-*/<>!&|^~%[]/.test(line[i - 1]))) {
        let j = i;
        if (line[j] === '0' && (line[j + 1] === 'x' || line[j + 1] === 'X')) {
          j += 2;
          while (j < line.length && /[0-9a-fA-F_]/.test(line[j])) j++;
        } else {
          while (j < line.length && /[0-9._eE]/.test(line[j])) j++;
        }
        result += `<span class="hl-number">${line.slice(i, j)}</span>`;
        i = j;
        continue;
      }

      // Words (keywords, builtins, identifiers)
      if (/[a-zA-Z_$]/.test(line[i])) {
        let j = i;
        while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
        const word = line.slice(i, j);
        if (KEYWORDS.has(word)) {
          result += `<span class="hl-keyword">${word}</span>`;
        } else if (BUILTINS.has(word)) {
          result += `<span class="hl-builtin">${word}</span>`;
        } else if (j < line.length && line[j] === '(') {
          result += `<span class="hl-function">${word}</span>`;
        } else {
          result += word;
        }
        i = j;
        continue;
      }

      // Operators/punctuation
      if (/[+\-*/%=<>!&|^~?:;.,{}()\[\]]/.test(line[i])) {
        result += `<span class="hl-punct">${line[i]}</span>`;
        i++;
        continue;
      }

      result += line[i];
      i++;
    }

    return result;
  }).join('\n');
}

// ── Table parsing ──────────────────────────────────────────────────

function isTableRow(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|');
}

function isSeparatorRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
  const inner = trimmed.slice(1, -1);
  return /^[\s|:\-]+$/.test(inner) && inner.includes('-');
}

function parseTableCells(line) {
  const trimmed = line.trim();
  const inner = trimmed.slice(1, -1); // remove outer pipes
  return inner.split('|').map(c => c.trim());
}

function parseAlignment(line) {
  const cells = parseTableCells(line);
  return cells.map(c => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

function renderTable(headerLine, separatorLine, bodyLines) {
  const headers = parseTableCells(headerLine);
  const aligns = parseAlignment(separatorLine);
  const rows = bodyLines.map(l => parseTableCells(l));

  let html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
  headers.forEach((h, i) => {
    const align = aligns[i] || 'left';
    html += `<th style="text-align:${align}">${processInline(escapeHtml(h))}</th>`;
  });
  html += '</tr></thead><tbody>';
  rows.forEach(row => {
    html += '<tr>';
    headers.forEach((_, i) => {
      const align = aligns[i] || 'left';
      const cell = row[i] !== undefined ? row[i] : '';
      html += `<td style="text-align:${align}">${processInline(escapeHtml(cell))}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

// ── Main renderer ──────────────────────────────────────────────────

/**
 * Render a markdown string to themed HTML.
 * @param {string} md - raw markdown text
 * @returns {string} HTML string
 */
export function renderMarkdown(md) {
  if (!md) return '';

  const lines = md.split('\n');
  const html = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Fenced code block toggle
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = trimmed.slice(3).trim();
        codeLines = [];
      } else {
        // Close code block
        const langAttr = codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : '';
        const langLabel = codeLang
          ? `<span class="md-code-lang">${escapeHtml(codeLang)}</span>`
          : '';
        const raw = codeLines.join('\n');
        const highlighted = codeLang ? highlightCode(raw, codeLang.toLowerCase()) : escapeHtml(raw);
        html.push(
          `<div class="md-code-block"${langAttr}>${langLabel}<pre>${highlighted}</pre></div>`
        );
        inCodeBlock = false;
        codeLang = '';
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Table detection: header | separator | body rows
    if (isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const headerLine = line;
      const separatorLine = lines[i + 1];
      const bodyLines = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        bodyLines.push(lines[j]);
        j++;
      }
      html.push(renderTable(headerLine, separatorLine, bodyLines));
      i = j - 1; // skip processed lines
      continue;
    }

    // Horizontal rule
    if (/^(\s*)(---+|___+|\*\*\*+)\s*$/.test(line)) {
      html.push('<div class="md-hr"></div>');
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = processInline(escapeHtml(headingMatch[2]));
      html.push(`<div class="md-h${level}">${headingMatch[1]} ${text}</div>`);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      const text = processInline(escapeHtml(trimmed.slice(2)));
      html.push(`<div class="md-blockquote">&gt; ${text}</div>`);
      continue;
    }

    // Unordered list
    const ulMatch = trimmed.match(/^([-*+])\s+(.*)$/);
    if (ulMatch) {
      const text = processInline(escapeHtml(ulMatch[2]));
      html.push(`<div class="md-list-item"><span class="md-list-marker">${ulMatch[1]}</span> ${text}</div>`);
      continue;
    }

    // Ordered list
    const olMatch = trimmed.match(/^(\d+\.)\s+(.*)$/);
    if (olMatch) {
      const text = processInline(escapeHtml(olMatch[2]));
      html.push(`<div class="md-list-item"><span class="md-list-marker">${olMatch[1]}</span> ${text}</div>`);
      continue;
    }

    // Empty line
    if (trimmed === '') {
      html.push('<div class="md-blank">&nbsp;</div>');
      continue;
    }

    // Normal paragraph line
    html.push(`<div class="md-line">${processInline(escapeHtml(line))}</div>`);
  }

  // Handle unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    const langAttr = codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : '';
    const raw = codeLines.join('\n');
    const highlighted = codeLang ? highlightCode(raw, codeLang.toLowerCase()) : escapeHtml(raw);
    html.push(
      `<div class="md-code-block"${langAttr}><pre>${highlighted}</pre></div>`
    );
  }

  return html.join('\n');
}
