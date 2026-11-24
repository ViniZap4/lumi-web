<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pending = $state(false);
	// The tab is a link (?aba=), so it works without JavaScript; a failed login comes back on its own tab.
	const tab = $derived(form?.tab ?? data.tab);
	const userError = $derived(tab === 'usuario' && form?.message ? form.message : null);
	const tokenError = $derived(tab === 'token' && form?.message ? form.message : null);

	function submit() {
		pending = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			pending = false;
			await update();
		};
	}
</script>

<svelte:head>
	<title>Entrar · lumi · Administração</title>
</svelte:head>

<main class="login">
	<div class="brand">
		<span class="logo" aria-hidden="true">◆</span>
		<div>
			<h1>lumi</h1>
			<p class="muted">Administração do servidor</p>
		</div>
	</div>
	{#if data.reason}
		<p class="banner info" role="status">{data.reason}</p>
	{/if}
	<nav class="tabs" aria-label="Forma de entrar">
		<a href="?aba=usuario" aria-current={tab === 'usuario' ? 'page' : undefined} data-sveltekit-replacestate>Usuário</a>
		<a href="?aba=token" aria-current={tab === 'token' ? 'page' : undefined} data-sveltekit-replacestate>Token</a>
	</nav>
	{#if tab === 'usuario'}
		<form method="POST" action="?/usuario" class="card" use:enhance={submit}>
			<div class="field">
				<label for="username">Usuário</label>
				<input
					id="username"
					name="username"
					type="text"
					autocomplete="username"
					spellcheck="false"
					autocapitalize="off"
					maxlength="64"
					value={form?.tab === 'usuario' ? (form.username ?? '') : ''}
					required
					aria-invalid={userError ? 'true' : undefined}
				/>
			</div>
			<div class="field">
				<label for="password">Senha</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					maxlength="256"
					required
					aria-describedby="password-hint{userError ? ' login-error' : ''}"
					aria-invalid={userError ? 'true' : undefined}
				/>
				<span class="hint" id="password-hint">
					Sua conta do lumi, se ela for administradora do servidor. A sessão dura até 12 horas e “Sair” a
					encerra no servidor.
				</span>
			</div>
			{#if userError}
				<p class="error" id="login-error" role="alert">{userError}</p>
			{/if}
			<button class="btn primary wide" type="submit" disabled={pending} aria-busy={pending}>
				{pending ? 'Conferindo…' : 'Entrar'}
			</button>
		</form>
		<details class="card">
			<summary>Minha conta não entra</summary>
			<p>Só contas marcadas como administradoras do servidor entram aqui. No servidor (ZimaOS), na pasta do deploy:</p>
			<pre class="cmd">docker compose -p lumi-prod exec server /lumi-server admin grant &lt;usuário&gt;</pre>
			<p class="hint">
				O admin criado no primeiro boot (<code>LUMI_ADMIN_USERNAME</code>) já é administrador. Depois de 10 senhas
				erradas a conta fica bloqueada por um tempo; <code>user unlock &lt;usuário&gt;</code> libera.
			</p>
		</details>
	{:else}
		<form method="POST" action="?/token" class="card" use:enhance={submit}>
			<div class="field">
				<label for="token">Token de administração</label>
				<input
					id="token"
					name="token"
					type="password"
					autocomplete="off"
					spellcheck="false"
					autocapitalize="off"
					placeholder="lpa_…"
					required
					aria-describedby="token-hint{tokenError ? ' token-error' : ''}"
					aria-invalid={tokenError ? 'true' : undefined}
				/>
				<span class="hint" id="token-hint">
					Criado só no terminal do servidor. O painel guarda o token na memória do servidor dele, nunca no
					navegador; a sessão dura até 12 horas.
				</span>
			</div>
			{#if tokenError}
				<p class="error" id="token-error" role="alert">{tokenError}</p>
			{/if}
			<button class="btn primary wide" type="submit" disabled={pending} aria-busy={pending}>
				{pending ? 'Conferindo…' : 'Entrar'}
			</button>
		</form>
		<details class="card">
			<summary>Como conseguir um token</summary>
			<p>No servidor (ZimaOS), na pasta do deploy:</p>
			<pre class="cmd">docker compose -p lumi-prod exec server /lumi-server token create painel</pre>
			<p class="hint">
				O token aparece uma única vez. Padrão de 30 dias (<code>--ttl 7d</code> para menos). Liste e revogue com
				<code>token list</code> e <code>token revoke &lt;id&gt;</code>.
			</p>
		</details>
	{/if}
</main>

<style>
	.login {
		max-width: 28rem;
		margin: 12vh auto 2rem;
		padding: 0 1rem;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		margin-bottom: 1.5rem;
	}
	.brand h1 {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 1.6rem;
	}
	.brand p {
		margin: 0;
	}
	.logo {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		border-radius: 13px;
		background: linear-gradient(135deg, var(--color-primary), var(--color-secondary));
		color: var(--color-on-primary);
		font-size: 1.3rem;
		box-shadow: var(--shadow-2);
	}
	.card {
		padding: 1.4rem;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
		border-bottom: 1px solid var(--color-border);
	}
	.tabs a {
		padding: 0.5rem 0.9rem;
		color: var(--color-text-2);
		text-decoration: none;
		font-weight: 600;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	.tabs a[aria-current='page'] {
		color: var(--color-text);
		border-bottom-color: var(--color-primary);
	}
	.tabs a:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	.wide {
		width: 100%;
		min-height: 40px;
	}
	.error {
		color: var(--color-error);
	}
	summary {
		cursor: pointer;
		font-weight: 600;
		color: var(--color-text-2);
	}
	details[open] summary {
		margin-bottom: 0.5rem;
	}
</style>
