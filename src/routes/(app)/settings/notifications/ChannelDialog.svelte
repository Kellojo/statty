<script lang="ts">
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import LockIcon from '@lucide/svelte/icons/lock';
	import SendIcon from '@lucide/svelte/icons/send';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import StatusDot from '$lib/components/app/monitors/StatusDot.svelte';
	import { apiRequest } from '$lib/api-client.js';
	import type { MonitorStatus, NotificationChannel } from '$lib/types.js';
	import { cn } from '$lib/utils.js';

	let {
		open = $bindable(false),
		channel = null,
		monitors,
		onSaved,
		onTest,
		testingId = null
	}: {
		open?: boolean;
		/** The channel to edit; null adds one. */
		channel?: NotificationChannel | null;
		monitors: { id: string; name: string; status: MonitorStatus }[];
		onSaved?: (channel: NotificationChannel, created: boolean) => void;
		/** Sends a test with the saved settings (edit mode). */
		onTest?: (channel: NotificationChannel) => void;
		/** The channel a test is being sent to, if any. */
		testingId?: string | null;
	} = $props();

	const DEFAULT_PRIORITY = 8;

	let name = $state('');
	let url = $state('');
	let token = $state('');
	let priority = $state<number | null>(DEFAULT_PRIORITY);
	let enabled = $state(true);
	let allMonitors = $state(true);
	let chosen = $state<string[]>([]);
	let saving = $state(false);
	let error = $state('');

	// Load the form each time the dialog opens.
	$effect(() => {
		if (!open) return;
		name = channel?.name ?? '';
		url = channel?.config.url ?? '';
		token = '';
		priority = channel?.config.priority ?? DEFAULT_PRIORITY;
		enabled = channel?.enabled ?? true;
		allMonitors = channel?.allMonitors ?? true;
		chosen = channel ? [...channel.monitorIds] : [];
		error = '';
	});

	/** Whether what a test sends (server, token, priority) differs from the saved channel. */
	const dirty = $derived(
		channel !== null &&
			(url.trim().replace(/\/+$/, '') !== channel.config.url ||
				token.trim() !== '' ||
				(priority ?? DEFAULT_PRIORITY) !== channel.config.priority)
	);

	const allChosen = $derived(monitors.length > 0 && chosen.length === monitors.length);

	function toggle(id: string, on: boolean) {
		chosen = on ? [...chosen, id] : chosen.filter((c) => c !== id);
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		if (!allMonitors && chosen.length === 0) {
			error = 'Choose at least one monitor, or notify for all of them.';
			return;
		}
		saving = true;
		error = '';
		const body = {
			name,
			enabled,
			allMonitors,
			monitorIds: allMonitors ? [] : chosen,
			config: {
				url,
				// Blank keeps the stored token when editing.
				...(token.trim() ? { token } : {}),
				priority: priority ?? DEFAULT_PRIORITY
			}
		};
		try {
			const res = channel
				? await apiRequest<{ channel: NotificationChannel }>(
						`/api/notifications/${channel.id}`,
						'PATCH',
						body
					)
				: await apiRequest<{ channel: NotificationChannel }>('/api/notifications', 'POST', {
						type: 'gotify',
						...body
					});
			open = false;
			onSaved?.(res.channel, !channel);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Saving failed';
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<!-- Only the form scrolls, so Cancel and Save stay in view on short screens. -->
	<Dialog.Content class="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{channel ? `Edit ${channel.name}` : 'Add Gotify channel'}</Dialog.Title>
			<Dialog.Description>
				Statty pushes a message to your Gotify server when a monitor goes down and when it's back
				up.
			</Dialog.Description>
		</Dialog.Header>

		<form
			id="channel-form"
			class="-mx-6 -my-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-1"
			onsubmit={submit}
		>
			<div class="flex flex-col gap-2">
				<Label for="nc-name">Name</Label>
				<Input
					id="nc-name"
					bind:value={name}
					required
					maxlength={100}
					placeholder="Phone"
					autocomplete="off"
				/>
			</div>

			<div class="flex flex-col gap-2">
				<Label for="nc-url">Server URL</Label>
				<Input
					id="nc-url"
					type="url"
					inputmode="url"
					bind:value={url}
					required
					maxlength={500}
					placeholder="https://push.example.com"
					autocomplete="off"
					spellcheck={false}
				/>
			</div>

			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between gap-2">
					<Label for="nc-token">App token</Label>
					{#if channel?.config.hasToken}
						<span class="flex items-center gap-1 text-xs text-muted-foreground">
							<LockIcon class="size-3" aria-hidden="true" />Saved
						</span>
					{/if}
				</div>
				<Input
					id="nc-token"
					type="password"
					bind:value={token}
					required={!channel}
					maxlength={500}
					placeholder={channel ? '•••••••• (saved)' : 'AbCdEf123…'}
					autocomplete="new-password"
					spellcheck={false}
					aria-describedby="nc-token-hint"
				/>
				<p id="nc-token-hint" class="text-xs text-muted-foreground">
					{#if channel}
						The saved token is never shown. Leave blank to keep it, or paste a new one.
					{:else}
						In Gotify, open Apps, create an application and copy its token.
					{/if}
				</p>
			</div>

			<div class="flex items-center justify-between gap-4">
				<div class="flex min-w-0 flex-col gap-1">
					<Label for="nc-priority">Priority</Label>
					<p id="nc-priority-hint" class="text-xs text-muted-foreground">
						0–10, default 8. Gotify apps alert loudest from 8.
					</p>
				</div>
				<Input
					id="nc-priority"
					type="number"
					inputmode="numeric"
					class="w-20 shrink-0"
					min={0}
					max={10}
					step={1}
					bind:value={priority}
					onblur={() =>
						(priority =
							priority === null
								? DEFAULT_PRIORITY
								: Math.min(10, Math.max(0, Math.round(priority))))}
					aria-describedby="nc-priority-hint"
				/>
			</div>

			<fieldset class="flex flex-col gap-2">
				<legend class="mb-2 text-sm leading-none font-medium">Monitors</legend>
				<div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Which monitors notify">
					{#each [{ value: true, label: 'All monitors', icon: LayersIcon }, { value: false, label: 'Chosen ones', icon: ListChecksIcon }] as option (option.label)}
						<button
							type="button"
							role="radio"
							aria-checked={allMonitors === option.value}
							onclick={() => (allMonitors = option.value)}
							class={cn(
								'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
								allMonitors === option.value
									? 'border-foreground/40 bg-accent font-medium'
									: 'text-muted-foreground hover:bg-accent/50'
							)}
						>
							<option.icon class="size-4 shrink-0" />
							{option.label}
						</button>
					{/each}
				</div>
				{#if allMonitors}
					<p class="text-xs text-muted-foreground">Includes monitors you add later.</p>
				{:else if monitors.length === 0}
					<p class="text-xs text-muted-foreground">There are no monitors yet.</p>
				{:else}
					<div class="overflow-hidden rounded-xl border">
						<div
							class="flex items-center justify-between gap-2 border-b bg-muted/40 py-1 pr-1 pl-3 text-xs text-muted-foreground"
						>
							<span aria-live="polite">{chosen.length} of {monitors.length} chosen</span>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="h-7 text-xs"
								onclick={() => (chosen = allChosen ? [] : monitors.map((m) => m.id))}
							>
								{allChosen ? 'Clear' : 'Select all'}
							</Button>
						</div>
						<ul
							class="divide-y divide-border/60 sm:max-h-56 sm:overflow-y-auto"
							aria-label="Monitors"
						>
							{#each monitors as monitor (monitor.id)}
								<li>
									<label
										class="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent/40"
									>
										<input
											type="checkbox"
											class="size-4 shrink-0 cursor-pointer rounded accent-primary"
											checked={chosen.includes(monitor.id)}
											onchange={(e) => toggle(monitor.id, e.currentTarget.checked)}
										/>
										<span class="min-w-0 flex-1 truncate">{monitor.name}</span>
										<StatusDot status={monitor.status} />
									</label>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</fieldset>

			<label class="flex items-center justify-between gap-4 text-sm">
				<span class="flex flex-col gap-0.5">
					<span class="font-medium">Enabled</span>
					<span class="text-xs text-muted-foreground">
						Turn off to pause messages from this channel.
					</span>
				</span>
				<Switch bind:checked={enabled} />
			</label>

			{#if error}
				<p role="alert" class="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{error}
				</p>
			{/if}
		</form>

		<!-- Phones stack the footer in reverse: Save, Send test, Cancel from the top. -->
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			{#if channel && onTest}
				<Button
					variant="outline"
					class="sm:order-first sm:mr-auto"
					disabled={testingId === channel.id}
					title={dirty
						? 'Sends with the saved settings; save first to test your changes'
						: 'Send a test message'}
					onclick={() => channel && onTest(channel)}
				>
					{#if testingId === channel.id}<Loader2Icon class="animate-spin" />{:else}<SendIcon />{/if}
					{dirty ? 'Test saved settings' : 'Send test'}
				</Button>
			{/if}
			<Button type="submit" form="channel-form" disabled={saving}>
				{#if saving}<Loader2Icon class="animate-spin" />{/if}
				{channel ? 'Save' : 'Add channel'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
