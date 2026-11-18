<script lang="ts">
	import './layout.css';
	import type { Snippet } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import favicon from '$lib/assets/favicon.svg';
	import { Toaster } from '$lib/components/ui/sonner/index.js';

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
	<title>Statty</title>
	<link rel="icon" href={favicon} />
</svelte:head>
<ModeWatcher disableHeadScriptInjection themeColors={{ light: '#f9f8f7', dark: '#0e0d0c' }} />
{@render children()}
<Toaster />
