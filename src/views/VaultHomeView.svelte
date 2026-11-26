<script lang="ts">
  // The book shell. The floating explorer (SPEC-PARTE2 §2) is the only
  // navigation: there is no explorer column and no books sidebar. A
  // book opens on its last note (per book, per device) or on a calm
  // empty home with the explorer floating on top; `-`, <leader>e,
  // :explore, the top bar's Explorer button and the palette open it;
  // `gb` / the book button open it at the books level.
  //
  // State and behaviour live in the workspace controllers
  // (views/vault/*.svelte.ts); this file wires them to the window and
  // lays the chrome out. Heavy, rarely used surfaces (book settings,
  // new book, help, the hover card) load on first use.
  import { onMount, onDestroy } from 'svelte';
  import { vaults } from '../lib/vaults.svelte.ts';
  import { notes } from '../lib/notes.svelte.ts';
  import { books } from '../lib/books.svelte.ts';
  import { uiState } from '../lib/uistate.svelte.ts';
  import { serverLabel } from '../lib/serverurl.ts';
  import { installPaneClickFocus } from '../lib/pane-click.ts';
  import { registerStructuredViews } from '../lib/structured-views.ts';
  import { Workspace } from './vault/workspace.svelte.ts';
  import { provideWorkspace } from './vault/context.ts';
  import { lazyComponent } from './vault/lazy.svelte.ts';
  import TopBar from './vault/TopBar.svelte';
  import BookBanners from './vault/BookBanners.svelte';
  import BookHome from './vault/BookHome.svelte';
  import NoteStage from './vault/NoteStage.svelte';
  import StatusBar from './vault/StatusBar.svelte';
  import ToastStack from '../components/ToastStack.svelte';
  import CommandPalette from '../components/CommandPalette.svelte';
  import ContextMenu from '../components/ContextMenu.svelte';
  import HintOverlay from '../components/HintOverlay.svelte';
  import FloatingExplorer from '../components/FloatingExplorer.svelte';

  // Kanban boards and JSON canvases render through the note-view registry.
  registerStructuredViews();

  const VaultSettingsModal = lazyComponent(() => import('../components/VaultSettingsModal.svelte'));
  const VaultCreateModal = lazyComponent(() => import('../components/VaultCreateModal.svelte'));
  const HelpOverlay = lazyComponent(() => import('../components/HelpOverlay.svelte'));
  const HoverCard = lazyComponent(() => import('../components/HoverCard.svelte'));

  const ws = provideWorkspace(new Workspace());
  ws.install();
  const { cmd, explorer: ex, hover: hv, panes: pn, edit: ed } = ws;

  onMount(() => {
    window.addEventListener('keydown', cmd.handleKey);
    const onFocusIn = (e: FocusEvent) => pn.onFocusIn(e);
    window.addEventListener('focusin', onFocusIn);
    // First click/tap in a pane focuses it AND acts (SPEC-PARTE2 §3).
    const offClick = ws.rootEl
      ? installPaneClickFocus(ws.rootEl, { activate: (leaf) => pn.activate(leaf), focus: (leaf) => pn.focusLeaf(leaf) })
      : () => {};
    let mq: MediaQueryList | null = null;
    const onmq = () => (pn.narrowView = !!mq?.matches);
    try {
      mq = window.matchMedia('(max-width: 720px)');
      onmq();
      mq.addEventListener?.('change', onmq);
    } catch {
      /* jsdom */
    }
    return () => {
      offClick();
      window.removeEventListener('keydown', cmd.handleKey);
      window.removeEventListener('focusin', onFocusIn);
      mq?.removeEventListener?.('change', onmq);
    };
  });

  onDestroy(() => ws.destroy());
</script>

<!-- Hover previews are delegated: any rendered note link (reader,
     split preview, Live Preview, secondary panes) under this root. -->
<div class="vault-home" bind:this={ws.rootEl} onpointerover={hv.onOver} onpointerout={hv.onOut} role="presentation" data-vim={ed.mode && cmd.eff.vim ? ed.vimState.mode : 'none'} class:note-dragging={pn.noteDragging}>
  <TopBar />
  <BookBanners />

  {#if ws.activeRevoked && books.active}
    <div class="placeholder" data-testid="book-revoked">
      <p>Você não tem mais acesso a este livro.</p>
      <button class="ui-btn sm" type="button" onclick={() => books.active && books.removeFromList(books.active.id)}>Remover da lista</button>
    </div>
  {:else if ws.activeStatus?.state === 'needs_login' && books.active}
    <div class="placeholder" data-testid="book-needs-login">
      <p>Entre em {serverLabel(books.active.server_url)} para sincronizar.</p>
      <button class="ui-btn sm primary" type="button" onclick={() => books.active && uiState.openSignIn(books.active.server_url, books.active.account)}>Entrar</button>
    </div>
  {:else if notes.listErrorStatus === 403}
    <!-- The vault IS in our list (we routed here from it) but its
         notes 403 — on a federated replica this usually means the
         home server hasn't granted this account access yet. -->
    <div class="placeholder">
      You don’t have access to this vault’s notes yet. If this is a
      federated replica, you may be awaiting an access grant from
      the home server — ask its operator, then refresh.
    </div>
  {:else if notes.listError}
    <div class="error">{notes.listError}</div>
  {:else if ws.pane === 'home'}
    <BookHome />
  {:else}
    <NoteStage />
  {/if}

  <StatusBar />

  <ToastStack />

  {#if cmd.paletteMode}
    <CommandPalette
      commands={cmd.paletteCommands}
      notes={notes.list}
      commandMode={cmd.paletteMode === 'command'}
      onex={cmd.runExLine}
      onnote={(id) => ws.openNote(id)}
      onclose={() => { cmd.paletteMode = null; }}
    />
  {/if}

  {#if cmd.menu}
    <ContextMenu x={cmd.menu.x} y={cmd.menu.y} items={cmd.menu.items} title={cmd.menu.title} onrun={cmd.runMenu} onclose={() => (cmd.menu = null)} />
  {/if}

  {#if ex.fx && vaults.selectedID}
    {#key ex.fx.key}
      <FloatingExplorer
        vaultID={vaults.selectedID}
        bookName={vaults.selected?.name ?? books.active?.name ?? 'Book'}
        startNote={ex.fx.startNote}
        startDir={ex.fx.startDir}
        level={ex.fx.level}
        initial={ex.fx.initial}
        ops={ex.ops}
        bind:yanked={ex.yanked}
        onopen={ex.openNote}
        ondragnote={(on) => { pn.noteDragging = on; if (!on) pn.dropAt = null; }}
        onedit={(id) => { ex.close(); void ed.editNote(id); }}
        onbook={ex.pickBook}
        onapp={ex.app}
        onlevel={(l) => (ex.level = l)}
        onnewbook={() => (uiState.createBookOpen = true)}
        onmanage={() => books.openPicker()}
        onclose={ex.close}
      />
    {/key}
  {/if}

  {#if hv.current && vaults.selectedID && HoverCard.current}
    <HoverCard.current
      target={hv.current.target}
      vaultID={vaults.selectedID}
      anchor={hv.current.anchor}
      keyboard={hv.current.keyboard}
      onopen={hv.openFrom}
      onclose={hv.close}
      onhold={() => hv.intent.hold()}
      onleave={hv.leave}
    />
  {/if}

  {#if cmd.hintsOpen}
    <HintOverlay root={cmd.hintRoot ?? (() => ws.rootEl)} onclose={cmd.closeHints} />
  {/if}

  {#if uiState.helpOpen && HelpOverlay.current}
    <HelpOverlay.current leader={cmd.eff.leader} onclose={() => (uiState.helpOpen = false)} />
  {/if}

  {#if ws.showSettings && VaultSettingsModal.current}
    <VaultSettingsModal.current onclose={() => (ws.showSettings = false)} />
  {/if}

  {#if uiState.createBookOpen && VaultCreateModal.current}
    <VaultCreateModal.current onclose={() => (uiState.createBookOpen = false)} onCreated={(id) => vaults.select(id)} />
  {/if}
</div>

<style>
  .vault-home {
    --mode: var(--mode-normal);
    /* Chrome heights: one compact top row, one note bar per pane. */
    --topbar-h: 38px;
    --notebar-h: 36px;
    height: 100vh;
    height: 100dvh;
    background: var(--surface-0);
    color: var(--color-text);
    display: flex;
    flex-direction: column;
  }
  .vault-home[data-vim='insert'] { --mode: var(--mode-insert); }
  .vault-home[data-vim='visual'] { --mode: var(--mode-visual); }
  .vault-home[data-vim='replace'] { --mode: var(--mode-replace); }

  .placeholder,
  .error {
    padding: var(--sp-6) var(--sp-4);
    color: var(--ink-3);
    text-align: center;
    font-size: var(--text-sm);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-3);
  }
  .error { color: var(--color-error); }
</style>
