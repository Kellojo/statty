<script lang="ts">
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import type { Heartbeat } from '$lib/types.js';
	import { STATUS_BG, STATUS_LABEL, formatDateTime, formatLatency } from '$lib/monitor-format.js';
	import { cn } from '$lib/utils.js';

	/**
	 * The latest checks as thin bars, newest on the right; empty slots pad the left.
	 * A new check grows in at the right while the older ones slide left.
	 */
	let {
		beats,
		slots = 40,
		mobileSlots,
		class: className
	}: {
		beats: Heartbeat[];
		slots?: number;
		/** Fewer, wider bars below the sm breakpoint (the oldest are hidden). */
		mobileSlots?: number;
		class?: string;
	} = $props();

	const shown = $derived(beats.slice(-slots));
	const cells = $derived([
		...Array.from({ length: Math.max(0, slots - shown.length) }, (_, i) => ({
			key: `empty-${i}`,
			beat: null as Heartbeat | null
		})),
		...shown.map((beat) => ({ key: `b-${beat.checkedAt}`, beat: beat as Heartbeat | null }))
	]);
	const hiddenOnMobile = $derived(mobileSlots ? Math.max(0, slots - mobileSlots) : 0);

	function describe(b: Heartbeat): string {
		const parts = [STATUS_LABEL[b.status], formatDateTime(b.checkedAt)];
		if (b.latencyMs !== null) parts.push(formatLatency(b.latencyMs));
		if (b.message) parts.push(b.message);
		return parts.join(' · ');
	}

	/** Grows up from the baseline. Runs only for checks that arrive after the bar is shown. */
	function grow(_node: Element, { duration = 450 } = {}) {
		return {
			duration,
			easing: cubicOut,
			css: (t: number) => `transform: scaleY(${0.2 + 0.8 * t}); opacity: ${t}`
		};
	}
</script>

<div
	class={cn('flex h-6 items-stretch gap-[3px] overflow-hidden', className)}
	role="img"
	aria-label="Last {shown.length} checks"
>
	{#each cells as cell, i (cell.key)}
		<span
			animate:flip={{ duration: 350, easing: cubicOut }}
			in:grow
			class="min-w-0 flex-1 origin-bottom rounded-[3px] {i < hiddenOnMobile
				? 'max-sm:hidden'
				: ''} {cell.beat
				? `transition-[scale] hover:scale-y-110 ${STATUS_BG[cell.beat.status]}`
				: 'bg-muted-foreground/20 dark:bg-muted-foreground/30'}"
			title={cell.beat ? describe(cell.beat) : undefined}
		></span>
	{/each}
</div>
