// DOM pass over rendered markdown (after {@html}): the bits note
// content must never be able to inject itself — buttons, interactive
// checkboxes, highlighting. Idempotent: run after every update.

export interface EnhanceOptions {
  /** Tasks can be toggled (the user can edit the note). */
  canToggle: boolean;
  /** Load syntax highlighting (lazy chunk). */
  highlight?: boolean;
}

let highlighter: Promise<typeof import('./code-highlight.ts')> | null = null;

export function enhanceRendered(root: HTMLElement, opts: EnhanceOptions): void {
  // Task checkboxes: numbered in document order (= taskMarkers order).
  const boxes = root.querySelectorAll<HTMLInputElement>('input.md-task, li > input[type="checkbox"]');
  boxes.forEach((box, i) => {
    box.dataset.task = String(i);
    box.tabIndex = opts.canToggle ? 0 : -1;
    if (opts.canToggle) box.removeAttribute('disabled');
    else box.setAttribute('disabled', '');
    const label = (box.parentElement?.textContent ?? '').trim().slice(0, 80);
    box.setAttribute('aria-label', `${box.checked ? 'Done' : 'To do'}: ${label}`);
  });

  // Duplicate heading ids get a numeric suffix (anchor follows).
  const seen = new Map<string, number>();
  root.querySelectorAll<HTMLElement>('.md-h[id]').forEach((h) => {
    const base = h.id;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    if (n > 0) {
      h.id = `${base}-${n}`;
      h.querySelector('.md-anchor')?.setAttribute('href', `#${h.id}`);
    }
  });

  // Code blocks: header with language + copy button; highlighting.
  root.querySelectorAll<HTMLElement>('.md-code').forEach((block) => {
    if (!block.querySelector(':scope > .md-code-head')) {
      const head = document.createElement('div');
      head.className = 'md-code-head';
      const lang = document.createElement('span');
      lang.className = 'md-code-lang';
      lang.textContent = block.dataset.lang || 'text';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'md-copy';
      btn.dataset.action = 'copy-code';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy code');
      btn.setAttribute('data-hint-target', '');
      // Soft-wrap toggle for long lines (view-only state).
      const wrap = document.createElement('button');
      wrap.type = 'button';
      wrap.className = 'md-wrap';
      wrap.dataset.action = 'wrap-code';
      wrap.textContent = 'Wrap';
      wrap.title = 'Wrap long lines';
      wrap.setAttribute('aria-pressed', 'false');
      wrap.setAttribute('data-hint-target', '');
      const tools = document.createElement('span');
      tools.className = 'md-code-tools';
      tools.append(wrap, btn);
      head.append(lang, tools);
      block.prepend(head);
    }
    const code = block.querySelector<HTMLElement>('pre > code');
    const lang = block.dataset.lang ?? '';
    if (opts.highlight !== false && code && lang && !code.dataset.hl) {
      code.dataset.hl = 'pending';
      highlighter ??= import('./code-highlight.ts');
      void highlighter
        .then((m) => m.highlightElement(code, lang))
        .then((ok) => { if (code.isConnected) code.dataset.hl = ok ? 'done' : 'none'; })
        .catch(() => { code.dataset.hl = 'none'; });
    }
  });

  // Long tables scroll inside their wrapper with a sticky header.
  root.querySelectorAll<HTMLElement>('.md-table').forEach((t) => {
    const rows = t.querySelectorAll('tbody tr').length;
    t.classList.toggle('long', rows > 12);
    if (!t.hasAttribute('tabindex') && t.scrollWidth > t.clientWidth) {
      t.tabIndex = 0;
      t.setAttribute('role', 'region');
      t.setAttribute('aria-label', 'Table (scrolls horizontally)');
    }
  });

  root.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    if (!img.closest('a')) img.dataset.zoom = '';
  });
}

/** Text of the code block a copy button belongs to. */
export function codeTextFor(btn: Element): string {
  return btn.closest('.md-code')?.querySelector('pre > code')?.textContent ?? '';
}
