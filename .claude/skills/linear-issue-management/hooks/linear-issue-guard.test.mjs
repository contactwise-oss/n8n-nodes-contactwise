#!/usr/bin/env node
// Regression table for linear-issue-guard. Run: node .claude/skills/linear-issue-management/hooks/linear-issue-guard.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const H = path.dirname(fileURLToPath(import.meta.url));
const withConfig = mkdtempSync(path.join(tmpdir(), 'linear-guard-'));
const withoutConfig = mkdtempSync(path.join(tmpdir(), 'linear-guard-none-'));
writeFileSync(
  path.join(withConfig, 'CLAUDE.md'),
  `# CLAUDE.md\n\nIntro.\n\n## Linear\n\n- **Team:** T-Integrations (key \`TIN\`)\n- **Project:** n8n-nodes-contactwise\n- **Assignee:** me\n- **Type labels:** Feature, Improvement, Bug\n\n## Other\n\n- **Team:** Wrong\n`,
);
writeFileSync(path.join(withoutConfig, 'CLAUDE.md'), '# CLAUDE.md\n\nNo Linear section.\n');

const TOOL = 'mcp__claude_ai_Linear__save_issue';
const ok = { team: 'T-Integrations', title: 'Do a thing', assignee: 'me', priority: 3, milestone: 'M1', labels: ['Feature', 'ci'] };
const cases = [
  // [projectDir, payload, expectedExit, label]
  [withConfig, { tool_name: TOOL, tool_input: ok }, 0, 'compliant create'],
  [withConfig, { tool_name: TOOL, tool_input: { ...ok, labels: undefined, addLabels: ['improvement', 'ci'] } }, 0, 'type label via addLabels, case-insensitive'],
  [withConfig, { tool_name: TOOL, tool_input: { ...ok, team: undefined, project: 'n8n-nodes-contactwise' } }, 0, 'matched by project name'],
  [withConfig, { tool_name: TOOL, tool_input: { ...ok, priority: undefined } }, 2, 'missing priority'],
  [withConfig, { tool_name: TOOL, tool_input: { ...ok, priority: 0 } }, 2, 'priority 0'],
  [withConfig, { tool_name: TOOL, tool_input: { ...ok, milestone: undefined } }, 2, 'missing milestone'],
  [withConfig, { tool_name: TOOL, tool_input: { ...ok, assignee: undefined } }, 2, 'missing assignee'],
  [withConfig, { tool_name: TOOL, tool_input: { ...ok, labels: ['ci'] } }, 2, 'no type label'],
  [withConfig, { tool_name: TOOL, tool_input: { ...ok, labels: ['Feature', 'Bug'] } }, 2, 'two type labels'],
  [withConfig, { tool_name: TOOL, tool_input: { ...ok, labels: undefined, template: 'Bug report' } }, 0, 'template supplies labels'],
  [withConfig, { tool_name: TOOL, tool_input: { team: 'Other team', title: 'x' } }, 0, 'other team is not policed'],
  [withConfig, { tool_name: TOOL, tool_input: { id: 'TIN-1', state: 'Done' } }, 0, 'plain update'],
  [withConfig, { tool_name: TOOL, tool_input: { id: 'TIN-1', addLabels: ['ci'] } }, 0, 'update addLabels'],
  [withConfig, { tool_name: TOOL, tool_input: { id: 'TIN-1', labels: ['ci'] } }, 2, 'update replaces labels without type'],
  [withConfig, { tool_name: TOOL, tool_input: { id: 'TIN-1', priority: 0 } }, 2, 'update clears priority'],
  [withConfig, { tool_name: 'mcp__linear__save_issue', tool_input: { ...ok, milestone: undefined } }, 2, 'other Linear MCP server name'],
  [withConfig, { tool_name: 'mcp__claude_ai_Linear__save_comment', tool_input: { body: 'x' } }, 0, 'not save_issue'],
  [withoutConfig, { tool_name: TOOL, tool_input: ok }, 2, 'no ## Linear section blocks create'],
  [withoutConfig, { tool_name: TOOL, tool_input: { id: 'TIN-1', state: 'Done' } }, 0, 'no ## Linear section allows update'],
];

let failed = 0;
for (const [dir, payload, expected, label] of cases) {
  const r = spawnSync('node', [`${H}/linear-issue-guard.mjs`], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: 'utf8',
  });
  const pass = r.status === expected;
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  exit=${r.status} want=${expected}  ${label}${!pass && r.stderr ? '\n      ' + r.stderr.trim() : ''}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
rmSync(withConfig, { recursive: true, force: true });
rmSync(withoutConfig, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
