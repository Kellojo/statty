<script lang="ts">
	import AnimatedNumber from './AnimatedNumber.svelte';

	/** A response time with rolling digits: 87ms, 1.24s. */
	let {
		ms,
		fallback,
		class: className
	}: { ms: number | null; fallback?: string; class?: string } = $props();

	const seconds = $derived(ms !== null && ms >= 1000);
</script>

<AnimatedNumber
	value={ms === null ? null : seconds ? ms / 1000 : ms}
	format={seconds
		? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
		: { maximumFractionDigits: 0 }}
	suffix={seconds ? 's' : 'ms'}
	{fallback}
	class={className}
/>
