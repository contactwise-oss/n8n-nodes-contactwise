---
name: linear-issue-management
description: Rules and procedures for creating, updating, commenting on and closing Linear issues (priority, labels, milestone, relations, spec in the description, updates as comments). Project-specific values come from the "## Linear" section of CLAUDE.md. Use whenever you create, change or close Linear issues or epics. Run with "setup" to generate that CLAUDE.md section and install the enforcement hook in a new project.
argument-hint: "[setup]"
---

# Linear issue management

This skill works in any repo. The rules below are the same everywhere. The **project-specific values** (team, project, assignee, labels, milestones, statuses, extra rules) live in the `## Linear` section of the repo's `CLAUDE.md`.

## 0. Load the project's Linear settings

1. Read the `## Linear` section of `CLAUDE.md` in the repo root. It must have **Team**, **Project**, **Assignee**, **Type labels**, **Area labels** and a **Milestones** table.
2. If the section is missing or incomplete: **stop**. Tell the developer what's missing and offer to run `/linear-issue-management setup` (section 6). Don't guess the values.
3. If the Linear tools are deferred, load them with ToolSearch (e.g. `select:mcp__claude_ai_Linear__save_issue,…`).

With `setup` as the argument, go straight to section 6.

## 1. Every issue has

| Field | Rule |
|---|---|
| Assignee | The **Assignee** from CLAUDE.md, always. Reassign when someone else picks the issue up. |
| Priority | Set on create, never "No priority". Use the scale below. |
| Labels | Exactly **one type label** from **Type labels**, plus **1–2 area labels** from **Area labels**. Type: new capability → Feature; a change to something that exists (including docs, tests, CI, tooling, process) → Improvement; a defect → Bug. |
| Milestone | Always. Unplanned work goes in the unscheduled/backlog milestone listed in CLAUDE.md. Sub-issues share their parent's milestone. |
| Relations | **Blocked by / Blocks** only for hard dependencies: the work can't start or can't finish without the other issue. **Related** for "see also". Don't add a direct link that's already implied through another issue. Epics group their work as parent and sub-issues, not with blocking links. |
| Title | Starts with a verb and says what changes. |

### Priority scale

| Priority | Use when |
|---|---|
| Urgent (1) | It blocks the current milestone's target date or a customer. |
| High (2) | The current milestone needs it. |
| Medium (3) | A later milestone needs it. |
| Low (4) | Nice to have, or unscheduled. |

Issues tracked for another team take the priority of our work they block. CLAUDE.md may add project-specific exceptions.

## 2. Description vs. comments

The **description is the spec**: the problem, requirements, scope and a "Done when" checklist. It must stay true.

- If scope changes, edit the description **and** add a comment that says what changed and why.
- Never write progress, results, dates of events or replanning notes into a description.
- Everything else goes in **comments**, each starting with one of these headings:

| Heading | Holds |
|---|---|
| `## Design` | The approach, alternatives considered, the interfaces |
| `## Decision` | What was decided, why, and the date |
| `## Progress` | What's done, what's next, blockers, the date |
| `## Implementation` | The PR link, what changed, check results, anything left for later |

**Epics** are the exception. An epic's description is the requirements document for its sub-issues, so it may keep a decision log and a context snapshot. Its type label is the main type of its sub-issues.

## 3. Status flow

`Backlog` → `Todo` (planned next) → `In Progress` (branch created) → `In Review` (PR open) → `Done` (merged).

- **Done** needs an `## Implementation` comment first. Issues closed without code (ops, research, work owned by another team) record the outcome there instead.
- **Canceled** and **Duplicate** always get a comment with the reason.

Use the status names from CLAUDE.md if they differ.

## 4. Procedures

### Create an issue
1. Check for duplicates: `list_issues` with a `query` on the key words.
2. Write the description: **Problem** (why), **Requirements** or **What to do**, **Done when** (a checklist).
3. Create it in one `save_issue` call with team, project, assignee, priority, milestone, labels and `parentId` where it applies. Include `blockedBy`/`blocks`/`relatedTo` for issues that already exist.
4. **Read it back** with `get_issue` and `includeRelations: true`, and check that the fields and relations were saved.

### Create an epic with sub-issues
1. Create the epic, with a `## Sub-issues` heading as a placeholder.
2. Create the sub-issues with `parentId` set to the epic. They share the epic's milestone.
3. Once all the IDs exist, add the blocking links.
4. Replace the placeholder with a table: #, issue, blocked by. Add the critical path if there is one.
5. Read everything back with `list_issues` and `parentId`, and spot-check the relations.

### Update, start or finish work
- Starting: set `In Progress` and add a `## Progress` comment with the plan, or a `## Design` comment.
- PR opened: set `In Review`, attach the PR link (`links`), and add a `## Progress` comment.
- Finished: add an `## Implementation` comment, then set `Done`.
- Decision taken: add a `## Decision` comment with the date.
- Plan changed: move the milestone or priority, and add a `## Decision` comment giving the reason.

### When something goes wrong
- A Linear call errored: list issues **before** retrying, so a partial create doesn't leave a duplicate.
- The enforcement hook blocked a call: fix the call as the message says. Don't work around it.
- A permission check blocked an edit: report it to the developer. Don't try another route.

## 5. The enforcement hook

`hooks/linear-issue-guard.mjs` runs before every Linear `save_issue` call:
- **Create:** blocks the call unless it has an assignee, a priority from 1 to 4, a milestone and exactly one type label. It only checks issues for the team or project in CLAUDE.md.
- **Update:** blocks a full `labels` replacement that doesn't keep exactly one type label, and blocks clearing the priority.
- **No `## Linear` section:** blocks creates and points to `setup`.

The hook can't check relations or whether a description holds progress notes. Those rules stay with you.

Tests: `node .claude/skills/linear-issue-management/hooks/linear-issue-guard.test.mjs`

## 6. `setup`: configure a project

Run this in a repo that doesn't have a `## Linear` section yet, or has an incomplete one.

1. **Find the values.**
   - `list_teams`, then `list_projects` for the team. Ask the developer which ones (use AskUserQuestion with the likely choice first).
   - `get_user` with `me` gives the assignee.
   - Load `list_milestones`, `list_issue_labels` for the team, and `list_issue_statuses`.
2. **Draft the section** from `reference/claude-md-section.md`.
   - Type labels are the team's Feature/Improvement/Bug labels, or the closest equivalents. Area labels are the others that apply to this project.
   - If the project has no unscheduled milestone, offer to create `Backlog · Unscheduled`.
3. **Show the draft and ask for approval.** Then write it into `CLAUDE.md`, replacing any existing `## Linear` section, or appending it at the end.
4. **Install the hook.** Add this to the project's `.claude/settings.json` under `hooks.PreToolUse`, merging with what's there and not duplicating it. Show the change first.
   ```json
   {
     "matcher": "mcp__.*[Ll]inear.*__save_issue",
     "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/skills/linear-issue-management/hooks/linear-issue-guard.mjs\"", "timeout": 10 }]
   }
   ```
   If the skill is installed at user level (`~/.claude/skills/`), put the entry in `~/.claude/settings.json` with that absolute path instead.
5. **Check it.** Run the hook tests. Then pipe a sample create payload with no milestone into the hook and confirm it's blocked:
   `echo '{"tool_name":"mcp__claude_ai_Linear__save_issue","tool_input":{"team":"<team>","title":"x"}}' | CLAUDE_PROJECT_DIR=$PWD node .claude/skills/linear-issue-management/hooks/linear-issue-guard.mjs`
   It should exit with code 2.
6. **Point agents at it.** Add one line to `AGENTS.md` (or CLAUDE.md) saying that Linear work follows this skill.

Related: `linear-project-update` posts project status updates from the same CLAUDE.md settings.
