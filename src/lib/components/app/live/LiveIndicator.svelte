<script lang="ts">
	/** "Live" while the event stream is open; "Reconnecting" while it is down. */
	let { connected, class: className = '' }: { connected: boolean; class?: string } = $props();
</script>

<span
	class="inline-flex items-center gap-1.5 text-xs text-muted-foreground {className}"
	role="status"
	title={connected ? 'Updates arrive as checks finish' : 'Live updates paused, reconnecting'}
>
	<span class="relative inline-flex size-2">
		{#if connected}
			<span
				class="absolute inset-0 animate-ping rounded-full bg-success opacity-50 motion-reduce:hidden"
				style="animation-duration: 2s"
			></span>
		{/if}
		<span
			class="relative inline-flex size-2 rounded-full transition-colors duration-500 {connected
				? 'bg-success'
				: 'bg-muted-foreground/50'}"
		></span>
	</span>
	{connected ? 'Live' : 'Reconnecting…'}
</span>
