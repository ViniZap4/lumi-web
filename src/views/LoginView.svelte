<script lang="ts">
  // Sign-in / sign-up / invite, now per SERVER (SPEC-LIVROS §5 "Adicionar
  // servidor"). Used full-screen when there is no account on this
  // device, and embedded in a modal for "Adicionar servidor…" and for
  // re-entering an account that "Precisa entrar".
  import { onMount, untrack } from 'svelte';
  import { auth, type ProbeResult } from '../lib/auth.svelte.ts';
  import { vaults } from '../lib/vaults.svelte.ts';
  import { DEFAULT_SERVER_URL } from '../lib/api.ts';
  import { isInsecure, serverLabel } from '../lib/serverurl.ts';

  interface Props {
    embedded?: boolean;
    presetServer?: string | null;
    presetUsername?: string | null;
    ondone?: (accountKey: string) => void;
    oncancel?: () => void;
  }
  const { embedded = false, presetServer = null, presetUsername = null, ondone, oncancel }: Props = $props();

  type Mode = 'signin' | 'signup';
  let mode = $state<Mode>('signin');

  function initialServer(): string {
    if (presetServer) return presetServer;
    if (DEFAULT_SERVER_URL) return DEFAULT_SERVER_URL;
    try {
      return location.origin;
    } catch {
      return '';
    }
  }

  let serverInput = $state(initialServer());
  let probe = $state<ProbeResult | null>(null);
  let probedFor = $state<string | null>(null);
  let probing = $state(false);
  // Initial value only (the modal remounts per account).
  let username = $state(untrack(() => presetUsername ?? ''));
  let password = $state('');
  let displayName = $state('');
  let tosVersion = $state('');
  let privacyVersion = $state('');
  let consentAccepted = $state(false);
  // Owner decision 22/11/2026: unchecked by default (token only in
  // this tab). Checked → IndexedDB, sealed with the device key.
  let remember = $state(false);
  let submitting = $state(false);
  let httpWarningHidden = $state(false);

  // Tunable: the consent fields show only when the user types a value
  // OR the server told us they're required.
  let showConsent = $state(false);

  // Invite acceptance: read ?invite=<token> off the URL on mount.
  let inviteToken = $state<string | null>(null);

  onMount(() => {
    auth.lastError = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('invite');
      if (t && t.trim()) {
        inviteToken = t.trim();
        mode = 'signup';
      }
    } catch {
      // ignore — non-browser env or weird URL
    }
  });

  function clearInviteFromURL(): void {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('invite');
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore
    }
  }

  const HTTP_WARN_KEY = (u: string) => `lumi.httpWarningHidden.${u}`;

  async function runProbe(): Promise<ProbeResult> {
    const input = serverInput.trim();
    if (probe && probedFor === input) return probe;
    probing = true;
    try {
      const r = await auth.probeServer(input);
      probe = r;
      probedFor = input;
      if (r.ok) {
        try {
          httpWarningHidden = localStorage.getItem(HTTP_WARN_KEY(r.serverUrl)) === '1';
        } catch {
          httpWarningHidden = false;
        }
      }
      return r;
    } finally {
      probing = false;
    }
  }

  function hideHttpWarning(): void {
    if (!probe?.ok) return;
    httpWarningHidden = true;
    try {
      localStorage.setItem(HTTP_WARN_KEY(probe.serverUrl), '1');
    } catch {
      // ignore
    }
  }

  async function onSubmit(e: Event): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    submitting = true;
    auth.lastError = null;
    try {
      const p = await runProbe();
      if (!p.ok) return;
      const serverUrl = p.serverUrl;
      const publicKey = p.info?.public_key ?? null;
      const signupBody = {
        serverUrl,
        remember,
        publicKey,
        username: username.trim(),
        password,
        display_name: displayName.trim() || username.trim(),
        consent:
          tosVersion && privacyVersion && consentAccepted
            ? {
                tos_version: tosVersion,
                privacy_version: privacyVersion,
                accepted_at: new Date().toISOString(),
              }
            : undefined,
      };

      if (inviteToken) {
        // Invite flow — either consume during signup, or sign in and
        // then redeem against the same token. Either way we end up
        // joined to the invite's vault, so refresh and open it.
        let joinedVaultID: string;
        let key: string;
        if (mode === 'signup') {
          const r = await auth.signUpViaInvite(inviteToken, signupBody);
          joinedVaultID = r.vaultID;
          key = r.accountKey;
        } else {
          key = await auth.signIn({ serverUrl, username: username.trim(), password, remember, publicKey });
          const r = await auth.acceptInvite(inviteToken, key);
          joinedVaultID = r.vaultID;
        }
        clearInviteFromURL();
        inviteToken = null;
        await vaults.load();
        vaults.select(joinedVaultID);
        ondone?.(key);
        return;
      }

      const key =
        mode === 'signin'
          ? await auth.signIn({ serverUrl, username: username.trim(), password, remember, publicKey })
          : await auth.signUp(signupBody);
      password = '';
      ondone?.(key);
    } catch {
      // auth.lastError is already populated; nothing to do.
    } finally {
      submitting = false;
    }
  }

  function setMode(m: Mode): void {
    mode = m;
    auth.lastError = null;
  }
</script>

<div class="login-view" class:embedded>
  {#if !embedded}
    <div class="brand">lumi</div>
    <div class="subtitle">collaborative markdown vaults</div>
  {:else}
    <h2 class="embedded-title">{presetUsername ? 'Entrar' : 'Adicionar servidor'}</h2>
  {/if}

  {#if inviteToken}
    <div class="invite-banner">
      You've been invited to a vault. Pick <strong>Create account</strong> if you're
      new here, or <strong>Sign in</strong> if you already have an account on this
      server — either way you'll join the vault on submit.
    </div>
  {/if}

  <div class="mode-tabs" role="tablist">
    <button
      class="mode-tab"
      class:active={mode === 'signin'}
      onclick={() => setMode('signin')}
      type="button"
    >Sign in</button>
    <button
      class="mode-tab"
      class:active={mode === 'signup'}
      onclick={() => setMode('signup')}
      type="button"
    >Create account</button>
  </div>

  <form class="login-form" onsubmit={onSubmit}>
    <label class="field-label" for="lumi-server-url">servidor</label>
    <input
      id="lumi-server-url"
      type="url"
      class="login-input"
      placeholder="https://lumi.exemplo.com"
      autocomplete="url"
      inputmode="url"
      bind:value={serverInput}
      onblur={() => { if (serverInput.trim()) void runProbe(); }}
      oninput={() => { probe = null; probedFor = null; }}
      disabled={submitting || !!presetServer}
      required
    />
    {#if probing}
      <div class="server-note">verificando servidor…</div>
    {:else if probe && !probe.ok}
      <div class="login-error" role="alert">{probe.error}</div>
    {:else if probe && probe.ok}
      <div class="server-note" data-testid="server-info">
        {#if probe.info?.name}{probe.info.name}{:else}{serverLabel(probe.serverUrl)}{/if}
        {#if probe.info?.version} · v{probe.info.version}{/if}
        {#if !probe.info} · versão sem /api/info (sem sincronização ao vivo da lista){/if}
      </div>
      {#if probe.warning}<div class="server-warn">{probe.warning}</div>{/if}
      {#if isInsecure(probe.serverUrl) && !httpWarningHidden}
        <div class="server-warn" role="note">
          Conexão sem criptografia (http://). Use só em rede local confiável.
          <button type="button" class="link-button" onclick={hideHttpWarning}>ocultar</button>
        </div>
      {/if}
    {/if}

    <input
      type="text"
      class="login-input"
      placeholder="Username"
      autocomplete="username"
      bind:value={username}
      disabled={submitting}
      required
    />
    {#if mode === 'signup'}
      <input
        type="text"
        class="login-input"
        placeholder="Display name (optional)"
        autocomplete="name"
        bind:value={displayName}
        disabled={submitting}
      />
    {/if}
    <input
      type="password"
      class="login-input"
      placeholder="Password"
      autocomplete={mode === 'signin' ? 'current-password' : 'new-password'}
      bind:value={password}
      disabled={submitting}
      required
    />

    {#if mode === 'signup'}
      <button
        type="button"
        class="link-button"
        onclick={() => (showConsent = !showConsent)}
      >
        {showConsent ? 'Hide' : 'Show'} consent options
      </button>
      {#if showConsent}
        <input
          type="text"
          class="login-input"
          placeholder="ToS version (from operator)"
          bind:value={tosVersion}
          disabled={submitting}
        />
        <input
          type="text"
          class="login-input"
          placeholder="Privacy version (from operator)"
          bind:value={privacyVersion}
          disabled={submitting}
        />
        <label class="consent">
          <input type="checkbox" bind:checked={consentAccepted} disabled={submitting} />
          I accept the Terms of Service and Privacy Policy.
        </label>
      {/if}
    {/if}

    <label class="consent remember">
      <input type="checkbox" bind:checked={remember} disabled={submitting} />
      Lembrar neste aparelho
    </label>
    <div class="remember-hint">
      {remember
        ? 'A sessão fica guardada neste navegador, cifrada com uma chave que não sai dele.'
        : 'A sessão vale só nesta aba e some ao fechá-la.'}
    </div>

    {#if auth.lastError}
      <div class="login-error">{auth.lastError}</div>
    {/if}

    <button class="primary-button" type="submit" disabled={submitting}>
      {#if submitting}
        …
      {:else if inviteToken && mode === 'signup'}
        Create account &amp; join vault
      {:else if inviteToken && mode === 'signin'}
        Sign in &amp; join vault
      {:else if mode === 'signin'}
        Sign in
      {:else}
        Create account
      {/if}
    </button>
    {#if oncancel}
      <button class="link-button cancel" type="button" onclick={oncancel}>Cancelar</button>
    {/if}
  </form>
</div>

<style>
  .login-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: var(--color-background);
    color: var(--color-text);
    padding: 2rem;
    box-sizing: border-box;
  }

  .login-view.embedded {
    min-height: 0;
    padding: 1.25rem;
  }
  .embedded-title {
    margin: 0 0 1rem;
    font-size: 1rem;
    font-weight: 600;
  }
  .field-label {
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.78rem;
    margin-bottom: -0.4rem;
  }
  .server-note {
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.8rem;
  }
  .server-warn {
    color: var(--color-warning, var(--color-secondary));
    font-size: 0.8rem;
  }
  .remember-hint {
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.75rem;
    margin-top: -0.4rem;
  }
  .cancel {
    align-self: center;
  }

  .brand {
    font-size: 2.5rem;
    font-weight: 700;
    color: var(--color-primary);
    margin-bottom: 0.25rem;
  }

  .subtitle {
    color: var(--color-text-dim, var(--color-muted));
    margin-bottom: 2rem;
    font-size: 0.95rem;
  }

  .mode-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .mode-tab {
    background: transparent;
    border: 1px solid var(--color-border, var(--color-muted));
    color: var(--color-text-dim, var(--color-muted));
    padding: 0.4rem 0.9rem;
    font-family: inherit;
    font-size: 0.9rem;
    border-radius: 4px;
    cursor: pointer;
  }

  .mode-tab:hover {
    border-color: var(--color-secondary);
  }

  .mode-tab.active {
    background: var(--color-selected-bg, var(--color-overlay-bg));
    color: var(--color-text);
    border-color: var(--color-primary);
  }

  .login-form {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
    width: 100%;
    max-width: 320px;
  }

  .login-input {
    padding: 0.6rem 0.8rem;
    background: var(--color-overlay-bg, var(--color-background));
    border: 1px solid var(--color-border, var(--color-muted));
    border-radius: 4px;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.95rem;
    outline: none;
  }

  .login-input:focus {
    border-color: var(--color-secondary);
  }

  .primary-button {
    margin-top: 0.5rem;
    padding: 0.65rem;
    background: var(--color-primary);
    border: none;
    border-radius: 4px;
    color: var(--color-background);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }

  .primary-button:disabled {
    opacity: 0.5;
    cursor: progress;
  }

  .link-button {
    background: transparent;
    border: none;
    color: var(--color-secondary);
    font-family: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    align-self: flex-start;
    padding: 0;
  }

  .consent {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    color: var(--color-text-dim, var(--color-muted));
    font-size: 0.85rem;
  }

  .login-error {
    color: var(--color-error);
    font-size: 0.85rem;
    text-align: center;
  }

  .invite-banner {
    max-width: 360px;
    margin: 0 0 1rem;
    padding: 0.75rem 0.9rem;
    background: var(--color-overlay-bg, var(--color-background));
    border: 1px solid var(--color-primary);
    border-radius: 6px;
    color: var(--color-text);
    font-size: 0.85rem;
    line-height: 1.45;
    text-align: center;
  }
</style>
