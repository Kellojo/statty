<script lang="ts" module>
	/** Shared with the legend so the colours and their meaning can't drift apart. */
	export const DAY_TONES = {
		up: 'bg-success',
		degraded: 'bg-warning',
		down: 'bg-destructive',
		none: 'bg-muted-foreground/30 dark:bg-muted-foreground/35'
	} as const;
</script>

<script lang="ts">
	import { formatUptime } from '$lib/monitor-format.js';
	import type { PublicMonitor } from '$lib/types.js';

	/**
	 * A monitor's daily uptime bars. Hover, tap or arrow keys pick a day and the
	 * line under the bars describes it, so the details work on touch too (a
	 * `title` tooltip never shows there).
	 */
	let {
		name,
		days,
		history,
		visible
	}: {
		name: string;
		days: PublicMonitor['days'];
		/**
		 * Days of history the page has (30 to 90). Older bars would only say "no data"
		 * and make a young status page look broken, so they are left out.
		 */
		history: number;
		/** How many of the newest days this viewport shows; keys stay inside them. */
		visible: number;
	} = $props();

	let active = $state<number | null>(null);
	const first = $derived(Math.max(0, days.length - visible));
	const day = $derived(active === null ? null : days[active]);

	const dateFormat = new Intl.DateTimeFormat(undefined, {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC'
	});

	function tone(uptime: number | null): string {
		if (uptime === null) return DAY_TONES.none;
		// 99% keeps a day with one short blip green; amber means visitors felt it.
		if (uptime >= 99) return DAY_TONES.up;
		if (uptime >= 95) return DAY_TONES.degraded;
		return DAY_TONES.down;
	}

	function dateLabel(d: PublicMonitor['days'][number]): string {
		return d === days[days.length - 1] ? 'Today (so far)' : dateFormat.format(new Date(d.date));
	}

	function describe(d: PublicMonitor['days'][number]): string {
		const date = dateLabel(d);
		if (d.uptime === null) return `${date}, no data`;
		return `${date}, ${formatUptime(d.uptime)} uptime${failedText(d.down)}`;
	}

	function failedText(down: number): string {
		return down ? `, ${down} failed ${down === 1 ? 'check' : 'checks'}` : '';
	}

	let strip = $state<HTMLElement>();

	/**
	 * The bar under the pointer, by x position rather than event target: the gaps
	 * between 8px bars would otherwise drop taps and flicker on hover.
	 */
	function pick(event: PointerEvent) {
		if (!strip) return;
		const rect = strip.getBoundingClientRect();
		const pad = 4; // the strip's px-1, which widens the focus ring past the bars
		const x = (event.clientX - rect.left - pad) / (rect.width - pad * 2);
		const index = first + Math.floor(Math.min(0.999, Math.max(0, x)) * (days.length - first));
		active = index;
	}

	function onkeydown(event: KeyboardEvent) {
		const last = days.length - 1;
		const current = active ?? last;
		const next =
			event.key === 'ArrowLeft'
				? current - 1
				: event.key === 'ArrowRight'
					? current + 1
					: event.key === 'Home'
						? first
						: event.key === 'End'
							? last
							: null;
		if (next === null) return;
		event.preventDefault();
		active = Math.min(last, Math.max(first, next));
	}
</script>

<div class="flex flex-col gap-2">
	<div
		bind:this={strip}
		class="-mx-1 flex h-9 touch-pan-y items-stretch gap-[2px] rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
		role="slider"
		aria-valuemin={first}
		aria-valuemax={days.length - 1}
		aria-valuenow={active ?? days.length - 1}
		aria-valuetext={describe(day ?? days[days.length - 1])}
		tabindex="0"
		aria-label="Daily uptime for {name}, last {visible} days"
		onpointermove={pick}
		onpointerdown={pick}
		onpointerleave={(e) => {
			if (e.pointerType === 'mouse') active = null;
		}}
		onfocus={() => (active ??= days.length - 1)}
		onblur={() => (active = null)}
		{onkeydown}
	>
		{#each days as d, i (d.date)}
			<span
				class="min-w-0 flex-1 rounded-[3px] transition-[background-color,opacity,box-shadow] duration-200 {tone(
					d.uptime
				)} {i < days.length - history ? 'hidden' : ''} {i < days.length - 30
					? 'max-sm:hidden'
					: ''} {i < days.length - 60 ? 'max-md:hidden' : ''} {active === null
					? ''
					: active === i
						? 'ring-2 ring-foreground/25 ring-offset-1 ring-offset-card'
						: 'opacity-70'}"
			></span>
		{/each}
	</div>
	<!-- The picked day replaces the axis labels in place: one fixed-height line, so
	     nothing below moves and no popup covers the row's name or status. -->
	<div class="flex h-5 items-center text-xs leading-5 text-muted-foreground">
		{#if day}
			<p class="flex min-w-0 flex-1 items-center justify-center gap-1.5">
				<span class="size-2 shrink-0 rounded-[2px] {tone(day.uptime)}" aria-hidden="true"></span>
				<span class="truncate">
					<span class="font-medium text-foreground">{dateLabel(day)}</span>
					·
					{day.uptime === null
						? 'No data'
						: `${formatUptime(day.uptime)} uptime${failedText(day.down)}`}
				</span>
			</p>
		{:else}
			<div class="flex flex-1 items-center justify-between gap-2">
				<!-- CSS picks the label, like the bars, so phones get no layout shift on load. -->
				<span class="sm:hidden">{Math.min(30, history)} days ago</span>
				<span class="hidden sm:inline md:hidden">{Math.min(60, history)} days ago</span>
				<span class="hidden md:inline">{Math.min(90, history)} days ago</span>
				<span>Today</span>
			</div>
		{/if}
	</div>
</div>
