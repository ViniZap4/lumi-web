<script lang="ts">
  // Sign-in / sign-up / invite, now per SERVER (SPEC-LIVROS §5 "Adicionar
  // servidor"). Used full-screen when there is no account on this
  // device, and embedded in a modal for "Adicionar servidor…" and for
  // re-entering an account that "Precisa entrar".
  import { onMount, untrack, tick } from 'svelte';
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
    // Keyboard first: land on the first field that still needs input.
    void tick().then(() => {
      const ids = ['lumi-server-url', 'lumi-username', 'lumi-password'];
      for (const id of ids) {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el && !el.disabled && !el.value) {
          el.focus();
          return;
        }
      }
    });
  });

  /** ←/→ (and h/l) switch the Sign in / Create account tabs. */
  function onTabsKey(e: KeyboardEvent): void {
    const next = e.key === 'ArrowRight' || e.key === 'l';
    const prev = e.key === 'ArrowLeft' || e.key === 'h';
    if (!next && !prev) return;
    e.preventDefault();
    setMode(mode === 'signin' ? 'signup' : 'signin');
    void tick().then(() => document.getElementById(`login-tab-${mode}`)?.focus());
  }

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
  <div class="card">
    {#if !embedded}
      <header class="head">
        <span class="ui-wordmark brand"><span class="mark"></span>lumi</span>
        <p class="subtitle">Markdown notes, local-first, synced to your own server.</p>
      </header>
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

    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div class="ui-seg mode-tabs" role="tablist" aria-label="Account" onkeydown={onTabsKey}>
      <button
        class:active={mode === 'signin'}
        role="tab"
        id="login-tab-signin"
        tabindex={mode === 'signin' ? 0 : -1}
        aria-selected={mode === 'signin'}
        onclick={() => setMode('signin')}
        type="button"
      >Sign in</button>
      <button
        class:active={mode === 'signup'}
        role="tab"
        id="login-tab-signup"
        tabindex={mode === 'signup' ? 0 : -1}
        aria-selected={mode === 'signup'}
        onclick={() => setMode('signup')}
        type="button"
      >Create account</button>
    </div>

    <form class="login-form" onsubmit={onSubmit}>
      <div class="field">
        <label class="ui-label" for="lumi-server-url">Server</label>
        <input
          id="lumi-server-url"
          type="url"
          class="ui-input mono"
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
          <div class="server-note"><span class="dot pulse"></span>verificando servidor…</div>
        {:else if probe && !probe.ok}
          <div class="login-error" role="alert">{probe.error}</div>
        {:else if probe && probe.ok}
          <div class="server-note ok" data-testid="server-info">
            <span class="dot"></span>
            {#if probe.info?.name}{probe.info.name}{:else}{serverLabel(probe.serverUrl)}{/if}
            {#if probe.info?.version}<span class="ver">v{probe.info.version}</span>{/if}
            {#if !probe.info} · versão sem /api/info (sem sincronização ao vivo da lista){/if}
          </div>
          {#if probe.warning}<div class="server-warn">{probe.warning}</div>{/if}
          {#if isInsecure(probe.serverUrl) && !httpWarningHidden}
            <div class="server-warn" role="note">
              Conexão sem criptografia (http://). Use só em rede local confiável.
              <button type="button" class="ui-link" onclick={hideHttpWarning}>ocultar</button>
            </div>
          {/if}
        {/if}
      </div>

      <div class="field">
        <label class="ui-label" for="lumi-username">Username</label>
        <input
          id="lumi-username"
          type="text"
          class="ui-input"
          placeholder="Username"
          autocomplete="username"
          bind:value={username}
          disabled={submitting}
          required
        />
      </div>
      {#if mode === 'signup'}
        <div class="field">
          <label class="ui-label" for="lumi-display">Display name <span class="opt">optional</span></label>
          <input
            id="lumi-display"
            type="text"
            class="ui-input"
            placeholder="Display name (optional)"
            autocomplete="name"
            bind:value={displayName}
            disabled={submitting}
          />
        </div>
      {/if}
      <div class="field">
        <label class="ui-label" for="lumi-password">Password</label>
        <input
          id="lumi-password"
          type="password"
          class="ui-input"
          placeholder="Password"
          autocomplete={mode === 'signin' ? 'current-password' : 'new-password'}
          bind:value={password}
          disabled={submitting}
          required
        />
      </div>

      {#if mode === 'signup'}
        <button
          type="button"
          class="ui-link consent-toggle"
          aria-expanded={showConsent}
          onclick={() => (showConsent = !showConsent)}
        >
          {showConsent ? 'Hide' : 'Show'} consent options
        </button>
        {#if showConsent}
          <input
            type="text"
            class="ui-input"
            placeholder="ToS version (from operator)"
            aria-label="Terms of Service version"
            bind:value={tosVersion}
            disabled={submitting}
          />
          <input
            type="text"
            class="ui-input"
            placeholder="Privacy version (from operator)"
            aria-label="Privacy policy version"
            bind:value={privacyVersion}
            disabled={submitting}
          />
          <label class="consent">
            <input type="checkbox" bind:checked={consentAccepted} disabled={submitting} />
            I accept the Terms of Service and Privacy Policy.
          </label>
        {/if}
      {/if}

      <label class="remember">
        <input type="checkbox" class="ui-switch" bind:checked={remember} disabled={submitting} />
        <span>
          <span class="remember-title">Lembrar neste aparelho</span>
          <span class="remember-hint">
            {remember
              ? 'A sessão fica guardada neste navegador, cifrada com uma chave que não sai dele.'
              : 'A sessão vale só nesta aba e some ao fechá-la.'}
          </span>
        </span>
      </label>

      {#if auth.lastError}
        <div class="login-error" role="alert">{auth.lastError}</div>
      {/if}

      <button class="ui-btn primary submit" type="submit" disabled={submitting}>
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
        <button class="ui-btn ghost cancel" type="button" onclick={oncancel}>Cancelar</button>
      {/if}
    </form>
  </div>
  {#if !embedded}
    <footer class="foot">Your notes stay plain markdown files on your server.</footer>
  {/if}
</div>

<style>
  .login-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    min-height: 100dvh;
    padding: var(--sp-6) var(--sp-4);
    background:
      radial-gradient(60rem 30rem at 50% -10%, var(--tint-primary), transparent 70%),
      var(--color-background);
    color: var(--color-text);
    overflow-y: auto;
  }
  .login-view.embedded {
    min-height: 0;
    padding: var(--sp-5);
    background: none;
  }
  .card {
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    margin-bottom: var(--sp-2);
  }
  .brand { font-size: 22px; }
  .brand :global(.mark) { width: 18px; height: 18px; border-radius: 5px; }
  .subtitle {
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }
  .embedded-title {
    font-size: var(--text-lg);
    font-weight: 600;
  }
  .mode-tabs { align-self: stretch; }
  .mode-tabs button { flex: 1; }
  .login-form {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .opt { font-weight: 400; opacity: 0.7; }
  .mono { font-family: var(--font-mono); font-size: var(--text-sm); }
  .server-note {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text-dim);
    font-size: var(--text-xs);
  }
  .server-note .ver { font-family: var(--font-mono); opacity: 0.8; }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-text-dim);
    flex: none;
  }
  .server-note.ok .dot { background: var(--color-primary); }
  .pulse { animation: pulse 1s ease-in-out infinite alternate; }
  @keyframes pulse { to { opacity: 0.3; } }
  .server-warn {
    color: var(--color-warning);
    font-size: var(--text-xs);
  }
  .remember {
    display: flex;
    gap: var(--sp-3);
    align-items: flex-start;
    padding: var(--sp-3);
    border-radius: var(--radius);
    border: 1px solid var(--hairline);
    cursor: pointer;
  }
  .remember .ui-switch { margin-top: 2px; }
  .remember > span { display: flex; flex-direction: column; gap: 2px; }
  .remember-title { font-size: var(--text-sm); font-weight: 500; }
  .remember-hint {
    color: var(--color-text-dim);
    font-size: var(--text-xs);
  }
  .consent-toggle { align-self: flex-start; font-size: var(--text-xs); }
  .consent {
    display: flex;
    gap: var(--sp-2);
    align-items: center;
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }
  .submit { height: 36px; margin-top: var(--sp-1); font-size: var(--text-md); }
  .cancel { align-self: center; }
  .login-error {
    color: var(--color-error);
    font-size: var(--text-sm);
  }
  .invite-banner {
    padding: var(--sp-3);
    background: var(--tint-primary);
    border: 1px solid color-mix(in srgb, var(--color-primary) 35%, transparent);
    border-radius: var(--radius);
    font-size: var(--text-sm);
    line-height: 1.5;
  }
  .foot {
    margin-top: var(--sp-6);
    font-size: var(--text-xs);
    color: var(--color-text-dim);
  }
</style>
