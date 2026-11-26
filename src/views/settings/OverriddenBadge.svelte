<script lang="ts">
  // ".vimrc" next to a setting your .vimrc overrides while vim is on.
  import { editorSettings } from '../../lib/editor-settings.svelte.ts';
  import type { EditorSettings } from '../../lib/editor-settings.ts';
  import { effectiveSettings } from '../../lib/vim-config.ts';

  const { k }: { k: keyof EditorSettings } = $props();
  const over = $derived(effectiveSettings(editorSettings.value).overridden.includes(k));
</script>

{#if over}<span class="badge" title="Set by your .vimrc while vim is on">.vimrc</span>{/if}
