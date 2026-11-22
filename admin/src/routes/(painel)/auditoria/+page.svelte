<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import { ACTION_FILTERS, INVALID_LABELS, actionLabel, actionTone, actorOf, targetOf } from '#lib/audit.ts';
	import { formatDateTime, formatRelative, shortId } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const knownAction = $derived(ACTION_FILTERS.some((a) => a.value === data.filters.action));
	const active = $derived(
		data.filters.scope === 'admin' || !!data.filters.user || !!data.filters.vault || !!data.filters.action || !!data.filters.from || !!data.filters.to
	);
	const exportHref = $derived(data.query ? `/auditoria/exportar?${data.query}` : '/auditoria/exportar');

	function payloadText(p: unknown): string {
		return p === null || p === undefined ? '' : JSON.stringify(p, null, 2);
	}

	function filterHref(name: string, value: string): string {
		const q = new URLSearchParams(data.query);
		q.set(name, value);
		return `/auditoria?${q}`;
	}
</script>

<svelte:head>
	<title>Auditoria · lumi · Administração</title>
</svelte:head>

<PageHeader eyebrow="Servidor" title="Auditoria"
	subtitle="O audit_log inteiro, mais novo primeiro: ações das pessoas e do admin. Ações do terminal aparecem com o token “cli”.">
	{#snippet actions()}
		<a class="btn" href={exportHref} download><Icon name="download" size={16} /> Exportar CSV</a>
	{/snippet}
</PageHeader>

<form method="GET" class="card filters" aria-label="Filtros da auditoria">
	<div class="field">
		<label for="f-action">Ação</label>
		<select id="f-action" name="acao" value={data.filters.action}>
			{#each ACTION_FILTERS as a (a.value)}
				<option value={a.value}>{a.label}</option>
			{/each}
			{#if data.filters.action && !knownAction}
				<option value={data.filters.action}>{actionLabel(data.filters.action)}</option>
			{/if}
		</select>
	</div>
	<div class="field">
		<label for="f-user">Usuário</label>
		<input id="f-user" name="usuario" type="text" value={data.filters.user} placeholder="nome ou id" autocomplete="off"
			spellcheck="false" autocapitalize="off" aria-invalid={data.invalid.includes('usuario') || data.unknown.includes('usuario') ? 'true' : undefined} />
	</div>
	<div class="field">
		<label for="f-vault">Cofre</label>
		<input id="f-vault" name="cofre" type="text" value={data.filters.vault} placeholder="identificador ou id" autocomplete="off"
			spellcheck="false" autocapitalize="off" aria-invalid={data.invalid.includes('cofre') || data.unknown.includes('cofre') ? 'true' : undefined} />
	</div>
	<div class="field">
		<label for="f-from">De</label>
		<input id="f-from" name="de" type="date" value={data.filters.from} aria-invalid={data.invalid.includes('de') ? 'true' : undefined} />
	</div>
	<div class="field">
		<label for="f-to">Até</label>
		<input id="f-to" name="ate" type="date" value={data.filters.to} aria-invalid={data.invalid.includes('ate') ? 'true' : undefined} />
	</div>
	<div class="field">
		<label for="f-scope">Origem</label>
		<select id="f-scope" name="escopo" value={data.filters.scope}>
			<option value="all">Tudo</option>
			<option value="admin">Só ações de admin</option>
		</select>
	</div>
	<div class="row buttons">
		<button class="btn primary" type="submit"><Icon name="filter" size={15} /> Filtrar</button>
		{#if active}<a class="btn ghost" href="/auditoria">Limpar</a>{/if}
	</div>
	<p class="hint full">Datas no horário de Brasília. Usuário e cofre aceitam o nome exato ou o id.</p>
</form>

{#if data.invalid.length > 0}
	<div class="banner warn" role="alert"><Icon name="alert" /><p>Filtro ignorado: {data.invalid.map((i) => INVALID_LABELS[i] ?? i).join(', ')} inválido(s).</p></div>
{/if}
{#if data.unknown.length > 0}
	<div class="banner warn" role="alert"><Icon name="alert" /><p>Nenhum {data.unknown.map((i) => INVALID_LABELS[i] ?? i).join(' ou ')} com esse nome.</p></div>
{/if}
{#if data.userLabel || data.vaultLabel}
	<p class="muted">
		Filtrando
		{#if data.userLabel}a conta <a href="/usuarios/{data.userId}">{data.userLabel}</a>{/if}
		{#if data.userLabel && data.vaultLabel} e {/if}
		{#if data.vaultLabel}o cofre <a class="mono" href="/cofres/{data.vaultId}">{data.vaultLabel}</a>{/if}.
	</p>
{/if}

<div class="table-card">
	{#if data.entries.length === 0}
		<EmptyState icon="shield" title={active ? 'Nada com esses filtros' : 'Nenhuma entrada'}
			description={active ? 'Amplie as datas ou tire um filtro.' : 'As ações aparecem aqui assim que alguém usar o servidor.'} />
	{:else}
		<div class="table-scroll">
			<table class="table">
				<thead>
					<tr>
						<th scope="col">Quando</th>
						<th scope="col">Ação</th>
						<th scope="col">Quem / alvo</th>
						<th scope="col">IP</th>
						<th scope="col">Detalhes</th>
					</tr>
				</thead>
				<tbody>
					{#each data.entries as e (e.id)}
						{@const actor = actorOf(e)}
						{@const target = targetOf(e)}
						<tr>
							<td data-label="Quando" class="nowrap" title={formatDateTime(e.createdAt)}>
								{formatDateTime(e.createdAt)}<span class="sub">{formatRelative(e.createdAt)}</span>
							</td>
							<td data-label="Ação">
								<a class="action {actionTone(e.action)}" href={filterHref('acao', e.action)} title="Filtrar por {e.action}">
									<span class="dot" aria-hidden="true"></span>{actionLabel(e.action)}
								</a>
							</td>
							<td data-label="Quem / alvo" class="wide">
								{#if actor}<span class="actor">{actor}</span>{/if}
								{#if target}<span class="mono target">{target}</span>{/if}
								{#if e.userId}<a href="/usuarios/{e.userId}" title={e.userId}>usuário {shortId(e.userId)}</a>{/if}
								{#if e.vaultId}<a href="/cofres/{e.vaultId}" title={e.vaultId}>cofre {shortId(e.vaultId)}</a>{/if}
								{#if !actor && !target && !e.userId && !e.vaultId}<span class="muted">—</span>{/if}
							</td>
							<td data-label="IP" class="mono">{e.ip ?? '—'}</td>
							<td data-label="Detalhes">
								{#if payloadText(e.payload) || e.userAgent}
									<details>
										<summary>#{e.id}</summary>
										{#if payloadText(e.payload)}<pre class="payload">{payloadText(e.payload)}</pre>{/if}
										{#if e.userAgent}<p class="hint">{e.userAgent}</p>{/if}
									</details>
								{:else}
									<span class="muted">#{e.id}</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
<Pager next={data.next} param="antes" label="Páginas da auditoria" />
<p class="hint">O CSV leva até 10 000 linhas com os filtros atuais, a partir da mais nova.</p>

<style>
	.filters {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr));
		gap: 0 0.9rem;
		align-items: end;
	}
	.buttons {
		margin-bottom: 0.9rem;
	}
	.full {
		grid-column: 1 / -1;
		margin: 0;
	}
	.sub {
		display: block;
		font-size: 0.78rem;
		color: var(--color-text-dim);
	}
	.action {
		--tone: var(--color-muted);
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		color: var(--color-text);
		text-decoration: none;
		font-weight: 550;
	}
	.action:hover {
		color: var(--color-primary);
	}
	.action.admin {
		--tone: var(--color-secondary);
	}
	.action.alert {
		--tone: var(--color-error);
	}
	.action.auth {
		--tone: var(--color-accent);
	}
	.dot {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--tone);
	}
	.wide > * + * {
		margin-left: 0.5rem;
	}
	.actor {
		color: var(--color-secondary);
		font-weight: 600;
	}
	.target {
		color: var(--color-text-2);
	}
	summary {
		cursor: pointer;
		color: var(--color-text-dim);
	}
	.payload {
		margin: 0.4rem 0;
		max-width: 32rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 0.78rem;
	}
</style>
