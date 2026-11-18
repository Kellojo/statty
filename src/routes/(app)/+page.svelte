<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import { fade } from 'svelte/transition';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import AnimatedNumber from '$lib/components/app/live/AnimatedNumber.svelte';
	import Latency from '$lib/components/app/live/Latency.svelte';
	import LiveDuration from '$lib/components/app/live/LiveDuration.svelte';
	import LiveIndicator from '$lib/components/app/live/LiveIndicator.svelte';
	import Uptime from '$lib/components/app/live/Uptime.svelte';
	import HeartbeatBar from '$lib/components/app/monitors/HeartbeatBar.svelte';
	import MonitorDialog from '$lib/components/app/monitors/MonitorDialog.svelte';
	import MonitorIcon from '$lib/components/app/monitors/MonitorIcon.svelte';
	import MonitorMenu from '$lib/components/app/monitors/MonitorMenu.svelte';
	import StatusDot from '$lib/components/app/monitors/StatusDot.svelte';
	import { LiveMonitors, dashboardStream } from '$lib/live/monitors.svelte.js';
	import { pollWhileDisconnected, refreshSoon } from '$lib/live/stream.svelte.js';
	import { flash } from '$lib/live/transitions.js';
	import { STATUS_TEXT, monitorTarget } from '$lib/monitor-format.js';
	import type { Monitor, MonitorStatus } from '$lib/types.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const BAR_SLOTS = 40;
	const live = new LiveMonitors();
	$effect(() => dashboardStream.listen(live.apply));
	$effect(() => pollWhileDisconnected(dashboardStream));

	/** The loaded monitors with check results that streamed in since. */
	const monitors = $derived(data.monitors.map((m) => live.merge(m, BAR_SLOTS)));

	let query = $state('');
	let filter = $state<MonitorStatus | 'all'>('all');
	let dialogOpen = $state(false);
	let editing = $state<Monitor | null>(null);

	const counts = $derived(
		monitors.reduce(
			(acc, m) => {
				acc[m.status]++;
				return acc;
			},
			{ up: 0, down: 0, pending: 0, unknown: 0, paused: 0 } as Record<MonitorStatus, number>
		)
	);

	const visible = $derived(
		monitors.filter((m) => {
			if (filter !== 'all' && m.status !== filter) return false;
			const q = query.trim().toLowerCase();
			return !q || m.name.toLowerCase().includes(q) || monitorTarget(m).toLowerCase().includes(q);
		})
	);

	const TILES: { status: MonitorStatus; label: string }[] = [
		{ status: 'up', label: 'Up' },
		{ status: 'down', label: 'Down' },
		{ status: 'pending', label: 'Pending' },
		{ status: 'paused', label: 'Paused' }
	];

	const FLASH: Record<MonitorStatus, string> = {
		up: 'var(--success)',
		down: 'var(--destructive)',
		pending: 'var(--warning)',
		unknown: 'var(--muted-foreground)',
		paused: 'var(--muted-foreground)'
	};

	/** A selected filter tile, tinted in its status colour. */
	const SELECTED: Record<MonitorStatus, string> = {
		up: 'border-success/60 bg-success/15 ring-2 ring-success/25',
		down: 'border-destructive/60 bg-destructive/15 ring-2 ring-destructive/25',
		pending: 'border-warning/70 bg-warning/15 ring-2 ring-warning/30',
		unknown: 'border-foreground/30 bg-accent/60 ring-2 ring-foreground/15',
		paused: 'border-foreground/30 bg-accent/60 ring-2 ring-foreground/15'
	};

	function openDialog(monitor: Monitor | null) {
		editing = monitor;
		dialogOpen = true;
	}
</script>

<svelte:head>
	<title>{counts.down > 0 ? `(${counts.down} down) ` : ''}Monitors · Statty</title>
</svelte:head>

<PageHeader title="Monitors">
	{#snippet description()}
		{#if monitors.length === 0}
			Every service Statty watches, checked on its own interval.
		{:else if counts.down > 0}
			<!-- The headline doubles as a shortcut to the Down filter. -->
			<button
				type="button"
				onclick={() => (filter = 'down')}
				class="rounded-sm font-medium text-destructive underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
			>
				{counts.down} of {monitors.length} monitors {counts.down === 1 ? 'is' : 'are'} down
			</button>
		{:else if counts.pending > 0}
			<span class="font-medium text-warning-foreground">
				{counts.pending}
				{counts.pending === 1 ? 'monitor is' : 'monitors are'} failing, retrying
			</span>
		{:else}
			All {monitors.length - counts.paused} active monitors are up.
		{/if}
	{/snippet}
	{#snippet badges()}<LiveIndicator connected={dashboardStream.connected} class="ml-1" />{/snippet}
	{#snippet actions()}
		<Button onclick={() => openDialog(null)}><PlusIcon />Add monitor</Button>
	{/snippet}
</PageHeader>

{#if monitors.length === 0}
	<Card.Root class="rounded-2xl">
		<EmptyState
			icon={ActivityIcon}
			title="No monitors yet"
			description="Add a URL to health-check or a Docker container to watch. Statty checks it right away."
		>
			<Button onclick={() => openDialog(null)}><PlusIcon />Add monitor</Button>
		</EmptyState>
	</Card.Root>
{:else}
	<!-- Four compact tiles in one row on every width; they double as status filters. -->
	<div class="grid grid-cols-4 gap-2 sm:gap-3">
		{#each TILES as tile (tile.status)}
			<button
				type="button"
				onclick={() => (filter = filter === tile.status ? 'all' : tile.status)}
				aria-pressed={filter === tile.status}
				aria-label="{tile.label}: {counts[tile.status]}{filter === tile.status
					? ' (filtering, press to show all)'
					: ''}"
				class="flex min-h-14 flex-col justify-center gap-0.5 rounded-2xl border bg-card px-3 py-2 text-left shadow-xs transition-colors outline-none hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-sm:px-2.5 sm:gap-1 sm:px-4 sm:py-3 {filter ===
				tile.status
					? SELECTED[tile.status]
					: ''}"
			>
				<span class="flex items-center gap-1.5 text-xs text-muted-foreground sm:gap-2">
					<StatusDot status={tile.status} class="size-2" />{tile.label}
				</span>
				<AnimatedNumber
					value={counts[tile.status]}
					class="text-xl font-semibold tabular-nums transition-colors duration-500 sm:text-2xl {counts[
						tile.status
					] > 0 && tile.status !== 'paused'
						? STATUS_TEXT[tile.status]
						: ''}"
				/>
			</button>
		{/each}
	</div>

	<Card.Root class="gap-0 overflow-hidden rounded-2xl py-0">
		<div class="flex items-center gap-2 border-b border-border/60 px-4 py-3">
			<div class="relative flex-1 sm:max-w-xs">
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input bind:value={query} placeholder="Search monitors" class="pl-9" aria-label="Search" />
			</div>
			{#if filter !== 'all'}
				<Button
					variant="secondary"
					size="sm"
					onclick={() => (filter = 'all')}
					aria-label="Clear the status filter"
				>
					{TILES.find((t) => t.status === filter)?.label}<XIcon />
				</Button>
			{/if}
			<span class="ml-auto text-xs text-muted-foreground tabular-nums" aria-live="polite">
				<!-- Only worth reading once a filter or search narrows the list; the live region stays mounted. -->
				{#if visible.length !== monitors.length}
					<AnimatedNumber value={visible.length} /> of <AnimatedNumber value={monitors.length} />
				{/if}
			</span>
		</div>
		{#if visible.length === 0}
			<div
				class="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-muted-foreground"
				in:fade={{ duration: 150 }}
			>
				<p>
					{filter !== 'all' && !query.trim()
						? `No monitors are ${TILES.find((t) => t.status === filter)?.label.toLowerCase()}.`
						: 'No monitors match.'}
				</p>
				<Button
					variant="outline"
					size="sm"
					onclick={() => {
						filter = 'all';
						query = '';
					}}
				>
					Show all monitors
				</Button>
			</div>
		{:else}
			<!-- Column labels, desktop only (phones fold the figures under each name). -->
			<div
				class="hidden grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_5rem_6.5rem_auto] items-center gap-x-3 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground md:grid"
				aria-hidden="true"
			>
				<span class="size-2.5"></span>
				<span>Monitor</span>
				<span>Last {BAR_SLOTS} checks</span>
				<span class="text-right">Uptime 24h</span>
				<span class="text-right">Response</span>
				<span class="size-8"></span>
			</div>
			<ul class="divide-y divide-border/60" aria-label="Monitors">
				{#each visible as monitor (monitor.id)}
					<li
						animate:flip={{ duration: 300, easing: cubicOut }}
						transition:fade={{ duration: 150 }}
						class="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 bg-card px-4 py-3 hover:bg-accent/30 md:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_5rem_6.5rem_auto]"
					>
						{#key monitor.status}
							<span
								class="pointer-events-none absolute inset-0"
								in:flash={{ color: FLASH[monitor.status] }}
								aria-hidden="true"
							></span>
						{/key}
						<!-- Level with the name's first line, also when an error line follows. -->
						<StatusDot status={monitor.status} class="mt-[5px] self-start" />
						<div class="flex min-w-0 flex-col gap-0.5">
							<div class="flex min-w-0 items-baseline justify-between gap-3">
								<a
									href={resolve('/(app)/monitors/[id]', { id: monitor.id })}
									class="truncate text-sm font-medium outline-none after:absolute after:inset-0 after:content-['']"
								>
									{monitor.name}
								</a>
							</div>
							<span class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
								<MonitorIcon {monitor} />
								<span class="truncate">{monitorTarget(monitor)}</span>
								{#if !monitor.public}<EyeOffIcon
										class="size-3 shrink-0"
										aria-label="Not on the status page"
									/>{/if}
							</span>
							{#if (monitor.status === 'down' || monitor.status === 'pending') && monitor.message}
								<span
									class="line-clamp-3 text-xs break-words md:line-clamp-1 {monitor.status === 'down'
										? 'text-destructive'
										: 'text-warning-foreground'}"
									title={monitor.message}
									transition:fade={{ duration: 200 }}
								>
									{monitor.status === 'pending' ? 'Retrying · ' : ''}{monitor.message}
								</span>
							{/if}
							{#if monitor.status === 'paused'}
								<span class="text-xs text-muted-foreground">Paused · not being checked</span>
							{:else}<!-- Phones: the uptime and latency columns fold into one line. --><span
									class="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums md:hidden"
								>
									<span><Uptime value={monitor.uptime.day} class="text-foreground" /> uptime</span>
									{#if monitor.latencyMs !== null}
										<span aria-hidden="true">·</span>
										<Latency ms={monitor.latencyMs} />
									{/if}
									<!-- When it was checked; desktop shows this under the response column. -->
									{#if monitor.lastCheckedAt}
										<span aria-hidden="true">·</span>
										<LiveDuration since={monitor.lastCheckedAt} suffix=" ago" />
									{/if}
								</span>{/if}
						</div>
						<HeartbeatBar
							beats={monitor.recent}
							slots={BAR_SLOTS}
							mobileSlots={28}
							class="col-span-3 row-start-2 h-4 md:col-span-1 md:row-start-auto md:h-5"
						/>
						<div class="hidden flex-col items-end md:flex">
							<Uptime value={monitor.uptime.day} class="text-sm tabular-nums" />
						</div>
						<div class="hidden flex-col items-end md:flex">
							{#if monitor.status === 'paused'}
								<span class="text-sm text-muted-foreground">Paused</span>
							{:else}
								<Latency
									ms={monitor.latencyMs}
									fallback="No response"
									class="text-sm tabular-nums {monitor.latencyMs === null
										? 'text-muted-foreground'
										: ''}"
								/>
								<span class="text-xs text-muted-foreground" title="Last check">
									{#if monitor.lastCheckedAt}<LiveDuration
											since={monitor.lastCheckedAt}
											suffix=" ago"
										/>{:else}Not checked yet{/if}
								</span>
							{/if}
						</div>
						<div class="relative z-10 col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
							<MonitorMenu {monitor} onEdit={() => openDialog(monitor)} />
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Card.Root>
{/if}

<MonitorDialog
	bind:open={dialogOpen}
	monitor={editing}
	onSaved={(m) => {
		if (!editing) void goto(resolve('/(app)/monitors/[id]', { id: m.id }));
		else refreshSoon(0);
	}}
/>
