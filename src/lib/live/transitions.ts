import { cubicOut } from 'svelte/easing';

/**
 * Washes an element with `color` and fades it out: a row's brief highlight when
 * its status changes. Use as `in:flash` inside `{#key status}`; it does not
 * play on the page's first render.
 */
export function flash(
	_node: Element,
	{ color = 'currentColor', duration = 1600, strength = 14 } = {}
) {
	return {
		duration,
		easing: cubicOut,
		css: (t: number) =>
			`background-color: color-mix(in oklch, ${color} ${((1 - t) * strength).toFixed(1)}%, transparent)`
	};
}
