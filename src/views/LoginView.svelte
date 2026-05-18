<script lang="ts">
  import { auth } from '../lib/auth.svelte.ts';

  type Mode = 'signin' | 'signup';
  let mode = $state<Mode>('signin');

  let username = $state('');
  let password = $state('');
  let displayName = $state('');
  let tosVersion = $state('');
  let privacyVersion = $state('');
  let consentAccepted = $state(false);
  let submitting = $state(false);

  // Tunable: the consent fields show only when the user types a value
  // OR the server told us they're required. For the initial slice we
  // surface them as advanced — server only enforces them when its
  // LUMI_TOS_VERSION / LUMI_PRIVACY_VERSION envs are set.
  let showConsent = $state(false);

  async function onSubmit(e: Event): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    submitting = true;
    try {
      if (mode === 'signin') {
        await auth.signIn(username.trim(), password);
      } else {
        await auth.signUp({
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
        });
      }
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

<div class="login-view">
  <div class="brand">lumi</div>
  <div class="subtitle">collaborative markdown vaults</div>

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

    {#if auth.lastError}
      <div class="login-error">{auth.lastError}</div>
    {/if}

    <button class="primary-button" type="submit" disabled={submitting}>
      {submitting ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
    </button>
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
</style>
