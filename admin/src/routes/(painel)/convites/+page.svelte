<script lang="ts">
	import type { AdminInvite } from '#lib/admin.ts';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Pager from '#lib/components/Pager.svelte';
	import StatePill from '#lib/components/StatePill.svelte';
	import { formatDate, formatDateTime, formatInt, formatRelative, shortId } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let target = $state<AdminInvite | null>(null);
	let open = $state(false);

	function href(state: 'active' | 'all'): string {
		const q = new URLSearchParams();
		if (data.vault) q.set('cofre', data.vault);
		if (state === 'all') q.set('estado', 'todos');
		const s = q.toString();
		return s ? `/convites?${s}` : '/convites';
	}
</script>

<svelte:head>
	<title>Convites · lumi · Administração</title>
</svelte:head>

<PageHeader eyebrow="Conteúdo" title="Convites"
	subtitle="Links de entrada em cofres, criados pelos admins de cada cofre no app. Aqui dá para ver quem convidou, quantos usos sobram e revogar um link vazado. O link em si nunca aparece." />

<div class="toolbar">
	<nav class="segmented" aria-label="Filtrar por estado">
		<a href={href('active')} aria-current={data.state === 'active' ? 'true' : undefined}>Válidos</a>
		<a href={href('all')} aria-current={data.state === 'all' ? 'true' : undefined}>Todos</a>
	</nav>
	{#if data.vault}<a class="btn ghost" href="/convites">Todos os cofres</a>{/if}
</div>

<div class="table-card">
	{#if data.items.length === 0}
		<EmptyState icon="mail" title={data.state === 'active' ? 'Nenhum convite válido' : 'Nenhum convite'}
			description="Quando um admin de cofre criar um convite no app, ele aparece aqui." />
	{:else}
		<div class="table-scroll">
			<table class="table">
				<thead>
					<tr>
						<th scope="col">Cofre</th>
						<th scope="col">Papel</th>
						<th scope="col">Convidou</th>
						<th scope="col">Estado</th>
						<th scope="col" class="num">Usos</th>
						<th scope="col">Expira</th>
						<th scope="col">Criado</th>
						<th scope="col"><span class="sr-only">Ações</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.items as i (i.id)}
						<tr class:dim={i.state !== 'active'}>
							<td class="primary">
								<a class="row-link" href="/cofres/{i.vault.id}">
									<span class="mono">{i.vault.slug}</span>
									<span class="sub mono" title="Identificador (hash), não o link">#{shortId(i.id)}{i.emailHint ? ` · ${i.emailHint}` : ''}</span>
								</a>
							</td>
							<td data-label="Papel">{i.role.name}</td>
							<td data-label="Convidou">{#if i.inviter.username}<a href="/usuarios/{i.inviter.id}">{i.inviter.username}</a>{:else}<span class="muted">—</span>{/if}</td>
							<td data-label="Estado"><StatePill state={i.state} /></td>
							<td data-label="Usos" class="num">{formatInt(i.useCount)} de {formatInt(i.maxUses)}</td>
							<td data-label="Expira" title={formatDateTime(i.expiresAt)}>{formatRelative(i.expiresAt)}</td>
							<td data-label="Criado" class="muted">{formatDate(i.createdAt)}</td>
							<td class="actions">
								{#if i.state === 'active'}
									<button class="btn small danger" type="button" onclick={() => { target = i; open = true; }}>Revogar</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
<Pager next={data.next} label="Páginas de convites" />

{#if target}
	<ConfirmDialog bind:open title="Revogar o convite de {target.vault.slug}?" action="?/revoke" fields={{ invite: target.id }}
		confirmLabel="Revogar convite" danger>
		<p>
			O link (papel {target.role.name}, {formatInt(target.maxUses - target.useCount)} uso(s) restante(s)) deixa de valer na
			hora. Quem já entrou por ele continua membro.
		</p>
	</ConfirmDialog>
{/if}
