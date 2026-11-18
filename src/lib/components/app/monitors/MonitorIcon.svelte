<script lang="ts">
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import ContainerIcon from '@lucide/svelte/icons/container';
	import type { Monitor } from '$lib/types.js';
	import { cn } from '$lib/utils.js';

	let {
		monitor,
		size = 16,
		class: className
	}: {
		monitor: Pick<Monitor, 'type' | 'faviconUrl'>;
		/** Edge length in px (16–22 suits rows and headers). */
		size?: number;
		class?: string;
	} = $props();

	/** The URL that failed to load, so a later (re-versioned) URL gets its own try. */
	let failed = $state<string | null>(null);
	const src = $derived(monitor.type === 'http' ? monitor.faviconUrl : null);
	const showImage = $derived(Boolean(src) && failed !== src);
</script>

<!-- Decorative: the monitor's name is always next to it. -->
<span
	class={cn('inline-flex shrink-0 items-center justify-center', className)}
	style="width: {size}px; height: {size}px"
	aria-hidden="true"
>
	{#if showImage && src}
		<!-- A light tile with a hairline ring, in both themes: dark and transparent icons stay
		     visible on the dark theme, and the icon looks the same everywhere. -->
		<span
			class="flex size-full items-center justify-center overflow-hidden rounded-[4px] bg-white ring-1 ring-black/[0.12] dark:bg-white/85 dark:ring-white/15"
			style="padding: {size <= 16 ? 1 : Math.round(size / 10)}px"
		>
			<img
				{src}
				alt=""
				width={size}
				height={size}
				loading="lazy"
				decoding="async"
				draggable="false"
				class="size-full object-contain"
				onerror={() => (failed = src)}
			/>
		</span>
	{:else}
		<!-- The same footprint as a favicon tile, so rows with and without one line up. -->
		<span
			class="flex size-full items-center justify-center rounded-[4px] bg-muted ring-1 ring-black/5 dark:ring-white/10"
		>
			{#if monitor.type === 'docker'}
				<ContainerIcon class="size-[70%] text-muted-foreground" strokeWidth={2} />
			{:else}
				<GlobeIcon class="size-[70%] text-muted-foreground" strokeWidth={2} />
			{/if}
		</span>
	{/if}
</span>
