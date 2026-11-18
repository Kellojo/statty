<script lang="ts">
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import AuthShell from '$lib/components/app/auth/AuthShell.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** The page's starting values; it is not re-run with new data. */
	const initial = (() => ({
		label: data.existing?.label ?? data.client?.name ?? '',
		canWrite: data.existing?.canWrite ?? false
	}))();

	let label = $state(initial.label);
	let canWrite = $state(initial.canWrite);
	let busy = $state<'approve' | 'deny' | null>(null);
	/** Set once the answer was sent and the browser is on its way back. */
	let leaving = $state(false);
	const labelMissing = $derived(!label.trim());

	async function answer(decision: 'approve' | 'deny') {
		if (busy || !data.client) return;
		if (decision === 'approve' && !label.trim()) return;
		busy = decision;
		try {
			const body =
				decision === 'approve'
					? {
							decision,
							query: data.query,
							label: label.trim(),
							scopes: canWrite ? ['status:read', 'monitors:write'] : ['status:read']
						}
					: { decision, query: data.query };
			const res = await fetch('/api/oauth/authorize', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const payload = (await res.json().catch(() => null)) as {
				redirectTo?: string;
				message?: string;
			} | null;
			if (!res.ok || !payload?.redirectTo) {
				throw new Error(payload?.message ?? `Request failed (${res.status})`);
			}
			leaving = true;
			// Back to the app that asked (often another site or a local port), so a full navigation.
			window.location.assign(payload.redirectTo);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Something went wrong');
			busy = null;
		}
	}
</script>

<svelte:head>
	<title>Connect {data.client?.name ?? 'an app'} · Statty</title>
</svelte:head>

<AuthShell wide>
	<div
		class="flex w-full flex-col gap-6 text-card-foreground sm:rounded-4xl sm:border sm:bg-card sm:px-8 sm:py-8 sm:shadow-sm"
	>
		{#if data.problem || !data.client}
			<header class="flex flex-col items-center gap-3 text-center">
				<span
					class="flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive"
				>
					<CircleAlertIcon class="size-5" aria-hidden="true" />
				</span>
				<h1 class="text-xl font-semibold tracking-tight">Can't connect this app</h1>
				<p class="text-sm text-balance text-muted-foreground">
					{data.problem ??
						'This sign-in link is incomplete. Start the connection again from the app.'}
				</p>
			</header>
			<Button href={resolve('/')} variant="outline" class="self-center">Back to Statty</Button>
		{:else}
			<header class="flex flex-col items-center gap-3 text-center">
				<h1 class="text-xl font-semibold tracking-tight text-balance [overflow-wrap:anywhere]">
					{data.existing ? 'Reconnect' : 'Connect'}
					{data.client.name} to Statty
				</h1>
				<p class="text-sm text-balance text-muted-foreground">
					It will use Statty's MCP tools as
					<span class="font-medium text-foreground">{data.user?.email}</span>. Only continue if you
					started this from the address below.
				</p>
				<!-- The one thing to verify, so it gets its own row and never breaks mid-word. -->
				<p
					class="flex max-w-full flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5 rounded-xl px-3 py-1.5 text-sm {data
						.client.local
						? 'border border-border bg-muted'
						: 'border border-amber-500/30 bg-amber-500/10'}"
				>
					<span class="shrink-0 text-muted-foreground">Returns to</span>
					<span
						class="min-w-0 font-mono text-sm font-semibold [overflow-wrap:anywhere] text-foreground"
					>
						{data.client.returnTo}
					</span>
				</p>
				{#if !data.client.local}
					<p
						class="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-900 dark:text-amber-300"
					>
						<TriangleAlertIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
						<span>
							The app picked the name “{data.client.name}” itself; Statty can't verify it.
							<strong class="font-semibold">Trust the address above, not the name.</strong>
						</span>
					</p>
				{/if}
			</header>

			<div class="flex flex-col gap-3 rounded-2xl border border-border/60 p-4">
				<div class="flex items-center gap-3 text-sm">
					<EyeIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span class="flex flex-col gap-0.5">
						<span class="font-medium">Read monitors and status</span>
						<span class="text-xs text-muted-foreground">Always included.</span>
					</span>
				</div>
				{#if data.writeRequested}
					<!-- A div, not a label: only the switch itself grants write access, never a stray tap on the text. -->
					<div class="flex items-center gap-3 border-t border-border/60 pt-3 text-sm">
						<PencilIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<span class="flex flex-1 flex-col gap-0.5">
							<span id="oauth-write-title" class="font-medium">
								Create, change and delete monitors
							</span>
							<!-- Turning write on should look like a weightier choice than leaving it off. -->
							<span
								id="oauth-write-hint"
								aria-live="polite"
								class="text-xs transition-colors {canWrite
									? 'text-amber-900 dark:text-amber-300'
									: 'text-muted-foreground'}"
							>
								{canWrite
									? 'It can also delete monitors and their history.'
									: 'Leave off for read-only access.'}
							</span>
						</span>
						<!-- A darker off track than the kit's: this switch grants write access, so it must be easy to spot. -->
						<Switch
							class="ml-1 data-unchecked:bg-foreground/35"
							bind:checked={canWrite}
							aria-labelledby="oauth-write-title"
							aria-describedby="oauth-write-hint"
						/>
					</div>
				{/if}
			</div>

			<div class="flex flex-col gap-2">
				<Label for="oauth-label">Name in your API keys</Label>
				<Input
					id="oauth-label"
					bind:value={label}
					maxlength={100}
					required
					autocomplete="off"
					spellcheck={false}
					enterkeyhint="done"
					aria-invalid={labelMissing ? true : undefined}
					aria-describedby="oauth-label-hint"
				/>
				<p
					id="oauth-label-hint"
					class="text-xs text-pretty {labelMissing ? 'text-destructive' : 'text-muted-foreground'}"
				>
					{#if labelMissing}
						Give the key a name to allow access.
					{:else if data.existing}
						Approving updates the key from your last sign-in.
					{:else}
						Approving adds a key you can edit or delete under
						<!-- A new tab, so this approval stays open. -->
						<a
							href={resolve('/settings/api')}
							target="_blank"
							rel="noopener"
							class="whitespace-nowrap text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
						>
							Settings → API & MCP
						</a>.
					{/if}
				</p>
			</div>

			<!-- After answering the form stays put (buttons disabled) instead of collapsing to a spinner. -->
			<p class="sr-only" role="status">
				{leaving ? `Returning to ${data.client.name}…` : ''}
			</p>
			<!-- Allow comes first in the DOM (and tab order); row-reverse puts it on the right on desktop. -->
			<div class="flex flex-col gap-2 border-t border-border/60 pt-5 sm:flex-row-reverse">
				<Button
					class="disabled:opacity-60"
					disabled={busy !== null || labelMissing}
					aria-describedby={labelMissing ? 'oauth-label-hint' : undefined}
					onclick={() => answer('approve')}
				>
					{#if busy === 'approve'}<Loader2Icon
							class="size-4 animate-spin"
							aria-hidden="true"
						/>{/if}
					{leaving && busy === 'approve' ? 'Returning…' : 'Allow access'}
				</Button>
				<Button
					variant="outline"
					class="border-foreground/15"
					disabled={busy !== null}
					onclick={() => answer('deny')}
				>
					{#if busy === 'deny'}<Loader2Icon class="size-4 animate-spin" aria-hidden="true" />{/if}
					Deny
				</Button>
			</div>
		{/if}
	</div>
</AuthShell>
