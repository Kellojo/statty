<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import BrandMark from '../BrandMark.svelte';

	/** The centred frame of the sign-in pages: Statty's mark above the content. */
	let {
		children,
		wide = false,
		centered = false
	}: {
		children: Snippet;
		wide?: boolean;
		/** Centre vertically: for pages without a form, where nothing appears later to shift the stack. */
		centered?: boolean;
	} = $props();
</script>

<main
	class="auth-bg flex min-h-dvh flex-col items-center bg-background px-4 pt-[calc(2.5rem+var(--safe-top))] pb-[calc(2.5rem+env(safe-area-inset-bottom))] sm:px-6"
>
	<!--
		Unless `centered`, a fixed offset from the top instead of vertical centring: an error banner
		appearing would otherwise shift the whole stack up. Phones get a small fixed
		offset so a form stays above the on-screen keyboard; the desktop one shrinks on short
		screens, so tall pages are never clipped.
	-->
	<div
		class="flex w-full flex-col items-center gap-6 sm:gap-8 {centered
			? 'my-auto'
			: 'mt-2 mb-auto sm:mt-[clamp(0px,calc(20dvh-5rem),8rem)]'} {wide ? 'max-w-xl' : 'max-w-sm'}"
	>
		<a
			href={resolve('/status')}
			class="group flex flex-col items-center gap-3 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
			aria-label="Statty, public status page"
		>
			<BrandMark
				class="size-9 rounded-xl transition-transform group-hover:scale-105 sm:size-11 sm:rounded-2xl"
			/>
			<span class="text-lg font-semibold tracking-tight">Statty</span>
		</a>
		{@render children()}
	</div>
</main>

<style>
	.auth-bg {
		background-image: radial-gradient(
			ellipse 60% 40% at 50% 0%,
			color-mix(in oklch, var(--foreground) 6%, transparent),
			transparent
		);
	}
</style>
