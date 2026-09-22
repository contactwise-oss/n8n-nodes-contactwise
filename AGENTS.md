# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex and others) working in this repository. `CLAUDE.md` imports this file.

## What this is

`n8n-nodes-contactwise` is an n8n community node package for the ContactWise messaging API. The repo is public, MIT-licensed, and has to pass n8n's **verified community node** review, which is what makes a node installable on n8n Cloud.

Phase 1 (current) is the `ContactWise API` credential plus the `ContactWise SMS` node: one operation (Send), Indian recipients only, with DLT values (sender, template ID, entity ID, body) entered manually. The Trigger node, API-driven dropdowns and WhatsApp come later. Don't build them unless the task asks for it.

**Status:** scaffolded with the n8n-node CLI (`programmatic/example` template, TIN-7). `ContactWise SMS` is a skeleton until TIN-12, and there's no credential yet (TIN-8). If the scaffold is ever regenerated, keep **this** `AGENTS.md` and `CLAUDE.md`, not the template's.

## Commands

```bash
npm run dev        # build + watch, then run a local n8n via `npx n8n` with the node linked; http://localhost:5678
npm run dev:docker # build, then run n8n 2.40.5 in Docker with dist/ mounted as a custom node (no watch: rerun after changes)
npm run build
npm run lint       # n8n community-node lint rules; `npm run lint:fix` autofixes
npm run release    # local run: lint, build, version bump, changelog, tag, push. It does NOT publish:
                   # the pushed tag triggers .github/workflows/publish.yml, which publishes with npm provenance
npx @n8n/scan-community-package n8n-nodes-contactwise   # n8n's verification scan (runs against the published package)
```

`npm run dev` needs a Node version with prebuilt binaries for n8n's native modules. On Node 26 it stalled in `node-gyp` while installing n8n (2026-09-22), so use Node 24 LTS or `npm run dev:docker`.

Test commands get defined with the test harness (see the Decisions section in `docs/architecture.md`). Never use `n8n-node release --publish`: a package published from a laptop has no provenance and can't be verified.

## Rules the code won't tell you

- **Zero runtime `dependencies`** (verification requirement). Make HTTP calls with `this.helpers.httpRequestWithAuthentication`, never with an HTTP or SDK package. Tooling goes in `devDependencies`.
- **No `process.env` and no `fs`** in node or credential code (verification requirement).
- **Tests never call the real ContactWise API.** There's no sandbox, so every real request sends a real, billed SMS.
- **Never auto-retry a send after a 500, 502/504 or timeout.** The API has no idempotency keys, so a retry can deliver the SMS twice. Only 429 and 503 are safe to retry, honouring `Retry-After`.
- **Published node versions are frozen.** Breaking parameter or behaviour changes go in a new node version.
- When you add, rename or remove a node or credential, update `n8n.nodes` / `n8n.credentials` in `package.json`. Those entries point at `dist/` files.
- User-facing text is English and follows n8n copy rules (Title Case labels, sentence-case descriptions, booleans start with "Whether").

## Read before working on…

| Working on… | Read first |
|---|---|
| Any file in `nodes/` | `.agents/nodes.md`, `.agents/properties.md`, plus `.agents/nodes-declarative.md` or `.agents/nodes-programmatic.md` for that node's style |
| Files in `credentials/` | `.agents/credentials.md` |
| Adding a node version | `.agents/versioning.md`, then the Versioning section of `docs/architecture.md` |
| Planning a task | `.agents/workflow.md` |
| Package structure, credential fields, shared request code, decisions | `docs/architecture.md` |
| Writing or changing tests | The Test seams section of `docs/architecture.md` |
| Request bodies, responses, error codes, retries, DLT, phone formats | `docs/contactwise-sms-api.md` |
| User-facing copy and error text, dependencies, release and verification | `docs/n8n-guidelines.md` |

`.agents/*` is n8n's generic community-node guidance, delivered by the scaffold. Don't edit it, so template updates merge cleanly. `docs/*` holds this project's decisions and contracts, and wins when the two conflict.

## Workflow

Work is tracked in Linear under team key `TIN`. Use the branch name Linear generates (`<user>/tin-<n>-<slug>`) and reference `TIN-<n>` in commit messages.
