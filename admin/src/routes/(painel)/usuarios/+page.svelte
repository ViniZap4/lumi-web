<script lang="ts">
	import Avatar from '#lib/components/Avatar.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import PasswordChoice from '#lib/components/PasswordChoice.svelte';
	import SecretDialog from '#lib/components/SecretDialog.svelte';
	import StatePill from '#lib/components/StatePill.svelte';
	import { formatDate, formatDateTime, formatInt, formatRelative } from '#lib/format.ts';
	import { passwordReady, usernameProblem } from '#lib/rules.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let creating = $state(false);
	let username = $state('');
	let displayName = $state('');
	let mode = $state<'gerar' | 'definir'>('gerar');
	let password = $state('');
	let repeat = $state('');
	let result = $state<{ id: string; username: string; generated: string | null } | null>(null);
	let resultOpen = $state(false);

	const nameProblem = $derived(username ? usernameProblem(username) : null);
	const ready = $derived(!!username && !nameProblem && passwordReady(mode, password, repeat));

	$effect(() => {
		if (!creating) {
			username = '';
			displayName = '';
			password = '';
			repeat = '';
			mode = 'gerar';
		}
	});

	const filters = [
		{ value: null, label: 'Todos' },
		{ value: 'active', label: 'Ativos' },
		{ value: 'locked', label: 'Bloqueados' },
		{ value: 'disabled', label: 'Desativados' }
	] as const;

	function stateHref(value: string | null): string {
		const q = new URLSearchParams();
		if (data.q) q.set('busca', data.q);
		if (value) q.set('estado', value);
		const s = q.toString();
		return s ? `/usuarios?${s}` : '/usuarios';
	}

	const filtered = $derived(!!data.q || !!data.state);
</script>

<svelte:head>
	<title>Usuários · lumi · Administração</title>
</svelte:head>

<PageHeader eyebrow="Contas" title="Usuários" subtitle="Quem pode entrar neste servidor. Senhas e o conteúdo das notas nunca aparecem aqui.">
	{#snippet actions()}
		<button class="btn primary" type="button" onclick={() => (creating = true)}>
			<Icon name="plus" size={16} /> Novo usuário
		</button>
	{/snippet}
</PageHeader>

{#if data.deleted}
	<div class="banner ok" role="status"><Icon name="check" /><p>Usuário “{data.deleted}” apagado.</p></div>
{/if}

<div class="toolbar">
	<form method="GET" class="search grow" role="search">
		{#if data.state}<input type="hidden" name="estado" value={data.state} />{/if}
		<label class="sr-only" for="busca">Buscar usuários</label>
		<span class="search-icon"><Icon name="search" size={16} /></span>
		<input id="busca" name="busca" type="search" placeholder="Buscar por nome de usuário ou de exibição" value={data.q}
			maxlength="64" autocomplete="off" spellcheck="false" />
	</form>
	<nav class="segmented" aria-label="Filtrar por estado">
		{#each filters as f (f.label)}
			<a href={stateHref(f.value)} aria-current={data.state === f.value ? 'true' : undefined}>{f.label}</a>
		{/each}
	</nav>
</div>

<div class="table-card">
	{#if data.items.length === 0}
		<EmptyState icon="users" title={filtered ? 'Ninguém com esse filtro' : 'Nenhum usuário ainda'}
			description={filtered ? 'Mude a busca ou o filtro de estado.' : 'Crie o primeiro usuário para alguém começar a usar o lumi.'}>
			{#if filtered}<a class="btn small" href="/usuarios">Limpar filtros</a>{/if}
		</EmptyState>
	{:else}
		<div class="table-scroll">
			<table class="table">
				<thead>
					<tr>
						<th scope="col">Usuário</th>
						<th scope="col">Estado</th>
						<th scope="col">Último acesso</th>
						<th scope="col" class="num">Sessões</th>
						<th scope="col" class="num">Cofres</th>
						<th scope="col" class="num">Falhas</th>
						<th scope="col">Desde</th>
					</tr>
				</thead>
				<tbody>
					{#each data.items as u (u.id)}
						<tr>
							<td class="primary">
								<a class="row-link" href="/usuarios/{u.id}">
									<Avatar name={u.displayName || u.username} />
									<span>{u.username}{#if u.displayName}<span class="sub">{u.displayName}</span>{/if}</span>
								</a>
							</td>
							<td data-label="Estado"><StatePill state={u.state} /></td>
							<td data-label="Último acesso" title={formatDateTime(u.lastSeenAt ?? u.lastLoginAt)}>
								{u.lastSeenAt || u.lastLoginAt ? formatRelative(u.lastSeenAt ?? u.lastLoginAt) : 'nunca'}
							</td>
							<td data-label="Sessões" class="num">{formatInt(u.sessions)}</td>
							<td data-label="Cofres" class="num" title="{formatInt(u.ownedVaults)} como dono">
								{formatInt(u.vaults)}{#if u.ownedVaults}<span class="muted"> ({formatInt(u.ownedVaults)})</span>{/if}
							</td>
							<td data-label="Falhas" class="num" class:warn={u.failedLogins > 0}>{formatInt(u.failedLogins)}</td>
							<td data-label="Desde" class="muted">{formatDate(u.createdAt)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
<Pager next={data.next} label="Páginas de usuários" />

<ConfirmDialog bind:open={creating} title="Novo usuário" action="?/create" confirmLabel="Criar usuário" {ready} quiet
	onsuccess={(d) => {
		const c = d?.created as { id: string; username: string } | undefined;
		if (c) {
			result = { ...c, generated: typeof d?.generated === 'string' ? d.generated : null };
			resultOpen = true;
		}
	}}>
	<div class="field">
		<label for="nu-username">Nome de usuário</label>
		<input id="nu-username" name="username" type="text" required minlength="3" maxlength="32" bind:value={username}
			autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="nu-username-hint"
			aria-invalid={nameProblem ? 'true' : undefined} />
		<span class="hint" id="nu-username-hint">{nameProblem ?? '3 a 32 de a-z, 0-9, _ e -; sem _ ou - nas pontas.'}</span>
	</div>
	<div class="field">
		<label for="nu-display">Nome de exibição <span class="muted">(opcional)</span></label>
		<input id="nu-display" name="display_name" type="text" maxlength="80" autocomplete="off" bind:value={displayName} />
	</div>
	<PasswordChoice bind:mode bind:password bind:repeat />
	<p class="hint">Nenhum consentimento é registrado em nome da pessoa: ela aceita os termos ao entrar.</p>
</ConfirmDialog>

<SecretDialog bind:open={resultOpen} title="Usuário criado" secret={result?.generated ?? null}>
	{#if result}
		<p>
			A conta <a href="/usuarios/{result.id}"><strong>{result.username}</strong></a> já pode entrar{result.generated ? ' com esta senha temporária:' : ' com a senha que você definiu.'}
		</p>
	{/if}
</SecretDialog>

<style>
	.search {
		position: relative;
	}
	.search-icon {
		position: absolute;
		left: 0.65rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-dim);
		display: grid;
	}
	.search input {
		padding-left: 2.1rem;
		min-height: 38px;
	}
	td.warn {
		color: var(--color-warning);
		font-weight: 650;
	}
</style>
