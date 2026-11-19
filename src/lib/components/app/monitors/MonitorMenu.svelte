<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import RowMenu from '$lib/components/app/settings/RowMenu.svelte';
	import { apiRequest } from '$lib/api-client.js';
	import type { Monitor } from '$lib/types.js';

	/** A monitor's actions: edit, check now, pause/resume, delete (with confirmation). */
	let {
		monitor,
		onEdit,
		onDeleted,
		text
	}: {
		monitor: Monitor;
		onEdit: () => void;
		onDeleted?: () => void;
		/** Visible trigger text, e.g. on the detail page. */
		text?: string;
	} = $props();

	let confirmDelete = $state(false);
	let busy = $state(false);

	async function run(action: () => Promise<unknown>, success?: string) {
		if (busy) return;
		busy = true;
		try {
			await action();
			if (success) toast.success(success);
			await invalidateAll();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Something went wrong');
		} finally {
			busy = false;
		}
	}

	const path = $derived(`/api/v1/monitors/${monitor.id}`);
</script>

<RowMenu
	label="Actions for {monitor.name}"
	{text}
	items={[
		{ label: 'Edit', icon: PencilIcon, onSelect: onEdit },
		{
			label: 'Check now',
			icon: RefreshCwIcon,
			disabled: !monitor.enabled || busy,
			onSelect: () =>
				run(async () => {
					const { monitor: m } = await apiRequest<{ monitor: Monitor }>(`${path}/check`, 'POST');
					toast.info(`${m.name}: ${m.status}${m.message ? ` · ${m.message}` : ''}`);
				})
		},
		monitor.enabled
			? {
					label: 'Pause',
					icon: PauseIcon,
					onSelect: () => run(() => apiRequest(path, 'PATCH', { enabled: false }), 'Monitor paused')
				}
			: {
					label: 'Resume',
					icon: PlayIcon,
					onSelect: () => run(() => apiRequest(path, 'PATCH', { enabled: true }), 'Monitor resumed')
				},
		'separator',
		{ label: 'Delete', icon: Trash2Icon, destructive: true, onSelect: () => (confirmDelete = true) }
	]}
/>

<Dialog.Root bind:open={confirmDelete}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Delete {monitor.name}?</Dialog.Title>
			<Dialog.Description>
				Its check history goes with it, and it disappears from the status page. This cannot be
				undone.
				{#if monitor.managedByConfig}
					It is declared in the monitors file, so it comes back the next time the file is applied
					unless you remove it there too.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (confirmDelete = false)}>Cancel</Button>
			<Button
				variant="destructive"
				disabled={busy}
				onclick={() =>
					run(async () => {
						await apiRequest(path, 'DELETE');
						confirmDelete = false;
						onDeleted?.();
					}, 'Monitor deleted')}
			>
				{busy ? 'Deleting…' : 'Delete'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
