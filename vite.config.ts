import { existsSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
	if (mode !== 'test' && existsSync('.env')) process.loadEnvFile();

	return {
		plugins: [tailwindcss(), sveltekit()],
		test: {
			expect: { requireAssertions: true },
			environment: 'node',
			include: ['src/**/*.{test,spec}.ts']
		}
	};
});
