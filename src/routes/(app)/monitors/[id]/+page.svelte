<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { toast } from 'svelte-sonner';
	import PlayIcon from '@lucide/svelte/icons/play';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import HeartbeatBar from '$lib/components/app/monitors/HeartbeatBar.svelte';
	import LatencyChart from '$lib/components/app/monitors/LatencyChart.svelte';
	import MonitorDialog from '$lib/components/app/monitors/MonitorDialog.svelte';
	import MonitorIcon from '$lib/components/app/monitors/MonitorIcon.svelte';
	import MonitorMenu from '$lib/components/app/monitors/MonitorMenu.svelte';
	import StatusBadge from '$lib/components/app/monitors/StatusBadge.svelte';
	import StatusDot from '$lib/components/app/monitors/StatusDot.svelte';
	import Latency from '$lib/components/app/live/Latency.svelte';
	import LiveDuration from '$lib/components/app/live/LiveDuration.svelte';
	import LiveIndicator from '$lib/components/app/live/LiveIndicator.svelte';
	import Uptime from '$lib/components/app/live/Uptime.svelte';
	import { apiRequest } from '$lib/api-client.js';
	import { LiveMonitors, dashboardStream } from '$lib/live/monitors.svelte.js';
	import { pollWhileDisconnected, refreshSoon } from '$lib/live/stream.svelte.js';
	import {
		STATUS_BG,
		STATUS_LABEL,
		STATUS_TEXT,
		formatDateTime,
		formatDuration,
		formatInterval,
		monitorTarget
	} from '$lib/monitor-format.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const BAR_SLOTS = 60;
	// 60 bars at phone width would be hairlines; show the newest 30, twice as wide.
	const MOBILE_SLOTS = 30;
	const live = new LiveMonitors();
	// Only this monitor's events matter here (others would just reload the page).
	$effect(() =>
		dashboardStream.listen((event) => {
			if (event.monitorId !== data.monitor.id) return;
			// Deleted elsewhere (another tab, the API or MCP): there is nothing left to show.
			if (event.type === 'monitor.deleted') void goto(resolve('/'));
			else live.apply(event);
		})
	);
	$effect(() => pollWhileDisconnected(dashboardStream));

	let editOpen = $state(false);
	/** The loaded monitor with check results that streamed in since. */
	const m = $derived(live.merge(data.monitor, BAR_SLOTS));
	/** The chart's checks, with the ones that streamed in appended. */
	const history = $derived.by(() => {
		const until = data.history.at(-1)?.checkedAt ?? 0;
		return [...data.history, ...live.newBeats(data.monitor.id, until)];
	});

	/**
	 * When the current status began. The newest status change in the history is the truth;
	 * the monitor's own timestamp is the fallback until a live change reloads the history.
	 */
	const statusSince = $derived(
		data.changes[0]?.status === m.status ? data.changes[0].checkedAt : m.lastChangeAt
	);

	let resuming = $state(false);
	async function resume() {
		resuming = true;
		try {
			await apiRequest(`/api/v1/monitors/${m.id}`, 'PATCH', { enabled: true });
			toast.success('Monitor resumed');
			refreshSoon(0);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Something went wrong');
		} finally {
			resuming = false;
		}
	}

	const THIS_YEAR = new Date().getFullYear();
	/** "Nov 18, 9:05 PM": the year only when it isn't this one, so phone rows stay on one line. */
	function formatShortDateTime(ts: number): string {
		return new Intl.DateTimeFormat(undefined, {
			year: new Date(ts).getFullYear() === THIS_YEAR ? undefined : 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(ts);
	}

	// The newest few are what matter; a flapping monitor would otherwise make the page endless.
	const CHANGES_SHOWN = 6;
	let showAllChanges = $state(false);

	/** Each status change with how long that status held (the newest is still going on). */
	const changes = $derived(
		data.changes.map((change, i) => ({
			...change,
			lasted: i === 0 ? null : formatDuration(data.changes[i - 1].checkedAt - change.checkedAt)
		}))
	);

	const uptimes = $derived([
		{ label: 'Uptime 24h', value: m.uptime.day },
		{ label: 'Uptime 7d', value: m.uptime.week },
		{ label: 'Uptime 30d', value: m.uptime.month }
	]);

	// Same surface as the cards around them, so the stats don't read as a different component.
	const TILE =
		'flex flex-col gap-1 rounded-2xl bg-card px-4 py-2.5 shadow-md sm:py-3 ring-1 ring-foreground/5 dark:ring-foreground/10';

	function setRange(range: string) {
		// This page's resolved path plus its own query.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		void goto(`${resolve('/(app)/monitors/[id]', { id: m.id })}?range=${range}`, {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}
</script>

<svelte:head><title>{m.name} · Statty</title></svelte:head>

<PageHeader title={m.name} back={{ href: resolve('/'), label: 'Monitors' }}>
	{#snippet leading()}<StatusDot status={m.status} class="size-3" /><MonitorIcon
			monitor={m}
			size={22}
		/>{/snippet}
	{#snippet badges()}
		<StatusBadge status={m.status} />
		{#if !m.public}<Badge variant="outline" class="font-normal text-muted-foreground">
				Private
			</Badge>{/if}
	{/snippet}
	{#snippet description()}
		{#if m.type === 'http' && m.url}
			<!-- eslint-disable svelte/no-navigation-without-resolve -- the monitored external URL -->
			<a
				href={m.url}
				target="_blank"
				rel="noopener noreferrer"
				class="font-mono text-[13px] break-all text-foreground/80 hover:underline"
			>
				{monitorTarget(m)}
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{:else}
			<span class="font-mono text-[13px] text-foreground/80">{monitorTarget(m)}</span>
		{/if}
		<span class="whitespace-nowrap">· every {formatInterval(m.intervalSeconds)}</span>
		{#if m.description}<span class="mt-1 block">{m.description}</span>{/if}
	{/snippet}
	{#snippet actions()}
		<MonitorMenu
			monitor={m}
			text="Actions"
			onEdit={() => (editOpen = true)}
			onDeleted={() => goto(resolve('/'))}
		/>
	{/snippet}
</PageHeader>

<!-- A faint red wash while down, so an incident is obvious before reading anything. -->
<Card.Root
	class="gap-3 rounded-2xl transition-colors duration-500 {m.status === 'down'
		? 'bg-destructive/5 ring-destructive/25 dark:bg-destructive/10 dark:ring-destructive/30'
		: ''}"
>
	<Card.Content class="flex flex-col gap-3">
		<div class="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
			{#if m.status === 'paused'}
				<span class="text-muted-foreground">Paused, so it isn't being checked.</span>
				<Button size="sm" variant="outline" disabled={resuming} onclick={resume}>
					<PlayIcon aria-hidden="true" />
					{resuming ? 'Resuming…' : 'Resume'}
				</Button>
			{:else}
				<span>
					{#if m.lastCheckedAt}
						<span class="font-medium {STATUS_TEXT[m.status]}">{STATUS_LABEL[m.status]}</span>
						{#if statusSince}for <LiveDuration since={statusSince} />{/if}
						{#if m.message}<span class="text-muted-foreground"> · {m.message}</span>{/if}
					{:else}
						Waiting for the first check…
					{/if}
				</span>
				<span class="flex items-center gap-2 text-xs text-muted-foreground">
					<LiveIndicator connected={dashboardStream.connected} />
					{#if m.lastCheckedAt}
						<span aria-hidden="true">·</span>
						<span>Checked <LiveDuration since={m.lastCheckedAt} suffix=" ago" /></span>
					{/if}
				</span>
			{/if}
		</div>
		<!-- A paused monitor that was never checked would only show empty placeholders. -->
		{#if m.recent.length > 0 || m.status !== 'paused'}
			<HeartbeatBar
				beats={m.recent}
				slots={BAR_SLOTS}
				mobileSlots={MOBILE_SLOTS}
				class="h-8 {m.status === 'paused' ? 'opacity-50' : ''}"
			/>
			<div class="-mt-1 flex justify-between text-[11px] text-muted-foreground" aria-hidden="true">
				<span class="sm:hidden">Last {MOBILE_SLOTS} checks</span>
				<span class="max-sm:hidden">Last {BAR_SLOTS} checks</span>
				<span>{m.status === 'paused' ? 'Paused' : 'Now'}</span>
			</div>
		{/if}
	</Card.Content>
</Card.Root>

<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
	<div class={TILE}>
		<span class="text-xs text-muted-foreground">Current response</span>
		{#if m.status === 'down'}
			<!-- A failed check's response time would read as healthy next to "Down". -->
			<span class="text-xl font-semibold text-destructive">Failed</span>
		{:else}
			<Latency ms={m.latencyMs} class="text-xl font-semibold tabular-nums" />
		{/if}
	</div>
	{#each uptimes as stat (stat.label)}
		<div class={TILE}>
			<span class="text-xs text-muted-foreground">{stat.label}</span>
			<Uptime value={stat.value} class="text-xl font-semibold tabular-nums" />
		</div>
	{/each}
</div>

<Card.Root class="gap-4 rounded-2xl">
	<Card.Header class="flex flex-wrap items-center justify-between gap-2">
		<Card.Title class="text-base font-semibold">Response time</Card.Title>
		<Tabs.Root value={data.range} onValueChange={setRange}>
			<Tabs.List>
				<Tabs.Trigger value="1h">1h</Tabs.Trigger>
				<Tabs.Trigger value="24h">24h</Tabs.Trigger>
				<Tabs.Trigger value="7d">7d</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>
	</Card.Header>
	<Card.Content>
		<LatencyChart
			beats={history}
			empty={m.status === 'paused'
				? 'No checks in this range while paused.'
				: 'Not enough checks in this range to chart yet.'}
		/>
	</Card.Content>
</Card.Root>

<Card.Root class="gap-2 rounded-2xl pb-2">
	<Card.Header>
		<Card.Title class="text-base font-semibold">Status changes</Card.Title>
		<Card.Description>When the monitor went up, down or pending.</Card.Description>
	</Card.Header>
	{#if changes.length === 0}
		<p class="px-(--card-spacing) pb-4 text-sm text-muted-foreground">No checks yet.</p>
	{:else}
		<ul class="divide-y divide-border/60 border-t border-border/60">
			{#each showAllChanges ? changes : changes.slice(0, CHANGES_SHOWN) as change (change.checkedAt)}
				<li
					class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 px-(--card-spacing) py-2.5 text-sm"
					in:slide={{ duration: 300, easing: cubicOut }}
				>
					<span
						class="size-2 shrink-0 translate-y-[-1px] self-center rounded-full {STATUS_BG[
							change.status
						]}"
						aria-hidden="true"
					></span>
					<span class="min-w-0">
						<span class="font-medium">{STATUS_LABEL[change.status]}</span>
						{#if change.lasted}
							<span class="text-xs text-muted-foreground tabular-nums">for {change.lasted}</span>
						{:else}
							<span
								class="text-xs {change.status === 'down'
									? 'font-medium text-destructive'
									: 'text-muted-foreground'}"
							>
								ongoing
							</span>
						{/if}
					</span>
					<time
						datetime={new Date(change.checkedAt).toISOString()}
						title={formatDateTime(change.checkedAt)}
						class="text-xs text-muted-foreground tabular-nums"
					>
						{formatShortDateTime(change.checkedAt)}
					</time>
					{#if change.message}
						<span class="col-start-2 col-end-4 mt-0.5 text-xs break-words text-foreground/70">
							{change.message}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
		{#if changes.length > CHANGES_SHOWN}
			<div class="border-t border-border/60 px-(--card-spacing) pt-2">
				<Button
					variant="ghost"
					size="sm"
					class="-ml-2.5 text-muted-foreground"
					aria-expanded={showAllChanges}
					onclick={() => (showAllChanges = !showAllChanges)}
				>
					{showAllChanges ? 'Show fewer' : `Show ${changes.length - CHANGES_SHOWN} more`}
				</Button>
			</div>
		{/if}
	{/if}
</Card.Root>

<MonitorDialog bind:open={editOpen} monitor={m} onSaved={() => refreshSoon(0)} />
