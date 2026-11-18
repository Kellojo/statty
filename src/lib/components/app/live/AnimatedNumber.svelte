<script lang="ts">
	import NumberFlow from '@number-flow/svelte';

	/** A number whose digits roll when it changes; `null` shows `fallback`. */
	let {
		value,
		format = { maximumFractionDigits: 0 },
		prefix = '',
		suffix = '',
		fallback = '–',
		trend,
		class: className
	}: {
		value: number | null | undefined;
		format?: Intl.NumberFormatOptions;
		prefix?: string;
		suffix?: string;
		fallback?: string;
		/** 1: always roll up, -1: down, 0 / unset: by direction of change. */
		trend?: number;
		class?: string;
	} = $props();
</script>

<!-- The wrapper takes layout classes, which the custom element ignores. -->
<span class={className}>
	{#if value == null || !Number.isFinite(value)}{fallback}{:else}<NumberFlow
			{value}
			{format}
			locales="en-US"
			{prefix}
			{suffix}
			{trend}
		/>{/if}
</span>
