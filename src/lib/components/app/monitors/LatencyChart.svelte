<script lang="ts">
	import type { Heartbeat } from '$lib/types.js';
	import { formatDateTime, formatLatency } from '$lib/monitor-format.js';

	/**
	 * Response times over time as an area line. Failed checks break the line (a failed check's
	 * response time says nothing about the service) and mark the baseline in red instead.
	 */
	let {
		beats,
		height = 160,
		empty = 'Not enough checks in this range to chart yet.'
	}: { beats: Heartbeat[]; height?: number; empty?: string } = $props();

	const WIDTH = 800;
	const PAD = 4;
	// Five ticks on desktop; phones keep the first, middle and last.
	const TICKS = 5;

	const ok = (b: Heartbeat) => b.status !== 'down' && b.latencyMs !== null;
	/** Checks the line goes through. */
	const points = $derived(beats.filter(ok));
	/** Checks the hover and arrow keys step through: the line's points and the failures. */
	const samples = $derived(beats.filter((b) => ok(b) || b.status === 'down'));
	/** Runs of good checks between failures; each becomes its own stretch of line. */
	const segments = $derived.by(() => {
		const runs: Heartbeat[][] = [[]];
		for (const b of beats) {
			if (b.status === 'down') {
				if (runs.at(-1)!.length) runs.push([]);
			} else if (b.latencyMs !== null) runs.at(-1)!.push(b);
		}
		return runs.filter((r) => r.length);
	});
	const t0 = $derived(beats[0]?.checkedAt ?? 0);
	const t1 = $derived(beats.at(-1)?.checkedAt ?? 1);
	const max = $derived(Math.max(1, ...points.map((b) => b.latencyMs!)) * 1.15);
	const avg = $derived(
		points.length ? Math.round(points.reduce((s, b) => s + b.latencyMs!, 0) / points.length) : null
	);

	const x = (t: number) => PAD + ((t - t0) / Math.max(1, t1 - t0)) * (WIDTH - 2 * PAD);
	const y = (ms: number) => height - PAD - (ms / max) * (height - 2 * PAD);

	const trace = (run: Heartbeat[]) =>
		run
			.map((b, i) => `${i ? 'L' : 'M'}${x(b.checkedAt).toFixed(1)},${y(b.latencyMs!).toFixed(1)}`)
			.join('');
	const line = $derived(segments.map(trace).join(''));
	const area = $derived(
		segments
			.map(
				(run) =>
					`${trace(run)}L${x(run.at(-1)!.checkedAt).toFixed(1)},${height - PAD}L${x(run[0].checkedAt).toFixed(1)},${height - PAD}Z`
			)
			.join('')
	);
	const failures = $derived(beats.filter((b) => b.status === 'down'));
	/** Outages as [start, end] times: from a run's first failure to the next good check. */
	const outages = $derived.by(() => {
		const spans: [number, number][] = [];
		let start: number | null = null;
		for (const b of samples) {
			if (b.status === 'down') start ??= b.checkedAt;
			else if (start !== null) {
				spans.push([start, b.checkedAt]);
				start = null;
			}
		}
		if (start !== null) spans.push([start, t1]);
		return spans;
	});
	/** Narrowest outage band in viewBox units, so a single failed check stays visible. */
	const MIN_BAND = 4;

	/**
	 * Gridline values from the top down; the line at fraction f of the height is (1 - f) of max.
	 * A gridline right on the average line is dropped, so the two don't read as a double line.
	 */
	const grid = $derived(
		[0.25, 0.5, 0.75]
			.map((f) => ({ f, top: PAD + f * (height - 2 * PAD), ms: Math.round((1 - f) * max) }))
			.filter((g) => avg === null || Math.abs(g.top - y(avg)) > 14)
	);

	// Time axis relative to the newest check: "18h ago" reads unambiguously where clock times
	// would repeat across midnight. Ranges over a day and a half get dates instead.
	const long = $derived(t1 - t0 > 36 * 3_600_000);
	const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
	function tickLabel(t: number, last: boolean): string {
		if (last) return 'Now';
		if (long) return dateFormat.format(t);
		const minutes = Math.round((t1 - t) / 60_000);
		return minutes < 90 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
	}
	const ticks = $derived(
		Array.from({ length: TICKS }, (_, i) =>
			tickLabel(t0 + (i / (TICKS - 1)) * (t1 - t0), i === TICKS - 1)
		)
	);

	let hoverIndex = $state<number | null>(null);
	const hover = $derived(hoverIndex === null ? null : (samples[hoverIndex] ?? null));
	let svg = $state<SVGSVGElement | null>(null);
	const hoverFlip = $derived(hover !== null && x(hover.checkedAt) > WIDTH / 2);
	/** The hovered point's height in px: failures sit on the baseline. */
	const hoverY = $derived(
		hover === null ? 0 : hover.status === 'down' ? height - PAD - 3 : y(hover.latencyMs!)
	);
	/** What the hover chip shows, for screen readers stepping with the arrow keys. */
	const hoverText = $derived(
		hover === null
			? ''
			: `${hover.status === 'down' ? `Failed${hover.message ? `, ${hover.message}` : ''}` : formatLatency(hover.latencyMs)}, ${formatDateTime(hover.checkedAt)}`
	);

	function nearest(t: number): number {
		let best = 0;
		for (let i = 1; i < samples.length; i++)
			if (Math.abs(samples[i].checkedAt - t) < Math.abs(samples[best].checkedAt - t)) best = i;
		return best;
	}

	function onMove(e: PointerEvent) {
		if (!svg || samples.length === 0) return;
		const rect = svg.getBoundingClientRect();
		hoverIndex = nearest(t0 + ((e.clientX - rect.left) / rect.width) * (t1 - t0));
	}

	/** Arrow keys step through the checks, so the values are reachable without a pointer. */
	function onKey(e: KeyboardEvent) {
		const last = samples.length - 1;
		const step = e.shiftKey ? Math.max(1, Math.round(samples.length / 20)) : 1;
		const from = hoverIndex ?? last;
		const next =
			e.key === 'ArrowLeft'
				? Math.max(0, from - step)
				: e.key === 'ArrowRight'
					? Math.min(last, from + step)
					: e.key === 'Home'
						? 0
						: e.key === 'End'
							? last
							: e.key === 'Escape'
								? null
								: undefined;
		if (next === undefined) return;
		e.preventDefault();
		hoverIndex = next;
	}
</script>

{#if samples.length < 2}
	<p
		class="flex items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground"
		style="height: {Math.min(height, 96)}px"
	>
		{empty}
	</p>
{:else}
	<div>
		<div
			class="mb-2 flex min-h-5 items-baseline justify-between gap-4 text-xs text-muted-foreground"
		>
			<span class="inline-flex items-center gap-1.5">
				<span class="w-3 border-t border-dashed border-chart-1" aria-hidden="true"></span>
				Average
				<span class="font-medium text-foreground tabular-nums">{formatLatency(avg)}</span>
			</span>
			<span class="tabular-nums">Peak {formatLatency(Math.round(max / 1.15))}</span>
		</div>
		<!-- The right gutter holds the y-scale, so its labels never sit on the line. -->
		<div class="relative pr-11">
			<!-- Focusable so arrow keys can inspect checks. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
			<svg
				bind:this={svg}
				viewBox="0 0 {WIDTH} {height}"
				preserveAspectRatio="none"
				class="block w-full touch-pan-y rounded-md text-chart-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
				style="height: {height}px"
				role="img"
				tabindex="0"
				aria-label="Response time chart, average {formatLatency(
					avg
				)}. Use the arrow keys to read individual checks."
				onpointermove={onMove}
				onpointerdown={onMove}
				onpointerleave={() => (hoverIndex = null)}
				onkeydown={onKey}
				onblur={() => (hoverIndex = null)}
			>
				<defs>
					<linearGradient id="latency-fill" x1="0" x2="0" y1="0" y2="1">
						<stop offset="0%" stop-color="currentColor" stop-opacity="0.25" />
						<stop offset="100%" stop-color="currentColor" stop-opacity="0" />
					</linearGradient>
					<!-- Outages fade up from the red baseline marks: loud at the axis, quiet over the line.
					     currentColor in a gradient resolves on the gradient itself, hence its class. -->
					<linearGradient id="outage-fill" class="text-destructive" x1="0" x2="0" y1="0" y2="1">
						<stop offset="0%" stop-color="currentColor" stop-opacity="0.02" />
						<stop offset="100%" stop-color="currentColor" stop-opacity="0.22" />
					</linearGradient>
				</defs>
				{#each outages as [from, to] (from)}
					<rect
						x={x(from)}
						y="0"
						width={Math.max(MIN_BAND, x(to) - x(from))}
						{height}
						fill="url(#outage-fill)"
					/>
				{/each}
				{#each grid as { f, top } (f)}
					<line
						x1="0"
						x2={WIDTH}
						y1={top}
						y2={top}
						class="stroke-border"
						stroke-dasharray="3 4"
						vector-effect="non-scaling-stroke"
					/>
				{/each}
				<path d={area} fill="url(#latency-fill)" />
				{#if avg !== null}
					<line
						x1="0"
						x2={WIDTH}
						y1={y(avg)}
						y2={y(avg)}
						stroke="currentColor"
						stroke-opacity="0.5"
						stroke-dasharray="6 4"
						vector-effect="non-scaling-stroke"
					/>
				{/if}
				<path
					d={line}
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linejoin="round"
					vector-effect="non-scaling-stroke"
				/>
				{#each failures as f (f.checkedAt)}
					<rect
						x={x(f.checkedAt) - 1.5}
						y={height - PAD - 8}
						width="3"
						height="8"
						class="fill-destructive"
					/>
				{/each}
				{#if hover}
					<line
						x1={x(hover.checkedAt)}
						x2={x(hover.checkedAt)}
						y1="0"
						y2={height}
						class="stroke-foreground/30"
						vector-effect="non-scaling-stroke"
					/>
				{/if}
			</svg>
			<!-- The y-scale, as HTML so the text isn't stretched with the SVG. -->
			{#each grid as { f, top, ms } (f)}
				<span
					class="pointer-events-none absolute right-0 w-10 -translate-y-1/2 text-[11px] leading-4 text-muted-foreground tabular-nums"
					style="top: {top}px"
					aria-hidden="true"
				>
					{formatLatency(ms)}
				</span>
			{/each}
			{#if avg === null || height - PAD - y(avg) > 14}
				<span
					class="pointer-events-none absolute right-0 w-10 -translate-y-1/2 text-[11px] leading-4 text-muted-foreground tabular-nums"
					style="top: {height - PAD}px"
					aria-hidden="true"
				>
					0ms
				</span>
			{/if}
			{#if avg !== null}
				<span
					class="pointer-events-none absolute right-0 w-10 -translate-y-1/2 text-[11px] leading-4 font-medium text-chart-1 tabular-nums"
					style="top: {y(avg)}px"
					aria-hidden="true"
				>
					{formatLatency(avg)}
				</span>
			{/if}
			{#if hover}
				<!-- A round dot drawn outside the stretched SVG, so it stays a circle at any width. -->
				<span
					class="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card {hover.status ===
					'down'
						? 'bg-destructive'
						: 'bg-chart-1'}"
					style="left: calc({x(hover.checkedAt) / WIDTH} * (100% - 2.75rem)); top: {hoverY}px"
				></span>
				<!-- The value beside the point: above it (below near the top), flipped left in the right
				     half, so it stays inside the chart and off the line it describes. -->
				<span
					class="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md {hoverFlip
						? '-translate-x-[calc(100%+10px)]'
						: 'translate-x-2.5'} {hoverY > 52 ? '-translate-y-full' : ''}"
					style="left: calc({x(hover.checkedAt) / WIDTH} * (100% - 2.75rem)); top: {hoverY > 52
						? hoverY - 10
						: hoverY + 10}px"
					aria-hidden="true"
				>
					{#if hover.status === 'down'}
						<span class="font-medium text-destructive">Failed</span>
						{#if hover.message}<span class="text-muted-foreground"> · {hover.message}</span>{/if}
					{:else}
						<span class="font-medium tabular-nums">{formatLatency(hover.latencyMs)}</span>
					{/if}
					<span class="block text-[11px] text-muted-foreground">
						{formatDateTime(hover.checkedAt)}
					</span>
				</span>
			{/if}
			<span class="sr-only" aria-live="polite">{hoverText}</span>
		</div>
		<div
			class="mt-1.5 flex h-4 justify-between pr-11 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums"
			aria-hidden="true"
		>
			{#each ticks as tick, i (i)}
				<span class="first:text-left last:text-right {i % 2 ? 'max-sm:hidden' : ''}">{tick}</span>
			{/each}
		</div>
		{#if failures.length}
			<p class="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
				<span
					class="size-3 rounded-[3px] border-b-2 border-destructive bg-destructive/10"
					aria-hidden="true"
				></span>
				{failures.length} failed {failures.length === 1 ? 'check' : 'checks'} in this range
			</p>
		{/if}
	</div>
{/if}
