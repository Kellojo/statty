<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';

	let {
		title,
		back,
		description,
		badges,
		actions,
		leading
	}: {
		title: string;
		/** Parent page link shown above the title on detail pages (a resolved path). */
		back?: { href: string; label: string };
		description?: Snippet | string;
		/** Chips after the title. */
		badges?: Snippet;
		/** Primary page actions, right of the title (under it on phones). */
		actions?: Snippet;
		/** Before the title, e.g. a status dot. */
		leading?: Snippet;
	} = $props();
</script>

<header class="flex flex-col gap-1">
	{#if back}
		<!-- eslint-disable svelte/no-navigation-without-resolve -- callers pass resolve()d hrefs -->
		<a
			href={back.href}
			class="-ml-1 flex h-8 w-fit items-center gap-1 rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
		>
			<ArrowLeftIcon class="size-3.5" aria-hidden="true" />
			{back.label}
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/if}
	<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:gap-x-6">
		<div class="flex min-h-9 min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
			{@render leading?.()}
			<h1 class="min-w-0 truncate text-xl font-semibold">{title}</h1>
			{@render badges?.()}
		</div>
		{#if description}
			<p
				class="col-span-2 row-start-2 max-w-2xl text-sm text-pretty text-muted-foreground sm:col-span-1"
			>
				{#if typeof description === 'string'}{description}{:else}{@render description()}{/if}
			</p>
		{/if}
		{#if actions}
			<div class="col-start-2 row-start-1 flex flex-wrap items-center justify-end gap-2">
				{@render actions()}
			</div>
		{/if}
	</div>
</header>
