<script>
  import { onMount, onDestroy } from 'svelte';
  import { store } from './lib/store.svelte.js';
  import { connectWebSocket, disconnect as disconnectWs } from './lib/ws.js';
  import { totalColumns } from './lib/animation.js';

  import HomeView from './views/HomeView.svelte';
  import TreeView from './views/TreeView.svelte';
  import NoteView from './views/NoteView.svelte';
  import ConfigView from './views/ConfigView.svelte';
  import Toast from './components/Toast.svelte';
  import SearchModal from './components/SearchModal.svelte';
  import CommandModal from './components/CommandModal.svelte';

  onMount(async () => {
    store.loadThemeFromStorage();
    store.applyResolvedTheme();
    store.setupSystemWatch();
    store.loadEditorSettings();
    store.loadPreviewSetting();
    await store.loadAll();
    connectWebSocket(store.handleWsMessage);
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  onDestroy(() => {
    disconnectWs();
    store.cleanupEditor();
  });

  async function handleKey(e) {
    // Command modal
    if (store.cmdModal) {
      if (e.key === 'Escape') {
        e.preventDefault();
        store.cmdModal = null;
        store.cmdInputValue = '';
        return;
      }
      if (store.cmdModal.kind === 'confirm') {
        if (e.key === 'Enter' || e.key === 'y') {
          e.preventDefault();
          const fn = store.cmdModal.onSubmit;
          store.cmdModal = null;
          await fn();
        }
        return;
      }
      if (store.cmdModal.kind === 'select') {
        if (e.key === 'j' || e.key === 'ArrowDown') {
          e.preventDefault();
          if (store.cmdSelectCursor < store.cmdModal.items.length - 1) store.cmdSelectCursor++;
          return;
        }
        if (e.key === 'k' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (store.cmdSelectCursor > 0) store.cmdSelectCursor--;
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const item = store.cmdModal.items[store.cmdSelectCursor];
          const fn = store.cmdModal.onSubmit;
          store.cmdModal = null;
          await fn(item.value);
          return;
        }
        return;
      }
      // input kind: Escape handled above, let browser handle typing
    }

    // Search modal
    if (store.showSearch) {
      if (e.key === 'Escape') {
        e.preventDefault();
        store.showSearch = false;
        store.searchQuery = '';
        store.searchCursor = 0;
        return;
      } else if ((e.key === 'j' || e.key === 'ArrowDown') && e.ctrlKey) {
        e.preventDefault();
        if (store.searchCursor < store.searchResults.length - 1) store.searchCursor++;
        return;
      } else if ((e.key === 'k' || e.key === 'ArrowUp') && e.ctrlKey) {
        e.preventDefault();
        if (store.searchCursor > 0) store.searchCursor--;
        return;
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (store.searchResults[store.searchCursor]) {
          await store.openNote(store.searchResults[store.searchCursor]);
          store.showSearch = false;
        }
        return;
      }
    }

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.closest?.('.cm-editor')) return;

    // Home view
    if (store.viewMode === 'home' && !store.showSearch) {
      // Any key skips animation
      if (!store.animDone) {
        store.animDone = true;
        store.animProgress = totalColumns(store.logoLines);
      }
      if (e.key === '/') { e.preventDefault(); store.showSearch = true; store.performSearch(); }
      else if (e.key === 't' || e.key === 'Enter') { e.preventDefault(); store.viewMode = 'tree'; }
      else if (e.key === 'c') { e.preventDefault(); store.enterConfig(); }
      return;
    }

    // Tree view
    if (store.viewMode === 'tree') {
      if (e.key === '/') { e.preventDefault(); store.showSearch = true; store.performSearch(); }
      else if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (store.cursor < store.displayItems.length - 1) store.cursor++;
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (store.cursor > 0) store.cursor--;
      } else if (e.key === 'Enter' || e.key === 'l') {
        e.preventDefault();
        const item = store.displayItems[store.cursor];
        if (item?.type === 'note') store.openNote(item);
        else if (item?.type === 'folder') store.enterFolder(item);
      } else if (e.key === 'Escape' || e.key === 'h') {
        e.preventDefault();
        if (store.currentDir !== '/') {
          store.goBackDir();
        } else {
          store.viewMode = 'home';
        }
      } else if (e.key === 'c') {
        e.preventDefault();
        store.enterConfig();
      } else if (e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        store.cmdNewNote();
      } else if (e.key === 'N') {
        e.preventDefault();
        store.cmdNewFolder();
      } else if (e.key === 'r') {
        e.preventDefault();
        store.cmdRenameItem();
      } else if (e.key === 'm') {
        e.preventDefault();
        store.cmdMoveItem();
      } else if (e.key === 'y') {
        e.preventDefault();
        store.cmdCopyNote();
      } else if (e.key === 'd') {
        e.preventDefault();
        store.cmdDeleteItem();
      }
      return;
    }

    // Note view
    if (store.viewMode === 'note') {
      if (e.key === 'Escape' && !store.editMode) {
        e.preventDefault();
        store.viewMode = 'tree'; store.selectedNote = null;
      } else if (e.key === 'h' && !store.editMode) {
        e.preventDefault();
        store.viewMode = 'home';
        store.selectedNote = null;
      } else if (e.key === 'e' && !store.editMode) {
        e.preventDefault();
        store.editMode = true;
      } else if (e.key === 'j' && !store.editMode) {
        e.preventDefault();
        const el = document.querySelector('.note-view-content');
        if (el) el.scrollBy(0, 40);
      } else if (e.key === 'k' && !store.editMode) {
        e.preventDefault();
        const el = document.querySelector('.note-view-content');
        if (el) el.scrollBy(0, -40);
      } else if (e.key === '/' && !store.editMode) {
        e.preventDefault();
        store.showSearch = true;
        store.performSearch();
      } else if (e.key === 'c' && !store.editMode) {
        e.preventDefault();
        store.enterConfig();
      } else if (e.key === 'd' && !store.editMode) {
        e.preventDefault();
        store.cmdDeleteCurrentNote();
      }
      return;
    }

    // Config view
    if (store.viewMode === 'config') {
      if (e.key === 'Escape') { e.preventDefault(); store.viewMode = store.previousView; }
      else if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); store.configMoveDown(); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); store.configMoveUp(); }
      else if (e.key === 'l' || e.key === 'ArrowRight') { e.preventDefault(); store.configCycleOption(1); }
      else if (e.key === 'h' || e.key === 'ArrowLeft') { e.preventDefault(); store.configCycleOption(-1); }
      return;
    }
  }
</script>

<Toast />

{#if store.viewMode === 'home'}
  <HomeView />
{/if}

{#if store.viewMode === 'tree'}
  <TreeView />
{/if}

{#if store.viewMode === 'note'}
  <NoteView />
{/if}

{#if store.viewMode === 'config'}
  <ConfigView />
{/if}

<SearchModal />
<CommandModal />
