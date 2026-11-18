<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import SettingsHeader from '$lib/components/app/settings/SettingsHeader.svelte';
	import SettingsSection from '$lib/components/app/settings/SettingsSection.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import StatusDot from '$lib/components/app/monitors/StatusDot.svelte';
	import MonitorIcon from '$lib/components/app/monitors/MonitorIcon.svelte';
	import { apiRequest } from '$lib/api-client.js';
	import { STATUS_LABEL, STATUS_TEXT } from '$lib/monitor-format.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The form starts from the saved settings and is compared against them to enable Save.
	const initial = (() => ({ ...data.settings }))();
	let title = $state(initial.title);
	let description = $state(initial.description);
	let saving = $state(false);
	const dirty = $derived(
		title.trim() !== data.settings.title || description.trim() !== data.settings.description
	);

	let toggling = $state<string | null>(null);
	let bulkBusy = $state(false);
	const allPublic = $derived(data.monitors.every((m) => m.public));
	const publicCount = $derived(data.monitors.filter((m) => m.public).length);
	const publicUrl = $derived(`${data.origin}/status`);

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (saving || !dirty) return;
		saving = true;
		try {
			await apiRequest('/api/settings/status-page', 'PUT', { title, description });
			toast.success('Status page saved');
			await invalidateAll();
			title = data.settings.title;
			description = data.settings.description;
			justSaved = true;
			clearTimeout(savedTimer);
			savedTimer = setTimeout(() => (justSaved = false), 2500);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Saving failed');
		} finally {
			saving = false;
		}
	}

	let urlCopied = $state(false);
	let urlTimer: ReturnType<typeof setTimeout> | undefined;
	async function copyUrl() {
		try {
			await navigator.clipboard.writeText(publicUrl);
			urlCopied = true;
			clearTimeout(urlTimer);
			urlTimer = setTimeout(() => (urlCopied = false), 1500);
		} catch {
			toast.error('Couldn’t copy to the clipboard');
		}
	}

	/** Brief "Saved" confirmation in the hint slot after a save. */
	let justSaved = $state(false);
	let savedTimer: ReturnType<typeof setTimeout> | undefined;

	function discard() {
		title = data.settings.title;
		description = data.settings.description;
	}

	async function setPublic(id: string, value: boolean) {
		toggling = id;
		try {
			await apiRequest(`/api/v1/monitors/${id}`, 'PATCH', { public: value });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Saving failed');
		} finally {
			// Also reverts the switch when the request failed.
			await invalidateAll();
			toggling = null;
		}
	}

	// One request per monitor: there is no bulk endpoint, and seven-ish PATCHes are instant.
	async function setAllPublic(value: boolean) {
		bulkBusy = true;
		try {
			const changed = data.monitors.filter((m) => m.public !== value);
			await Promise.all(
				changed.map((m) => apiRequest(`/api/v1/monitors/${m.id}`, 'PATCH', { public: value }))
			);
			toast.success(value ? 'All monitors are on the page' : 'All monitors are hidden');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Saving failed');
		} finally {
			await invalidateAll();
			bulkBusy = false;
		}
	}
</script>

<svelte:head><title>Status page · Settings · Statty</title></svelte:head>

<SettingsHeader
	title="Status page"
	description="A public page anyone can open without signing in. It shows names and status only, never URLs, containers or error messages."
/>

<SettingsSection title="Page details">
	<!-- The URL, then both of its actions side by side: on phones they wrap under it together. -->
	<div class="flex flex-col gap-2">
		<span class="text-sm text-muted-foreground" id="sp-url-label">Public URL</span>
		<div class="flex flex-wrap items-center gap-2">
			<code
				class="flex min-h-9 min-w-0 flex-1 basis-60 items-center rounded-lg border border-border/60 bg-muted/50 px-3 py-1.5 font-mono text-sm wrap-anywhere select-all"
				aria-labelledby="sp-url-label"
			>
				{publicUrl}
			</code>
			<div class="flex shrink-0 gap-2">
				<Button variant="outline" size="sm" onclick={copyUrl}>
					{#if urlCopied}<CheckIcon />Copied{:else}<CopyIcon />Copy{/if}
				</Button>
				<Button
					variant="outline"
					size="sm"
					href={resolve('/status')}
					target="_blank"
					rel="noopener"
				>
					<ExternalLinkIcon />View page
					<span class="sr-only">(opens in a new tab)</span>
				</Button>
			</div>
		</div>
		<span class="sr-only" aria-live="polite">{urlCopied ? 'Link copied' : ''}</span>
	</div>
	<form class="flex flex-col gap-4 border-t border-border/60 pt-4" onsubmit={save}>
		<div class="flex flex-col gap-2">
			<Label for="sp-title">Title</Label>
			<Input id="sp-title" bind:value={title} required maxlength={100} />
		</div>
		<div class="flex flex-col gap-2">
			<Label for="sp-description">
				Description <span class="font-normal text-muted-foreground">(optional)</span>
			</Label>
			<Textarea
				id="sp-description"
				bind:value={description}
				maxlength={1000}
				rows={2}
				placeholder="e.g. Live status of our website and APIs. Questions? support@example.com"
				aria-describedby="sp-description-hint"
			/>
			<p id="sp-description-hint" class="text-xs text-muted-foreground">
				Shown under the title. Line breaks are kept.
				{#if description.length > 800}
					<span class="tabular-nums">{description.length} / 1000</span>
				{/if}
			</p>
		</div>
		<div class="flex items-center gap-2">
			<span class="mr-auto text-sm text-muted-foreground" aria-live="polite">
				{dirty ? 'Unsaved changes' : justSaved ? 'Saved' : ''}
			</span>
			<!-- Always laid out (just invisible, which also takes it out of the tab order) so Save
				doesn't move when the form becomes dirty. -->
			<Button type="button" variant="ghost" class={dirty ? '' : 'invisible'} onclick={discard}>
				Discard
			</Button>
			<Button type="submit" disabled={saving || !dirty || !title.trim()}>
				{#if saving}<Loader2Icon class="animate-spin" />{/if}Save
			</Button>
		</div>
	</form>
</SettingsSection>

<SettingsSection
	title="Monitors on the page"
	description="Visitors see each one's name, status and uptime. Switches apply right away."
	flush
>
	{#if data.monitors.length === 0}
		<div class="border-t border-border/60">
			<EmptyState
				icon={ActivityIcon}
				compact
				title="No monitors yet"
				description="Add a monitor first, then choose here whether it appears on the public page."
			>
				<Button variant="outline" size="sm" href={resolve('/')}>Go to monitors</Button>
			</EmptyState>
		</div>
	{:else}
		<!-- A toolbar row rather than a header action, so phones keep count and button on one line. -->
		<div
			class="flex items-center justify-between gap-3 border-t border-border/60 px-(--card-spacing) py-2"
		>
			<p class="text-sm text-muted-foreground">
				<span class="font-medium text-foreground tabular-nums">{publicCount}</span> of
				<span class="tabular-nums">{data.monitors.length}</span> on the page
			</p>
			{#if data.monitors.length > 1}
				<Button
					variant="outline"
					size="sm"
					class="shrink-0"
					disabled={bulkBusy}
					onclick={() => setAllPublic(!allPublic)}
				>
					{#if bulkBusy}<Loader2Icon class="animate-spin" />{/if}
					{allPublic ? 'Hide all' : 'Show all'}
				</Button>
			{/if}
		</div>
		<ul class="divide-y divide-border/60 border-t border-border/60" aria-label="Monitors">
			{#each data.monitors as monitor (monitor.id)}
				<li
					class="flex items-center gap-3 px-(--card-spacing) py-2.5"
					aria-busy={toggling === monitor.id}
				>
					<!-- The status is also written out in the label, so the dot's own sr-only text is hidden. -->
					<span aria-hidden="true" class="flex"><StatusDot status={monitor.status} /></span>
					<label
						for="pub-{monitor.id}"
						class="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2"
					>
						<span class="flex min-w-0 items-center gap-2 text-sm">
							<MonitorIcon {monitor} /><span class="truncate">{monitor.name}</span>
						</span>
						<span class="shrink-0 text-xs text-muted-foreground">
							{monitor.type === 'http' ? 'HTTP' : 'Docker'} ·
							<span class={monitor.status === 'down' ? STATUS_TEXT.down : ''}>
								{STATUS_LABEL[monitor.status]}
							</span>
						</span>
					</label>
					<!-- Stays enabled while saving, so the state doesn't flicker; the row is aria-busy instead.
						The unchecked track is darker than the kit's so "off" reads on a white card. -->
					<Switch
						id="pub-{monitor.id}"
						checked={monitor.public}
						class="{toggling === monitor.id
							? 'opacity-70'
							: ''} data-unchecked:bg-muted-foreground/35 dark:data-unchecked:bg-input/90"
						onCheckedChange={(v) => setPublic(monitor.id, v)}
					/>
				</li>
			{/each}
		</ul>
	{/if}
</SettingsSection>
