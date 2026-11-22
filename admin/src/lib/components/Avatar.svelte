<script lang="ts">
	type Props = { name: string; size?: number };
	let { name, size = 30 }: Props = $props();

	const PALETTE = ['primary', 'secondary', 'accent', 'success', 'warning'];
	const hue = $derived(PALETTE[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length]);
	const initials = $derived(
		name
			.split(/[\s._-]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p) => p[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);
</script>

<span class="avatar" style:--size="{size}px" style:--hue="var(--color-{hue})" aria-hidden="true">{initials}</span>

<style>
	.avatar {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: var(--size);
		height: var(--size);
		border-radius: 50%;
		background: color-mix(in srgb, var(--hue) 18%, transparent);
		color: var(--hue);
		font-size: calc(var(--size) * 0.38);
		font-weight: 700;
		letter-spacing: 0.02em;
	}
</style>
