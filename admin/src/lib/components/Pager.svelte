<script lang="ts">
	import { page } from '$app/state';

	type Props = {
		next: string | null;
		/** The query parameter that carries the cursor. */
		param?: string;
		label: string;
	};

	let { next, param = 'apos', label }: Props = $props();

	const paged = $derived(page.url.searchParams.has(param));

	function href(cursor: string | null): string {
		const q = new URLSearchParams([...page.url.searchParams]);
		q.delete(param);
		if (cursor !== null) q.set(param, cursor);
		const s = q.toString();
		return s ? `${page.url.pathname}?${s}` : page.url.pathname;
	}
</script>

{#if paged || next !== null}
	<nav class="pager" aria-label={label}>
		{#if paged}
			<a class="btn ghost" href={href(null)}>← Primeira página</a>
		{/if}
		{#if next !== null}
			<a class="btn next" href={href(next)}>Próxima página →</a>
		{/if}
	</nav>
{/if}

<style>
	.pager {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 1rem;
	}
	.next {
		margin-left: auto;
	}
</style>
