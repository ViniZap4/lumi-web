<script lang="ts">
  // Settings → Offline & storage: space used, persistence, pending edits
  // and conflict copies.
  import { books } from '../../lib/books.svelte.ts';
  import { offline, bundleMarkdown, downloadText, exportFilename } from '../../lib/offline.svelte.ts';
  import { fmtBytes, type DeviceStorage } from './storage.svelte.ts';
  import type { ShowRow } from './form.ts';

  const { show, storage }: { show: ShowRow; storage: DeviceStorage } = $props();
  const usage = $derived(storage.usage);
  const persisted = $derived(storage.persisted);
  const requestPersist = () => storage.requestPersist();

  const pendingHere = $derived(books.active?.vault_id ? offline.pendingNotes(books.active.vault_id).length : 0);
  function exportConflicts(): void {
    const items = offline.conflicts.map((c) => ({ vaultID: c.vaultID, noteID: c.noteID, title: c.title, text: c.text }));
    if (items.length) downloadText(exportFilename(items), bundleMarkdown(items));
  }
</script>

<section class="group" aria-labelledby="sec-storage">
  <h2 id="sec-storage">Offline &amp; storage</h2>
  {#if show('storage')}
    <div class="row">
      <div class="row-text">
        <span class="row-title">Space used on this device</span>
        <span class="row-desc">Offline copies of opened notes, cached note lists and settings, in this browser only.</span>
      </div>
      <span class="value">{usage ? `${fmtBytes(usage.used)} of ${fmtBytes(usage.quota)}` : '—'}</span>
    </div>
    <div class="row">
      <div class="row-text">
        <span class="row-title">Keep offline data</span>
        <span class="row-desc">{persisted ? 'The browser will not evict lumi’s offline copies under storage pressure.' : 'Ask the browser not to evict offline copies when space runs low.'}</span>
      </div>
      {#if persisted}<span class="value ok">persistent</span>{:else}<button class="ui-btn sm" type="button" onclick={() => void requestPersist()}>Make persistent</button>{/if}
    </div>
    {#if books.active}
      <div class="row">
        <div class="row-text"><span class="row-title">Pending in {books.active.name}</span><span class="row-desc">Notes edited offline that have not reached the server yet.</span></div>
        <span class="value">{pendingHere}</span>
      </div>
    {/if}
  {/if}
  {#if show('conflicts')}
    <div class="row">
      <div class="row-text"><span class="row-title">Conflict copies</span><span class="row-desc">Local text that could not be merged (note deleted, another version). Never merged silently.</span></div>
      <span class="row-ctl">
        <span class="value">{offline.conflicts.length}</span>
        <button class="ui-btn sm" type="button" disabled={offline.conflicts.length === 0} onclick={exportConflicts}>Download all</button>
      </span>
    </div>
  {/if}
</section>
