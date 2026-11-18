<script lang="ts">
	import { resolve } from '$app/paths';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
	import BrandMark from '$lib/components/app/BrandMark.svelte';
	import StatusBadge from '$lib/components/app/monitors/StatusBadge.svelte';
	import MonitorIcon from '$lib/components/app/monitors/MonitorIcon.svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { fade } from 'svelte/transition';
	import LiveDuration from '$lib/components/app/live/LiveDuration.svelte';
	import LiveIndicator from '$lib/components/app/live/LiveIndicator.svelte';
	import Uptime from '$lib/components/app/live/Uptime.svelte';
	import UptimeBars, { DAY_TONES } from './UptimeBars.svelte';
	import { publicStream } from '$lib/live/monitors.svelte.js';
	import { pollWhileDisconnected, refreshSoon } from '$lib/live/stream.svelte.js';
	import { flash } from '$lib/live/transitions.js';
	import { overallStatus } from '$lib/status.js';
	import type { MonitorStatus, PublicEvent } from '$lib/types.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Live status per monitor, laid over the loaded data until it catches up. */
	const live = new SvelteMap<string, PublicEvent & { type: 'monitor.checked' }>();
	let lastEventAt = $state<number | null>(null);

	$effect(() =>
		publicStream.listen((event) => {
			if (event.type !== 'monitor.checked') {
				refreshSoon();
				return;
			}
			const before = monitors.find((m) => m.id === event.monitorId)?.status;
			live.set(event.monitorId, event);
			lastEventAt = event.lastCheckedAt;
			// A status change moves the day bars and uptime: reload those from the server.
			if (before !== event.status) refreshSoon(1_000);
		})
	);
	$effect(() => pollWhileDisconnected(publicStream, 30_000));

	const monitors = $derived(
		data.monitors.map((m) => {
			const patch = live.get(m.id);
			if (!patch || (patch.lastCheckedAt ?? 0) <= (m.lastCheckedAt ?? 0)) return m;
			return {
				...m,
				status: patch.status,
				latencyMs: patch.latencyMs,
				lastCheckedAt: patch.lastCheckedAt
			};
		})
	);
	const status = $derived(overallStatus(monitors.map((m) => m.status)));
	const updatedAt = $derived(Math.max(data.generatedAt, lastEventAt ?? 0));

	/**
	 * Customer-facing words, matching the banner and the bar legend; the app's own
	 * labels ("Up", "Pending") are operator jargon.
	 */
	const PUBLIC_LABEL: Record<MonitorStatus, string> = {
		up: 'Operational',
		down: 'Outage',
		pending: 'Degraded',
		unknown: 'No data',
		paused: 'Paused'
	};

	const FLASH: Record<MonitorStatus, string> = {
		up: 'var(--success)',
		down: 'var(--destructive)',
		pending: 'var(--warning)',
		unknown: 'var(--muted-foreground)',
		paused: 'var(--muted-foreground)'
	};

	const BANNER = {
		operational: {
			title: 'All systems operational',
			icon: CircleCheckIcon,
			tone: 'border-success/25 bg-success/10 text-success-foreground',
			disc: 'bg-success',
			tint: 'var(--success)'
		},
		degraded: {
			title: 'Some systems are having problems',
			icon: TriangleAlertIcon,
			tone: 'border-warning/30 bg-warning/12 text-warning-foreground',
			disc: 'bg-warning',
			tint: 'var(--warning)'
		},
		outage: {
			title: 'Major outage',
			icon: CircleXIcon,
			tone: 'border-destructive/25 bg-destructive/10 text-destructive',
			disc: 'bg-destructive',
			tint: 'var(--destructive)'
		},
		unknown: {
			title: 'No status to report yet',
			icon: CircleDashedIcon,
			tone: 'border-border bg-muted/60 text-muted-foreground',
			disc: 'bg-muted-foreground',
			tint: 'var(--muted-foreground)'
		}
	} as const;

	const banner = $derived(BANNER[status]);

	/** One line under the banner title naming what is affected, so visitors needn't scan. */
	const detail = $derived.by(() => {
		const active = monitors.filter((m) => m.status !== 'paused' && m.status !== 'unknown');
		const down = active.filter((m) => m.status === 'down').map((m) => m.name);
		const pending = active.filter((m) => m.status === 'pending').map((m) => m.name);
		const list = (names: string[]) =>
			names.length <= 2
				? names.join(' and ')
				: `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
		if (status === 'unknown') return 'Checks have not reported yet.';
		if (status === 'operational')
			return active.length === 1
				? 'The service is running normally.'
				: `All ${active.length} services are running normally.`;
		if (status === 'outage')
			return active.length === 1 ? 'The service is down.' : 'All services are down.';
		const parts = [];
		if (down.length) parts.push(`${list(down)} ${down.length === 1 ? 'is' : 'are'} down`);
		if (pending.length)
			parts.push(`${list(pending)} ${pending.length === 1 ? 'is' : 'are'} degraded`);
		return `${parts.join('; ')}.`;
	});

	// Phones show 30 days, tablets 60, wider screens 90. CSS hides the bars; this only
	// keeps the keyboard and labels inside what is shown.
	let innerWidth = $state(1024);
	/**
	 * The bars' window: days since the first check on the page, rounded down to 30, 60
	 * or 90 so the axis matches the 30-day uptime figure instead of reading "31 days".
	 */
	const history = $derived.by(() => {
		const total = monitors[0]?.days.length ?? 90;
		const firstData = Math.min(
			...monitors.map((m) => {
				const i = m.days.findIndex((d) => d.uptime !== null);
				return i === -1 ? total : i;
			})
		);
		return Math.min(total, Math.max(30, Math.floor((total - firstData) / 30) * 30));
	});
	const visibleDays = $derived(
		Math.min(history, innerWidth < 640 ? 30 : innerWidth < 768 ? 60 : 90)
	);
</script>

{#snippet legend()}
	<ul
		class="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground"
		aria-label="Legend"
	>
		{#each [['Operational', DAY_TONES.up], ['Degraded', DAY_TONES.degraded], ['Outage', DAY_TONES.down], ['No data', DAY_TONES.none]] as [label, tone] (label)}
			<li class="flex items-center gap-1.5">
				<span class="size-2.5 rounded-[3px] {tone}" aria-hidden="true"></span>{label}
			</li>
		{/each}
	</ul>
{/snippet}

<svelte:window bind:innerWidth />

<svelte:head>
	<title>{data.page.title}</title>
	{#if data.page.description}<meta name="description" content={data.page.description} />{/if}
</svelte:head>

<div class="status-bg min-h-dvh" style="--tint: {banner.tint}">
	<div
		class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-[calc(2rem+var(--safe-top))] pb-[calc(2.5rem+var(--safe-bottom))] sm:gap-8 sm:px-6 sm:pt-[calc(3.5rem+var(--safe-top))]"
	>
		<header class="flex flex-col gap-3">
			<div class="flex items-center justify-between gap-4">
				<div class="flex min-w-0 items-center gap-3">
					<BrandMark class="size-9" />
					<h1 class="truncate text-xl font-semibold tracking-tight sm:text-2xl">
						{data.page.title}
					</h1>
				</div>
				<a
					href={resolve(data.signedIn ? '/' : '/login')}
					class="inline-flex h-8 shrink-0 items-center rounded-full border bg-background/60 px-3 text-sm font-medium text-muted-foreground shadow-xs transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					{data.signedIn ? 'Dashboard' : 'Sign in'}
				</a>
			</div>
			{#if data.page.description}
				<p class="max-w-prose text-sm text-pretty whitespace-pre-line text-muted-foreground">
					{data.page.description}
				</p>
			{/if}
		</header>

		<div
			class="flex flex-col gap-3 rounded-2xl border px-4 py-4 transition-colors duration-700 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5 {banner.tone}"
			role="status"
		>
			{#key status}
				<div class="flex min-w-0 items-start gap-3.5" in:fade={{ duration: 400 }}>
					<span
						class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full text-white shadow-sm dark:text-background {banner.disc}"
					>
						<banner.icon class="size-[1.125rem]" aria-hidden="true" />
					</span>
					<div class="flex min-w-0 flex-col gap-0.5">
						<p class="text-base font-semibold text-balance sm:text-lg">{banner.title}</p>
						<p class="text-sm text-pretty text-foreground/80">{detail}</p>
					</div>
				</div>
			{/key}
			<!-- Indented on phones to line up with the title, not the icon. -->
			<span
				class="flex shrink-0 items-center gap-3 pl-[2.875rem] text-xs text-foreground/80 sm:pl-0"
			>
				<LiveIndicator connected={publicStream.connected} class="text-current" />
				<span class="tabular-nums">Updated <LiveDuration since={updatedAt} suffix=" ago" /></span>
			</span>
		</div>

		{#if monitors.length === 0}
			<div
				class="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-12 text-center"
			>
				<CircleDashedIcon class="size-6 text-muted-foreground" aria-hidden="true" />
				<p class="text-sm font-medium">No services are listed yet</p>
				<p class="text-sm text-muted-foreground">Check back soon.</p>
			</div>
		{:else}
			<section class="flex flex-col gap-3" aria-labelledby="services-heading">
				<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
					<h2 id="services-heading" class="text-sm font-medium text-muted-foreground">Services</h2>
					{@render legend()}
				</div>
				<ul class="divide-y divide-border/60 rounded-2xl border bg-card shadow-xs">
					{#each monitors as monitor (monitor.id)}
						<li
							class="relative flex flex-col gap-3 px-4 py-4 first:rounded-t-2xl last:rounded-b-2xl sm:px-5"
						>
							{#key monitor.status}
								<span
									class="pointer-events-none absolute inset-0 rounded-[inherit]"
									in:flash={{ color: FLASH[monitor.status] }}
									aria-hidden="true"
								></span>
							{/key}
							<div class="flex items-start justify-between gap-3">
								<div class="flex min-w-0 flex-col gap-0.5">
									<h3 class="flex min-w-0 items-center gap-2 text-sm font-semibold">
										<MonitorIcon {monitor} /><span class="truncate">{monitor.name}</span>
									</h3>
									{#if monitor.status === 'paused'}
										<p class="truncate text-xs text-muted-foreground">Monitoring paused</p>
									{:else if monitor.description}
										<p class="truncate text-xs text-muted-foreground">{monitor.description}</p>
									{/if}
								</div>
								<div class="flex shrink-0 items-center gap-2.5">
									{#if monitor.uptime.month !== null}
										<span
											class="inline-flex items-baseline gap-1 text-xs text-muted-foreground tabular-nums"
											title="Uptime over the last 30 days"
										>
											<Uptime value={monitor.uptime.month} class="font-medium text-foreground/85" />
											<span class="sm:hidden">· 30d</span>
											<span class="max-sm:hidden">uptime, 30 days</span>
										</span>
									{/if}
									<StatusBadge status={monitor.status} label={PUBLIC_LABEL[monitor.status]} />
								</div>
							</div>
							<UptimeBars name={monitor.name} days={monitor.days} {history} visible={visibleDays} />
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<footer class="flex flex-col items-center gap-3 pt-8 text-xs text-muted-foreground">
			<p>Days in UTC · Powered by <span class="font-medium text-foreground/80">Statty</span></p>
		</footer>
	</div>
</div>

<style>
	.status-bg {
		background-image: radial-gradient(
			ellipse 70% 320px at 50% 0%,
			color-mix(in oklch, var(--tint) 9%, transparent),
			transparent
		);
	}
</style>
