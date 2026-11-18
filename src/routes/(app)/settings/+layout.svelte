<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import BellIcon from '@lucide/svelte/icons/bell';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import UsersIcon from '@lucide/svelte/icons/users';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const isAdmin = $derived(data.user.role === 'admin');
	const sections = $derived([
		{ href: '/settings/api' as const, label: 'API & MCP', icon: KeyRoundIcon },
		...(isAdmin
			? [
					{ href: '/settings/notifications' as const, label: 'Notifications', icon: BellIcon },
					{ href: '/settings/status-page' as const, label: 'Status page', icon: GlobeIcon },
					{ href: '/settings/users' as const, label: 'Users', icon: UsersIcon }
				]
			: [])
	]);
	const isActive = (href: string) => page.url.pathname.startsWith(href);
</script>

<!-- No subtitle: the section nav right below already lists what's here (and stays true as
	sections are added). -->
<PageHeader title="Settings" />

<nav
	class="-mx-4 flex gap-1 overflow-x-auto border-b px-4 md:hidden"
	aria-label="Settings sections"
>
	{#each sections as section (section.href)}
		<a
			href={resolve(section.href)}
			aria-current={isActive(section.href) ? 'page' : undefined}
			class="shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors {isActive(
				section.href
			)
				? 'border-foreground font-medium text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
		>
			{section.label}
		</a>
	{/each}
</nav>

<div class="flex gap-8">
	<nav
		class="sticky top-20 -ml-3 hidden w-52 shrink-0 flex-col gap-0.5 self-start md:flex"
		aria-label="Settings sections"
	>
		{#each sections as section (section.href)}
			<a
				href={resolve(section.href)}
				aria-current={isActive(section.href) ? 'page' : undefined}
				class="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors {isActive(
					section.href
				)
					? 'bg-accent font-medium text-accent-foreground'
					: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
			>
				<section.icon class="size-4 shrink-0" aria-hidden="true" />
				{section.label}
			</a>
		{/each}
	</nav>
	<div class="flex min-w-0 flex-1 flex-col gap-6">
		{@render children()}
	</div>
</div>
