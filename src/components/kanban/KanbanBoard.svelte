<script lang="ts">
  // Kanban board view (SPEC-PARTE2 §5) over a LiveText.
  //
  // The board is DERIVED from the text on every change (local or
  // remote); nothing is cached in a separate model. Every operation
  // re-parses the CURRENT text, finds its target by card key / sticky
  // anchor, and applies the planner's minimal ranged edits in one
  // transaction (kanban-edits.ts). Focus follows the focused card's key,
  // so a remote edit elsewhere never moves the cursor.
  import { flip } from 'svelte/animate';
  import { tick } from 'svelte';
  import type { LiveText } from '../../lib/live-text.ts';
  import { parseKanban, type KanbanBoard, type KanbanCard, type KanbanLane } from '../../lib/kanban/kanban.ts';
  import { planKanban, type KanbanOp } from '../../lib/kanban/kanban-edits.ts';
  import { KanbanKeys, clampCursor, type KanbanCursor } from '../../lib/kanban/kanban-keys.ts';
  import { renderMarkdown } from '../../lib/markdown.ts';
  import { motionAllowed, animate } from '../../lib/motion.ts';

  interface Props {
    doc: LiveText;
    title?: string;
    /** Switch to the markdown source (Board ↔ Source toggle). */
    onsource?: () => void;
    /** Links inside cards (internal notes / external URLs). */
    onlink?: (href: string, e: MouseEvent) => void;
    /** Shown in the toolbar (e.g. "connecting…", "read-only"). */
    status?: string | null;
    autofocus?: boolean;
  }
  let { doc, title = '', onsource, onlink, status = null, autofocus = true }: Props = $props();

  // ---- text → board ---------------------------------------------------------
  let text = $state('');
  $effect(() => {
    const d = doc;
    text = d.read();
    return d.subscribe(() => {
      text = d.read();
    });
  });
  const board = $derived(parseKanban(text));

  interface CardVM {
    key: string;
    card: KanbanCard;
    html: string;
  }
  interface LaneVM {
    key: string;
    lane: KanbanLane;
    cards: CardVM[];
    total: number;
  }

  /** Stable keys: source text + occurrence (moves keep their key). */
  function keysOf(b: KanbanBoard): { lanes: string[]; cards: string[][] } {
    const seen = new Map<string, number>();
    const k = (s: string) => {
      const n = (seen.get(s) ?? 0) + 1;
      seen.set(s, n);
      return `${n}\u0001${s}`;
    };
    return {
      lanes: b.lanes.map((l) => k('L\u0002' + b.text.slice(l.start, l.headingEnd))),
      cards: b.lanes.map((l) => l.cards.map((c) => k('C\u0002' + c.raw.replace(/\r?\n$/, '')))),
    };
  }

  let filter = $state('');
  let filterOpen = $state(false);
  const needle = $derived(filter.trim().toLowerCase());

  const lanesVM = $derived.by((): LaneVM[] => {
    const keys = keysOf(board);
    return board.lanes.map((lane, li) => ({
      key: keys.lanes[li],
      lane,
      total: lane.cards.length,
      cards: lane.cards
        .map((card, ci) => ({ key: keys.cards[li][ci], card, html: renderMarkdown(card.text) }))
        .filter((c) => !needle || c.card.text.toLowerCase().includes(needle)),
    }));
  });
  const shape = $derived(lanesVM.map((l) => l.cards.length));

  // ---- cursor ---------------------------------------------------------------
  let cursor = $state<KanbanCursor>({ lane: 0, card: 0 });
  let focusKey = $state<string | null>(null);
  const cur = $derived.by((): KanbanCursor => {
    if (focusKey) {
      for (let li = 0; li < lanesVM.length; li++) {
        const ci = lanesVM[li].cards.findIndex((c) => c.key === focusKey);
        if (ci >= 0) return { lane: li, card: ci };
      }
    }
    return clampCursor(cursor, shape);
  });
  function setCursor(c: KanbanCursor): void {
    const cl = clampCursor(c, shape);
    cursor = cl;
    focusKey = cl.card >= 0 ? (lanesVM[cl.lane]?.cards[cl.card]?.key ?? null) : null;
  }

  let root = $state<HTMLElement | null>(null);
  $effect(() => {
    const c = cur;
    void tick().then(() => {
      const el = root?.querySelector<HTMLElement>(`[data-lane-index="${c.lane}"] [data-card-index="${c.card}"]`)
        ?? root?.querySelector<HTMLElement>(`[data-lane-index="${c.lane}"]`);
      el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  });
  $effect(() => {
    if (autofocus && root) root.focus({ preventScroll: true });
  });

  // ---- operations -----------------------------------------------------------
  const editable = $derived(doc.editable);
  let notice = $state<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  function flash(msg: string): void {
    notice = msg;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = null), 2200);
  }

  /** Plan against the CURRENT text and apply in one transaction. */
  function exec(build: (b: KanbanBoard) => KanbanOp | null): KanbanBoard | null {
    if (!doc.editable) {
      flash('Read-only');
      return null;
    }
    const b = parseKanban(doc.read());
    const op = build(b);
    if (!op) return null;
    const edits = planKanban(b, op);
    if (edits.length) doc.apply(edits);
    return b;
  }

  function findByKey(b: KanbanBoard, key: string): KanbanCard | null {
    const keys = keysOf(b);
    for (let li = 0; li < b.lanes.length; li++) {
      const ci = keys.cards[li].indexOf(key);
      if (ci >= 0) return b.lanes[li].cards[ci];
    }
    return null;
  }
  function keyAt(lane: number, index: number): string | null {
    const b = parseKanban(doc.read());
    const keys = keysOf(b);
    return keys.cards[lane]?.[index] ?? null;
  }
  function focusAfter(lane: number, index: number): void {
    const k = keyAt(lane, index);
    cursor = { lane, card: index };
    focusKey = k;
  }

  const filtering = $derived(needle !== '');
  function needsNoFilter(): boolean {
    if (filtering) flash('Clear the filter (Esc) to reorder or add');
    return !filtering;
  }

  function moveCurrent(toLane: number, toIndex: number): void {
    const vm = lanesVM[cur.lane]?.cards[cur.card];
    if (!vm || !needsNoFilter()) return;
    const key = vm.key;
    exec((b) => {
      const c = findByKey(b, key);
      return c ? { type: 'moveCard', lane: c.lane, card: c.index, toLane, toIndex } : null;
    });
    focusKey = key;
    cursor = { lane: toLane, card: toIndex };
  }

  function toggle(vm: CardVM): void {
    exec((b) => {
      const c = findByKey(b, vm.key);
      return c ? { type: 'toggleCard', lane: c.lane, card: c.index } : null;
    });
    // The raw (and so the key) changed: refocus by position.
    focusAfter(vm.card.lane, vm.card.index);
  }

  function remove(key: string): void {
    const pos = { ...cur };
    exec((b) => {
      const c = findByKey(b, key);
      return c ? { type: 'deleteCard', lane: c.lane, card: c.index } : null;
    });
    focusKey = null;
    cursor = pos;
  }

  // ---- inline editing ---------------------------------------------------------
  type Editing =
    | { kind: 'card'; key: string; anchor: () => number | null; draft: string }
    | { kind: 'new'; lane: number; laneAnchor: () => number | null; index: number; draft: string }
    | { kind: 'lane'; lane: number; laneAnchor: () => number | null; draft: string }
    | { kind: 'newLane'; draft: string };
  let editing = $state<Editing | null>(null);
  let confirmKey = $state<string | null>(null);

  function laneByAnchor(b: KanbanBoard, anchor: () => number | null, fallback: number): KanbanLane | null {
    const at = anchor();
    return b.lanes.find((l) => l.start === at) ?? b.lanes[fallback] ?? null;
  }

  function startEdit(vm: CardVM): void {
    if (!doc.editable) return flash('Read-only');
    editing = { kind: 'card', key: vm.key, anchor: doc.anchor(vm.card.start), draft: vm.card.text };
    focusKey = vm.key;
  }
  function startNew(lane: number, index: number): void {
    if (!doc.editable) return flash('Read-only');
    if (!needsNoFilter()) return;
    const l = board.lanes[lane];
    if (!l) return;
    editing = { kind: 'new', lane, laneAnchor: doc.anchor(l.start), index, draft: '' };
  }
  function startRename(lane: number): void {
    if (!doc.editable) return flash('Read-only');
    const l = board.lanes[lane];
    if (!l) return;
    editing = { kind: 'lane', lane, laneAnchor: doc.anchor(l.start), draft: l.title };
  }
  function startNewLane(): void {
    if (!doc.editable) return flash('Read-only');
    editing = { kind: 'newLane', draft: '' };
  }

  function commitEdit(): void {
    const e = editing;
    editing = null;
    if (!e) return;
    const draft = e.draft;
    if (e.kind === 'card') {
      if (!draft.trim()) return;
      const at = e.anchor();
      let lane = -1;
      let index = -1;
      exec((b) => {
        const c = b.lanes.flatMap((l) => l.cards).find((x) => x.start === at) ?? findByKey(b, e.key);
        if (!c) return null;
        lane = c.lane;
        index = c.index;
        return { type: 'editCard', lane: c.lane, card: c.index, text: draft };
      });
      if (lane >= 0) focusAfter(lane, index);
    } else if (e.kind === 'new') {
      if (!draft.trim()) return;
      let li = -1;
      exec((b) => {
        const l = laneByAnchor(b, e.laneAnchor, e.lane);
        if (!l) return null;
        li = l.index;
        return { type: 'addCard', lane: l.index, index: e.index, text: draft };
      });
      if (li >= 0) focusAfter(li, Math.min(e.index, (parseKanban(doc.read()).lanes[li]?.cards.length ?? 1) - 1));
    } else if (e.kind === 'lane') {
      if (!draft.trim()) return;
      exec((b) => {
        const l = laneByAnchor(b, e.laneAnchor, e.lane);
        return l ? { type: 'renameLane', lane: l.index, title: draft } : null;
      });
    } else {
      if (!draft.trim()) return;
      let at = 0;
      exec((b) => {
        at = b.lanes.length;
        return { type: 'addLane', index: b.lanes.length, title: draft };
      });
      cursor = { lane: at, card: -1 };
      focusKey = null;
    }
    void tick().then(() => root?.focus({ preventScroll: true }));
  }
  function cancelEdit(): void {
    editing = null;
    void tick().then(() => root?.focus({ preventScroll: true }));
  }
  function onEditKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      commitEdit();
    }
  }
  function autosize(el: HTMLTextAreaElement): void {
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.addEventListener('input', fit);
  }
  function focusInput(el: HTMLInputElement): void {
    el.focus();
    el.select();
  }

  // ---- keyboard -----------------------------------------------------------------
  const keys = new KanbanKeys();
  let pending = $state<string | null>(null);
  let filterInput = $state<HTMLInputElement | null>(null);

  function onkeydown(e: KeyboardEvent): void {
    if (e.target !== root || editing) return;
    if (confirmKey) {
      e.preventDefault();
      if (e.key === 'y' || e.key === 'Y' || e.key === 'Enter') remove(confirmKey);
      confirmKey = null;
      return;
    }
    const had = keys.pending;
    const a = keys.feed(e, cur, shape);
    pending = keys.pending;
    if (!a) {
      if (keys.pending || had) e.preventDefault();
      return;
    }
    const vm = lanesVM[cur.lane]?.cards[cur.card];
    switch (a.kind) {
      case 'cursor':
        setCursor(a.cursor);
        break;
      case 'moveCard':
        moveCurrent(a.toLane, a.toIndex);
        break;
      case 'newCard':
        startNew(a.lane, a.index);
        break;
      case 'newLane':
        startNewLane();
        break;
      case 'edit':
        if (vm) startEdit(vm);
        break;
      case 'toggle':
        if (vm && doc.editable) toggle(vm);
        else if (!doc.editable) flash('Read-only');
        break;
      case 'delete':
        if (vm && doc.editable) confirmKey = vm.key;
        else if (!doc.editable) flash('Read-only');
        break;
      case 'filter':
        filterOpen = true;
        void tick().then(() => filterInput?.focus());
        break;
      case 'rename':
        startRename(cur.lane);
        break;
      case 'moveLane': {
        if (!needsNoFilter()) break;
        const from = cur.lane;
        exec(() => ({ type: 'moveLane', lane: from, toIndex: a.toIndex }));
        cursor = { lane: a.toIndex, card: cur.card };
        break;
      }
      case 'undo':
        doc.undo?.();
        break;
      case 'redo':
        doc.redo?.();
        break;
      case 'escape':
        if (filter || filterOpen) {
          filter = '';
          filterOpen = false;
        } else return; // let the shell have Esc
        break;
    }
    e.preventDefault();
  }

  function onFilterKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      filter = '';
      filterOpen = false;
      root?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!filter) filterOpen = false;
      setCursor({ lane: cur.lane, card: 0 });
      root?.focus();
    }
  }

  // ---- drag and drop (pointer events; animated with FLIP) ------------------
  interface Drag {
    kind: 'card' | 'lane';
    key: string;
    html: string;
    w: number;
    h: number;
    ox: number;
    oy: number;
    x: number;
    y: number;
    toLane: number;
    toIndex: number;
  }
  let drag = $state<Drag | null>(null);
  let press: { kind: 'card' | 'lane'; key: string; lane: number; index: number; x0: number; y0: number; el: HTMLElement; html: string } | null = null;
  const PH = '\u0000placeholder';

  function isInteractive(t: EventTarget | null): boolean {
    return !!(t as HTMLElement | null)?.closest?.('input, textarea, button, a, select, [contenteditable="true"]');
  }

  function onCardPointerDown(e: PointerEvent, vm: CardVM, lane: number, index: number): void {
    if (e.button !== 0 || editing || isInteractive(e.target)) return;
    root?.focus({ preventScroll: true });
    setCursor({ lane, card: index });
    if (!doc.editable || filtering) return;
    press = { kind: 'card', key: vm.key, lane, index, x0: e.clientX, y0: e.clientY, el: e.currentTarget as HTMLElement, html: vm.html };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
    window.addEventListener('pointercancel', onPointerUp, { once: true });
  }
  function onLanePointerDown(e: PointerEvent, l: LaneVM, lane: number): void {
    if (e.button !== 0 || editing || isInteractive(e.target)) return;
    root?.focus({ preventScroll: true });
    setCursor({ lane, card: cur.lane === lane ? cur.card : 0 });
    if (!doc.editable || filtering) return;
    const el = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-lane-index]')!;
    press = { kind: 'lane', key: l.key, lane, index: lane, x0: e.clientX, y0: e.clientY, el, html: '' };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
    window.addEventListener('pointercancel', onPointerUp, { once: true });
  }

  function dropTarget(x: number, y: number, d: Drag): { lane: number; index: number } {
    if (!root) return { lane: d.toLane, index: d.toIndex };
    const lanes = [...root.querySelectorAll<HTMLElement>('[data-lane-index]')].filter((el) => el.dataset.laneKey !== d.key);
    if (d.kind === 'lane') {
      let index = 0;
      for (const el of lanes) {
        if (el.dataset.placeholder) continue;
        const r = el.getBoundingClientRect();
        if (r.left + r.width / 2 < x) index++;
      }
      return { lane: index, index };
    }
    let best = -1;
    let bestDist = Infinity;
    lanes.forEach((el) => {
      const r = el.getBoundingClientRect();
      const dist = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const li = Number(el.dataset.laneIndex);
      if (dist < bestDist) [best, bestDist] = [li, dist];
    });
    if (best < 0) return { lane: d.toLane, index: d.toIndex };
    const laneEl = root.querySelector<HTMLElement>(`[data-lane-index="${best}"]`)!;
    let index = 0;
    for (const c of laneEl.querySelectorAll<HTMLElement>('[data-card-key]')) {
      if (c.dataset.cardKey === d.key || c.dataset.cardKey === PH) continue;
      const r = c.getBoundingClientRect();
      if (r.top + r.height / 2 < y) index++;
    }
    return { lane: best, index };
  }

  function onPointerMove(e: PointerEvent): void {
    if (!press) return;
    if (!drag) {
      if (Math.hypot(e.clientX - press.x0, e.clientY - press.y0) < 5) return;
      const r = press.el.getBoundingClientRect();
      drag = {
        kind: press.kind,
        key: press.key,
        html: press.html,
        w: r.width,
        h: r.height,
        ox: press.x0 - r.left,
        oy: press.y0 - r.top,
        x: e.clientX,
        y: e.clientY,
        toLane: press.lane,
        toIndex: press.index,
      };
      if (press.kind === 'lane') ghostTitle = lanesVM[press.lane]?.lane.title ?? '';
    }
    e.preventDefault();
    const t = dropTarget(e.clientX, e.clientY, drag);
    drag = { ...drag, x: e.clientX, y: e.clientY, toLane: t.lane, toIndex: t.index };
    autoScroll(e.clientX);
  }
  let ghostTitle = $state('');
  let scroller = $state<HTMLElement | null>(null);
  function autoScroll(x: number): void {
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    if (x < r.left + 40) scroller.scrollLeft -= 14;
    else if (x > r.right - 40) scroller.scrollLeft += 14;
  }

  function onPointerUp(e: PointerEvent): void {
    window.removeEventListener('pointermove', onPointerMove);
    const p = press;
    const d = drag;
    press = null;
    drag = null;
    if (!p || !d || e.type === 'pointercancel') return;
    const ghost = { x: d.x - d.ox, y: d.y - d.oy };
    if (d.kind === 'card') {
      if (!(d.toLane === p.lane && d.toIndex === p.index)) {
        exec((b) => {
          const c = findByKey(b, d.key);
          return c ? { type: 'moveCard', lane: c.lane, card: c.index, toLane: d.toLane, toIndex: d.toIndex } : null;
        });
      }
      focusKey = d.key;
      cursor = { lane: d.toLane, card: d.toIndex };
    } else {
      if (d.toIndex !== p.lane) exec(() => ({ type: 'moveLane', lane: p.lane, toIndex: d.toIndex }));
      cursor = { lane: d.toIndex, card: 0 };
      focusKey = null;
    }
    // Settle animation: from where the ghost was to the final slot.
    void tick().then(() => {
      const sel = d.kind === 'card' ? `[data-card-key="${CSS.escape(d.key)}"]` : `[data-lane-index="${d.toIndex}"]`;
      const el = root?.querySelector<HTMLElement>(sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      animate(el, [{ transform: `translate(${ghost.x - r.left}px, ${ghost.y - r.top}px)` }, { transform: 'none' }], 180);
    });
  }

  // Display lists with the dragged item lifted out and a placeholder at the target.
  type Item = CardVM | { key: string; placeholder: true } | { key: string; draft: true };
  const NEW = '\u0000new';
  const displayLanes = $derived.by(() => {
    const d = drag;
    const ed = editing;
    let lanes: (LaneVM & { items: Item[]; placeholder?: boolean })[] = lanesVM.map((l, li) => {
      let items: Item[] = l.cards;
      if (d?.kind === 'card') {
        items = l.cards.filter((c) => c.key !== d.key);
        if (d.toLane === li) items = [...items.slice(0, d.toIndex), { key: PH, placeholder: true }, ...items.slice(d.toIndex)];
      }
      if (ed?.kind === 'new' && ed.lane === li) items = [...items.slice(0, ed.index), { key: NEW, draft: true }, ...items.slice(ed.index)];
      return { ...l, items };
    });
    if (d?.kind === 'lane') {
      const rest = lanes.filter((l) => l.key !== d.key);
      const ph = { key: PH, lane: lanes[0].lane, cards: [], total: 0, items: [], placeholder: true };
      lanes = [...rest.slice(0, d.toIndex), ph, ...rest.slice(d.toIndex)];
    }
    return lanes;
  });
  const flipMs = () => (motionAllowed() ? 180 : 0);

  function realLaneIndex(l: LaneVM): number {
    return l.lane.index;
  }

  function onBodyClick(e: MouseEvent): void {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || !onlink) return;
    e.preventDefault();
    e.stopPropagation();
    onlink(a.getAttribute('href') ?? '', e);
  }

  const totalCards = $derived(board.lanes.reduce((n, l) => n + l.cards.length, 0));
  const doneCards = $derived(board.lanes.reduce((n, l) => n + l.cards.filter((c) => c.checked).length, 0));
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="kb"
  bind:this={root}
  tabindex="0"
  role="application"
  aria-label={title ? `Board: ${title}` : 'Kanban board'}
  aria-roledescription="kanban board"
  data-testid="kanban-board"
  {onkeydown}
>
  <header class="kb-bar">
    <div class="kb-lead">
      {#if title}<span class="kb-title">{title}</span>{/if}
      <span class="kb-meta">{board.lanes.length} {board.lanes.length === 1 ? 'column' : 'columns'} · {doneCards}/{totalCards} done</span>
      {#if status}<span class="kb-status" data-testid="kanban-status">{status}</span>{/if}
      {#if pending}<span class="kb-pending" aria-live="polite">{pending}</span>{/if}
      {#if notice}<span class="kb-notice" role="status">{notice}</span>{/if}
    </div>
    <div class="kb-actions">
      {#if filterOpen || filter}
        <input
          class="kb-filter"
          bind:this={filterInput}
          bind:value={filter}
          placeholder="Filter cards…"
          aria-label="Filter cards"
          onkeydown={onFilterKey}
        />
      {:else}
        <button class="ui-btn ghost sm" type="button" onclick={() => { filterOpen = true; void tick().then(() => filterInput?.focus()); }} title="Filter (/)">Filter</button>
      {/if}
      <button class="ui-btn ghost sm" type="button" onclick={startNewLane} disabled={!editable} title="New column (A)">+ Column</button>
      {#if onsource}
        <div class="ui-seg" role="group" aria-label="View">
          <button type="button" class="active" aria-pressed="true">Board</button>
          <button type="button" aria-pressed="false" onclick={() => onsource?.()} title="Markdown source (e)">Source</button>
        </div>
      {/if}
    </div>
  </header>

  <div class="kb-scroll" bind:this={scroller}>
    <div class="kb-lanes">
      {#each displayLanes as l (l.key)}
        {@const laneIdx = realLaneIndex(l)}
        <section
          class="kb-lane"
          class:kb-lane-ph={l.placeholder}
          class:active={!l.placeholder && cur.lane === laneIdx}
          data-lane-index={l.placeholder ? undefined : laneIdx}
          data-placeholder={l.placeholder ? '1' : undefined}
          data-lane-key={l.key}
          aria-hidden={l.placeholder ? 'true' : undefined}
          aria-label={l.placeholder ? undefined : l.lane.title || 'Untitled column'}
          animate:flip={{ duration: flipMs() }}
        >
          {#if !l.placeholder}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <header class="kb-lane-head" onpointerdown={(e) => onLanePointerDown(e, l, laneIdx)} ondblclick={() => startRename(laneIdx)}>
              {#if editing?.kind === 'lane' && editing.lane === laneIdx}
                <input class="kb-lane-input" bind:value={editing.draft} use:focusInput onkeydown={onEditKey} onblur={commitEdit} aria-label="Column title" />
              {:else}
                <h3 class="kb-lane-title">{l.lane.title || 'Untitled'}</h3>
                <span class="kb-count">{filtering ? `${l.cards.length}/${l.total}` : l.total}</span>
                {#if l.lane.complete}<span class="kb-flag" title="Complete column">✓</span>{/if}
                <button class="kb-add-top ui-btn ghost sm icon" type="button" onclick={() => startNew(laneIdx, 0)} disabled={!editable} aria-label="Add card at top" title="Add card (O)">+</button>
              {/if}
            </header>
            <ol class="kb-cards">
              {#each l.items as it, ci (it.key)}
                {@const isCard = !('placeholder' in it) && !('draft' in it)}
                {@const vm = isCard ? (it as CardVM) : null}
                {@const focused = !!vm && cur.lane === laneIdx && cur.card === ci}
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <li
                  class="kb-card"
                  class:kb-card-ph={'placeholder' in it}
                  class:kb-card-new={'draft' in it}
                  class:focused
                  class:done={vm?.card.checked}
                  class:confirm={!!vm && confirmKey === vm.key}
                  style={'placeholder' in it ? `height: ${drag?.h ?? 40}px` : undefined}
                  data-card-key={it.key}
                  data-card-index={vm ? ci : undefined}
                  aria-current={focused ? 'true' : undefined}
                  aria-hidden={'placeholder' in it ? 'true' : undefined}
                  animate:flip={{ duration: flipMs() }}
                  onpointerdown={(e) => vm && onCardPointerDown(e, vm, laneIdx, ci)}
                  ondblclick={() => vm && startEdit(vm)}
                >
                  {#if 'draft' in it}
                    {#if editing?.kind === 'new'}
                      <textarea class="kb-edit" bind:value={editing.draft} use:autosize onkeydown={onEditKey} onblur={commitEdit} placeholder="Card text…" aria-label="New card"></textarea>
                    {/if}
                  {:else if vm}
                    {#if editing?.kind === 'card' && editing.key === vm.key}
                      <textarea class="kb-edit" bind:value={editing.draft} use:autosize onkeydown={onEditKey} onblur={commitEdit} aria-label="Card text"></textarea>
                    {:else}
                      <input
                        type="checkbox"
                        class="kb-check"
                        checked={vm.card.checked}
                        disabled={!editable}
                        aria-label={vm.card.checked ? 'Mark not done' : 'Mark done'}
                        onclick={(e) => { e.preventDefault(); toggle(vm); }}
                      />
                      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                      <div class="kb-card-body lumi-prose compact md-body" onclick={onBodyClick}>{@html vm.html}</div>
                      {#if confirmKey === vm.key}
                        <div class="kb-confirm" role="alertdialog" aria-label="Delete card?">
                          Delete card? <kbd>y</kbd> / <kbd>n</kbd>
                        </div>
                      {/if}
                    {/if}
                  {/if}
                </li>
              {/each}
            </ol>
            {#if !(editing?.kind === 'new' && editing.lane === laneIdx)}
              <button class="kb-add ui-btn ghost sm" type="button" onclick={() => startNew(laneIdx, l.total)} disabled={!editable} title="Add card (a)">+ Add card</button>
            {/if}
          {/if}
        </section>
      {/each}
      {#if editing?.kind === 'newLane'}
        <section class="kb-lane kb-lane-new">
          <header class="kb-lane-head">
            <input class="kb-lane-input" bind:value={editing.draft} use:focusInput onkeydown={onEditKey} onblur={commitEdit} placeholder="Column title" aria-label="New column title" />
          </header>
        </section>
      {/if}
      {#if board.lanes.length === 0 && editing?.kind !== 'newLane'}
        <div class="kb-empty">
          No columns yet. <button class="ui-btn sm" type="button" onclick={startNewLane} disabled={!editable}>Add a column</button>
        </div>
      {/if}
    </div>
  </div>

  {#if drag}
    <div
      class="kb-ghost"
      class:lane={drag.kind === 'lane'}
      class:moving={motionAllowed()}
      style="width: {drag.w}px; {drag.kind === 'lane' ? `height: ${Math.min(drag.h, 160)}px;` : ''} transform: translate({drag.x - drag.ox}px, {drag.y - drag.oy}px)"
      aria-hidden="true"
    >
      {#if drag.kind === 'card'}
        <div class="kb-card-body lumi-prose compact md-body">{@html drag.html}</div>
      {:else}
        <h3 class="kb-lane-title">{ghostTitle}</h3>
      {/if}
    </div>
  {/if}
</div>

<style>
  .kb {
    --kb-lane-w: 280px;
    --kb-surface: color-mix(in srgb, var(--color-text) 3.5%, var(--color-background));
    --kb-card: color-mix(in srgb, var(--color-text) 1.5%, var(--color-background));
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    outline: none;
    color: var(--color-text);
    background: var(--color-background);
  }
  .kb:focus-visible .kb-card.focused { box-shadow: 0 0 0 2px var(--ring); }
  .kb-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3, 12px);
    padding: 10px 16px;
    border-bottom: 1px solid var(--hairline);
    flex-wrap: wrap;
  }
  .kb-lead { display: flex; align-items: baseline; gap: 10px; min-width: 0; flex-wrap: wrap; }
  .kb-title { font-weight: 600; font-size: var(--text-lg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kb-meta, .kb-status { color: var(--color-text-dim); font-size: var(--text-xs); }
  .kb-status { padding: 1px 6px; border-radius: 999px; background: var(--tint-hover); }
  .kb-pending { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-primary); }
  .kb-notice { font-size: var(--text-xs); color: var(--color-warning); }
  .kb-actions { display: flex; align-items: center; gap: 6px; }
  .kb-filter {
    height: 24px;
    width: 180px;
    max-width: 40vw;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-background);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-xs);
  }
  .kb-filter:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--ring); }

  .kb-scroll { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
  .kb-lanes { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px 24px; min-height: 100%; box-sizing: border-box; width: max-content; }

  .kb-lane {
    flex: 0 0 var(--kb-lane-w);
    width: var(--kb-lane-w);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--kb-surface);
    border: 1px solid color-mix(in srgb, var(--color-border) 45%, transparent);
    border-radius: var(--radius-lg);
    padding: 6px;
    box-sizing: border-box;
  }
  .kb-lane.active { border-color: color-mix(in srgb, var(--color-primary) 35%, var(--color-border)); }
  .kb-lane-ph {
    min-height: 120px;
    align-self: stretch;
    background: var(--tint-primary);
    border: 1.5px dashed color-mix(in srgb, var(--color-primary) 55%, transparent);
  }
  .kb-lane-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 8px;
    cursor: grab;
    user-select: none;
    touch-action: none;
  }
  .kb-lane-title { margin: 0; font-size: var(--text-sm); font-weight: 600; letter-spacing: 0.01em; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kb-count {
    font-size: 11px;
    min-width: 18px;
    text-align: center;
    padding: 0 6px;
    border-radius: 999px;
    color: var(--color-text-dim);
    background: var(--tint-hover);
    font-variant-numeric: tabular-nums;
  }
  .kb-flag { color: var(--color-primary); font-size: 12px; }
  .kb-add-top { opacity: 0; transition: opacity 120ms var(--ease); }
  .kb-lane-head:hover .kb-add-top, .kb-add-top:focus-visible { opacity: 1; }
  .kb-lane-input {
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-primary);
    background: var(--color-background);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .kb-cards {
    list-style: none;
    margin: 0;
    padding: 2px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    min-height: 8px;
  }
  .kb-card {
    position: relative;
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 8px 10px;
    background: var(--kb-card);
    border: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
    border-radius: var(--radius);
    box-shadow: 0 1px 2px color-mix(in srgb, #000 10%, transparent);
    cursor: grab;
    user-select: none;
    touch-action: none;
    transition: border-color 120ms var(--ease), box-shadow 120ms var(--ease);
  }
  .kb-card:hover { border-color: color-mix(in srgb, var(--color-text) 22%, var(--color-border)); }
  .kb-card.focused { border-color: color-mix(in srgb, var(--color-primary) 70%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 45%, transparent); }
  .kb-card.done .kb-card-body { color: var(--color-text-dim); }
  .kb-card.confirm { border-color: var(--color-error); }
  .kb-card-ph {
    background: var(--tint-primary);
    border: 1.5px dashed color-mix(in srgb, var(--color-primary) 55%, transparent);
    box-shadow: none;
  }
  .kb-card-new { cursor: text; padding: 4px; }
  .kb-check {
    margin: 3px 0 0;
    flex: none;
    width: 14px;
    height: 14px;
    accent-color: var(--color-primary);
    cursor: pointer;
  }
  .kb-card-body {
    flex: 1;
    min-width: 0;
    /* Card-size prose: `.lumi-prose.compact` (app.css), a touch denser. */
    --md-rhythm: 0.4em;
    overflow-wrap: anywhere;
    max-width: none;
  }
  .kb-card-body :global(.md-b > :first-child) { margin-top: 0; }
  .kb-card-body :global(.md-b > :last-child) { margin-bottom: 0; }
  .kb-card-body :global(p) { margin: 0 0 0.35em; }
  .kb-card-body :global(ul), .kb-card-body :global(ol) { margin: 0.2em 0; padding-left: 1.2em; }
  .kb-card-body :global(h1), .kb-card-body :global(h2), .kb-card-body :global(h3) { font-size: 1.05em; margin: 0 0 0.3em; }
  .kb-card-body :global(img) { max-width: 100%; border-radius: var(--radius-sm); }
  .kb-edit {
    width: 100%;
    min-height: 38px;
    resize: none;
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-sm);
    background: var(--color-background);
    color: var(--color-text);
    font: inherit;
    font-size: 13.5px;
    line-height: 1.45;
    padding: 6px 8px;
    box-sizing: border-box;
    outline: none;
    box-shadow: 0 0 0 2px var(--ring);
  }
  .kb-confirm {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: inherit;
    font-size: var(--text-xs);
    background: color-mix(in srgb, var(--color-error) 16%, var(--color-background));
    color: var(--color-text);
  }
  .kb-add { margin-top: 6px; justify-content: flex-start; width: 100%; color: var(--color-text-dim); }
  .kb-empty { color: var(--color-text-dim); padding: 24px; display: flex; gap: 10px; align-items: center; }

  .kb-ghost {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 50;
    pointer-events: none;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--kb-card);
    border: 1px solid color-mix(in srgb, var(--color-primary) 60%, transparent);
    box-shadow: var(--shadow-pop);
    box-sizing: border-box;
    opacity: 0.96;
    will-change: transform;
  }
  .kb-ghost.lane { border-radius: var(--radius-lg); background: var(--kb-surface); padding: 12px; overflow: hidden; }
  .kb-ghost.moving { rotate: 1.5deg; }

  @media (max-width: 640px) {
    .kb { --kb-lane-w: min(84vw, 300px); }
    .kb-lanes { padding: 12px 16px 20px; scroll-snap-type: x mandatory; }
    .kb-lane { scroll-snap-align: start; }
  }
</style>
