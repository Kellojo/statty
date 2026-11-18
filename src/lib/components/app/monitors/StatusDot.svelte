<script lang="ts">
	import type { MonitorStatus } from '$lib/types.js';
	import { STATUS_BG, STATUS_LABEL } from '$lib/monitor-format.js';
	import { cn } from '$lib/utils.js';

	let { status, class: className }: { status: MonitorStatus; class?: string } = $props();
</script>

<span class={cn('relative inline-flex size-2.5 shrink-0', className)} title={STATUS_LABEL[status]}>
	{#if status === 'up' || status === 'down'}
		<span
			class="absolute inset-0 animate-ping rounded-full opacity-40 motion-reduce:hidden {STATUS_BG[
				status
			]}"
			style="animation-duration: {status === 'down' ? '1.4s' : '3s'}"
		></span>
	{/if}
	<span
		class="relative inline-flex size-full rounded-full transition-colors duration-500 {STATUS_BG[
			status
		]}"
	></span>
	<span class="sr-only">{STATUS_LABEL[status]}</span>
</span>
