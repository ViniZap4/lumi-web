<script lang="ts">
  // Federation: links with other servers, federation invites (replica / mirror / publish) and federated members.
  import { vaultMembers } from '../../lib/vaultmembers.svelte.ts';
  import { federation } from '../../lib/federation.svelte.ts';
  import { federationRowView } from '../../lib/federation-view.ts';
  import { fmtDate, isFedInviteActive, fedInviteStateLabel } from './format.ts';
  import { publishConsentText, publishScope } from '../../lib/publish.ts';
  import type { VaultSettingsController } from './settings.svelte.ts';

  const { s }: { s: VaultSettingsController } = $props();
</script>

<div class="body" role="tabpanel" id="vs-panel-federation" aria-labelledby="vs-tab-federation">
  {#if federation.loading}
    <div class="placeholder">Loading…</div>
  {:else}
    {#if federation.lastError}<div class="error">{federation.lastError}</div>{/if}
    {#if s.fedRowError}<div class="error">{s.fedRowError}</div>{/if}

    <h3>Federated servers</h3>
    <p class="hint">
      Servers this vault syncs with. Every listed server holds a
      full plaintext replica of the vault’s content.
    </p>
    {#if federation.federations.length === 0}
      <div class="placeholder">This vault isn’t federated with any other server.</div>
    {:else}
      <ul class="rows">
        {#each federation.federations as f (f.id)}
          {@const fv = federationRowView(f)}
          <li tabindex="-1" class="row" class:inactive={f.status !== 'active'} data-testid="federation-row">
            <div class="row-main">
              <div class="name">
                <span class="badge fed-{f.role}">{fv.role}</span>
                <span class="badge">{fv.mode}</span>
                <span class="badge state-{f.status}">{fv.status}</span>
                {f.peer_url}
              </div>
              {#each fv.lines as line (line)}<div class="meta">{line}</div>{/each}
              <div class="meta">
                ligado em {fmtDate(f.created_at)}{#if f.revoked_at} · revogado em {fmtDate(f.revoked_at)}{/if}
              </div>
              {#if fv.warning}<div class="error" role="alert" data-testid="erasure-lagging">{fv.warning}</div>{/if}
            </div>
            <div class="row-actions">
              {#if s.canFederate && f.status === 'active'}
                <button
                  class="link danger"
                  type="button"
                  onclick={() => (s.pendingRevokeFederation = f)}
                >Revoke…</button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <h3 class="fed-section">Federation invites</h3>
    {#if !s.canFederate}
      <p class="hint">
        You don’t have permission to manage federation for this
        vault (requires <code>vault.federate</code>).
      </p>
    {:else}
      <p class="hint">
        Inviting another server federates this vault: the other
        operator’s server will store all of this vault’s content
        <strong>in plaintext on their infrastructure</strong> and
        keeps its copy even if you later revoke the link. Only
        federate with operators you trust.
      </p>
      <div class="invite-bar">
        <button class="primary" type="button" onclick={s.openFedInviteForm}>+ New federation invite</button>
        {#if s.lastFedInviteToken}
          <div class="created-row">
            <input class="select" readonly value={s.lastFedInviteToken} />
            <button class="link" type="button" onclick={() => s.copyFedToken(s.lastFedInviteToken!)}>
              {Date.now() - s.fedTokenCopiedAt < 2000 ? 'Copied!' : 'Copy'}
            </button>
          </div>
        {/if}
      </div>
      {#if s.lastFedInviteToken}
        <p class="hint token-once">
          This token is shown only once — hand it to the other
          operator out-of-band. Anyone who redeems it gets a full
          plaintext replica of this vault.
        </p>
      {/if}

      {#if s.fedInviteOpen}
        <form class="create-form" onsubmit={s.submitFedInvite}>
          <label>
            Follower server URL (optional — pins the invite to one server)
            <input
              class="input"
              type="url"
              placeholder="https://other-server.example"
              bind:value={s.fedInviteServerHint}
              disabled={s.fedInviteSubmitting}
            />
          </label>
          <fieldset class="fed-mode">
            <legend>Tipo de vínculo</legend>
            <label class="inline"><input type="radio" name="fed-mode" value="replica" bind:group={s.fedInviteMode} disabled={s.fedInviteSubmitting} /> Réplica (os dois servidores editam)</label>
            <label class="inline"><input type="radio" name="fed-mode" value="mirror" bind:group={s.fedInviteMode} disabled={s.fedInviteSubmitting} data-testid="fed-mode-mirror" /> Espelho somente leitura (só esta origem envia)</label>
          </fieldset>
          {#if s.fedInviteMode === 'mirror'}
            <fieldset class="fed-publish" data-testid="fed-publish">
              <legend>Publicação</legend>
              {#if !s.canManageVault}
                <p class="hint">Publicar exige também a permissão <code>vault.manage</code>.</p>
              {:else}
                <label class="inline"><input type="checkbox" bind:checked={s.fedPublish} disabled={s.fedInviteSubmitting} data-testid="fed-publish-allow" /> Permitir que o espelho publique notas para leitura pública</label>
                {#if s.fedPublish}
                  <label class="inline"><input type="radio" name="fed-scope" value="flagged" bind:group={s.fedPublishScope} /> Só as notas marcadas com “Publicar”</label>
                  <label class="inline"><input type="radio" name="fed-scope" value="all" bind:group={s.fedPublishScope} /> Todas as notas do livro</label>
                  <label class="inline"><input type="radio" name="fed-scope" value="folder" bind:group={s.fedPublishScope} /> Uma pasta:
                    <input class="input sm" type="text" placeholder="blog/" bind:value={s.fedPublishFolder} disabled={s.fedPublishScope !== 'folder'} aria-label="Pasta a publicar" /></label>
                  <label class="inline"><input type="checkbox" bind:checked={s.fedPublishIndex} data-testid="fed-publish-index" /> Permitir indexação por buscadores (Google etc.)</label>
                  <p class="consent-text" data-testid="fed-publish-consent-text">{publishConsentText(publishScope(s.fedPublishScope, s.fedPublishFolder) ?? 'flagged', s.fedPublishIndex)}</p>
                  <label class="inline consent"><input type="checkbox" bind:checked={s.fedPublishConsent} data-testid="fed-publish-consent" /> Entendo e autorizo a publicação</label>
                {/if}
              {/if}
            </fieldset>
          {/if}
          <label>
            Expires at (optional)
            <input
              class="input"
              type="datetime-local"
              bind:value={s.fedInviteExpiresAt}
              disabled={s.fedInviteSubmitting}
            />
          </label>
          {#if s.fedInviteError}<div class="error">{s.fedInviteError}</div>{/if}
          <div class="form-actions">
            <button class="primary" type="submit" disabled={s.fedInviteSubmitting}>
              {s.fedInviteSubmitting ? '…' : 'Create federation invite'}
            </button>
            <button class="link" type="button" onclick={s.closeFedInviteForm} disabled={s.fedInviteSubmitting}>
              Cancel
            </button>
          </div>
        </form>
      {/if}

      {#if federation.invites.length === 0}
        <div class="placeholder">No federation invites yet.</div>
      {:else}
        <ul class="rows">
          {#each federation.invites as inv (inv.token)}
            <li tabindex="-1" class="row" class:inactive={!isFedInviteActive(inv)}>
              <div class="row-main">
                <div class="name">
                  <span class="badge state-{fedInviteStateLabel(inv)}">{fedInviteStateLabel(inv)}</span>
                  {inv.server_url_hint || '(any server)'}
                </div>
                <div class="meta">
                  created {fmtDate(inv.created_at)} · expires {fmtDate(inv.expires_at)}
                </div>
              </div>
              <div class="row-actions">
                {#if isFedInviteActive(inv)}
                  <button class="link danger" type="button" onclick={() => s.onRevokeFedInvite(inv)}>Revoke</button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}

    <h3 class="fed-section">Federated members</h3>
    <p class="hint">
      Users from federated servers with a role in this vault.
      Membership is authored here — on the vault’s home server.
    </p>
    {#if s.canManageMembers}
      <form class="create-form" onsubmit={s.submitFedMember}>
        <div class="form-row two">
          <label>
            Member key
            <input
              class="input"
              type="text"
              placeholder="username@https://server"
              bind:value={s.fedMemberKey}
              disabled={s.fedMemberSubmitting}
            />
          </label>
          <label>
            Role
            <select class="select" bind:value={s.fedMemberRoleID} disabled={s.fedMemberSubmitting}>
              {#each vaultMembers.roles as r (r.id)}
                <option value={r.id}>{r.name}</option>
              {/each}
            </select>
          </label>
        </div>
        {#if s.fedMemberError}<div class="error">{s.fedMemberError}</div>{/if}
        <div class="form-actions">
          <button
            class="primary"
            type="submit"
            disabled={s.fedMemberSubmitting || !s.fedMemberKey.trim() || !s.fedMemberRoleID}
          >{s.fedMemberSubmitting ? '…' : 'Add federated member'}</button>
        </div>
      </form>
    {/if}
    {#if federation.members.length === 0}
      <div class="placeholder">No federated members.</div>
    {:else}
      <ul class="rows">
        {#each federation.members as m (m.member_key)}
          <li tabindex="-1" class="row">
            <div class="row-main">
              <div class="name">{m.member_key}</div>
              <div class="meta">joined {fmtDate(m.joined_at)}</div>
            </div>
            <div class="row-actions">
              {#if s.canManageMembers && vaultMembers.roles.length > 0}
                <select
                  class="select"
                  value={m.role_id}
                  onchange={(e) => s.onChangeFedMemberRole(m, e)}
                  aria-label="Role"
                >
                  {#each vaultMembers.roles as r (r.id)}
                    <option value={r.id}>{r.name}</option>
                  {/each}
                </select>
                <button
                  class="link danger"
                  type="button"
                  onclick={() => (s.pendingRemoveFedMember = m)}
                >Remove</button>
              {:else}
                <span class="role-readonly">{m.role_name}</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
