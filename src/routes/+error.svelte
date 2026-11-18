<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import { Button } from '$lib/components/ui/button/index.js';
	import AuthShell from '$lib/components/app/auth/AuthShell.svelte';

	// SvelteKit's own messages ("Not Found", "Internal Error") are developer text,
	// so they are replaced by friendly copy; a specific message from a load
	// function (e.g. "Monitor not found") is kept as the heading.
	const GENERIC = new Set(['Not Found', 'Internal Error', 'Error']);

	const status = $derived(page.status);
	const message = $derived(page.error?.message ?? '');
	const specific = $derived(message && !GENERIC.has(message) ? message : '');
	const serverError = $derived(status >= 500);
	/** Sign-in link that comes back here afterwards. */
	const signInHref = $derived(
		`${resolve('/login')}?redirectTo=${encodeURIComponent(page.url.pathname + page.url.search)}`
	);
	// The (app) routes need a session (signed-out visitors are sent to /login
	// before any 404), so an error under them means "/" is the dashboard.
	const inApp = $derived(/^\/(monitors|settings)(\/|$)/.test(page.url.pathname));

	const copy = $derived.by(() => {
		if (status === 404)
			return {
				title: specific || 'Page not found',
				hint: specific
					? 'It may have been deleted, or the link is wrong.'
					: 'It may have been deleted or moved, or the link is wrong.'
			};
		if (status === 401)
			return {
				title: specific || 'Sign in to continue',
				hint: 'This page needs a Statty account.'
			};
		if (status === 403)
			return {
				title: specific || "You don't have access",
				hint: 'Sign in with an account that has access, or ask the instance owner.'
			};
		if (serverError)
			return {
				title: 'Something went wrong',
				hint: specific || 'An unexpected error occurred. Try again in a moment.'
			};
		return { title: specific || 'Something went wrong', hint: '' };
	});
</script>

<svelte:head><title>{copy.title} · Statty</title></svelte:head>

<AuthShell centered>
	<div
		class="flex w-full flex-col items-center gap-6 text-center text-card-foreground sm:rounded-4xl sm:border sm:bg-card sm:px-8 sm:py-8 sm:shadow-sm"
	>
		<header class="flex flex-col items-center gap-1.5">
			<p class="text-sm font-medium text-muted-foreground tabular-nums">
				Error {status}
			</p>
			<h1 class="text-xl font-semibold tracking-tight text-balance">{copy.title}</h1>
			{#if copy.hint}
				<p class="text-sm text-balance text-muted-foreground">{copy.hint}</p>
			{/if}
		</header>
		<!--
			"/" opens the dashboard when signed in and the public status page when
			signed out, so one link fits both; it is named for where it goes when that
			is known. A server error offers a retry first, a 401 a sign-in.
		-->
		<div class="flex w-full max-w-xs flex-col gap-2 sm:w-auto sm:max-w-none sm:flex-row-reverse">
			{#if serverError}
				<Button onclick={() => location.reload()}>
					<RotateCwIcon aria-hidden="true" />
					Try again
				</Button>
			{:else if status === 401}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve()d in signInHref -->
				<Button href={signInHref}>Sign in</Button>
			{/if}
			<Button
				href={resolve('/')}
				variant={serverError || status === 401 ? 'outline' : 'default'}
				class={serverError || status === 401 ? 'border-foreground/15' : ''}
			>
				{inApp ? 'Back to dashboard' : 'Back to Statty'}
			</Button>
		</div>
	</div>
</AuthShell>
