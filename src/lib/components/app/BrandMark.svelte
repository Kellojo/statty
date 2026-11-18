<script lang="ts">
	import { cn } from '$lib/utils.js';

	/** Statty's mark: a heartbeat line in a rounded tile. */
	let { class: className }: { class?: string } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	class={cn('size-8 shrink-0 rounded-xl bg-foreground text-background shadow-sm', className)}
	aria-hidden="true"
>
	<path
		d="M4.5 12.5h3.2l1.8-4.5 3.2 9 2.2-6 1.4 1.5h3.2"
		fill="none"
		stroke="currentColor"
		stroke-width="1.9"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
</svg>
