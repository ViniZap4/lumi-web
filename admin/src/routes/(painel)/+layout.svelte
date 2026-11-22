<script lang="ts">
	import { enhance } from '$app/forms';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon, { type IconName } from '#lib/components/Icon.svelte';
	import Toaster from '#lib/components/Toaster.svelte';
	import { daysUntil } from '#lib/format.ts';
	import { GoShortcut, SECTIONS, isCurrent, isTyping } from '#lib/nav.ts';
	import type { ThemeChoice } from '#lib/theme.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const go = new GoShortcut();
	const days = $derived(data.token ? daysUntil(new Date(data.token.expiresAt).toISOString()) : 0);
	let drawer: HTMLDialogElement | undefined = $state();
	// svelte-ignore state_referenced_locally
	let theme = $state<ThemeChoice>(data.theme);

	const themes: { value: ThemeChoice; label: string; icon: IconName }[] = [
		{ value: 'auto', label: 'Seguir o sistema', icon: 'monitor' },
		{ value: 'light', label: 'Claro', icon: 'sun' },
		{ value: 'dark', label: 'Escuro', icon: 'moon' }
	];

	function onkeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || isTyping(e.target)) return;
		const href = go.press(e.key, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
		if (href) {
			e.preventDefault();
			void goto(href);
		}
	}

	afterNavigate(() => drawer?.close());
</script>

<svelte:window {onkeydown} />

<a class="skip" href="#conteudo">Pular para o conteúdo</a>

{#snippet brand()}
	<a class="brand" href="/">
		<span class="logo" aria-hidden="true">◆</span>
		<span class="brand-text"><strong>lumi</strong><small>administração</small></span>
	</a>
{/snippet}

{#snippet sidebar()}
	<nav aria-label="Seções" class="nav">
		{#each SECTIONS as section, i (i)}
			<div class="section">
				{#if section.title}<p class="section-title">{section.title}</p>{/if}
				<ul>
					{#each section.items as item (item.href)}
						<li>
							<a
								href={item.href}
								aria-current={isCurrent(item.href, page.url.pathname) ? 'page' : undefined}
								aria-keyshortcuts="g {item.key}"
							>
								<Icon name={item.icon} size={18} />
								<span class="label">{item.label}</span>
								<kbd aria-hidden="true">g {item.key}</kbd>
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</nav>
	<div class="foot">
		<form
			method="POST"
			action="/tema"
			class="themes"
			aria-label="Tema"
			use:enhance={({ formData }) => {
				const chosen = formData.get('tema');
				if (chosen === 'auto' || chosen === 'light' || chosen === 'dark') {
					theme = chosen;
					document.documentElement.dataset.theme = chosen;
				}
				// The cookie is set; staying on the page is the point.
				return async () => {};
			}}
		>
			<input type="hidden" name="voltar" value={page.url.pathname} />
			{#each themes as t (t.value)}
				<button type="submit" name="tema" value={t.value} aria-pressed={theme === t.value} title={t.label}>
					<Icon name={t.icon} size={16} />
					<span class="sr-only">{t.label}</span>
				</button>
			{/each}
		</form>
		{#if data.token}
			<div class="account">
				<span class="key"><Icon name="key" size={16} /></span>
				<span class="meta">
					<strong title={data.token.name}>{data.token.name}</strong>
					<small class:warn={days < 7}>token · expira em {days} {days === 1 ? 'dia' : 'dias'}</small>
				</span>
				<form method="POST" action="/sair" use:enhance>
					<button class="logout" type="submit" title="Sair do painel">
						<Icon name="logout" size={17} />
						<span class="sr-only">Sair</span>
					</button>
				</form>
			</div>
		{/if}
	</div>
{/snippet}

<div class="shell">
	<aside class="rail">
		{@render brand()}
		{@render sidebar()}
	</aside>

	<header class="topbar">
		{@render brand()}
		<button class="btn ghost" type="button" aria-haspopup="dialog" onclick={() => drawer?.showModal()}>
			<Icon name="menu" size={20} />
			<span class="sr-only">Abrir menu</span>
		</button>
	</header>

	<main id="conteudo" tabindex="-1">
		{#key page.url.pathname}
			<div class="enter">{@render children()}</div>
		{/key}
	</main>
</div>

<dialog bind:this={drawer} class="drawer" aria-label="Menu">
	<div class="drawer-head">
		{@render brand()}
		<button class="btn ghost" type="button" onclick={() => drawer?.close()}>
			<Icon name="x" size={20} />
			<span class="sr-only">Fechar menu</span>
		</button>
	</div>
	{@render sidebar()}
</dialog>

<Toaster />

<style>
	.skip {
		position: absolute;
		left: -999px;
		top: 0.5rem;
		z-index: 60;
		padding: 0.4rem 0.8rem;
		background: var(--color-primary);
		color: var(--color-on-primary);
	}
	.skip:focus {
		left: 0.5rem;
	}
	.shell {
		display: grid;
		grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
		min-height: 100vh;
	}
	.rail {
		position: sticky;
		top: 0;
		height: 100vh;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 1.1rem 0.85rem;
		border-right: 1px solid var(--color-border);
		background: var(--color-surface);
		overflow-y: auto;
	}
	.topbar {
		display: none;
	}
	.brand {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		padding: 0 0.4rem;
		color: var(--color-text);
		text-decoration: none;
	}
	.logo {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 9px;
		background: linear-gradient(135deg, var(--color-primary), var(--color-secondary));
		color: var(--color-on-primary);
		font-size: 0.95rem;
	}
	.brand-text {
		display: flex;
		flex-direction: column;
		line-height: 1.15;
	}
	.brand-text strong {
		font-family: var(--font-mono);
		font-size: 1.05rem;
	}
	.brand-text small {
		font-size: 0.75rem;
		color: var(--color-text-dim);
	}
	.nav {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.section-title {
		margin: 0 0 0.3rem;
		padding: 0 0.6rem;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-dim);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.nav a {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.6rem;
		border-radius: var(--radius-sm);
		color: var(--color-text-2);
		font-weight: 550;
		text-decoration: none;
	}
	.nav a:hover {
		background: var(--color-selected-bg);
		color: var(--color-text);
	}
	.nav a[aria-current='page'] {
		background: var(--soft-primary);
		color: var(--color-primary);
	}
	.label {
		flex: 1;
	}
	kbd {
		font-size: 0.7rem;
		color: var(--color-text-dim);
		opacity: 0;
		transition: opacity 120ms ease;
	}
	.nav a:hover kbd,
	.nav a:focus-visible kbd {
		opacity: 1;
	}
	.foot {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.themes {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 2px;
		padding: 3px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-background);
	}
	.themes button {
		display: grid;
		place-items: center;
		height: 28px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-dim);
		cursor: pointer;
	}
	.themes button:hover {
		color: var(--color-text);
	}
	.themes button[aria-pressed='true'] {
		background: var(--color-surface-2);
		color: var(--color-primary);
		box-shadow: var(--shadow-1);
	}
	.account {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-2);
		min-width: 0;
	}
	.key {
		display: grid;
		place-items: center;
		flex: none;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		background: var(--soft-warning);
		color: var(--color-warning);
	}
	.meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.meta strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.88rem;
	}
	.meta small {
		font-size: 0.74rem;
		color: var(--color-text-dim);
	}
	.meta small.warn {
		color: var(--color-warning);
	}
	.logout {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-dim);
		cursor: pointer;
	}
	.logout:hover {
		background: var(--soft-error);
		color: var(--color-error);
	}
	main {
		min-width: 0;
		width: 100%;
		max-width: 76rem;
		padding: 1.25rem 2rem 4rem;
	}
	main:focus {
		outline: none;
	}
	.enter {
		animation: enter 180ms ease-out both;
	}
	@keyframes enter {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
	.drawer {
		margin: 0;
		width: min(18rem, 86vw);
		height: 100dvh;
		max-height: none;
		padding: 1rem 0.85rem;
		border: 0;
		border-right: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		flex-direction: column;
		gap: 1.25rem;
	}
	.drawer[open] {
		display: flex;
		animation: drawer 180ms ease-out;
	}
	.drawer::backdrop {
		background: rgb(0 0 0 / 0.5);
	}
	.drawer-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	@keyframes drawer {
		from {
			transform: translateX(-100%);
		}
	}
	@media (max-width: 899px) {
		.shell {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto 1fr;
		}
		.rail {
			display: none;
		}
		.topbar {
			position: sticky;
			top: 0;
			z-index: 20;
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 0.6rem 1rem;
			border-bottom: 1px solid var(--color-border);
			background: color-mix(in srgb, var(--color-surface) 92%, transparent);
			backdrop-filter: blur(8px);
		}
		main {
			padding: 1rem 1rem 4rem;
		}
		kbd {
			display: none;
		}
	}
</style>
