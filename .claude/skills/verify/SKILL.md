---
name: verify
description: Run this repo's full local quality gate for the n8n node package — typecheck, lint, tests with the coverage gate, build, zero-runtime-dependency check, guard-hook regression tests, and an npm pack dry run. Use before saying a code change is done, before committing or opening a PR, or when asked to verify, check or validate the package.
allowed-tools: Bash(npm run *), Bash(npm test *), Bash(npm pack --dry-run *), Bash(node *), Read
---

# Verify

Run every step from the repo root, **even after one fails**, then report all results together. CI (`.github/workflows/ci.yml`) runs the same steps, so a local pass should mean a green PR. Nothing here calls the ContactWise API: tests run with `nock.disableNetConnect()`.

| # | Step | Command | Passes when |
|---|---|---|---|
| 1 | Typecheck | `npm run typecheck` | exit 0 |
| 2 | Lint + format | `npm run lint` and `npm run format:check` | both exit 0. List any lint warnings too: n8n expects them fixed before verification. Fix formatting with `npm run format` |
| 3 | Tests + coverage | `npm test -- --coverage` | all tests pass and the 90% threshold on `nodes/**/shared/*` holds (enforced by `vitest.config.mjs`) |
| 4 | Build | `npm run build` | exit 0 |
| 5 | Zero runtime deps | `npm run check:deps` | exit 0 |
| 6 | Guard hooks | `node .claude/hooks/hooks.test.mjs` and `node .claude/skills/linear-issue-management/hooks/linear-issue-guard.test.mjs` | every case passes in both |
| 7 | Package contents | `npm pack --dry-run --json` | the tarball holds only `dist/**`, `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`: no `test/`, `.ts` sources (other than `.d.ts`), `docs/` or `.claude/` |

If a script is missing from `package.json`, mark that step **SKIPPED (script missing)** and flag it. Don't substitute a command of your own.

## Report

```
verify: PASS | FAIL (<n> of 7 failed)

| Step | Result | Notes |
|---|---|---|
| Typecheck | ✅ / ❌ / ⏭ | … |
```

Under the table, quote the first relevant error lines of each failed step (file:line and message, not the whole log). For step 3, include the test count and the coverage summary line.

If you ran this as part of your own task, fix the failures and rerun only the failed steps until everything passes. Only then say the task is done.
