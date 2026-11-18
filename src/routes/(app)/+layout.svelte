<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { mode, setMode } from 'mode-watcher';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import BrandMark from '$lib/components/app/BrandMark.svelte';
	import { signOutToLogin } from '$lib/auth-client.js';
	import { dashboardStream } from '$lib/live/monitors.svelte.js';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Keeps the live stream open across pages, so moving between them doesn't reconnect.
	$effect(() => dashboardStream.listen(() => {}));

	const NAV = [
		{ href: '/', label: 'Monitors', icon: ActivityIcon },
		{ href: '/settings', label: 'Settings', icon: SettingsIcon }
	] as const;

	const isActive = (href: string) =>
		href === '/'
			? page.url.pathname === '/' || page.url.pathname.startsWith('/monitors')
			: page.url.pathname.startsWith(href);

	const initials = $derived(
		(data.user.name || data.user.email)
			.split(/\s+/)
			.map((p) => p[0])
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);
</script>

<div class="flex min-h-dvh flex-col">
	<header
		class="sticky top-0 z-40 border-b border-border/60 bg-background/80 pt-(--safe-top) backdrop-blur-md"
	>
		<div class="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 md:px-6">
			<a href={resolve('/')} class="mr-3 flex items-center gap-2 rounded-lg">
				<BrandMark class="size-7 rounded-lg" />
				<span class="font-semibold tracking-tight max-sm:sr-only">Statty</span>
			</a>
			<nav class="flex items-center gap-1" aria-label="Main">
				{#each NAV as item (item.href)}
					<a
						href={resolve(item.href)}
						aria-current={isActive(item.href) ? 'page' : undefined}
						class="flex h-8 items-center gap-2 rounded-full px-3 text-sm transition-colors {isActive(
							item.href
						)
							? 'bg-accent font-medium text-accent-foreground'
							: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
					>
						<item.icon class="size-4" aria-hidden="true" />
						{item.label}
					</a>
				{/each}
			</nav>
			<div class="ml-auto flex items-center gap-1">
				<a
					href={resolve('/status')}
					class="flex h-8 items-center gap-2 rounded-full px-3 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
					title="Public status page"
				>
					<GlobeIcon class="size-4" aria-hidden="true" />
					<span class="max-sm:sr-only">Status page</span>
				</a>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/30"
						aria-label="Account menu"
					>
						{initials}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="min-w-56">
						<DropdownMenu.Label class="flex flex-col gap-0.5 font-normal">
							<span class="truncate text-sm font-medium">{data.user.name}</span>
							<span class="truncate text-xs text-muted-foreground">{data.user.email}</span>
						</DropdownMenu.Label>
						<DropdownMenu.Separator />
						<DropdownMenu.Item onclick={() => setMode(mode.current === 'dark' ? 'light' : 'dark')}>
							{#if mode.current === 'dark'}<SunIcon class="size-4" />Light mode{:else}<MoonIcon
									class="size-4"
								/>Dark mode{/if}
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => void signOutToLogin()}>
							<LogOutIcon class="size-4" />Sign out
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</div>
	</header>
	<main class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:p-6">
		{@render children()}
	</main>
</div>
