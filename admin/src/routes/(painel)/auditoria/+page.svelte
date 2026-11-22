<script lang="ts">
	import Pager from '#lib/components/Pager.svelte';
	import { actionLabel, formatDateTime, shortId } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function payloadText(p: unknown): string {
		return p === null || p === undefined ? '' : JSON.stringify(p, null, 2);
	}

	function actor(p: unknown): string {
		if (typeof p !== 'object' || p === null) return '';
		const o = p as Record<string, unknown>;
		return typeof o.token_name === 'string' ? o.token_name : '';
	}
</script>

<svelte:head>
	<title>Auditoria · lumi · Administração</title>
</svelte:head>

<div class="page-head"><h1>Auditoria</h1></div>
<p class="muted">
	O <code>audit_log</code> inteiro, mais novo primeiro: ações dos usuários e do admin. Ações do terminal aparecem com o
	token “cli”.
</p>

<form method="GET" class="card filters" aria-label="Filtros da auditoria">
	<div class="field">
		<label for="f-scope">Escopo</label>
		<select id="f-scope" name="escopo" value={data.filters.scope}>
			<option value="all">Tudo</option>
			<option value="admin">Só ações de admin</option>
		</select>
	</div>
	<div class="field">
		<label for="f-user">Usuário (id)</label>
		<input id="f-user" name="usuario" type="text" value={data.filters.user} placeholder="uuid" autocomplete="off" spellcheck="false"
			aria-invalid={data.invalid.includes('usuario') ? 'true' : undefined} />
	</div>
	<div class="field">
		<label for="f-vault">Cofre (id)</label>
		<input id="f-vault" name="cofre" type="text" value={data.filters.vault} placeholder="uuid" autocomplete="off" spellcheck="false"
			aria-invalid={data.invalid.includes('cofre') ? 'true' : undefined} />
	</div>
	<div class="row buttons">
		<button class="btn primary" type="submit">Filtrar</button>
		<a class="btn ghost" href="/auditoria">Limpar</a>
	</div>
</form>
{#if data.invalid.length > 0}
	<p class="banner warn" role="alert">Filtro ignorado: {data.invalid.join(', ')} precisa ser um UUID.</p>
{/if}

{#if data.entries.length === 0}
	<p class="muted">Nenhuma entrada.</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">Quando</th>
					<th scope="col">Ação</th>
					<th scope="col">Quem</th>
					<th scope="col">Alvo</th>
					<th scope="col">IP</th>
					<th scope="col">Detalhes</th>
				</tr>
			</thead>
			<tbody>
				{#each data.entries as e (e.id)}
					<tr>
						<td class="nowrap">{formatDateTime(e.createdAt)}</td>
						<td><span title={e.action}>{actionLabel(e.action)}</span></td>
						<td>{actor(e.payload) || '—'}</td>
						<td>
							{#if e.userId}<a href="/auditoria?usuario={e.userId}" title={e.userId}>usuário {shortId(e.userId)}</a>{/if}
							{#if e.vaultId}<a href="/auditoria?cofre={e.vaultId}" title={e.vaultId}>cofre {shortId(e.vaultId)}</a>{/if}
							{#if !e.userId && !e.vaultId}—{/if}
						</td>
						<td class="mono">{e.ip ?? '—'}</td>
						<td>
							{#if payloadText(e.payload)}
								<details>
									<summary>#{e.id}</summary>
									<pre class="payload">{payloadText(e.payload)}</pre>
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
<Pager next={data.next} param="antes" label="Páginas da auditoria" />

<style>
	.filters {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0 1rem;
		align-items: end;
	}
	.buttons {
		margin-bottom: 0.9rem;
	}
	.nowrap {
		white-space: nowrap;
	}
	td a + a {
		margin-left: 0.5rem;
	}
	summary {
		cursor: pointer;
	}
	.payload {
		margin: 0.4rem 0;
		max-width: 32rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 0.8rem;
	}
</style>
