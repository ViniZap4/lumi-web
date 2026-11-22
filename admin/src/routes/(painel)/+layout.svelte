<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { flash, clearFlash } from '#lib/flash.svelte.ts';
	import { daysUntil } from '#lib/format.ts';
	import { GoShortcut, NAV, isCurrent, isTyping } from '#lib/nav.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const go = new GoShortcut();
	const days = $derived(data.token ? daysUntil(new Date(data.token.expiresAt).toISOString()) : 0);

	function onkeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || isTyping(e.target)) return;
		const href = go.press(e.key, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
		if (href) {
			e.preventDefault();
			void goto(href);
		}
	}

	// A new page starts without the previous page's message.
	$effect(() => {
		void page.url.pathname;
		clearFlash();
	});
</script>

<svelte:window {onkeydown} />

<a class="skip" href="#conteudo">Pular para o conteúdo</a>

<div class="shell">
	<aside class="side">
		<a class="brand" href="/">
			<span class="logo" aria-hidden="true">◆</span>
			<span><strong>lumi</strong> <small>administração</small></span>
		</a>
		<nav aria-label="Seções">
			<ul>
				{#each NAV as item (item.href)}
					<li>
						<a
							href={item.href}
							aria-current={isCurrent(item.href, page.url.pathname) ? 'page' : undefined}
							aria-keyshortcuts="g {item.key}"
						>
							<span>{item.label}</span>
							<kbd aria-hidden="true">g {item.key}</kbd>
						</a>
					</li>
				{/each}
			</ul>
		</nav>
		{#if data.token}
			<div class="account">
				<span class="muted">token</span>
				<strong title={data.token.name}>{data.token.name}</strong>
				<small class:warn={days < 7}>expira em {days} {days === 1 ? 'dia' : 'dias'}</small>
				<form method="POST" action="/sair" use:enhance>
					<button class="btn small ghost" type="submit">Sair</button>
				</form>
			</div>
		{/if}
	</aside>
	<main id="conteudo" tabindex="-1">
		<div class="live" role="status" aria-live="polite">
			{#if flash.message}
				{#key flash.seq}
					<p class="banner {flash.tone}">{flash.message}</p>
				{/key}
			{/if}
		</div>
		{@render children()}
	</main>
</div>

<style>
	.skip {
		position: absolute;
		left: -999px;
		top: 0.5rem;
		z-index: 10;
		padding: 0.4rem 0.8rem;
		background: var(--color-primary);
		color: var(--color-on-primary);
	}
	.skip:focus {
		left: 0.5rem;
	}
	.shell {
		display: grid;
		grid-template-columns: 15rem 1fr;
		min-height: 100vh;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		border-right: 1px solid var(--color-border);
		background: var(--color-overlay-bg);
		position: sticky;
		top: 0;
		height: 100vh;
	}
	.brand {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		color: var(--color-text);
		text-decoration: none;
	}
	.brand small {
		color: var(--color-text-dim);
	}
	.logo {
		color: var(--color-accent);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	nav a {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.35rem 0.6rem;
		border-radius: var(--radius);
		color: var(--color-text);
		text-decoration: none;
	}
	nav a:hover {
		background: var(--color-selected-bg);
	}
	nav a[aria-current='page'] {
		background: var(--color-selected-bg);
		color: var(--color-primary);
		font-weight: 600;
	}
	kbd {
		font: inherit;
		font-size: 0.75rem;
		color: var(--color-text-dim);
	}
	.account {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}
	.account .warn {
		color: var(--color-warning);
	}
	main {
		padding: 1.5rem;
		min-width: 0;
		max-width: 72rem;
	}
	main:focus {
		outline: none;
	}
	@media (max-width: 760px) {
		.shell {
			grid-template-columns: 1fr;
		}
		.side {
			position: static;
			height: auto;
			border-right: 0;
			border-bottom: 1px solid var(--color-border);
		}
		ul {
			flex-direction: row;
			flex-wrap: wrap;
		}
		kbd {
			display: none;
		}
		main {
			padding: 1rem;
		}
	}
</style>
