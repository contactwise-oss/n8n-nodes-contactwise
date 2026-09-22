import { defineConfig } from 'vitest/config';

// .mjs on purpose: the n8n linter applies community-node rules to every .ts file,
// which would forbid the path handling below.
const n8nWorkflowCjs = new URL('./node_modules/n8n-workflow/dist/cjs/index.js', import.meta.url)
	.pathname;

export default defineConfig({
	resolve: {
		// n8n loads community nodes with require(), so node code and n8n-core share the CommonJS
		// build of n8n-workflow. Tests must too: two copies would break instanceof checks on errors.
		alias: [{ find: /^n8n-workflow$/, replacement: n8nWorkflowCjs }],
	},
	test: {
		include: ['test/**/*.test.ts'],
		setupFiles: ['test/setup.ts'],
		restoreMocks: true,
		coverage: {
			provider: 'v8',
			// Gate only the logic modules where bugs cost money (normalization, error mapping,
			// retry policy, transport). Parameter-description files are excluded by design.
			include: ['nodes/**/shared/**/*.ts'],
			reporter: ['text', 'text-summary'],
			thresholds: {
				lines: 90,
				functions: 90,
				branches: 90,
				statements: 90,
			},
		},
	},
});
