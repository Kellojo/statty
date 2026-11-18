<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import BellIcon from '@lucide/svelte/icons/bell';
	import BellOffIcon from '@lucide/svelte/icons/bell-off';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SendIcon from '@lucide/svelte/icons/send';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import SettingsHeader from '$lib/components/app/settings/SettingsHeader.svelte';
	import SettingsSection from '$lib/components/app/settings/SettingsSection.svelte';
	import SettingsListItem from '$lib/components/app/settings/SettingsListItem.svelte';
	import RowMenu, { type RowMenuItem } from '$lib/components/app/settings/RowMenu.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import { apiRequest } from '$lib/api-client.js';
	import type { NotificationChannel } from '$lib/types.js';
	import ChannelDialog from './ChannelDialog.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const TYPE_LABEL: Record<NotificationChannel['type'], string> = { gotify: 'Gotify' };

	const monitorNames = $derived(new Map(data.monitors.map((m) => [m.id, m.name])));

	let dialogOpen = $state(false);
	let editing = $state<NotificationChannel | null>(null);

	let deleteTarget = $state<NotificationChannel | null>(null);
	let deleting = $state(false);
	let toggling = $state<string | null>(null);
	let testing = $state<string | null>(null);

	function openDialog(channel: NotificationChannel | null) {
		editing = channel;
		dialogOpen = true;
	}

	function host(url: string): string {
		try {
			const u = new URL(url);
			return u.pathname === '/' ? u.host : `${u.host}${u.pathname}`;
		} catch {
			return url;
		}
	}

	function scopeLabel(channel: NotificationChannel): string {
		if (channel.allMonitors) return 'All monitors';
		const names = channel.monitorIds.map((id) => monitorNames.get(id)).filter(Boolean);
		if (names.length === 1) return names[0]!;
		return `${names.length} monitors`;
	}

	function scopeTitle(channel: NotificationChannel): string | undefined {
		if (channel.allMonitors) return undefined;
		return channel.monitorIds
			.map((id) => monitorNames.get(id))
			.filter(Boolean)
			.join(', ');
	}

	function menuItems(channel: NotificationChannel): RowMenuItem[] {
		return [
			{ label: 'Edit', icon: PencilIcon, onSelect: () => openDialog(channel) },
			{
				label: 'Send test',
				icon: SendIcon,
				disabled: testing === channel.id,
				onSelect: () => sendTest(channel)
			},
			'separator',
			{
				label: 'Delete',
				icon: Trash2Icon,
				destructive: true,
				onSelect: () => (deleteTarget = channel)
			}
		];
	}

	async function onSaved(channel: NotificationChannel, created: boolean) {
		toast.success(created ? `Added ${channel.name}` : `Saved ${channel.name}`, {
			action: created ? { label: 'Send test', onClick: () => sendTest(channel) } : undefined
		});
		await invalidateAll();
	}

	async function setEnabled(channel: NotificationChannel, enabled: boolean) {
		toggling = channel.id;
		try {
			await apiRequest(`/api/notifications/${channel.id}`, 'PATCH', { enabled });
			toast.success(enabled ? `${channel.name} is on` : `${channel.name} is paused`);
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Saving failed');
		} finally {
			toggling = null;
		}
	}

	async function sendTest(channel: NotificationChannel) {
		if (testing) return;
		testing = channel.id;
		const id = toast.loading(`Sending a test to ${channel.name}…`);
		try {
			await apiRequest(`/api/notifications/${channel.id}/test`, 'POST');
			toast.success(`Test sent to ${channel.name}`, {
				id,
				description: 'Check your Gotify app.'
			});
		} catch (e) {
			toast.error(`Couldn't send to ${channel.name}`, {
				id,
				description: e instanceof Error ? e.message : 'Sending failed'
			});
		} finally {
			testing = null;
		}
	}

	async function confirmDelete() {
		if (!deleteTarget || deleting) return;
		deleting = true;
		try {
			await apiRequest(`/api/notifications/${deleteTarget.id}`, 'DELETE');
			toast.success(`Deleted ${deleteTarget.name}`);
			deleteTarget = null;
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Deleting failed');
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:head><title>Notifications · Settings · Statty</title></svelte:head>

<SettingsHeader
	title="Notifications"
	description="Get a push message when a monitor goes down and again when it's back up."
>
	{#snippet actions()}
		{#if data.channels.length > 0}
			<Button onclick={() => openDialog(null)}><PlusIcon />Add channel</Button>
		{/if}
	{/snippet}
</SettingsHeader>

<SettingsSection title="Channels" flush>
	{#snippet description()}
		Pending checks and a monitor's first check don't notify, and paused monitors stay quiet.
	{/snippet}
	{#if data.channels.length === 0}
		<div class="border-t border-border/60">
			<EmptyState
				icon={BellIcon}
				title="No channels yet"
				description="Add a Gotify server to get a message on your phone or desktop when a monitor goes down."
			>
				<Button onclick={() => openDialog(null)}><PlusIcon />Add Gotify channel</Button>
			</EmptyState>
		</div>
	{:else}
		<ul class="divide-y divide-border/60 border-t border-border/60" aria-label="Channels">
			{#each data.channels as channel (channel.id)}
				<SettingsListItem
					title={channel.name}
					onclick={() => openDialog(channel)}
					muted={!channel.enabled}
				>
					{#snippet leading()}
						{#if channel.enabled}<BellIcon class="size-4" />{:else}<BellOffIcon
								class="size-4"
							/>{/if}
					{/snippet}
					{#snippet badges()}
						<!-- Phones have little room; the type matters once there is more than one. -->
						<Badge variant="secondary" class="font-normal max-sm:hidden">
							{TYPE_LABEL[channel.type]}
						</Badge>
					{/snippet}
					{#snippet meta()}
						<!-- Phones put the server on its own line, so a wrap never strands a separator. -->
						<span class="flex flex-col sm:flex-row sm:gap-1">
							<span class="truncate" title={channel.config.url}>{host(channel.config.url)}</span>
							<span class="whitespace-nowrap">
								<span class="max-sm:hidden" aria-hidden="true">·</span>
								<span title={scopeTitle(channel)}>{scopeLabel(channel)}</span>
								· Priority {channel.config.priority}
							</span>
						</span>
					{/snippet}
					{#snippet trailing()}
						<Switch
							checked={channel.enabled}
							disabled={toggling === channel.id}
							aria-label="Send notifications to {channel.name}"
							onCheckedChange={(v) => setEnabled(channel, v)}
						/>
						<RowMenu label="Actions for {channel.name}" items={menuItems(channel)} />
					{/snippet}
				</SettingsListItem>
			{/each}
		</ul>
	{/if}
</SettingsSection>

<ChannelDialog
	bind:open={dialogOpen}
	channel={editing}
	monitors={data.monitors}
	{onSaved}
	onTest={sendTest}
	testingId={testing}
/>

<Dialog.Root open={deleteTarget !== null} onOpenChange={(open) => !open && (deleteTarget = null)}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Delete {deleteTarget?.name ?? 'channel'}?</Dialog.Title>
			<Dialog.Description>
				Statty stops sending to this {deleteTarget ? TYPE_LABEL[deleteTarget.type] : ''} server, and its
				saved token is removed. This cannot be undone.
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
