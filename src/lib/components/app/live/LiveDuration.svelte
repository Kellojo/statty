<script lang="ts" module>
	type Unit = 'd' | 'h' | 'm' | 's';

	/** "42s", "4m 05s", "3h 12m", "2d 4h": two parts at most, every part after the first padded. */
	export function durationParts(ms: number): { value: number; unit: Unit }[] {
		const s = Math.max(0, Math.floor(ms / 1000));
		if (s < 60) return [{ value: s, unit: 's' }];
		const m = Math.floor(s / 60);
		if (m < 60)
			return [
				{ value: m, unit: 'm' },
				{ value: s % 60, unit: 's' }
			];
		const h = Math.floor(m / 60);
		if (h < 24)
			return [
				{ value: h, unit: 'h' },
				{ value: m % 60, unit: 'm' }
			];
		return [
			{ value: Math.floor(h / 24), unit: 'd' },
			{ value: h % 24, unit: 'h' }
		];
	}

	export function formatDurationParts(ms: number): string {
		return durationParts(ms)
			.map((p, i) => `${i ? String(p.value).padStart(2, '0') : p.value}${p.unit}`)
			.join(' ');
	}
</script>

<script lang="ts">
	import NumberFlow, { NumberFlowGroup } from '@number-flow/svelte';
	import { now } from '$lib/live/now.svelte.js';

	/** Time since `since`, ticking every second with rolling digits; `suffix` e.g. " ago". */
	let {
		since,
		suffix = '',
		class: className = ''
	}: { since: number; suffix?: string; class?: string } = $props();

	const ms = $derived(Math.max(0, now() - since));
	const parts = $derived(durationParts(ms));
	const PADDED = { minimumIntegerDigits: 2 };
	// Parts are keyed by unit, so 59s → 1m 00s swaps parts instead of rolling seconds into
	// minutes; trend 1 because time only goes up, so :59 → :00 rolls forward.
</script>

<!-- Rolling digits are decoration; screen readers get the plain text. Spaced with margins, not
     text nodes, so the wording stays exactly "4m 05s ago". -->
<!-- prettier-ignore -->
<span class="tabular-nums {className}"><span class="sr-only">{formatDurationParts(ms)}{suffix}</span><span aria-hidden="true"><NumberFlowGroup>{#each parts as part, i (part.unit)}<NumberFlow class={i ? 'ml-[0.25em]' : undefined} value={part.value} format={i ? PADDED : undefined} suffix={part.unit} trend={1} />{/each}</NumberFlowGroup>{suffix}</span></span>
