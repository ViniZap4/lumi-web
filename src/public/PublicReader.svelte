<script lang="ts">
  // Public reader for a published book (/p/:slug, M3). Anonymous: every
  // request goes through public-api.ts (no token, no cookies, no
  // Referer). Markdown is rendered by the shared sanitised renderer
  // (lib/markdown.ts, DOMPurify); canvases open read-only.
  import { onMount, type Component } from 'svelte';
  import { renderBlocks } from '../lib/markdown.ts';
  import MarkdownView from '../components/MarkdownView.svelte';
  import { memoryLiveText } from '../lib/live-text.ts';
  import { theme } from '../lib/theme.svelte.ts';
  import { getPublicBook, getPublicNote, publicNotePath, PublicError, type PublicBook, type PublicNote } from './public-api.ts';

  interface Props {
    slug: string;
    noteID: string | null;
    server: string;
    fetchImpl?: typeof fetch;
  }
  const { slug, noteID = null, server, fetchImpl }: Props = $props();

  let book = $state<PublicBook | null>(null);
  let bookError = $state<string | null>(null);
  // svelte-ignore state_referenced_locally
  let currentID = $state<string | null>(noteID);
  let note = $state<PublicNote | null>(null);
  let noteError = $state<string | null>(null);
  let loading = $state(false);
  let Canvas = $state<Component<any> | null>(null);

  const blocks = $derived(note && note.kind === 'markdown' ? renderBlocks(note.body) : []);
  const canvasDoc = $derived(note && note.kind === 'canvas' ? memoryLiveText(note.body, false) : null);

  function errText(e: unknown): string {
    return e instanceof PublicError ? e.message : 'Não foi possível carregar.';
  }

  async function open(id: string, push = true): Promise<void> {
    currentID = id;
    loading = true;
    noteError = null;
    try {
      const n = await getPublicNote(server, slug, id, fetchImpl);
      if (currentID !== id) return;
      note = n;
      document.title = `${n.title} · ${book?.name ?? 'lumi'}`;
      if (n.kind === 'canvas' && !Canvas) Canvas = (await import('../components/canvas/CanvasView.svelte')).default as Component<any>;
      if (push) history.pushState({ id }, '', publicNotePath(slug, id));
    } catch (e) {
      if (currentID === id) noteError = errText(e);
    } finally {
      if (currentID === id) loading = false;
    }
  }

  async function loadCanvasFile(path: string): Promise<string | null> {
    const ref = book?.notes.find((n) => n.path === path || n.path === path.replace(/^\/+/, ''));
    if (!ref || ref.kind !== 'markdown') return null;
    try {
      return (await getPublicNote(server, slug, ref.id, fetchImpl)).body;
    } catch {
      return null;
    }
  }

  onMount(() => {
    theme.init();
    const onPop = (e: PopStateEvent) => {
      const id = (e.state as { id?: string } | null)?.id;
      if (id) void open(id, false);
      else {
        note = null;
        currentID = null;
      }
    };
    window.addEventListener('popstate', onPop);
    void (async () => {
      try {
        book = await getPublicBook(server, slug, fetchImpl);
        document.title = book.name;
        if (currentID) await open(currentID, false);
      } catch (e) {
        bookError = errText(e);
      }
    })();
    return () => {
      window.removeEventListener('popstate', onPop);
      theme.destroy();
    };
  });

  function onLink(e: MouseEvent): void {
    // Internal note links resolve inside the published book only.
    const a = (e.target as HTMLElement).closest?.('a');
    const href = a?.getAttribute('href');
    if (!a || !href || /^[a-z]+:/i.test(href) || href.startsWith('#')) return;
    const target = decodeURIComponent(href.replace(/^\.?\//, '').split('#')[0]);
    const ref = book?.notes.find((n) => n.path === target || n.path === `${target}.md` || n.title === target);
    if (ref) {
      e.preventDefault();
      void open(ref.id);
    }
  }
</script>

<div class="pub" data-testid="public-reader">
  <header class="pub-bar">
    <span class="pub-name">{book?.name ?? slug}</span>
    <span class="pub-note">Leitura pública · somente leitura</span>
  </header>
  {#if bookError}
    <p class="pub-error" role="alert" data-testid="public-error">{bookError}</p>
  {:else if !book}
    <p class="pub-muted">Carregando…</p>
  {:else}
    <div class="pub-body">
      <nav class="pub-list" aria-label="Notas publicadas">
        {#if book.notes.length === 0}<p class="pub-muted">Nenhuma nota publicada.</p>{/if}
        <ul>
          {#each book.notes as n (n.id)}
            <li><a href={publicNotePath(slug, n.id)} class:active={n.id === currentID} onclick={(e) => { e.preventDefault(); void open(n.id); }}>{n.title || n.path}</a></li>
          {/each}
        </ul>
      </nav>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <main class="pub-main" onclick={onLink}>
        {#if noteError}
          <p class="pub-error" role="alert">{noteError}</p>
        {:else if loading && !note}
          <p class="pub-muted">Carregando…</p>
        {:else if note?.kind === 'canvas' && Canvas && canvasDoc}
          <div class="pub-canvas"><Canvas doc={canvasDoc} title={note.title} mode="read" autofocus={false} loadNote={loadCanvasFile} /></div>
        {:else if note}
          <article class="rendered lumi-prose" data-testid="public-note">
            <h1 class="rendered-title">{note.title}</h1>
            <MarkdownView {blocks} />
          </article>
        {:else}
          <p class="pub-muted">Escolha uma nota.</p>
        {/if}
      </main>
    </div>
  {/if}
</div>

<style>
  .pub { display: flex; flex-direction: column; height: 100vh; background: var(--color-background); color: var(--color-text); }
  .pub-bar { display: flex; align-items: baseline; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--hairline); }
  .pub-name { font-weight: 700; }
  .pub-note, .pub-muted { color: var(--color-text-dim); font-size: var(--text-sm); }
  .pub-muted { padding: 16px; }
  .pub-error { margin: 16px; color: var(--color-error); }
  .pub-body { display: flex; flex: 1; min-height: 0; }
  .pub-list { width: 260px; flex: none; overflow: auto; border-right: 1px solid var(--hairline); padding: 8px; }
  .pub-list ul { list-style: none; margin: 0; padding: 0; }
  .pub-list a { display: block; padding: 4px 8px; border-radius: var(--radius); color: inherit; text-decoration: none; font-size: var(--text-sm); }
  .pub-list a:hover { background: var(--tint-hover); }
  .pub-list a.active { color: var(--color-primary); background: var(--tint-hover); }
  .pub-main { flex: 1; min-width: 0; overflow: auto; }
  .pub-main article { padding: 32px 24px 80px; margin: 0 auto; }
  .pub-canvas { height: 100%; }
  @media (max-width: 640px) {
    .pub-body { flex-direction: column; }
    .pub-list { width: auto; max-height: 30vh; border-right: none; border-bottom: 1px solid var(--hairline); }
  }
</style>
