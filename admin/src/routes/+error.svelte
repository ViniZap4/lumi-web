<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Erro · lumi · Administração</title>
</svelte:head>

<main class="error-page">
	<p class="code mono">{page.status}</p>
	<h1>{page.status === 404 ? 'Não encontrado' : page.status === 503 ? 'API indisponível' : 'Algo deu errado'}</h1>
	<p class="muted">{page.error?.message ?? 'Erro desconhecido.'}</p>
	<p class="row">
		<a class="btn primary" href="/">Voltar à visão geral</a>
		<a class="btn ghost" href={page.url.pathname}>Tentar de novo</a>
	</p>
</main>

<style>
	.error-page {
		max-width: 40rem;
		margin: 14vh auto;
		padding: 0 1rem;
	}
	.code {
		margin: 0;
		font-size: 3rem;
		font-weight: 700;
		color: var(--color-primary);
		line-height: 1;
	}
	h1 {
		margin-top: 0.5rem;
	}
</style>
