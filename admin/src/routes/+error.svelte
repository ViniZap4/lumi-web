<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Erro · lumi · Administração</title>
</svelte:head>

<main class="error-page">
	<h1>{page.status === 404 ? 'Não encontrado' : 'Algo deu errado'}</h1>
	<p>{page.error?.message ?? 'Erro desconhecido.'}</p>
	<p><a href="/">Voltar à visão geral</a></p>
</main>

<style>
	.error-page {
		max-width: 40rem;
		margin: 4rem auto;
		padding: 0 1rem;
	}
</style>
