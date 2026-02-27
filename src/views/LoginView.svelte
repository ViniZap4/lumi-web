<script>
  import { store } from '../lib/store.svelte.js';

  let password = $state('');
  let errorMsg = $state('');
  let loading = $state(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password.trim() || loading) return;
    loading = true;
    errorMsg = '';
    try {
      await store.login(password);
    } catch {
      errorMsg = 'Invalid password';
      password = '';
    } finally {
      loading = false;
    }
  }
</script>

<div class="login-view">
  <div class="logo">
    {#each store.logoLines as line, i}
      <div class="logo-line" style="color: var(--color-logo-{i})">{line}</div>
    {/each}
  </div>
  <div class="subtitle">Local-first Markdown notes</div>
  <form class="login-form" onsubmit={handleSubmit}>
    <input
      type="password"
      class="login-input"
      placeholder="Password"
      bind:value={password}
      disabled={loading}
      autofocus
    />
    {#if errorMsg}
      <div class="login-error">{errorMsg}</div>
    {/if}
    <div class="login-hint">Press <span class="key-hint">Enter</span> to log in</div>
  </form>
</div>

<style>
  .login-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    width: 100vw;
    background: var(--color-background);
    color: var(--color-text);
  }

  .logo {
    font-size: 0.75rem;
    line-height: 1.2;
    font-weight: bold;
    white-space: pre;
    margin-bottom: 2rem;
  }

  .subtitle {
    color: var(--color-muted);
    margin-bottom: 3rem;
  }

  .login-form {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    width: 100%;
    max-width: 300px;
  }

  .login-input {
    width: 100%;
    padding: 0.6rem 0.8rem;
    background: var(--color-surface, var(--color-background));
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

  .login-error {
    color: var(--color-error, #f7768e);
    font-size: 0.85rem;
  }

  .login-hint {
    color: var(--color-muted);
    font-size: 0.85rem;
  }

  .key-hint {
    color: var(--color-secondary);
    font-weight: 700;
  }
</style>
