<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pending = $state(false);
</script>

<svelte:head>
	<title>Entrar · lumi · Administração</title>
</svelte:head>

<main class="login">
	<h1><span class="logo" aria-hidden="true">◆</span> lumi · administração</h1>
	{#if data.reason}
		<p class="banner" role="status">{data.reason}</p>
	{/if}
	<form
		method="POST"
		class="card"
		use:enhance={() => {
			pending = true;
			return async ({ update }) => {
				pending = false;
				await update();
			};
		}}
	>
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
				aria-describedby="token-hint{form?.message ? ' token-error' : ''}"
				aria-invalid={form?.message ? 'true' : undefined}
			/>
			<span class="hint" id="token-hint">
				Criado só no terminal do servidor. O painel guarda o token na memória do servidor dele, nunca no
				navegador; a sessão dura até 12 horas.
			</span>
		</div>
		{#if form?.message}
			<p class="error" id="token-error" role="alert">{form.message}</p>
		{/if}
		<button class="btn primary" type="submit" disabled={pending} aria-busy={pending}>
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
</main>

<style>
	.login {
		max-width: 30rem;
		margin: 10vh auto 2rem;
		padding: 0 1rem;
	}
	.logo {
		color: var(--color-accent);
	}
	.error {
		color: var(--color-error);
	}
	summary {
		cursor: pointer;
		color: var(--color-secondary);
	}
	details[open] summary {
		margin-bottom: 0.5rem;
	}
</style>
