# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Claude Code specifics

- **Before saying a change is done**, run the `verify` skill (the full local gate). Build features test-first with the `tdd` skill, at the seams listed in `docs/architecture.md`.
- **After changing user-facing text** (parameters, descriptions, errors), run the `copy-reviewer` subagent and fix any blockers.
- **Hooks** in `.claude/settings.json` block publishing, runtime dependencies, and Linear issues that break the `linear-issue-management` rules. If one blocks you, change the approach rather than working around it. After editing a hook, run `node .claude/hooks/hooks.test.mjs` and `node .claude/skills/linear-issue-management/hooks/linear-issue-guard.test.mjs`.
- **Linear:** follow the `linear-issue-management` skill for every issue you create, update or close. Post project updates with `/linear-project-update`.
- `.mcp.json` configures two n8n documentation MCP servers: `n8n-docs` (search and fetch docs.n8n.io pages) and `n8n-kapa`. Query them for n8n internals (helpers, parameter types, versioning, linter rules) rather than relying on memory.

## Linear

Settings for the `linear-issue-management` and `linear-project-update` skills and the Linear issue hook. Regenerate with `/linear-issue-management setup`.

- **Workspace:** contactwise
- **Team:** T-Integrations (key `TIN`)
- **Project:** n8n-nodes-contactwise
- **Assignee:** me (Lucky, the owner and solo maintainer)
- **Type labels:** Feature, Improvement, Bug
- **Area labels:** ci, infra, documentation, testing, security, auth, ux, ops, integration, foundation, audit, ratelimit, open-question
- **Statuses:** Backlog → Todo → In Progress → In Review → Done (also Canceled, Duplicate)
- **Branches and commits:** use Linear's branch name (`<user>/tin-<n>-<slug>`); reference `TIN-<n>` in commit messages
- **GitHub integration:** connected to `contactwise-oss/n8n-nodes-contactwise` (2026-09-23, TIN-50); PR automation: branch pushed → In Progress, PR opened → In Review, PR merged → Done; GitHub Issues sync: off. So post the `## Implementation` comment before merging, and mention only the PR's own issue (`Fixes TIN-n`): every issue ID in a PR is linked and moved, including after "Part of" or "Ref"

### Milestones

| Milestone | Contents |
|---|---|
| M1 · SMS on npm for self-hosted n8n | The SMS node published to npm for self-hosted customers |
| M2 · SMS hardening for self-hosted customers | Provenance publishing with the n8n scan (TIN-11), public API docs fixes (TIN-5), live Callback URL and AI Agent tests (TIN-54) |
| M3 · WhatsApp nodes | The WhatsApp action and trigger nodes (epic TIN-30) |
| M4 · n8n verification (n8n Cloud) | n8n Cloud only: the npm maintainer check, the reviewers' test tenant, the Creator Portal submission. After the self-hosted work |
| Backlog · Unscheduled | API-team reference issues (under TIN-20), the SMS Trigger, Phase 2 dropdowns, anything not yet planned |

### Project-specific rules

- ContactWise API or backend changes that the nodes need are reference-only sub-issues of epic TIN-20, titled `API team: …`, in `Backlog · Unscheduled`. They take the priority of the node work they block.
