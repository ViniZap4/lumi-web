<script lang="ts">
  // Settings → Account: the accounts on this device and sign-in.
  import { accounts } from '../../lib/accounts.svelte.ts';
  import { books } from '../../lib/books.svelte.ts';
  import { uiState } from '../../lib/uistate.svelte.ts';
  import { serverLabel } from '../../lib/serverurl.ts';
  import type { ShowRow } from './form.ts';

  const { show }: { show: ShowRow } = $props();
  const close = () => uiState.closeSettings();
</script>

<section class="group" aria-labelledby="sec-account">
  <h2 id="sec-account">Account</h2>
  {#if show('accounts')}
    <ul class="accounts">
      {#each accounts.list as a (a.key)}
        <li>
          <span class="avatar" aria-hidden="true">{(a.display_name || a.username).slice(0, 1).toUpperCase()}</span>
          <span class="acct-main">
            <span class="acct-name">{a.display_name || a.username}</span>
            <span class="row-desc">{a.username} @ {serverLabel(a.server_url)}{a.remember ? ' · remembered' : ' · this tab only'}</span>
          </span>
          {#if a.status === 'needs_login'}
            <button class="ui-btn sm" type="button" onclick={() => uiState.openSignIn(a.server_url, a.username)}>Entrar</button>
          {:else}
            <span class="value ok">signed in</span>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="row">
      <div class="row-text"><span class="row-title">Books &amp; accounts</span><span class="row-desc">Add a server, sign out of this device (with an export of unsent text), manage books.</span></div>
      <span class="row-ctl">
        <button class="ui-btn sm" type="button" onclick={() => uiState.openAddServer()}>Add server</button>
        <button class="ui-btn sm" type="button" onclick={() => { close(); books.openPicker(); }}>Open books</button>
      </span>
    </div>
  {/if}
</section>
