<script lang="ts">
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import { formatDateTime, formatRelative, shortId } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let target = $state<{ id: string; username: string } | null>(null);
	let open = $state(false);
</script>

<svelte:head>
	<title>Sessões · lumi · Administração</title>
</svelte:head>

<div class="page-head">
	<h1>Sessões</h1>
	{#if data.user}
		<a class="btn ghost" href="/sessoes">Mostrar todas</a>
	{/if}
</div>
<p class="muted">Sessões de usuário não expiradas, mais novas primeiro. O id é o hash do token: identifica, mas não autentica.</p>

{#if data.items.length === 0}
	<p class="muted">Nenhuma sessão ativa.</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">Usuário</th>
					<th scope="col">Sessão</th>
					<th scope="col">Criada</th>
					<th scope="col">Último uso</th>
					<th scope="col">Expira</th>
					<th scope="col"><span class="sr-only">Ações</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.items as s (s.id)}
					<tr>
						<td><a href="/usuarios/{s.userId}">{s.username}</a></td>
						<td class="mono" title={s.id}>{shortId(s.id)}</td>
						<td>{formatDateTime(s.createdAt)}</td>
						<td>{formatRelative(s.lastUsedAt)}</td>
						<td>{formatDateTime(s.expiresAt)}</td>
						<td class="actions">
							<button class="btn small danger" type="button"
								onclick={() => { target = { id: s.id, username: s.username }; open = true; }}>
								Encerrar
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
<Pager next={data.next} label="Páginas de sessões" />

{#if target}
	<ConfirmDialog bind:open title="Encerrar a sessão de {target.username}?" action="?/revoke"
		fields={{ session: target.id }} confirmLabel="Encerrar sessão" danger>
		<p>O dispositivo dessa sessão ({shortId(target.id)}) precisa entrar de novo.</p>
	</ConfirmDialog>
{/if}
