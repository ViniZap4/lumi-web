<script lang="ts">
	import '#lib/theme.css';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<title>lumi · Administração</title>
</svelte:head>

{#if data.insecure}
	<div class="banner alert insecure" role="alert">
		<strong>Conexão sem HTTPS.</strong> Este painel está sendo servido por HTTP fora do computador local: o token
		trafega sem proteção e o navegador não guarda a sessão. Acesse pelo endereço HTTPS da tailnet.
	</div>
{/if}

{@render children()}

<style>
	.insecure {
		margin: 0.75rem;
	}
</style>
