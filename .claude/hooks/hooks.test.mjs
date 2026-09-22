#!/usr/bin/env node
// Regression table for the guard hooks. Run: node .claude/hooks/hooks.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const H = path.dirname(fileURLToPath(import.meta.url));
const P = mkdtempSync(path.join(tmpdir(), 'guard-hooks-'));
writeFileSync(path.join(P, 'package.json'), JSON.stringify({
  name: 'n8n-nodes-contactwise',
  devDependencies: { typescript: '5.9.2' },
  peerDependencies: { 'n8n-workflow': '*' },
}, null, 2));
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const cases = [
  // [hook, payload, expectedExit, label]
  ['guard-publish', bash('npm publish'), 2, 'npm publish'],
  ['guard-publish', bash('cd x && npm publish --access public'), 2, 'chained npm publish'],
  ['guard-publish', bash('pnpm publish'), 2, 'pnpm publish'],
  ['guard-publish', bash('yarn npm publish'), 2, 'yarn npm publish'],
  ['guard-publish', bash('npm unpublish n8n-nodes-contactwise@0.1.0'), 2, 'npm unpublish'],
  ['guard-publish', bash('npx n8n-node release --publish'), 2, 'n8n-node release --publish'],
  ['guard-publish', bash('npm run release -- --publish'), 2, 'npm run release -- --publish'],
  ['guard-publish', bash('GITHUB_ACTIONS=true npm run release'), 2, 'fake GITHUB_ACTIONS'],
  ['guard-publish', bash('export GITHUB_ACTIONS=1'), 2, 'export GITHUB_ACTIONS'],
  ['guard-publish', bash('npm publish --dry-run && npm publish'), 2, 'dry-run does not excuse 2nd segment'],
  ['guard-publish', bash('npm publish --dry-run'), 0, 'npm publish --dry-run'],
  ['guard-publish', bash('npm pack --dry-run'), 0, 'npm pack --dry-run'],
  ['guard-publish', bash('npm run release'), 0, 'npm run release (local, no publish)'],
  ['guard-publish', bash('grep -r "npm publish" docs/'), 0, 'grep for quoted text'],
  ['guard-publish', bash('ls -la'), 0, 'ls'],
  ['guard-deps', bash('npm install axios'), 2, 'npm install axios'],
  ['guard-deps', bash('npm i lodash@4 --save'), 2, 'npm i --save'],
  ['guard-deps', bash('pnpm add zod'), 2, 'pnpm add'],
  ['guard-deps', bash('yarn add got'), 2, 'yarn add'],
  ['guard-deps', bash('bun add ky'), 2, 'bun add'],
  ['guard-deps', bash('npm i --save-optional fsevents'), 2, 'optional dep'],
  ['guard-deps', bash('npm i --save-peer lodash'), 2, 'peer other than n8n-workflow'],
  ['guard-deps', bash('npm i -D vitest nock'), 0, 'npm i -D'],
  ['guard-deps', bash('npm install --save-dev n8n-core@2.16.1'), 0, '--save-dev'],
  ['guard-deps', bash('pnpm add -D vitest'), 0, 'pnpm add -D'],
  ['guard-deps', bash('npm i -g @n8n/node-cli'), 0, 'global install'],
  ['guard-deps', bash('npm i --save-peer n8n-workflow'), 0, 'peer n8n-workflow'],
  ['guard-deps', bash('npm install'), 0, 'plain npm install'],
  ['guard-deps', bash('npm ci'), 0, 'npm ci'],
  ['guard-deps', bash('npm install --registry https://r.example.com'), 0, 'value flag not a package'],
  ['guard-deps', bash('npm install 2>&1 | tail -5'), 0, 'redirect is not a package'],
  ['guard-deps', bash('npm ci > install.log'), 0, 'redirect target is not a package'],
  ['guard-deps', bash('npm i -D vitest 2>&1'), 0, 'dev install with redirect'],
  ['guard-deps', { tool_name: 'Edit', tool_input: { file_path: P + '/package.json', old_string: '"devDependencies"', new_string: '"dependencies": { "axios": "1" },\n  "devDependencies"' } }, 2, 'Edit adds dependencies'],
  ['guard-deps', { tool_name: 'Edit', tool_input: { file_path: P + '/package.json', old_string: '"typescript": "5.9.2"', new_string: '"typescript": "5.9.2", "vitest": "5.0.1"' } }, 0, 'Edit adds devDependency'],
  ['guard-deps', { tool_name: 'Write', tool_input: { file_path: P + '/package.json', content: '{"name":"x","dependencies":{}}' } }, 0, 'Write with empty dependencies'],
  ['guard-deps', { tool_name: 'Write', tool_input: { file_path: P + '/package.json', content: '{"name":"x","peerDependencies":{"n8n-workflow":"*","n8n-core":"*"}}' } }, 2, 'Write with extra peer'],
  ['guard-deps', { tool_name: 'MultiEdit', tool_input: { file_path: P + '/package.json', edits: [{ old_string: '"name"', new_string: '"optionalDependencies": {"x":"1"}, "name"' }] } }, 2, 'MultiEdit adds optionalDependencies'],
  ['guard-deps', { tool_name: 'Write', tool_input: { file_path: P + '/test/fixtures/package.json', content: '{"dependencies":{"a":"1"}}' } }, 0, 'nested package.json ignored'],
  ['guard-deps', { tool_name: 'Edit', tool_input: { file_path: P + '/README.md', old_string: 'a', new_string: 'b' } }, 0, 'non-package file'],
];
let failed = 0;
for (const [hook, payload, expected, label] of cases) {
  const r = spawnSync('node', [`${H}/${hook}.mjs`], { input: JSON.stringify(payload), env: { ...process.env, CLAUDE_PROJECT_DIR: P }, encoding: 'utf8' });
  const ok = r.status === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${hook}] exit=${r.status} want=${expected}  ${label}${!ok && r.stderr ? '\n      ' + r.stderr.trim() : ''}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
rmSync(P, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
