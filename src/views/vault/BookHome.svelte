<script lang="ts">
  // The book's calm home: shown when no note is open (SPEC-PARTE2 §2).
  import { vaults } from '../../lib/vaults.svelte.ts';
  import { notes } from '../../lib/notes.svelte.ts';
  import { books } from '../../lib/books.svelte.ts';
  import { serverLabel } from '../../lib/serverurl.ts';
  import { dirOf } from '../../lib/notetree.ts';
  import { updatedLabel } from '../../lib/hover-preview.ts';
  import { motionAllowed } from '../../lib/motion.ts';
  import SyncDot from '../../components/SyncDot.svelte';
  import { useWorkspace } from './context.ts';

  const ws = useWorkspace();
  const ex = ws.explorer;

  // Home (motion v2): the ambient light leans away from the pointer.
  let ambientEl = $state<HTMLElement | null>(null);
  $effect(() => {
    const amb = ambientEl;
    const host = ws.homeEl;
    if (!amb || !host || !motionAllowed()) return;
    let raf = 0;
    let px = 0;
    let py = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = host.getBoundingClientRect();
      px = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
      py = ((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        amb.style.setProperty('--px', px.toFixed(3));
        amb.style.setProperty('--py', py.toFixed(3));
      });
    };
    host.addEventListener('pointermove', move, { passive: true });
    return () => {
      host.removeEventListener('pointermove', move);
      if (raf) cancelAnimationFrame(raf);
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<section class="stage home" bind:this={ws.homeEl} tabindex="-1" aria-label="{vaults.selected?.name ?? 'Book'} home" data-testid="book-home">
  <!-- Ambient light: two slow, soft blooms of the theme's colours
       (CSS only, transform-animated, paused when the tab is hidden,
       absent under Reduce Motion). Calm: a full cycle is ~48 s. -->
  <div class="ambient" aria-hidden="true" bind:this={ambientEl}><span class="bloom a"></span><span class="bloom b"></span><span class="bloom c"></span><span class="grain"></span></div>
  <div class="home-inner">
    <p class="ui-eyebrow home-eyebrow">book</p>
    <h1 class="home-title">{books.active?.name ?? vaults.selected?.name ?? 'Book'}</h1>
    <p class="home-meta">
      {#if ws.activeStatus}<SyncDot state={ws.activeStatus.state} pending={ws.activeStatus.pending} label vaultID={vaults.selectedID ?? undefined} />{/if}
      <span class="home-dot" aria-hidden="true">·</span>
      <span data-testid="home-count">{notes.loadingList && notes.list.length === 0 ? '…' : notes.list.length} {notes.list.length === 1 ? 'note' : 'notes'}</span>
      {#if books.active}<span class="home-dot" aria-hidden="true">·</span><span class="mono">{books.active.account}@{serverLabel(books.active.server_url)}</span>{/if}
    </p>
    <div class="home-actions">
      <button class="ui-btn primary" type="button" onclick={() => ex.open()} data-testid="home-explore">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.75 4.25a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.75h5a1.5 1.5 0 0 1 1.5 1.5v6.25a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
        Explore <kbd class="on-primary">-</kbd>
      </button>
      <button class="ui-btn" type="button" onclick={ex.beginCreate} disabled={ws.structuralOffline}>New note <kbd>a</kbd></button>
      <button class="ui-btn ghost" type="button" onclick={ex.openBooks}>Switch book <kbd>gb</kbd></button>
    </div>
    {#if notes.loadingList && notes.list.length === 0}
      <div class="home-skel" aria-hidden="true" data-testid="home-skeleton">
        {#each [0, 1, 2, 3, 4] as i (i)}<span class="skeleton" style="width: {88 - i * 9}%"></span>{/each}
      </div>
    {:else if ws.recents.length > 0}
      <h2 class="home-h">Recent</h2>
      <ul class="home-recent" data-testid="home-recent">
        {#each ws.recents as n, i (n.id)}
          <li style="--i: {i}">
            <button type="button" class="recent glow" data-recent={i} data-hint-target onclick={(e) => ws.openNote(n.id, { from: (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.recent-title') })} onfocus={() => (ws.homeIndex = i)}>
              <span class="recent-title">{n.title}</span>
              <span class="recent-dir mono">{dirOf(n.path) || '/'}</span>
              <span class="recent-when">{updatedLabel(n.updated_at)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="home-empty">
        <p class="empty-title">This book is empty</p>
        <p>Press <kbd>a</kbd> to create a note — <span class="mono">ideas</span>, <span class="mono">work/plan</span>, or a folder <span class="mono">journal/</span>.</p>
      </div>
    {/if}
    <p class="home-keys" aria-hidden="true"><kbd>-</kbd> explore · <kbd>j</kbd><kbd>k</kbd> recent · <kbd>space</kbd> commands · <kbd>[</kbd><kbd>]</kbd> books · <kbd>?</kbd> keys</p>
  </div>
</section>

<style>
  .mono { font-family: var(--font-mono); }
  .stage { position: relative; flex: 1; min-height: 0; min-width: 0; }
  .home { position: relative; isolation: isolate; overflow-y: auto; outline: none; display: flex; justify-content: center; }
  /* Ambient light: two blooms of the theme's own colours drifting on a
     48 s cycle. Transform-only (compositor), large soft gradients (no
     blur filter), paused while the tab is hidden; none under Reduce
     Motion (the static light stays — calm, not empty). */
  .ambient { position: absolute; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; contain: strict; }
  .bloom { position: absolute; border-radius: 50%; will-change: transform; transition: translate 900ms var(--spring-soft); }
  /* Parallax (motion v2): the light leans away from the pointer, each
     bloom by its own depth (--px/--py ∈ [-1, 1], one write per frame). */
  .bloom.a { translate: calc(var(--px, 0) * -46px) calc(var(--py, 0) * -34px); }
  .bloom.b { translate: calc(var(--px, 0) * 30px) calc(var(--py, 0) * 24px); }
  .bloom.c {
    width: 40vmax; height: 40vmax; left: 38%; top: 18%;
    background: radial-gradient(closest-side, color-mix(in oklch, var(--color-accent) 10%, transparent), transparent);
    translate: calc(var(--px, 0) * -70px) calc(var(--py, 0) * -50px);
    animation: ambient-drift-b calc(var(--dur-ambient) * 0.8) var(--ease-breath) infinite alternate-reverse;
  }
  .bloom.a {
    width: 78vmax; height: 78vmax; left: -22vmax; top: -38vmax;
    background: radial-gradient(closest-side, color-mix(in oklch, var(--color-primary) 24%, transparent), color-mix(in oklch, var(--color-primary) 7%, transparent) 55%, transparent);
    animation: ambient-drift-a var(--dur-ambient) var(--ease-breath) infinite alternate;
  }
  .bloom.b {
    width: 64vmax; height: 64vmax; right: -24vmax; bottom: -34vmax;
    background: radial-gradient(closest-side, color-mix(in oklch, var(--color-secondary) 20%, transparent), color-mix(in oklch, var(--color-accent) 6%, transparent) 60%, transparent);
    animation: ambient-drift-b calc(var(--dur-ambient) * 1.27) var(--ease-breath) infinite alternate;
  }
  :global(:root[data-theme='light']) .bloom.a { opacity: 0.8; }
  /* A whisper of grain keeps big gradients from banding. */
  .grain {
    position: absolute;
    inset: 0;
    opacity: 0.035;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    mix-blend-mode: overlay;
  }
  /* The first screen is the book: title, actions and up to 12 recent
     notes in as many columns as fit (2 on a laptop, 3 on a big screen). */
  .home-inner { width: min(1120px, 100%); padding: clamp(16px, 5vh, 56px) clamp(var(--sp-3), 4vw, var(--sp-6)) var(--sp-6); }
  /* Entrance: title, meta, actions and the recent grid rise in turn. */
  .home-inner > :global(*) { animation: home-in var(--spring-gentle-ms) var(--spring-gentle) both; }
  .home-inner > :global(:nth-child(2)) { animation-delay: 40ms; }
  .home-inner > :global(:nth-child(3)) { animation-delay: 80ms; }
  .home-inner > :global(:nth-child(4)) { animation-delay: 120ms; }
  .home-inner > :global(:nth-child(n + 5)) { animation-delay: 150ms; }
  @keyframes home-in { from { opacity: 0; transform: translateY(22px); } }
  .home-eyebrow { margin: 0 0 var(--sp-2); }
  .home-title {
    margin: 0;
    font-size: clamp(2rem, 4vw, var(--text-3xl));
    line-height: 1.06;
    letter-spacing: -0.032em;
    font-weight: 720;
    color: var(--md-heading, var(--color-text));
    text-wrap: balance;
    background: linear-gradient(180deg, var(--color-text) 30%, color-mix(in oklch, var(--color-text) 72%, var(--color-primary)));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .home-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: var(--sp-3) 0 0; font-size: var(--text-sm); color: var(--ink-3); }
  .home-dot { color: var(--ink-4); }
  .home-actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin: var(--sp-4) 0 var(--sp-5); }
  .home-actions .ui-btn { gap: 7px; height: 32px; padding: 0 14px; }
  .home-actions :global(kbd.on-primary) { background: color-mix(in oklch, black 18%, transparent); border-color: transparent; color: inherit; box-shadow: none; }
  .home-h { margin: 0 0 var(--sp-2); padding-left: 12px; font-family: var(--font-mono); font-size: var(--text-2xs); font-weight: 500; letter-spacing: var(--tracking-caps); text-transform: uppercase; color: var(--ink-3); }
  .home-recent { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr)); gap: var(--row-gap) var(--sp-2); }
  .home-recent li { animation: recent-in var(--spring-glide-ms) var(--spring-glide) both; animation-delay: calc(min(var(--i, 0), 10) * 26ms + 160ms); }
  @keyframes recent-in { from { opacity: 0; transform: translateY(16px) scale(0.97); } }
  .recent {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: var(--sp-3);
    min-height: calc(var(--row-h) + 6px);
    padding: 0 12px;
    align-items: center;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--dur-tap) var(--ease), transform var(--spring-snappy-ms) var(--spring-snappy), box-shadow var(--dur-fade) var(--ease);
  }
  .recent:hover { background: var(--surface-1); box-shadow: 0 0 0 1px var(--hairline-soft); }
  .recent:active { transform: scale(0.985); }
  .recent:focus-visible { outline: none; background: var(--accent-wash); box-shadow: inset 2px 0 0 var(--accent), 0 0 0 1px var(--accent-soft); }
  .recent-title { font-weight: 550; letter-spacing: var(--tracking-ui); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: transform var(--spring-snappy-ms) var(--spring-snappy); }
  .recent:hover .recent-title { transform: translateX(2px); }
  .recent-dir { font-size: var(--text-2xs); color: var(--ink-4); max-width: 22ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .recent-when { font-size: var(--text-xs); color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .home-empty { padding: var(--sp-5) 0; color: var(--ink-3); font-size: var(--text-sm); }
  .empty-title { color: var(--color-text); font-weight: 650; font-size: var(--text-lg); letter-spacing: var(--tracking-ui); }
  .home-keys { margin-top: var(--sp-4); padding-left: 12px; font-size: var(--text-xs); color: var(--ink-4); }
  .home-keys kbd { margin: 0 1px; }
  .home-skel { display: flex; flex-direction: column; gap: 12px; padding-top: var(--sp-2); }
  .home-skel .skeleton { height: 36px; border-radius: var(--radius); }

  @media (max-width: 720px) {
    .recent { grid-template-columns: minmax(0, 1fr) auto; padding: 12px; }
    .recent-dir { display: none; }
    .home-keys { display: none; }
  }
</style>
