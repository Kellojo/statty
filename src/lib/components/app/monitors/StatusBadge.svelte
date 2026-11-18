<script lang="ts">
	import type { MonitorStatus } from '$lib/types.js';
	import { STATUS_LABEL } from '$lib/monitor-format.js';
	import { cn } from '$lib/utils.js';

	let {
		status,
		label,
		class: className
	}: {
		status: MonitorStatus;
		/** Overrides the default wording, e.g. customer-facing words on the status page. */
		label?: string;
		class?: string;
	} = $props();

	const TONE: Record<MonitorStatus, string> = {
		up: 'bg-success/12 text-success-foreground',
		down: 'bg-destructive/12 text-destructive',
		pending: 'bg-warning/15 text-warning-foreground',
		unknown: 'bg-muted text-muted-foreground',
		paused: 'bg-muted text-muted-foreground'
	};
</script>

<span
	class={cn(
		'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium transition-colors duration-500',
		TONE[status],
		className
	)}
>
	{label ?? STATUS_LABEL[status]}
</span>
