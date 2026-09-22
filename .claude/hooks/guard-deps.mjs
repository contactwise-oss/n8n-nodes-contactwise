#!/usr/bin/env node
// PreToolUse guard: verified n8n community nodes must have zero runtime dependencies.
// - Bash: blocks package-manager installs that would add a non-dev dependency.
// - Edit/Write/MultiEdit on the root package.json: simulates the edit and blocks it
//   if dependencies/optionalDependencies/bundleDependencies would be non-empty or a
//   peer dependency other than n8n-workflow would exist.
// Exit 2 blocks the tool call and shows stderr to the agent.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const tool = input.tool_name;
const toolInput = input.tool_input ?? {};
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const rootPackageJson = path.resolve(projectDir, 'package.json');
const ALLOWED_PEERS = new Set(['n8n-workflow']);

function block(detail) {
	process.stderr.write(
		`Blocked by .claude/hooks/guard-deps.mjs: ${detail}\n` +
			'Verified n8n community nodes must have zero runtime dependencies. Use n8n helpers ' +
			'(e.g. this.helpers.httpRequestWithAuthentication) instead of a package, or install build/test tooling as a devDependency (-D).\n',
	);
	process.exit(2);
}

// Per package manager: install subcommands, and flags that keep a package out of runtime deps.
const MANAGERS = {
	npm: {
		install: new Set(['install', 'i', 'add', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall']),
		safe: new Set(['-D', '--save-dev', '-g', '--global', '--location=global', '--no-save']),
		peer: new Set(['--save-peer']),
	},
	pnpm: {
		install: new Set(['add', 'install', 'i']),
		safe: new Set(['-D', '--save-dev', '-g', '--global']),
		peer: new Set(['--save-peer']),
	},
	yarn: {
		install: new Set(['add']),
		safe: new Set(['-D', '--dev']),
		peer: new Set(['-P', '--peer']),
	},
	bun: {
		install: new Set(['add', 'install', 'i']),
		safe: new Set(['-d', '-D', '--dev', '-g', '--global', '--no-save']),
		peer: new Set(['--peer']),
	},
};
// Flags whose next token is a value, not a package name.
const VALUE_FLAGS = new Set(['--registry', '--tag', '--prefix', '-w', '--workspace', '--filter', '--cwd', '-C', '--dir']);

const packageName = (spec) => {
	const at = spec.lastIndexOf('@');
	return at > 0 ? spec.slice(0, at) : spec;
};

function checkCommand(command) {
	for (const segment of command.split(/&&|\|\||[;|\n]/)) {
		const tokens = segment.trim().split(/\s+/).filter(Boolean);
		// Skip env assignments and wrappers in front of the package manager.
		while (tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0]) || ['sudo', 'env', 'command'].includes(tokens[0]))) {
			tokens.shift();
		}
		const manager = MANAGERS[tokens[0]];
		if (!manager) continue;

		const rest = tokens.slice(1);
		const subIndex = rest.findIndex((t) => !t.startsWith('-'));
		if (subIndex === -1 || !manager.install.has(rest[subIndex])) continue;

		const flags = new Set();
		const packages = [];
		const args = rest.slice(subIndex + 1).concat(rest.slice(0, subIndex));
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (/^(\d*>>?|&>>?|<)(&\d+)?/.test(arg)) {
				// Shell redirection: a bare operator (`>`, `2>`) also consumes the next token (its target).
				if (/^(\d*>>?|&>>?|<)$/.test(arg)) i++;
			} else if (arg.startsWith('-')) {
				flags.add(arg);
				if (VALUE_FLAGS.has(arg)) i++;
			} else {
				packages.push(arg);
			}
		}
		if (packages.length === 0) continue; // plain `npm install` / `npm ci`: restores the lockfile
		if ([...flags].some((f) => manager.safe.has(f))) continue;
		if ([...flags].some((f) => manager.peer.has(f)) && packages.every((p) => ALLOWED_PEERS.has(packageName(p)))) continue;

		block(`\`${segment.trim()}\` would add runtime dependencies: ${packages.join(', ')}.`);
	}
}

function simulateEdit() {
	const current = existsSync(rootPackageJson) ? readFileSync(rootPackageJson, 'utf8') : '';
	const applyOne = (text, { old_string: oldStr = '', new_string: newStr = '', replace_all: all = false }) => {
		if (all) return text.split(oldStr).join(newStr);
		const at = text.indexOf(oldStr);
		return at === -1 ? text : text.slice(0, at) + newStr + text.slice(at + oldStr.length);
	};
	if (tool === 'Write') return String(toolInput.content ?? '');
	if (tool === 'MultiEdit') return (toolInput.edits ?? []).reduce(applyOne, current);
	return applyOne(current, toolInput);
}

function checkPackageJson() {
	if (!toolInput.file_path || path.resolve(projectDir, toolInput.file_path) !== rootPackageJson) return;

	let pkg;
	try {
		pkg = JSON.parse(simulateEdit());
	} catch {
		return; // Not valid JSON yet; nothing to judge. `npm run lint`/build will catch real breakage.
	}
	const problems = [];
	const deps = Object.keys(pkg.dependencies ?? {});
	const optional = Object.keys(pkg.optionalDependencies ?? {});
	const bundled = pkg.bundleDependencies ?? pkg.bundledDependencies;
	const peers = Object.keys(pkg.peerDependencies ?? {}).filter((p) => !ALLOWED_PEERS.has(p));
	if (deps.length) problems.push(`dependencies: ${deps.join(', ')}`);
	if (optional.length) problems.push(`optionalDependencies: ${optional.join(', ')}`);
	if (bundled && (bundled === true || bundled.length)) problems.push('bundleDependencies');
	if (peers.length) problems.push(`peerDependencies other than n8n-workflow: ${peers.join(', ')}`);
	if (problems.length) block(`package.json would contain ${problems.join('; ')}.`);
}

if (tool === 'Bash') checkCommand(String(toolInput.command ?? ''));
else if (['Edit', 'Write', 'MultiEdit'].includes(tool)) checkPackageJson();
process.exit(0);
