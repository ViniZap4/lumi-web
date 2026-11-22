<script lang="ts" module>
	// Stroke icons on a 24 px grid, drawn inline: no icon font, nothing from another origin.
	const PATHS = {
		home: 'M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9',
		users: 'M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
		user: 'M19 20v-1.5A3.5 3.5 0 0 0 15.5 15h-7A3.5 3.5 0 0 0 5 18.5V20M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
		activity: 'M3 12h4l3-8 4 16 3-8h4',
		vault: 'M4 4h16v16H4zM4 9h16M9 4v5M15 14.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0',
		mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
		globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3',
		key: 'M14.5 9.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0M13.2 12.7 21 20.5M17 16.5l2-2M19 18.5l2-2',
		shield: 'M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6zM9 12l2 2 4-4',
		notes: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
		database: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
		clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
		server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
		plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
		alert: 'M12 3 2 20h20zM12 10v4M12 17h.01',
		lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
		unlock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2',
		logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
		search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4',
		plus: 'M12 5v14M5 12h14',
		x: 'M6 6l12 12M18 6 6 18',
		check: 'M5 12.5 10 17l9-10',
		download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
		copy: 'M9 9h11v11H9zM5 15V4h11',
		chevron: 'M9 6l6 6-6 6',
		menu: 'M4 6h16M4 12h16M4 18h16',
		sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
		moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5',
		monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
		refresh: 'M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4',
		ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M5.6 5.6l12.8 12.8',
		trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
		filter: 'M4 5h16l-6 8v6l-4-2v-4z',
		info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5M12 8h.01',
		link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'
	} as const;

	export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
	type Props = { name: IconName; size?: number; label?: string };
	let { name, size = 18, label }: Props = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	<path d={PATHS[name]} />
</svg>
