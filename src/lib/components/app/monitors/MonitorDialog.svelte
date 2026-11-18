<script lang="ts">
	import { toast } from 'svelte-sonner';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import ContainerIcon from '@lucide/svelte/icons/container';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { apiRequest } from '$lib/api-client.js';
	import { HTTP_METHODS, type HttpMethod, type Monitor, type MonitorType } from '$lib/types.js';
	import { cn } from '$lib/utils.js';

	let {
		open = $bindable(false),
		monitor = null,
		onSaved
	}: {
		open?: boolean;
		/** The monitor to edit; null creates one. */
		monitor?: Monitor | null;
		onSaved?: (monitor: Monitor) => void;
	} = $props();

	const INTERVALS = [
		{ value: '20', label: 'Every 20 seconds' },
		{ value: '30', label: 'Every 30 seconds' },
		{ value: '60', label: 'Every minute' },
		{ value: '120', label: 'Every 2 minutes' },
		{ value: '300', label: 'Every 5 minutes' },
		{ value: '600', label: 'Every 10 minutes' },
		{ value: '1800', label: 'Every 30 minutes' },
		{ value: '3600', label: 'Every hour' }
	];

	let name = $state('');
	let description = $state('');
	let type = $state<MonitorType>('http');
	let url = $state('');
	let method = $state<HttpMethod>('GET');
	let acceptedStatuses = $state('200-299');
	let keyword = $state('');
	let ignoreTls = $state(false);
	let container = $state('');
	let dockerHost = $state('');
	let interval = $state('60');
	let timeoutSeconds = $state(10);
	let retries = $state(0);
	let isPublic = $state(true);
	let enabled = $state(true);
	let advanced = $state(false);
	let saving = $state(false);
	let error = $state('');

	// Load the form each time the dialog opens.
	$effect(() => {
		if (!open) return;
		const m = monitor;
		name = m?.name ?? '';
		description = m?.description ?? '';
		type = m?.type ?? 'http';
		url = m?.url ?? '';
		method = m?.method ?? 'GET';
		acceptedStatuses = m?.acceptedStatuses ?? '200-299';
		keyword = m?.keyword ?? '';
		ignoreTls = m?.ignoreTls ?? false;
		container = m?.container ?? '';
		dockerHost = m?.dockerHost ?? '';
		interval = String(m?.intervalSeconds ?? 60);
		timeoutSeconds = m?.timeoutSeconds ?? 10;
		retries = m?.retries ?? 0;
		isPublic = m?.public ?? true;
		enabled = m?.enabled ?? true;
		advanced = false;
		error = '';
	});

	const intervalOptions = $derived(
		INTERVALS.some((i) => i.value === interval)
			? INTERVALS
			: [...INTERVALS, { value: interval, label: `Every ${interval} seconds` }]
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		error = '';
		const body = {
			name,
			description: description || null,
			type,
			url: type === 'http' ? url : null,
			method,
			acceptedStatuses,
			keyword: keyword || null,
			ignoreTls,
			container: type === 'docker' ? container : null,
			dockerHost: type === 'docker' ? dockerHost || null : null,
			intervalSeconds: Number(interval),
			timeoutSeconds: Number(timeoutSeconds),
			retries: Number(retries),
			public: isPublic,
			enabled
		};
		try {
			const { monitor: saved } = monitor
				? await apiRequest<{ monitor: Monitor }>(`/api/v1/monitors/${monitor.id}`, 'PATCH', body)
				: await apiRequest<{ monitor: Monitor }>('/api/v1/monitors', 'POST', body);
			toast.success(
				monitor ? 'Monitor saved' : `${saved.name} is ${saved.status === 'up' ? 'up' : 'added'}`
			);
			open = false;
			onSaved?.(saved);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Saving failed';
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{monitor ? `Edit ${monitor.name}` : 'Add monitor'}</Dialog.Title>
			<Dialog.Description>
				Check a URL's response or a Docker container's state on an interval.
			</Dialog.Description>
		</Dialog.Header>

		<form id="monitor-form" class="flex flex-col gap-4" onsubmit={submit}>
			<div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Monitor type">
				{#each [{ value: 'http', label: 'URL check', icon: GlobeIcon }, { value: 'docker', label: 'Docker', icon: ContainerIcon }] as option (option.value)}
					<button
						type="button"
						role="radio"
						aria-checked={type === option.value}
						onclick={() => (type = option.value as MonitorType)}
						class={cn(
							'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
							type === option.value
								? 'border-foreground/40 bg-accent font-medium'
								: 'text-muted-foreground hover:bg-accent/50'
						)}
					>
						<option.icon class="size-4 shrink-0" />
						{option.label}
					</button>
				{/each}
			</div>

			<div class="flex flex-col gap-2">
				<Label for="m-name">Name</Label>
				<Input id="m-name" bind:value={name} required maxlength={100} placeholder="Website" />
			</div>

			{#if type === 'http'}
				<div class="flex flex-col gap-2">
					<Label for="m-url">URL</Label>
					<div class="flex gap-2">
						<Select.Root type="single" bind:value={method}>
							<Select.Trigger class="w-28 shrink-0" aria-label="HTTP method">
								{method}
							</Select.Trigger>
							<Select.Content>
								{#each HTTP_METHODS as m (m)}
									<Select.Item value={m}>{m}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<Input
							id="m-url"
							type="url"
							bind:value={url}
							required
							placeholder="https://…/health"
							class="min-w-0 flex-1"
						/>
					</div>
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					<Label for="m-container">Container</Label>
					<Input id="m-container" bind:value={container} required placeholder="nginx" />
					<p class="text-xs text-muted-foreground">
						Name or id. Up while running, and healthy if it has a health check.
					</p>
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<Label for="m-interval">Check</Label>
				<Select.Root type="single" bind:value={interval}>
					<Select.Trigger id="m-interval" class="w-full">
						{intervalOptions.find((i) => i.value === interval)?.label}
					</Select.Trigger>
					<Select.Content>
						{#each intervalOptions as option (option.value)}
							<Select.Item value={option.value}>{option.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<label class="flex items-center justify-between gap-4 text-sm">
				<span class="flex flex-col gap-0.5">
					<span class="font-medium">Show on the public status page</span>
					<span class="text-xs text-muted-foreground">
						Only the name and status are shown there.
					</span>
				</span>
				<Switch bind:checked={isPublic} />
			</label>

			<button
				type="button"
				class="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
				aria-expanded={advanced}
				onclick={() => (advanced = !advanced)}
			>
				<ChevronRightIcon class="size-4 transition-transform {advanced ? 'rotate-90' : ''}" />
				Advanced
			</button>

			{#if advanced}
				<div class="flex flex-col gap-4 border-l-2 border-border pl-4">
					<div class="flex flex-col gap-2">
						<Label for="m-description">Description</Label>
						<Textarea id="m-description" bind:value={description} maxlength={500} rows={2} />
					</div>
					{#if type === 'http'}
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="flex flex-col gap-2">
								<Label for="m-status">Accepted status codes</Label>
								<Input id="m-status" bind:value={acceptedStatuses} placeholder="200-299" />
							</div>
							<div class="flex flex-col gap-2">
								<Label for="m-keyword">Body must contain</Label>
								<Input id="m-keyword" bind:value={keyword} placeholder="Optional" />
							</div>
						</div>
						<label class="flex items-center justify-between gap-4 text-sm">
							<span class="font-medium">Ignore TLS certificate errors</span>
							<Switch bind:checked={ignoreTls} />
						</label>
					{:else}
						<div class="flex flex-col gap-2">
							<Label for="m-docker-host">Docker host</Label>
							<Input
								id="m-docker-host"
								bind:value={dockerHost}
								placeholder="Default (DOCKER_HOST)"
							/>
							<p class="text-xs text-muted-foreground">
								unix:///var/run/docker.sock, tcp://host:2375 or https://host:2376
							</p>
						</div>
					{/if}
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="flex flex-col gap-2">
							<Label for="m-timeout">Timeout (seconds)</Label>
							<Input id="m-timeout" type="number" min={1} max={300} bind:value={timeoutSeconds} />
						</div>
						<div class="flex flex-col gap-2">
							<Label for="m-retries">Retries before down</Label>
							<Input id="m-retries" type="number" min={0} max={20} bind:value={retries} />
						</div>
					</div>
					<label class="flex items-center justify-between gap-4 text-sm">
						<span class="font-medium">Enabled</span>
						<Switch bind:checked={enabled} />
					</label>
				</div>
			{/if}

			{#if error}
				<p role="alert" class="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{error}
				</p>
			{/if}
		</form>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit" form="monitor-form" disabled={saving}>
				{#if saving}<Loader2Icon class="animate-spin" />{/if}
				{monitor ? 'Save' : 'Add monitor'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
