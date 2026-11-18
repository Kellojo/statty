<script lang="ts">
	import AnimatedNumber from './AnimatedNumber.svelte';

	/** An uptime percentage (0–100) with rolling digits: 100%, 99.95%. */
	let { value, class: className }: { value: number | null; class?: string } = $props();

	const whole = $derived(value !== null && value >= 99.995);
</script>

<AnimatedNumber
	value={value === null ? null : whole ? 100 : value}
	format={{
		minimumFractionDigits: whole ? 0 : 2,
		maximumFractionDigits: whole ? 0 : 2
	}}
	suffix="%"
	class={className}
/>
