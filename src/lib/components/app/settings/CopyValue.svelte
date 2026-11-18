<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';

	/** A labelled read-only value (URL, ID) with a copy button. */
	let { label, value }: { label: string; value: string } = $props();

	// Long URLs wrap only after / and . (never at a hyphen, which would read as part of the URL).
	const parts = $derived(value.split(/(?<=[/.])/));

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			copied = true;
			clearTimeout(timer);
			timer = setTimeout(() => (copied = false), 1500);
		} catch {
			toast.error('Couldn’t copy to the clipboard');
		}
	}
</script>

<div class="flex min-w-0 items-end gap-2">
	<div class="flex min-w-0 flex-1 flex-col gap-0.5">
		<span class="text-sm text-muted-foreground">{label}</span>
		<!-- A value without / or . (a token) has no natural break, so it may break anywhere. -->
		<code class="font-mono text-xs leading-snug wrap-anywhere text-foreground select-all">
			{#each parts as part, i (i)}<span class={parts.length > 1 ? 'whitespace-nowrap' : ''}>
					{part}
				</span><wbr />{/each}
		</code>
	</div>
	<Button
		type="button"
		variant="ghost"
		size="icon-sm"
		class="shrink-0"
		aria-label={`Copy ${label}`}
		title={copied ? 'Copied' : 'Copy'}
		onclick={copy}
	>
		{#if copied}<CheckIcon class="size-4" />{:else}<CopyIcon class="size-4" />{/if}
	</Button>
	<span class="sr-only" aria-live="polite">{copied ? `${label} copied` : ''}</span>
</div>
