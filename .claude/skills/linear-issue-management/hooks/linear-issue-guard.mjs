#!/usr/bin/env node
// PreToolUse hook for Linear save_issue calls (any Linear MCP server).
// Enforces the linear-issue-management rules using the "## Linear" section of the project's CLAUDE.md:
//   create (no `id`): assignee, priority 1-4, milestone and exactly one type label are required.
//   update (`id`):    a full label replacement must keep exactly one type label; priority can't be cleared to 0.
// Exit 2 blocks the call and feeds stderr back to the agent. Exit 0 allows it.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SETUP = 'Run `/linear-issue-management setup` to add it, or ask the developer to add a `## Linear` section to CLAUDE.md.';

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

// Returns the "## Linear" section of CLAUDE.md as { team, project, typeLabels } or null.
export function readLinearConfig(projectDir) {
  const file = path.join(projectDir, 'CLAUDE.md');
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  const match = text.match(/^## Linear[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (!match) return null;
  const field = (name) => {
    const m = match[1].match(new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.+)$`, 'mi'));
    return m ? m[1].trim() : '';
  };
  const firstToken = (v) => v.replace(/`/g, '').split(/\s+\(/)[0].trim();
  return {
    team: firstToken(field('Team')),
    project: firstToken(field('Project')),
    typeLabels: field('Type labels')
      .replace(/`/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

export function check(input, config) {
  if (!config) return [`CLAUDE.md has no \`## Linear\` section, so Linear issue rules can't be checked. ${SETUP}`];
  const problems = [];
  const typeLabels = config.typeLabels.map((l) => l.toLowerCase());
  if (!typeLabels.length) return [`The \`## Linear\` section in CLAUDE.md has no "Type labels" line. ${SETUP}`];
  const countTypes = (labels) => (labels ?? []).filter((l) => typeLabels.includes(String(l).toLowerCase())).length;
  const isCreate = !input.id;

  if (isCreate) {
    // Only police issues in this project's team or project.
    const ours = same(input.team, config.team) || same(input.project, config.project);
    if (!ours) return [];
    if (!input.assignee) problems.push('assignee is missing (see "Assignee" in CLAUDE.md `## Linear`)');
    if (!(Number.isInteger(input.priority) && input.priority >= 1 && input.priority <= 4))
      problems.push('priority must be 1 (Urgent), 2 (High), 3 (Medium) or 4 (Low)');
    if (!input.milestone) problems.push('milestone is missing (use the unscheduled/backlog milestone if unplanned)');
    if (!input.template) {
      const n = countTypes([...(input.labels ?? []), ...(input.addLabels ?? [])]);
      if (n !== 1) problems.push(`exactly one type label is required (${config.typeLabels.join(' / ')}), found ${n}`);
    }
  } else {
    if (input.priority === 0) problems.push('priority can\'t be cleared to "No priority"');
    if (Array.isArray(input.labels)) {
      const n = countTypes(input.labels);
      if (n !== 1) problems.push(`\`labels\` replaces the whole set and must keep exactly one type label (${config.typeLabels.join(' / ')}), found ${n}`);
    }
  }
  return problems;
}

const payload = readStdin();
if (!payload || !/linear/i.test(payload.tool_name ?? '') || !/save_issue$/.test(payload.tool_name ?? '')) process.exit(0);
const input = payload.tool_input ?? {};
const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
const config = readLinearConfig(projectDir);
// Without config, only block creates: updates to existing issues stay possible.
if (!config && input.id) process.exit(0);
const problems = check(input, config);
if (problems.length) {
  process.stderr.write(
    `Blocked by linear-issue-management (${input.id ? `update ${input.id}` : 'create'}):\n` +
      problems.map((p) => `- ${p}`).join('\n') +
      '\nFix the call and retry. Rules: .claude/skills/linear-issue-management/SKILL.md\n',
  );
  process.exit(2);
}
process.exit(0);
