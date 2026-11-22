<script lang="ts">
	import { enhance } from '$app/forms';
	import Pager from '#lib/components/Pager.svelte';
	import StatePill from '#lib/components/StatePill.svelte';
	import { withFlash } from '#lib/enhance.ts';
	import { formatDate, formatInt } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let creating = $state(false);
	let pending = $state(false);

	$effect(() => {
		if (form && !form.ok) creating = true;
	});
</script>

<svelte:head>
	<title>Usuários · lumi · Administração</title>
</svelte:head>

<div class="page-head">
	<h1>Usuários</h1>
	<button class="btn primary" type="button" aria-expanded={creating} aria-controls="novo" onclick={() => (creating = !creating)}>
		{creating ? 'Fechar' : 'Novo usuário'}
	</button>
</div>

{#if data.deleted}
	<p class="banner ok" role="status">Usuário “{data.deleted}” apagado.</p>
{/if}

{#if creating}
	<form id="novo" method="POST" action="?/create" class="card create" use:enhance={withFlash({ pending: (on) => (pending = on) })}>
		<h2>Novo usuário</h2>
		<div class="cols">
			<div class="field">
				<label for="nu-username">Nome de usuário</label>
				<input id="nu-username" name="username" type="text" required minlength="3" maxlength="32"
					pattern="[a-z0-9][a-z0-9_\-]*[a-z0-9]" autocomplete="off" autocapitalize="off" spellcheck="false"
					value={(form && 'username' in form ? String(form.username) : '')} aria-describedby="nu-username-hint" />
				<span class="hint" id="nu-username-hint">3 a 32 de a-z, 0-9, _ e -; sem _ ou - nas pontas.</span>
			</div>
			<div class="field">
				<label for="nu-display">Nome de exibição <span class="muted">(opcional)</span></label>
				<input id="nu-display" name="display_name" type="text" maxlength="80" autocomplete="off"
					value={(form && 'display_name' in form ? String(form.display_name) : '')} />
			</div>
			<div class="field">
				<label for="nu-password">Senha</label>
				<input id="nu-password" name="password" type="password" required minlength="8" autocomplete="new-password" aria-describedby="nu-password-hint" />
				<span class="hint" id="nu-password-hint">8 a 72 bytes, não só dígitos; só letras exige 10.</span>
			</div>
			<div class="field">
				<label for="nu-repeat">Repita a senha</label>
				<input id="nu-repeat" name="password_repeat" type="password" required minlength="8" autocomplete="new-password" />
			</div>
		</div>
		<p class="hint">Nenhum consentimento é registrado em nome do usuário: ele aceita os termos ao entrar.</p>
		<button class="btn primary" type="submit" disabled={pending}>{pending ? 'Criando…' : 'Criar usuário'}</button>
	</form>
{/if}

{#if data.items.length === 0}
	<p class="muted">Nenhum usuário.</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">Usuário</th>
					<th scope="col">Estado</th>
					<th scope="col" class="num">Sessões</th>
					<th scope="col" class="num">Cofres (dono)</th>
					<th scope="col" class="num">Falhas</th>
					<th scope="col">Desde</th>
				</tr>
			</thead>
			<tbody>
				{#each data.items as u (u.id)}
					<tr>
						<td>
							<a href="/usuarios/{u.id}">{u.username}</a>
							{#if u.displayName}<span class="muted"> · {u.displayName}</span>{/if}
						</td>
						<td><StatePill state={u.state} /></td>
						<td class="num">{formatInt(u.sessions)}</td>
						<td class="num">{formatInt(u.vaults)} ({formatInt(u.ownedVaults)})</td>
						<td class="num">{formatInt(u.failedLogins)}</td>
						<td>{formatDate(u.createdAt)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
<Pager next={data.next} label="Páginas de usuários" />

<style>
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0 1rem;
	}
</style>
