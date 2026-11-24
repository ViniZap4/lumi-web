<script lang="ts">
  // JSON Canvas 1.0 view + editor (SPEC-PARTE2 §6) over a LiveText.
  //
  // Rendering is derived from the CURRENT text. Gestures keep a local
  // draft (positions/sizes) and commit once on drop; every commit
  // re-parses the current text, applies a pure op and writes ONE
  // minimal ranged edit in the file's own JSON style (canvas.ts
  // commitCanvas). Selection is by node/edge id, so remote edits never
  // drop it.
  import { tick } from 'svelte';
  import type { LiveText } from '../../lib/live-text.ts';
  import {
    parseCanvas, commitCanvas, patchNodes, patchEdge, addNode, addEdge, removeItems, newCanvasId, canvasColor,
    type CanvasNode, type CanvasEdge, type CanvasNoteRef, type CanvasOp, type CanvasSide, type FileNode, type LinkNode, type TextNode, type GroupNode,
  } from '../../lib/canvas/canvas.ts';
  import {
    zoomAt, panBy, toWorld, toScreen, fitRect, boundsOf, wheel as wheelView, edgeGeometry, curve, sidePoint, nearestSide,
    hitNode, readingOrder, arrowHead, contains, type Viewport, type Point,
  } from '../../lib/canvas/canvas-view.ts';
  import { CanvasKeys } from '../../lib/canvas/canvas-keys.ts';
  import { renderMarkdown } from '../../lib/markdown.ts';
  import { motionAllowed } from '../../lib/motion.ts';

  interface Props {
    doc: LiveText;
    title?: string;
    onsource?: () => void;
    /** Open a vault file (file node): current pane or a split. */
    onopenfile?: (path: string, opts: { split: boolean }) => void;
    /** Open an external URL (link node). Default: new tab, noopener. */
    onopenlink?: (url: string) => void;
    /** Links inside rendered text nodes. */
    onlink?: (href: string, e: MouseEvent) => void;
    /** Notes for the file-node picker. */
    notes?: readonly CanvasNoteRef[];
    /** Markdown of a vault file for file-node previews (null = unavailable). */
    loadNote?: (path: string) => Promise<string | null>;
    status?: string | null;
    autofocus?: boolean;
  }
  let { doc, title = '', onsource, onopenfile, onopenlink, onlink, notes = [], loadNote, status = null, autofocus = true }: Props = $props();

  // ---- text → canvas ------------------------------------------------------------
  let text = $state('');
  $effect(() => {
    const d = doc;
    text = d.read();
    return d.subscribe(() => {
      text = d.read();
    });
  });
  const parsed = $derived(parseCanvas(text));
  let lastGood = $state<{ nodes: CanvasNode[]; edges: CanvasEdge[] }>({ nodes: [], edges: [] });
  $effect(() => {
    if (parsed.ok) lastGood = { nodes: parsed.nodes, edges: parsed.edges };
  });
  const invalid = $derived(parsed.ok ? null : parsed.error);
  const editable = $derived(doc.editable && !invalid);
  const baseNodes = $derived(parsed.ok ? parsed.nodes : lastGood.nodes);
  const edges = $derived(parsed.ok ? parsed.edges : lastGood.edges);

  // Local drafts during gestures (never written until drop).
  let draft = $state<Record<string, { x: number; y: number; width: number; height: number }>>({});
  const nodes = $derived(baseNodes.map((n) => (draft[n.id] ? ({ ...n, ...draft[n.id] } as CanvasNode) : n)));
  const byId = $derived(new Map(nodes.map((n) => [n.id, n])));
  const groups = $derived(nodes.filter((n) => n.type === 'group') as GroupNode[]);
  const cards = $derived(nodes.filter((n) => n.type !== 'group'));

  function commit(op: CanvasOp): boolean {
    if (!editable) {
      flash(invalid ? 'Invalid JSON: fix it in Source' : 'Read-only');
      return false;
    }
    const edits = commitCanvas(doc.read(), op);
    if (edits.length) doc.apply(edits);
    return edits.length > 0;
  }

  // ---- viewport ---------------------------------------------------------------------
  let root = $state<HTMLElement | null>(null);
  let w = $state(0);
  let h = $state(0);
  let view = $state<Viewport>({ x: 0, y: 0, zoom: 1 });
  let fitted = false;
  let easing = $state(false);
  let easeTimer: ReturnType<typeof setTimeout> | null = null;

  function setView(v: Viewport, ease = false): void {
    if (ease && motionAllowed()) {
      easing = true;
      if (easeTimer) clearTimeout(easeTimer);
      easeTimer = setTimeout(() => (easing = false), 200);
    }
    view = v;
  }
  function fitAll(ease = true): void {
    setView(fitRect(boundsOf(nodes), w, h - 44, 56), ease);
    view = { ...view, y: view.y + 44 };
  }
  $effect(() => {
    if (!fitted && w > 0 && h > 0 && parsed.ok) {
      fitted = true;
      fitAll(false);
    }
  });
  $effect(() => {
    if (autofocus && root) root.focus({ preventScroll: true });
  });

  function screenPoint(e: { clientX: number; clientY: number }): Point {
    const r = root!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function worldPoint(e: { clientX: number; clientY: number }): Point {
    return toWorld(view, screenPoint(e));
  }
  function centerWorld(): Point {
    return toWorld(view, { x: w / 2, y: h / 2 });
  }
  function reveal(n: CanvasNode): void {
    const a = toScreen(view, { x: n.x, y: n.y });
    const b = toScreen(view, { x: n.x + n.width, y: n.y + n.height });
    if (a.x >= 0 && a.y >= 44 && b.x <= w && b.y <= h) return;
    setView({ ...view, x: w / 2 - (n.x + n.width / 2) * view.zoom, y: (h + 44) / 2 - (n.y + n.height / 2) * view.zoom }, true);
  }

  // Wheel: non-passive so Ctrl/Cmd+wheel (and trackpad pinch) can zoom.
  $effect(() => {
    const el = root;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest?.('.cv-scrollable') && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setView(wheelView(view, e, screenPoint(e)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // ---- selection / editing ------------------------------------------------------------
  let selected = $state<string[]>([]);
  let selectedEdge = $state<string | null>(null);
  const selNode = $derived(selected.length === 1 ? (byId.get(selected[0]) ?? null) : null);
  const hasSelection = $derived(selected.length > 0 || !!selectedEdge);
  $effect(() => {
    // Drop ids that no longer exist (deleted remotely).
    const ids = new Set(baseNodes.map((n) => n.id));
    if (selected.some((id) => !ids.has(id))) selected = selected.filter((id) => ids.has(id));
    if (selectedEdge && !edges.some((e) => e.id === selectedEdge)) selectedEdge = null;
  });
  function select(ids: string[], edge: string | null = null): void {
    selected = ids;
    selectedEdge = edge;
  }

  type Editing =
    | { kind: 'text'; id: string; draft: string; isNew: boolean }
    | { kind: 'label'; id: string; draft: string }
    | { kind: 'edge'; id: string; draft: string };
  let editing = $state<Editing | null>(null);
  let typingTimer: ReturnType<typeof setTimeout> | null = null;

  function startEdit(n: CanvasNode, isNew = false): void {
    if (!editable) return flash('Read-only');
    select([n.id]);
    if (n.type === 'text') editing = { kind: 'text', id: n.id, draft: (n as TextNode).text, isNew };
    else if (n.type === 'group') editing = { kind: 'label', id: n.id, draft: (n as GroupNode).label ?? '' };
  }
  function startEdgeEdit(e: CanvasEdge): void {
    if (!editable) return flash('Read-only');
    select([], e.id);
    editing = { kind: 'edge', id: e.id, draft: e.label ?? '' };
  }
  function flushTyping(): void {
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = null;
    const e = editing;
    if (e?.kind === 'text') commit(patchNodes({ [e.id]: { text: e.draft } }));
  }
  function onTyping(): void {
    // Live collaboration while typing: debounced ranged commits.
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(flushTyping, 450);
  }
  function finishEdit(): void {
    const e = editing;
    if (!e) return;
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = null;
    editing = null;
    if (e.kind === 'text') {
      if (e.isNew && !e.draft.trim()) commit(removeItems([e.id]));
      else commit(patchNodes({ [e.id]: { text: e.draft } }));
    } else if (e.kind === 'label') {
      commit(patchNodes({ [e.id]: { label: e.draft.trim() || undefined } }));
    } else {
      commit(patchEdge(e.id, { label: e.draft.trim() || undefined }));
    }
    void tick().then(() => root?.focus({ preventScroll: true }));
  }
  function onEditKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      finishEdit();
    } else if (e.key === 'Enter' && editing?.kind !== 'text') {
      e.preventDefault();
      finishEdit();
    }
  }
  function focusEl(el: HTMLInputElement | HTMLTextAreaElement): void {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }

  // ---- creating -----------------------------------------------------------------------------
  function addTextAt(p: Point): void {
    if (!editable) return flash(invalid ? 'Invalid JSON: fix it in Source' : 'Read-only');
    const node: TextNode = { id: newCanvasId(), type: 'text', text: '', x: Math.round(p.x - 125), y: Math.round(p.y - 30), width: 250, height: 60 };
    if (commit(addNode(node))) {
      select([node.id]);
      editing = { kind: 'text', id: node.id, draft: '', isNew: true };
    }
  }
  function nextSlot(wd: number): Point {
    const s = selNode;
    if (s) return { x: s.x + s.width + 60 + wd / 2, y: s.y + 30 };
    return centerWorld();
  }

  let picker = $state<{ query: string; at: Point; cursor: number } | null>(null);
  const pickList = $derived.by(() => {
    if (!picker) return [];
    const q = picker.query.trim().toLowerCase();
    return notes.filter((n) => !q || n.path.toLowerCase().includes(q) || (n.title ?? '').toLowerCase().includes(q)).slice(0, 50);
  });
  function openPicker(at?: Point): void {
    if (!editable) return flash('Read-only');
    picker = { query: '', at: at ?? nextSlot(400), cursor: 0 };
  }
  function pickNote(n: CanvasNoteRef): void {
    const at = picker?.at ?? centerWorld();
    picker = null;
    const node: FileNode = { id: newCanvasId(), type: 'file', file: n.path, x: Math.round(at.x - 200), y: Math.round(at.y - 150), width: 400, height: 300 };
    if (commit(addNode(node))) select([node.id]);
    void tick().then(() => root?.focus({ preventScroll: true }));
  }
  function onPickerKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (!picker) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      picker = null;
      root?.focus();
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      picker.cursor = Math.min(pickList.length - 1, picker.cursor + 1);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      picker.cursor = Math.max(0, picker.cursor - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const n = pickList[picker.cursor];
      if (n) pickNote(n);
    }
  }

  // ---- opening --------------------------------------------------------------------------------
  function safeURL(u: string): string | null {
    try {
      const x = new URL(u);
      return x.protocol === 'http:' || x.protocol === 'https:' ? x.toString() : null;
    } catch {
      return null;
    }
  }
  function openNode(n: CanvasNode, split = false): void {
    if (n.type === 'file') {
      const f = (n as FileNode).file;
      if (f) onopenfile?.(f, { split });
    } else if (n.type === 'link') {
      const u = safeURL((n as LinkNode).url);
      if (!u) return flash('Only http(s) links open');
      if (onopenlink) onopenlink(u);
      else window.open(u, '_blank', 'noopener,noreferrer');
    }
  }
  function activate(): void {
    if (selectedEdge) {
      const e = edges.find((x) => x.id === selectedEdge);
      if (e) startEdgeEdit(e);
      return;
    }
    const n = selNode;
    if (!n) return;
    if (n.type === 'text' || n.type === 'group') startEdit(n);
    else openNode(n);
  }

  // ---- file previews ------------------------------------------------------------------------
  let previews = $state<Record<string, { state: 'loading' | 'ok' | 'missing'; html: string }>>({});
  const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
  $effect(() => {
    for (const n of baseNodes) {
      if (n.type !== 'file') continue;
      const f = (n as FileNode).file;
      if (!f || previews[f] || IMAGE.test(f) || /\.canvas$/i.test(f)) continue;
      if (!loadNote) {
        previews[f] = { state: 'missing', html: '' };
        continue;
      }
      previews[f] = { state: 'loading', html: '' };
      void loadNote(f).then(
        (md) => {
          previews[f] = md == null ? { state: 'missing', html: '' } : { state: 'ok', html: renderMarkdown(md.split('\n').slice(0, 40).join('\n')) };
        },
        () => {
          previews[f] = { state: 'missing', html: '' };
        },
      );
    }
  });
  function baseName(p: string): string {
    return p.split('/').pop()!.replace(/\.md$/i, '');
  }
  function hostOf(u: string): string {
    try {
      return new URL(u).host;
    } catch {
      return u;
    }
  }

  // ---- color -------------------------------------------------------------------------------
  function colorCSS(c: unknown): string | null {
    const v = canvasColor(c);
    if (!v) return null;
    return 'preset' in v ? `var(--canvas-${v.preset})` : v.hex;
  }
  function setColor(c: string | null): void {
    if (selectedEdge) commit(patchEdge(selectedEdge, { color: c ?? undefined }));
    else if (selected.length) commit(patchNodes(Object.fromEntries(selected.map((id) => [id, { color: c ?? undefined }]))));
  }
  const PRESETS = ['1', '2', '3', '4', '5', '6'];
  const PRESET_NAMES = ['red', 'orange', 'yellow', 'green', 'cyan', 'purple'];

  // ---- pointer gestures ------------------------------------------------------------------------
  type Gesture =
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
    | { kind: 'move'; start: Point; origin: Record<string, { x: number; y: number; width: number; height: number }>; moved: boolean }
    | { kind: 'resize'; id: string; start: Point; w0: number; h0: number; x0: number; y0: number }
    | { kind: 'connect'; from: string; side: CanvasSide; to: Point }
    | { kind: 'pinch'; d0: number; z0: Viewport; m0: Point };
  let gesture = $state<Gesture | null>(null);
  const pointers = new Map<number, Point>();
  let spaceDown = $state(false);

  function isTyping(t: EventTarget | null): boolean {
    return !!(t as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]');
  }

  function onpointerdown(e: PointerEvent): void {
    if (!root) return;
    const t = e.target as HTMLElement;
    if (isTyping(t) || t.closest('.cv-ui')) return;
    root.focus({ preventScroll: true });
    pointers.set(e.pointerId, screenPoint(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      draft = {};
      gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), z0: view, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    root.setPointerCapture?.(e.pointerId);
    if (picker) picker = null;
    if (editing) finishEdit();

    if (spaceDown || e.button === 1) {
      gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    const handle = t.closest<HTMLElement>('[data-handle]');
    const nodeEl = t.closest<HTMLElement>('[data-node-id]');
    const edgeEl = t.closest<HTMLElement>('[data-edge-id]');
    if (handle && nodeEl && editable) {
      gesture = { kind: 'connect', from: nodeEl.dataset.nodeId!, side: handle.dataset.handle as CanvasSide, to: worldPoint(e) };
      return;
    }
    if (t.closest('[data-resize]') && nodeEl && editable) {
      const n = byId.get(nodeEl.dataset.nodeId!)!;
      select([n.id]);
      gesture = { kind: 'resize', id: n.id, start: worldPoint(e), w0: n.width, h0: n.height, x0: n.x, y0: n.y };
      return;
    }
    if (nodeEl) {
      const id = nodeEl.dataset.nodeId!;
      if (t.closest('a[href]')) return; // links inside text nodes
      if (e.shiftKey) select(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
      else if (!selected.includes(id)) select([id]);
      if (!editable) return;
      // Moving a group carries the nodes inside it.
      const ids = new Set(selected.includes(id) ? selected : [id]);
      for (const g of nodes) if (ids.has(g.id) && g.type === 'group') for (const n of nodes) if (n !== g && contains(g, n)) ids.add(n.id);
      const origin: Record<string, { x: number; y: number; width: number; height: number }> = {};
      for (const nid of ids) {
        const n = byId.get(nid);
        if (n) origin[nid] = { x: n.x, y: n.y, width: n.width, height: n.height };
      }
      gesture = { kind: 'move', start: worldPoint(e), origin, moved: false };
      return;
    }
    if (edgeEl) {
      select([], edgeEl.dataset.edgeId!);
      return;
    }
    if (!e.shiftKey) select([]);
    gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  }

  function onpointermove(e: PointerEvent): void {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, screenPoint(e));
    const g = gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = zoomAt(g.z0, g.m0.x, g.m0.y, d / (g.d0 || 1));
      setView(panBy(z, m.x - g.m0.x, m.y - g.m0.y));
      return;
    }
    if (g.kind === 'pan') {
      setView({ ...view, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy });
      return;
    }
    const p = worldPoint(e);
    if (g.kind === 'move') {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * view.zoom < 3) return;
      g.moved = true;
      const next: typeof draft = {};
      for (const [id, o] of Object.entries(g.origin)) next[id] = { ...o, x: Math.round(o.x + dx), y: Math.round(o.y + dy) };
      draft = next;
    } else if (g.kind === 'resize') {
      draft = { [g.id]: { x: g.x0, y: g.y0, width: Math.max(80, Math.round(g.w0 + p.x - g.start.x)), height: Math.max(40, Math.round(g.h0 + p.y - g.start.y)) } };
    } else if (g.kind === 'connect') {
      gesture = { ...g, to: p };
    }
  }

  function onpointerup(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    const g = gesture;
    if (g?.kind === 'pinch') {
      if (pointers.size < 2) gesture = null;
      return;
    }
    gesture = null;
    if (!g) return;
    const d = draft;
    if (g.kind === 'move' || g.kind === 'resize') {
      // Commit once, on drop (no per-frame CRDT traffic).
      draft = {};
      if ((g.kind === 'move' && g.moved) || g.kind === 'resize') {
        commit(patchNodes(Object.fromEntries(Object.entries(d).map(([id, r]) => [id, g.kind === 'move' ? { x: r.x, y: r.y } : { width: r.width, height: r.height }]))));
      }
    } else if (g.kind === 'connect') {
      const target = hitNode(nodes.filter((n) => n.id !== g.from), g.to);
      if (target) {
        const edge: CanvasEdge = { id: newCanvasId(), fromNode: g.from, fromSide: g.side, toNode: target.id, toSide: nearestSide(target, g.to) };
        if (commit(addEdge(edge))) select([], edge.id);
      }
    }
  }

  function ondblclick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (isTyping(t) || t.closest('.cv-ui')) return;
    const nodeEl = t.closest<HTMLElement>('[data-node-id]');
    const edgeEl = t.closest<HTMLElement>('[data-edge-id]');
    if (nodeEl) {
      const n = byId.get(nodeEl.dataset.nodeId!);
      if (!n) return;
      if (n.type === 'text') startEdit(n);
      else if (n.type === 'group') {
        if (t.closest('.cv-group-label')) startEdit(n);
        else addTextAt(worldPoint(e));
      } else openNode(n, e.metaKey || e.ctrlKey);
      return;
    }
    if (edgeEl) {
      const ed = edges.find((x) => x.id === edgeEl.dataset.edgeId);
      if (ed) startEdgeEdit(ed);
      return;
    }
    addTextAt(worldPoint(e));
  }

  // ---- keyboard -------------------------------------------------------------------------------
  const keys = new CanvasKeys();
  let pending = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  function flash(msg: string): void {
    notice = msg;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = null), 2200);
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.target !== root || editing || picker) return;
    if (e.key === ' ') {
      spaceDown = true;
      e.preventDefault();
      return;
    }
    const had = keys.pending;
    const a = keys.feed(e, hasSelection);
    pending = keys.pending;
    if (!a) {
      if (keys.pending || had) e.preventDefault();
      return;
    }
    switch (a.kind) {
      case 'cycle': {
        const order = readingOrder(nodes);
        if (!order.length) break;
        const i = selNode ? order.findIndex((n) => n.id === selNode.id) : -1;
        const n = order[(i + a.dir + order.length) % order.length] ?? order[0];
        select([n.id]);
        reveal(n);
        break;
      }
      case 'activate':
        activate();
        break;
      case 'openFile':
        if (selNode?.type === 'file') openNode(selNode, a.split);
        break;
      case 'pan':
        setView(panBy(view, a.dx, a.dy), true);
        break;
      case 'nudge':
        if (selected.length) {
          commit(patchNodes(Object.fromEntries(selected.map((id) => {
            const n = byId.get(id)!;
            return [id, { x: n.x + a.dx, y: n.y + a.dy }];
          }))));
        } else setView(panBy(view, -a.dx, -a.dy), true);
        break;
      case 'zoom':
        setView(zoomAt(view, w / 2, h / 2, a.factor), true);
        break;
      case 'fit':
        fitAll();
        break;
      case 'addText':
        addTextAt(nextSlot(250));
        break;
      case 'addFile':
        openPicker();
        break;
      case 'delete':
        commit(removeItems(selected, selectedEdge ? [selectedEdge] : []));
        select([]);
        break;
      case 'color':
        setColor(a.color);
        break;
      case 'undo':
        doc.undo?.();
        break;
      case 'redo':
        doc.redo?.();
        break;
      case 'escape':
        if (hasSelection) select([]);
        else return; // the shell's Esc
        break;
    }
    e.preventDefault();
  }
  function onkeyup(e: KeyboardEvent): void {
    if (e.key === ' ') spaceDown = false;
  }

  // ---- edges ------------------------------------------------------------------------------------
  interface EdgeVM {
    edge: CanvasEdge;
    d: string;
    mid: Point;
    head: string | null;
    tail: string | null;
    color: string | null;
  }
  const edgeVMs = $derived.by((): EdgeVM[] => {
    const out: EdgeVM[] = [];
    for (const e of edges) {
      const a = byId.get(e.fromNode);
      const b = byId.get(e.toNode);
      if (!a || !b) continue;
      const g = edgeGeometry(e, a, b);
      out.push({
        edge: e,
        d: g.d,
        mid: g.mid,
        head: (e.toEnd ?? 'arrow') === 'arrow' ? arrowHead(g.to, g.endAngle, 11) : null,
        tail: e.fromEnd === 'arrow' ? arrowHead(g.from, g.startAngle, 11) : null,
        color: colorCSS(e.color),
      });
    }
    return out;
  });
  const connectPath = $derived.by(() => {
    const g = gesture;
    if (g?.kind !== 'connect') return null;
    const a = byId.get(g.from);
    if (!a) return null;
    const target = hitNode(nodes.filter((n) => n.id !== g.from), g.to);
    const ts = target ? nearestSide(target, g.to) : null;
    const end = target && ts ? sidePoint(target, ts) : g.to;
    const c = curve(sidePoint(a, g.side), g.side, end, ts);
    return { d: c.d, head: arrowHead(end, c.endAngle, 11) };
  });

  const gridSize = $derived(24 * view.zoom);
  const zoomPct = $derived(Math.round(view.zoom * 100));
  const SIDES: CanvasSide[] = ['top', 'right', 'bottom', 'left'];

  function onTextClick(e: MouseEvent): void {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    if (onlink) onlink(a.getAttribute('href') ?? '', e);
  }
</script>

<svelte:window onkeyup={onkeyup} onblur={() => (spaceDown = false)} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="cv"
  class:panning={gesture?.kind === 'pan' || spaceDown}
  bind:this={root}
  bind:clientWidth={w}
  bind:clientHeight={h}
  tabindex="0"
  role="application"
  aria-label={title ? `Canvas: ${title}` : 'Canvas'}
  aria-roledescription="canvas"
  data-testid="canvas-view"
  {onkeydown}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
  {ondblclick}
  style="--grid: {gridSize}px; --gx: {view.x}px; --gy: {view.y}px"
>
  <div class="cv-world" class:ease={easing} style="transform: translate({view.x}px, {view.y}px) scale({view.zoom})">
    {#each groups as g (g.id)}
      {@const c = colorCSS(g.color)}
      <div
        class="cv-node cv-group"
        class:sel={selected.includes(g.id)}
        data-node-id={g.id}
        style="left: {g.x}px; top: {g.y}px; width: {g.width}px; height: {g.height}px; {c ? `--c: ${c}` : ''}"
      >
        {#if editing?.kind === 'label' && editing.id === g.id}
          <input class="cv-group-label cv-input" bind:value={editing.draft} use:focusEl onkeydown={onEditKey} onblur={finishEdit} aria-label="Group label" />
        {:else}
          <div class="cv-group-label">{g.label || 'Group'}</div>
        {/if}
        {#if selected.includes(g.id) && editable}<div class="cv-resize" data-resize="1"></div>{/if}
      </div>
    {/each}

    <svg class="cv-edges" aria-hidden="true">
      {#each edgeVMs as ev (ev.edge.id)}
        <g class="cv-edge" class:sel={selectedEdge === ev.edge.id} data-edge-id={ev.edge.id} style={ev.color ? `--c: ${ev.color}` : ''}>
          <path class="cv-edge-hit" d={ev.d} />
          <path class="cv-edge-line" d={ev.d} />
          {#if ev.head}<polygon class="cv-edge-head" points={ev.head} />{/if}
          {#if ev.tail}<polygon class="cv-edge-head" points={ev.tail} />{/if}
        </g>
      {/each}
      {#if connectPath}
        <g class="cv-edge connecting"><path class="cv-edge-line" d={connectPath.d} /><polygon class="cv-edge-head" points={connectPath.head} /></g>
      {/if}
    </svg>

    {#each edgeVMs as ev (ev.edge.id)}
      {#if ev.edge.label || (editing?.kind === 'edge' && editing.id === ev.edge.id)}
        <div class="cv-edge-label" class:sel={selectedEdge === ev.edge.id} data-edge-id={ev.edge.id} style="left: {ev.mid.x}px; top: {ev.mid.y}px; {ev.color ? `--c: ${ev.color}` : ''}">
          {#if editing?.kind === 'edge' && editing.id === ev.edge.id}
            <input class="cv-input" bind:value={editing.draft} use:focusEl onkeydown={onEditKey} onblur={finishEdit} aria-label="Edge label" />
          {:else}{ev.edge.label}{/if}
        </div>
      {/if}
    {/each}

    {#each cards as n (n.id)}
      {@const c = colorCSS(n.color)}
      {@const sel = selected.includes(n.id)}
      <div
        class="cv-node cv-{n.type}"
        class:sel
        class:colored={!!c}
        data-node-id={n.id}
        style="left: {n.x}px; top: {n.y}px; width: {n.width}px; height: {n.height}px; {c ? `--c: ${c}` : ''}"
      >
        {#if n.type === 'text'}
          {#if editing?.kind === 'text' && editing.id === n.id}
            <textarea class="cv-text-edit" bind:value={editing.draft} use:focusEl oninput={onTyping} onkeydown={onEditKey} onblur={finishEdit} aria-label="Text node"></textarea>
          {:else}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="cv-body cv-scrollable lumi-prose md-body" onclick={onTextClick}>{@html renderMarkdown((n as TextNode).text)}</div>
          {/if}
        {:else if n.type === 'file'}
          {@const f = (n as FileNode).file}
          {@const pv = previews[f]}
          <div class="cv-file-head" title={f}>
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 1.75h5.5L12.25 4.5v9.75H4z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.25 1.75V4.75h3" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
            <span class="cv-file-name">{baseName(f) || '(no file)'}</span>
            {#if (n as FileNode).subpath}<span class="cv-sub">{(n as FileNode).subpath}</span>{/if}
          </div>
          {#if IMAGE.test(f)}
            <div class="cv-body cv-muted">Image · {f}</div>
          {:else if /\.canvas$/i.test(f)}
            <div class="cv-body cv-muted">Canvas · {f}</div>
          {:else if pv?.state === 'ok'}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="cv-body cv-scrollable lumi-prose md-body cv-embed" onclick={onTextClick}>{@html pv.html}</div>
          {:else if pv?.state === 'loading'}
            <div class="cv-body cv-muted">Loading…</div>
          {:else}
            <div class="cv-body cv-muted">Note not found in this book.</div>
          {/if}
        {:else if n.type === 'link'}
          {@const u = (n as LinkNode).url}
          <div class="cv-link">
            <span class="cv-link-host">{hostOf(u)}</span>
            <span class="cv-link-url">{u}</span>
            <button class="ui-btn sm cv-link-open" type="button" onclick={() => openNode(n)} disabled={!safeURL(u)}>Open ↗</button>
          </div>
        {/if}
        {#if sel && editable && selected.length === 1}
          {#each SIDES as s (s)}<div class="cv-handle cv-h-{s}" data-handle={s} title="Drag to connect"></div>{/each}
          <div class="cv-resize" data-resize="1" title="Resize"></div>
        {/if}
      </div>
    {/each}
  </div>

  <header class="cv-bar cv-ui">
    <div class="cv-lead">
      {#if title}<span class="cv-title">{title}</span>{/if}
      <span class="cv-meta">{baseNodes.length} nodes · {edges.length} edges</span>
      {#if status}<span class="cv-status" data-testid="canvas-status">{status}</span>{/if}
      {#if pending}<span class="cv-pending">{pending}</span>{/if}
      {#if notice}<span class="cv-notice" role="status">{notice}</span>{/if}
    </div>
    <div class="cv-actions">
      {#if onsource}
        <div class="ui-seg" role="group" aria-label="View">
          <button type="button" class="active" aria-pressed="true">Canvas</button>
          <button type="button" aria-pressed="false" onclick={() => onsource?.()} title="JSON source (e)">Source</button>
        </div>
      {/if}
    </div>
  </header>

  {#if invalid}
    <div class="cv-banner cv-ui" role="alert">This canvas is not valid JSON ({invalid}). Showing the last valid state, read-only.</div>
  {:else if parsed.ok && parsed.issues.length}
    <div class="cv-banner warn cv-ui" title={parsed.issues.join('\n')}>{parsed.issues.length} item{parsed.issues.length === 1 ? '' : 's'} could not be shown (kept in the file).</div>
  {/if}

  {#if baseNodes.length === 0 && !invalid}
    <div class="cv-empty cv-ui">
      Empty canvas. Double-click or press <kbd>a</kbd> to add a card, <kbd>f</kbd> to add a note.
    </div>
  {/if}

  <div class="cv-tools cv-ui" role="toolbar" aria-label="Canvas tools">
    {#if hasSelection && editable}
      <div class="cv-palette" role="group" aria-label="Color">
        <button type="button" class="cv-swatch none" onclick={() => setColor(null)} aria-label="No color" title="No color (c0)"></button>
        {#each PRESETS as p, i (p)}
          <button type="button" class="cv-swatch" style="--c: var(--canvas-{p})" onclick={() => setColor(p)} aria-label={PRESET_NAMES[i]} title="{PRESET_NAMES[i]} (c{p})"></button>
        {/each}
      </div>
      <span class="cv-sep" aria-hidden="true"></span>
    {/if}
    <button class="ui-btn ghost sm" type="button" onclick={() => addTextAt(nextSlot(250))} disabled={!editable} title="Add text card (a)">+ Card</button>
    <button class="ui-btn ghost sm" type="button" onclick={() => openPicker()} disabled={!editable} title="Add note (f)">+ Note</button>
    <span class="cv-sep" aria-hidden="true"></span>
    <button class="ui-btn ghost sm icon" type="button" onclick={() => setView(zoomAt(view, w / 2, h / 2, 1 / 1.2), true)} aria-label="Zoom out" title="Zoom out (-)">−</button>
    <span class="cv-zoom" aria-live="polite">{zoomPct}%</span>
    <button class="ui-btn ghost sm icon" type="button" onclick={() => setView(zoomAt(view, w / 2, h / 2, 1.2), true)} aria-label="Zoom in" title="Zoom in (+)">+</button>
    <button class="ui-btn ghost sm" type="button" onclick={() => fitAll()} title="Fit (0)">Fit</button>
  </div>

  {#if picker}
    <div class="cv-picker cv-ui" role="dialog" aria-label="Add a note to the canvas">
      <input class="cv-input" bind:value={picker.query} use:focusEl onkeydown={onPickerKey} placeholder="Find a note…" aria-label="Find a note" />
      <ul role="listbox">
        {#each pickList as n, i (n.path)}
          <li role="option" aria-selected={i === picker.cursor}>
            <button type="button" class:active={i === picker.cursor} onclick={() => pickNote(n)}>
              <span>{n.title || baseName(n.path)}</span><small>{n.path}</small>
            </button>
          </li>
        {:else}
          <li class="cv-muted">No matching notes</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .cv {
    --canvas-1: var(--color-error);
    --canvas-2: color-mix(in oklch, var(--color-error) 50%, var(--color-warning));
    --canvas-3: var(--color-warning);
    --canvas-4: color-mix(in oklch, var(--color-info) 50%, var(--color-warning));
    --canvas-5: var(--color-info);
    --canvas-6: var(--color-secondary);
    --cv-node: color-mix(in srgb, var(--color-text) 2.5%, var(--color-background));
    --cv-line: color-mix(in srgb, var(--color-text) 38%, var(--color-background));
    position: relative;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    outline: none;
    background-color: var(--color-background);
    background-image: radial-gradient(circle, color-mix(in srgb, var(--color-text) 14%, transparent) 1px, transparent 1.2px);
    background-size: var(--grid) var(--grid);
    background-position: var(--gx) var(--gy);
    color: var(--color-text);
    touch-action: none;
    user-select: none;
    cursor: default;
  }
  .cv.panning { cursor: grabbing; }
  .cv-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
  .cv-world.ease { transition: transform 180ms var(--ease); }

  .cv-node {
    position: absolute;
    box-sizing: border-box;
    border-radius: var(--radius-lg);
    background: var(--cv-node);
    border: 1.5px solid color-mix(in srgb, var(--c, var(--color-border)) 80%, transparent);
    box-shadow: 0 1px 3px color-mix(in srgb, #000 12%, transparent);
    display: flex;
    flex-direction: column;
    overflow: visible;
    cursor: grab;
  }
  .cv-node.colored { background: color-mix(in srgb, var(--c) 9%, var(--cv-node)); }
  .cv-node.sel { border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--ring), 0 6px 18px color-mix(in srgb, #000 16%, transparent); }
  .cv-group {
    background: color-mix(in srgb, var(--c, var(--color-text)) 5%, transparent);
    border-style: solid;
    border-color: color-mix(in srgb, var(--c, var(--color-border)) 70%, transparent);
    box-shadow: none;
  }
  .cv-group-label {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin-bottom: 6px;
    font-size: 18px;
    font-weight: 600;
    color: color-mix(in srgb, var(--c, var(--color-text)) 85%, var(--color-text));
    white-space: nowrap;
    cursor: text;
  }
  .cv-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px; cursor: inherit; }
  .cv-body.lumi-prose { --prose-size: 15px; --prose-leading: 1.5; --md-rhythm: 0.6em; font-size: var(--prose-size); line-height: var(--prose-leading); max-width: none; user-select: text; }
  .cv-body :global(.md-b > :first-child) { margin-top: 0; }
  .cv-body :global(.md-b:last-child > :last-child) { margin-bottom: 0; }
  .cv-muted { color: var(--color-text-dim); font-size: var(--text-sm); }
  .cv-embed { border-top: 1px solid var(--hairline); --prose-size: 13px; }
  .cv-text-edit {
    flex: 1;
    width: 100%;
    resize: none;
    border: none;
    outline: none;
    border-radius: inherit;
    padding: 12px 16px;
    font: inherit;
    font-family: var(--font-mono);
    font-size: 13.5px;
    line-height: 1.5;
    background: var(--color-background);
    color: var(--color-text);
    box-sizing: border-box;
    user-select: text;
  }
  .cv-file-head { display: flex; align-items: center; gap: 6px; padding: 8px 12px; font-size: var(--text-sm); font-weight: 600; color: var(--color-text); min-width: 0; }
  .cv-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cv-sub { color: var(--color-text-dim); font-weight: 400; }
  .cv-link { display: flex; flex-direction: column; gap: 4px; padding: 12px 16px; min-width: 0; height: 100%; box-sizing: border-box; }
  .cv-link-host { font-weight: 600; font-size: var(--text-md); }
  .cv-link-url { color: var(--md-link, var(--color-primary)); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cv-link-open { align-self: flex-start; margin-top: auto; }

  .cv-handle {
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--color-background);
    border: 2px solid var(--color-primary);
    cursor: crosshair;
    z-index: 2;
  }
  .cv-h-top { top: -7px; left: calc(50% - 6px); }
  .cv-h-bottom { bottom: -7px; left: calc(50% - 6px); }
  .cv-h-left { left: -7px; top: calc(50% - 6px); }
  .cv-h-right { right: -7px; top: calc(50% - 6px); }
  .cv-resize {
    position: absolute;
    right: -5px;
    bottom: -5px;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: var(--color-primary);
    cursor: nwse-resize;
    z-index: 2;
  }

  .cv-edges { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
  .cv-edge { color: var(--c, var(--cv-line)); }
  .cv-edge-hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; cursor: pointer; }
  .cv-edge-line { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .cv-edge-head { fill: currentColor; }
  .cv-edge.sel { color: var(--color-primary); }
  .cv-edge.sel .cv-edge-line { stroke-width: 3; }
  .cv-edge.connecting { color: var(--color-primary); }
  .cv-edge.connecting .cv-edge-line { stroke-dasharray: 6 5; }
  .cv-edge-label {
    position: absolute;
    transform: translate(-50%, -50%);
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    background: var(--color-background);
    border: 1px solid color-mix(in srgb, var(--c, var(--color-border)) 60%, transparent);
    font-size: 13px;
    white-space: nowrap;
    cursor: pointer;
  }
  .cv-edge-label.sel { border-color: var(--color-primary); }

  .cv-input {
    font: inherit;
    font-size: 13px;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-primary);
    background: var(--color-background);
    color: var(--color-text);
    outline: none;
    user-select: text;
  }

  .cv-bar {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 16px;
    background: color-mix(in srgb, var(--color-background) 86%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--hairline);
    box-sizing: border-box;
    z-index: 5;
  }
  .cv-lead { display: flex; align-items: baseline; gap: 10px; min-width: 0; overflow: hidden; }
  .cv-title { font-weight: 600; font-size: var(--text-lg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cv-meta, .cv-status { color: var(--color-text-dim); font-size: var(--text-xs); white-space: nowrap; }
  .cv-status { padding: 1px 6px; border-radius: 999px; background: var(--tint-hover); }
  .cv-pending { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-primary); }
  .cv-notice { font-size: var(--text-xs); color: var(--color-warning); }
  .cv-banner {
    position: absolute;
    top: 52px;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - 32px);
    padding: 6px 12px;
    border-radius: var(--radius);
    font-size: var(--text-xs);
    background: color-mix(in srgb, var(--color-error) 16%, var(--color-background));
    border: 1px solid color-mix(in srgb, var(--color-error) 45%, transparent);
    z-index: 5;
  }
  .cv-banner.warn { background: color-mix(in srgb, var(--color-warning) 14%, var(--color-background)); border-color: color-mix(in srgb, var(--color-warning) 40%, transparent); }
  .cv-empty { position: absolute; inset: 44px 0 0; display: grid; place-items: center; color: var(--color-text-dim); font-size: var(--text-sm); pointer-events: none; }
  .cv-tools {
    position: absolute;
    right: 16px;
    bottom: 16px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-background) 92%, transparent);
    border: 1px solid var(--hairline);
    box-shadow: var(--shadow-pop);
    backdrop-filter: blur(8px);
    z-index: 5;
    max-width: calc(100% - 32px);
    flex-wrap: wrap;
  }
  .cv-zoom { min-width: 42px; text-align: center; font-size: var(--text-xs); color: var(--color-text-dim); font-variant-numeric: tabular-nums; }
  .cv-sep { width: 1px; height: 16px; background: var(--hairline); margin: 0 4px; }
  .cv-palette { display: flex; gap: 4px; padding: 0 4px; }
  .cv-swatch {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, var(--color-text) 25%, transparent);
    background: var(--c);
    cursor: pointer;
    padding: 0;
  }
  .cv-swatch.none { background: linear-gradient(135deg, transparent 45%, var(--color-error) 45%, var(--color-error) 55%, transparent 55%); }
  .cv-swatch:hover { transform: scale(1.12); }
  .cv-picker {
    position: absolute;
    left: 50%;
    top: 64px;
    transform: translateX(-50%);
    width: min(440px, calc(100% - 32px));
    max-height: 60%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: var(--radius-lg);
    background: var(--color-overlay-bg);
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-pop);
    z-index: 6;
  }
  .cv-picker .cv-input { height: 30px; font-size: var(--text-sm); }
  .cv-picker ul { list-style: none; margin: 0; padding: 0; overflow: auto; }
  .cv-picker button {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: 6px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }
  .cv-picker button small { color: var(--color-text-dim); font-size: 11px; }
  .cv-picker button.active, .cv-picker button:hover { background: var(--tint-active); }
  @media (prefers-reduced-motion: reduce) { .cv-world.ease { transition: none; } }
</style>
