<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		children,
		footer
	}: { title: string; description?: string; children: Snippet; footer?: Snippet } = $props();
</script>

<div class="flex w-full flex-col gap-6">
	<!--
		On mobile the card is flat on the page, where the borderless input fills are
		too faint (dark mode especially): give resting inputs a visible edge there.
	-->
	<div
		class="flex w-full flex-col gap-6 text-card-foreground sm:rounded-4xl sm:border sm:bg-card sm:px-8 sm:py-8 sm:shadow-sm max-sm:[&_[data-slot=input]:not([aria-invalid=true]):not(:focus-visible)]:border-foreground/15"
	>
		<header class="flex flex-col gap-1.5 text-center">
			<h1 class="text-xl font-semibold tracking-tight">{title}</h1>
			{#if description}
				<p class="text-sm text-balance text-muted-foreground">{description}</p>
			{/if}
		</header>
		{@render children()}
	</div>
	{#if footer}
		<p class="text-center text-sm text-muted-foreground">
			{@render footer()}
		</p>
	{/if}
</div>
