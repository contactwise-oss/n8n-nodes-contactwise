# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex and others) working in this repository. `CLAUDE.md` imports this file.

## What this is

`@contactwise/n8n-nodes-contactwise` is an n8n community node package for the ContactWise messaging API. The repo is public, MIT-licensed, and has to pass n8n's **verified community node** review, which is what makes a node installable on n8n Cloud.

Phase 1 (shipped as 0.1.x) is the `ContactWise API` credential plus the `ContactWise SMS` node: one operation (Send), Indian recipients only, with DLT values (sender, template ID, entity ID, body) entered manually.

The current work (milestone M3, epic TIN-30) is WhatsApp: the `ContactWise WhatsApp` node, then the `ContactWise WhatsApp Trigger`. They reuse the same credential and call the WhatsApp gateway, a transparent proxy over Meta's Graph API (`docs/contactwise-whatsapp-api.md`). The SMS Trigger and API-driven SMS dropdowns come later. Don't build them unless the task asks for it.

**Status:** scaffolded with the n8n-node CLI (`programmatic/example` template, TIN-7). The credential (TIN-8), the Send operation (TIN-12), and API error mapping with the retry policy (TIN-13) are built. The transport, error mapping and retry policy are shared by all nodes in `nodes/shared/` (TIN-38). If the scaffold is ever regenerated, keep **this** `AGENTS.md` and `CLAUDE.md`, not the template's.

## Commands

```bash
npm run dev        # build + watch, then run a local n8n via `npx n8n` with the node linked; http://localhost:5678
npm run dev:docker # build, then (re)start n8n 2.40.5 in Docker on :5678 with the package installed as a community node.
                   # Rerun after every change (the build replaces dist/). n8n data persists in the n8n-contactwise-dev volume
npm run dev:docker:logs / dev:docker:stop
npm run build
npm run lint       # n8n community-node lint rules; `npm run lint:fix` autofixes
npm run typecheck  # tsc over nodes/, credentials/ and test/ (tsconfig.test.json)
npm run format     # prettier on nodes/, credentials/, test/; CI runs `npm run format:check`
npm test           # Vitest, network closed by nock; `npm test -- --coverage` enforces the 90% gate
npx vitest run test/path/file.test.ts -t "test name"   # one file / one test
npm run check:deps # fails if package.json has any runtime dependency
npm run release    # local run: lint, build, version bump, changelog, tag, push. It does NOT publish:
                   # the pushed tag triggers .github/workflows/publish.yml, which publishes with npm provenance
npx @n8n/scan-community-package @contactwise/n8n-nodes-contactwise   # n8n's verification scan (runs against the published package)
```

`npm run dev` needs a Node version with prebuilt binaries for n8n's native modules. On Node 26 it stalled in `node-gyp` while installing n8n (2026-09-22), so use Node 24 LTS or `npm run dev:docker`.

Never use `n8n-node release --publish`: a package published from a laptop has no provenance and can't be verified.

## Rules the code won't tell you

- **Zero runtime `dependencies`** (verification requirement). Make HTTP calls with `this.helpers.httpRequestWithAuthentication`, never with an HTTP or SDK package. Tooling goes in `devDependencies`.
- **No `process.env` and no `fs`** in node or credential code (verification requirement).
- **Tests never call the real ContactWise API.** There's no sandbox, so every real request sends a real, billed SMS or WhatsApp message.
- **Never auto-retry a send after a 500, 502/504 or timeout.** The API has no idempotency keys, so a retry can deliver the SMS or WhatsApp message twice. Only 429 and 503 are safe to retry, honouring `Retry-After`.
- **Published node versions are frozen.** Breaking parameter or behaviour changes go in a new node version.
- When you add, rename or remove a node or credential, update `n8n.nodes` / `n8n.credentials` in `package.json`. Those entries point at `dist/` files.
- User-facing text is English and follows n8n copy rules (Title Case labels, sentence-case descriptions, booleans start with "Whether").
- **The n8n linter covers every `.ts` file, tests included.** No `process`, `setTimeout`, `globalThis` or `__dirname`, and no Node built-ins except `crypto`. Use n8n-workflow's `sleep` for waits. Config files that need Node APIs are `.mjs`.

## Read before working on…

| Working on… | Read first |
|---|---|
| Any file in `nodes/` | `.agents/nodes.md`, `.agents/properties.md`, plus `.agents/nodes-declarative.md` or `.agents/nodes-programmatic.md` for that node's style |
| Files in `credentials/` | `.agents/credentials.md` |
| Adding a node version | `.agents/versioning.md`, then the Versioning section of `docs/architecture.md` |
| Planning a task | `.agents/workflow.md` |
| Package structure, credential fields, shared request code, decisions | `docs/architecture.md` |
| Writing or changing tests | The Test seams section of `docs/architecture.md` |
| SMS request bodies, responses, error codes, retries, DLT, phone formats | `docs/contactwise-sms-api.md` |
| WhatsApp routes, IDs, request and response shapes, Meta error codes | `docs/contactwise-whatsapp-api.md` |
| User-facing copy and error text, dependencies, release and verification | `docs/n8n-guidelines.md` |
| Creating, updating or closing Linear issues; project updates | `.claude/skills/linear-issue-management/SKILL.md`, with this project's values in the `## Linear` section of `CLAUDE.md` |

`.agents/*` is n8n's generic community-node guidance, delivered by the scaffold. Don't edit it, so template updates merge cleanly. `docs/*` holds this project's decisions and contracts, and wins when the two conflict.

## Workflow

Work is tracked in Linear under team key `TIN`. Use the branch name Linear generates (`<user>/tin-<n>-<slug>`) and reference `TIN-<n>` in commit messages.

Every issue follows `.claude/skills/linear-issue-management/SKILL.md`. The team, project, labels and milestones are in the `## Linear` section of `CLAUDE.md`. A hook blocks issue creates that break the rules. The short version:
- Every issue has the owner as assignee, a priority, one type label plus area labels, a milestone (`Backlog · Unscheduled` if unplanned), and Blocked by / Blocks / Related links where they apply.
- The description is the spec. Design, decisions, progress and the final implementation go in comments.
- An issue isn't Done without an `## Implementation` comment.
