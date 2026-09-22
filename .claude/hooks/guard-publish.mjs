#!/usr/bin/env node
// PreToolUse(Bash) guard: only the GitHub Actions publish workflow may publish.
// n8n verification requires npm provenance, which a laptop publish can't produce.
// Exit 2 blocks the tool call and shows stderr to the agent.
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const command = String(input?.tool_input?.command ?? '');

// Split on shell separators so "--dry-run" in one segment can't excuse another.
const segments = command.split(/&&|\|\||[;|\n]/);

const rules = [
	{
		test: (s) => /(^|[\s(])(npm|pnpm|yarn|bun)(\s+npm)?\s+(un)?publish\b/.test(s) && !/--dry-run\b/.test(s),
		reason: 'package publishing',
	},
	{
		test: (s) => /\brelease\b.*--publish\b/.test(s),
		reason: '`release --publish` (local publish without provenance)',
	},
	{
		test: (s) => /(^|[\s(])(export\s+)?GITHUB_ACTIONS=/.test(s),
		reason: 'faking GitHub Actions (`GITHUB_ACTIONS=`) to trigger CI-mode release',
	},
];

for (const segment of segments) {
	const hit = rules.find((r) => r.test(segment));
	if (hit) {
		process.stderr.write(
			`Blocked by .claude/hooks/guard-publish.mjs: ${hit.reason}.\n` +
				'Publishing is CI-only: .github/workflows/publish.yml publishes with npm provenance, which n8n verification requires.\n' +
				'To release, run `npm run release` (locally it bumps the version, updates the changelog, tags and pushes; the tag triggers CI to publish). Dry runs (`--dry-run`, `npm pack --dry-run`) are allowed.\n',
		);
		process.exit(2);
	}
}
process.exit(0);
