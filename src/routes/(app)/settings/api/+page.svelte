<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import SettingsHeader from '$lib/components/app/settings/SettingsHeader.svelte';
	import SettingsSection from '$lib/components/app/settings/SettingsSection.svelte';
	import SettingsListItem from '$lib/components/app/settings/SettingsListItem.svelte';
	import CodeBlock from '$lib/components/app/settings/CodeBlock.svelte';
	import CopyValue from '$lib/components/app/settings/CopyValue.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import { apiRequest } from '$lib/api-client.js';
	import { formatDateTime, formatTimeAgo } from '$lib/monitor-format.js';
	import type { ApiKey, ApiScope } from '$lib/types.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The key dialog: create (editing null) or edit.
	let dialogOpen = $state(false);
	let editing = $state<ApiKey | null>(null);
	let label = $state('');
	let canWrite = $state(false);
	let saving = $state(false);
	/** The raw key, shown once after creating it. */
	let created = $state<string | null>(null);

	let deleteTarget = $state<ApiKey | null>(null);
	let deleting = $state(false);

	function openDialog(key: ApiKey | null) {
		editing = key;
		label = key?.label ?? '';
		canWrite = key?.scopes.includes('monitors:write') ?? false;
		created = null;
		keyCopied = false;
		dialogOpen = true;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		const scopes: ApiScope[] = canWrite ? ['status:read', 'monitors:write'] : ['status:read'];
		try {
			if (editing) {
				await apiRequest(`/api/api-keys/${editing.id}`, 'PATCH', { label, scopes });
				toast.success('API key saved');
				dialogOpen = false;
			} else {
				const res = await apiRequest<{ key: string }>('/api/api-keys', 'POST', { label, scopes });
				created = res.key;
			}
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Saving failed');
		} finally {
			saving = false;
		}
	}

	// The one-time key gets its own big copy button: it's the only thing to do in that dialog.
	let keyCopied = $state(false);
	let copyButton = $state<HTMLElement | null>(null);
	// Move focus to "Copy key" once the reveal replaces the form (whose focused input is gone).
	$effect(() => {
		if (created && copyButton) copyButton.focus();
	});
	async function copyKey() {
		if (!created) return;
		try {
			await navigator.clipboard.writeText(created);
			keyCopied = true;
		} catch {
			toast.error('Couldn’t copy to the clipboard');
		}
	}

	/** "Nov 19" this year, "Nov 19, 2025" otherwise: the time of day adds nothing here. */
	function formatDay(ts: number): string {
		const sameYear = new Date(ts).getFullYear() === new Date().getFullYear();
		return new Intl.DateTimeFormat(undefined, {
			month: 'short',
			day: 'numeric',
			year: sameYear ? undefined : 'numeric'
		}).format(ts);
	}

	async function confirmDelete() {
		if (!deleteTarget || deleting) return;
		deleting = true;
		try {
			await apiRequest(`/api/api-keys/${deleteTarget.id}`, 'DELETE');
			toast.success('API key deleted');
			deleteTarget = null;
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Deleting failed');
		} finally {
			deleting = false;
		}
	}

	const mcpUrl = $derived(`${data.origin}/api/mcp`);
	const curlList = $derived(
		`curl ${data.origin}/api/v1/monitors \\\n  -H "Authorization: Bearer $STATTY_KEY"`
	);
	const curlCreate = $derived(
		`curl -X POST ${data.origin}/api/v1/monitors \\\n  -H "Authorization: Bearer $STATTY_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name": "Website", "type": "http", "url": "https://example.com"}'`
	);
	const claudeCode = $derived(`claude mcp add --transport http statty ${mcpUrl}`);
	const mcpJson = $derived(
		JSON.stringify({ mcpServers: { statty: { type: 'http', url: mcpUrl } } }, null, 2)
	);

	// Mirrors monitorCreateSchema: name and type always, then url (http) or container (docker).
	const REQUIRED_FIELDS = ['name', 'type ("http" | "docker")', 'url (http)', 'container (docker)'];
	const OPTIONAL_FIELDS = [
		'description',
		'method',
		'acceptedStatuses',
		'keyword',
		'ignoreTls',
		'dockerHost',
		'intervalSeconds',
		'timeoutSeconds',
		'retries',
		'enabled',
		'public',
		'sortOrder'
	];

	const ENDPOINTS = [
		['GET', '/api/v1/status', 'Overall status, counts, what is down', 'status:read'],
		[
			'GET',
			'/api/v1/monitors',
			'All monitors with status, uptime and recent checks',
			'status:read'
		],
		[
			'GET',
			'/api/v1/monitors/:id',
			'One monitor (id or exact name) with status changes',
			'status:read'
		],
		[
			'GET',
			'/api/v1/monitors/:id/heartbeats',
			'Check history, last 24 hours unless ?hours= is set',
			'status:read'
		],
		['POST', '/api/v1/monitors', 'Create a monitor', 'monitors:write'],
		['PATCH', '/api/v1/monitors/:id', 'Change fields, e.g. {"enabled": false}', 'monitors:write'],
		['DELETE', '/api/v1/monitors/:id', 'Delete a monitor', 'monitors:write'],
		['POST', '/api/v1/monitors/:id/check', 'Check now', 'monitors:write'],
		['GET', '/api/public/status', 'Public status page data', 'no key']
	] as const;

	// Same hues as the status colours elsewhere: reads green, writes amber, deletes red.
	const METHOD_TONE: Record<(typeof ENDPOINTS)[number][0], string> = {
		GET: 'text-emerald-700 dark:text-emerald-400',
		POST: 'text-sky-700 dark:text-sky-400',
		PATCH: 'text-amber-700 dark:text-amber-400',
		DELETE: 'text-red-700 dark:text-red-400'
	};
</script>

<svelte:head><title>API & MCP · Settings · Statty</title></svelte:head>

<SettingsHeader
	title="API & MCP"
	description="Read status or manage monitors from scripts and AI assistants. Keys act as you, so treat them like passwords."
>
	{#snippet actions()}
		<Button onclick={() => openDialog(null)}><PlusIcon />Create key</Button>
	{/snippet}
</SettingsHeader>

<SettingsSection title="API keys" flush>
	{#snippet description()}
		<code class="rounded bg-muted px-1 py-0.5 text-xs">status:read</code> reads monitors and status;
		<code class="rounded bg-muted px-1 py-0.5 text-xs">monitors:write</code> also creates, changes and
		deletes them. MCP clients that sign in show up here too.
	{/snippet}
	{#if data.apiKeys.length === 0}
		<div class="border-t border-border/60">
			<EmptyState
				icon={KeyRoundIcon}
				compact
				title="No API keys yet"
				description="Create one for scripts, or connect an MCP client, which signs in by itself."
			/>
		</div>
	{:else}
		<ul class="divide-y divide-border/60 border-t border-border/60" aria-label="API keys">
			{#each data.apiKeys as key (key.id)}
				<SettingsListItem title={key.label} onclick={() => openDialog(key)}>
					{#snippet leading()}<KeyRoundIcon class="size-4" />{/snippet}
					{#snippet badges()}
						<!-- Every key can read, so only write access is worth a badge. -->
						{#if key.scopes.includes('monitors:write')}
							<Badge
								variant="outline"
								class="border-amber-500/40 font-mono font-normal text-amber-800 dark:text-amber-300"
							>
								monitors:write
							</Badge>
						{:else}
							<Badge variant="secondary" class="font-normal">Read only</Badge>
						{/if}
						{#if key.oauthClient}
							<Badge variant="outline" class="font-normal text-muted-foreground">
								Signed in · {key.oauthClient}
							</Badge>
						{/if}
					{/snippet}
					{#snippet meta()}
						<span class="whitespace-nowrap" title={formatDateTime(key.createdAt)}>
							Created {formatDay(key.createdAt)}
						</span>
						<span aria-hidden="true">·</span>
						{#if key.lastUsedAt}
							<span class="whitespace-nowrap" title={formatDateTime(key.lastUsedAt)}>
								Used {formatTimeAgo(key.lastUsedAt)}
							</span>
						{:else}
							<span class="whitespace-nowrap">Never used</span>
						{/if}
					{/snippet}
					{#snippet trailing()}
						<Button
							variant="ghost"
							size="icon-sm"
							class="text-muted-foreground hover:text-destructive"
							aria-label="Delete key {key.label}"
							title="Delete key"
							onclick={() => (deleteTarget = key)}
						>
							<Trash2Icon class="size-4" />
						</Button>
					{/snippet}
				</SettingsListItem>
			{/each}
		</ul>
	{/if}
</SettingsSection>

<SettingsSection title="Connect">
	{#snippet description()}
		MCP clients sign in through Statty, so they need no key.
	{/snippet}
	<Tabs.Root value="mcp" class="gap-4">
		<Tabs.List class="self-start">
			<Tabs.Trigger value="mcp">MCP</Tabs.Trigger>
			<Tabs.Trigger value="rest">REST API</Tabs.Trigger>
		</Tabs.List>
		<Tabs.Content value="mcp" class="flex flex-col gap-4">
			<CopyValue label="MCP server URL (Streamable HTTP)" value={mcpUrl} />
			<CodeBlock label="Claude Code" code={claudeCode} />
			<CodeBlock label="Other clients (mcp.json)" code={mcpJson} />
			<p class="text-sm text-muted-foreground">
				Tools: <code class="text-xs">list_monitors</code>, <code class="text-xs">get_monitor</code>;
				with write access also <code class="text-xs">create_monitor</code>,
				<code class="text-xs">update_monitor</code>, <code class="text-xs">delete_monitor</code> and
				<code class="text-xs">check_monitor</code>. Clients without OAuth can send an API key as
				<code class="text-xs">Authorization: Bearer</code>.
			</p>
		</Tabs.Content>
		<Tabs.Content value="rest" class="flex flex-col gap-4">
			<CodeBlock label="List monitors" code={curlList} />
			<CodeBlock label="Create a monitor" code={curlCreate} />
			<!-- A grid with subgrid rows: columns line up on wide screens, and on phones each endpoint
				stacks (method and path, then what it does and its scope) instead of scrolling sideways. -->
			<ul
				class="divide-y divide-border/60 rounded-xl border border-border/60 sm:grid sm:grid-cols-[auto_auto_1fr_auto]"
				aria-label="REST endpoints"
			>
				{#each ENDPOINTS as [method, path, what, scope] (method + path)}
					<li
						class="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 px-3 py-2.5 sm:col-span-4 sm:grid-cols-subgrid sm:items-baseline sm:gap-x-6 sm:py-2"
					>
						<span class="font-mono text-xs font-semibold {METHOD_TONE[method]}">{method}</span>
						<code class="font-mono text-xs wrap-anywhere sm:whitespace-nowrap">{path}</code>
						<span class="col-start-2 text-sm text-muted-foreground sm:col-start-auto">{what}</span>
						<span
							class="col-start-2 font-mono text-xs text-muted-foreground sm:col-start-auto sm:text-right"
						>
							{scope}
						</span>
					</li>
				{/each}
			</ul>
			<div class="flex flex-col gap-3 text-sm text-muted-foreground">
				{#each [['Required to create a monitor', REQUIRED_FIELDS], ['Optional', OPTIONAL_FIELDS]] as const as [heading, fields] (heading)}
					<div class="flex flex-col gap-1.5">
						<p>{heading}</p>
						<ul class="flex flex-wrap gap-1.5" aria-label="{heading} fields">
							{#each fields as field (field)}
								<li>
									<code class="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
										{field}
									</code>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
				<p>
					Errors come back as <code class="text-xs">{'{ "message": "…" }'}</code> with a 4xx status.
				</p>
			</div>
		</Tabs.Content>
	</Tabs.Root>
</SettingsSection>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content>
		{#if created}
			<Dialog.Header>
				<Dialog.Title>Copy your new key</Dialog.Title>
				<Dialog.Description>
					This is the only time it is shown. Store it somewhere safe.
				</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium">{label}</span>
				<code
					class="rounded-lg border border-border/60 bg-muted/50 px-3 py-2.5 font-mono text-xs leading-relaxed break-all select-all"
					aria-label="New API key"
				>
					{created}
				</code>
			</div>
			<p
				class="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
			>
				<TriangleAlertIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
				{canWrite
					? 'Anyone with this key can create, change and delete your monitors.'
					: 'Anyone with this key can see all your monitors and their status.'}
			</p>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (dialogOpen = false)}>Done</Button>
				<Button onclick={copyKey} bind:ref={copyButton}>
					{#if keyCopied}<CheckIcon />Copied{:else}<CopyIcon />Copy key{/if}
				</Button>
			</Dialog.Footer>
			<span class="sr-only" aria-live="polite">{keyCopied ? 'Key copied' : ''}</span>
		{:else}
			<Dialog.Header>
				<Dialog.Title>{editing ? `Edit ${editing.label}` : 'Create API key'}</Dialog.Title>
				<Dialog.Description>
					{editing ? 'The key itself stays the same.' : 'Every key can read status.'}
				</Dialog.Description>
			</Dialog.Header>
			<form id="key-form" class="flex flex-col gap-4" onsubmit={save}>
				<div class="flex flex-col gap-2">
					<Label for="key-label">Name</Label>
					<Input
						id="key-label"
						bind:value={label}
						required
						maxlength={100}
						placeholder="e.g. CI sync"
						autocomplete="off"
						aria-describedby="key-label-hint"
					/>
					<p id="key-label-hint" class="text-xs text-muted-foreground">
						Required. Say where it's used, so you know what breaks if you delete it.
					</p>
				</div>
				<label class="flex items-center justify-between gap-4 text-sm">
					<span class="flex flex-col gap-0.5">
						<span class="font-medium">Allow changes</span>
						<span class="text-xs text-muted-foreground">
							Create, edit, pause and delete monitors (monitors:write).
						</span>
					</span>
					<Switch bind:checked={canWrite} />
				</label>
			</form>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (dialogOpen = false)}>Cancel</Button>
				<Button type="submit" form="key-form" disabled={saving || !label.trim()}>
					{#if saving}<Loader2Icon class="animate-spin" />{/if}
					{editing ? 'Save' : 'Create key'}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={deleteTarget !== null} onOpenChange={(open) => !open && (deleteTarget = null)}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Delete key {deleteTarget?.label ?? ''}?</Dialog.Title>
			<Dialog.Description>
				Anything using this key loses access right away. This cannot be undone.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (deleteTarget = null)}>Cancel</Button>
			<Button variant="destructive" disabled={deleting} onclick={confirmDelete}>
				{deleting ? 'Deleting…' : 'Delete'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
