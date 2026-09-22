# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Claude Code specifics

- **Before saying a change is done**, run the `verify` skill (the full local gate). Build features test-first with the `tdd` skill, at the seams listed in `docs/architecture.md`.
- **After changing user-facing text** (parameters, descriptions, errors), run the `copy-reviewer` subagent and fix any blockers.
- **Hooks** in `.claude/settings.json` block publishing and runtime dependencies. If one blocks you, change the approach rather than working around it. After editing a hook, run `node .claude/hooks/hooks.test.mjs`.
- `.mcp.json` configures two n8n documentation MCP servers: `n8n-docs` (search and fetch docs.n8n.io pages) and `n8n-kapa`. Query them for n8n internals (helpers, parameter types, versioning, linter rules) rather than relying on memory.
