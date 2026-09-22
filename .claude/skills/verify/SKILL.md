---
name: verify
description: Run this repo's full local quality gate for the n8n node package — typecheck, lint, tests with the coverage gate, build, zero-runtime-dependency check, guard-hook regression tests, and an npm pack dry run. Use before saying a code change is done, before committing or opening a PR, or when asked to verify, check or validate the package.
allowed-tools: Bash(npm run *), Bash(npm test *), Bash(npm pack --dry-run *), Bash(node *), Read
---

# Verify

Run every step from the repo root, **even after one fails**, then report all results together. Nothing here calls the ContactWise API. Tests run with `nock.disableNetConnect()`.

| # | Step | Command | Passes when |
|---|---|---|---|
| 1 | Typecheck | `npm run typecheck` | exit 0 |
| 2 | Lint | `npm run lint` | exit 0. List any warnings too: n8n expects them fixed before verification |
| 3 | Tests + coverage | `npm test -- --coverage` | all tests pass and the 90% threshold on `nodes/**/shared/*` holds (enforced by `vitest.config.ts`) |
| 4 | Build | `npm run build` | exit 0 |
| 5 | Zero runtime deps | see below | exit 0 |
| 6 | Guard hooks | `node .claude/hooks/hooks.test.mjs` | every case passes |
| 7 | Package contents | `npm pack --dry-run --json` | the tarball holds only `dist/**`, `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`: no tests, fixtures, `.ts` sources, `docs/` or `.claude/` |

Step 5:

```bash
node -e "const p=require('./package.json');const bad=Object.keys({...p.dependencies,...p.optionalDependencies}).concat(Object.keys(p.peerDependencies||{}).filter(n=>n!=='n8n-workflow'));if(bad.length){console.error('Runtime deps not allowed: '+bad.join(', '));process.exit(1)}"
```

If a script doesn't exist yet (the package scaffold is TIN-7; `typecheck`, `test` and coverage come in TIN-19), mark that step **SKIPPED (not set up yet)**. Don't substitute a command of your own.

## Report

```
verify: PASS | FAIL (<n> of 7 failed)

| Step | Result | Notes |
|---|---|---|
| Typecheck | ✅ / ❌ / ⏭ | … |
```

Under the table, quote the first relevant error lines of each failed step (file:line and message, not the whole log).

If you ran this as part of your own task, fix the failures and rerun only the failed steps until everything passes. Only then say the task is done.
