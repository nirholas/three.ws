# Dead-code report (knip)

`npm run audit:dead-code` runs [knip](https://github.com/webpro-nl/knip) (ISC) at the pinned version in `scripts/audit-dead-code.mjs`, using the entry points modelled in `knip.json` (page HTML, `api/**`, `server/index.mjs`, `scripts/`, tests, build configs). It writes `reports/dead-code.json` (gitignored), prints a count summary and exits 0. It exits 2 only when knip itself could not run.

Knip runs through `npx` at a pinned version, so it is not a root devDependency and never touches the shared `node_modules`. Move it to a devDependency when someone can run an install deliberately.

## Baseline (2026-11-10, knip 6.45.0)

| Category | Count |
|---|---|
| Unused files | 86 |
| Unused exports | 240 |
| Unused dependencies | 15 |
| Unused devDependencies | 0 |

No deletions were made in this pass, so before and after are identical. The reasons:

- Dependencies: removing one needs a `package-lock.json` regeneration, which the shared worktree forbids (no root `npm install`). Verified by grep across `api src pages workers packages scripts server public tests`: `papaparse`, `ssh2`, `@solana/wallet-standard-features` and one Solana lending SDK have zero source references and are safe candidates for the next person who may run an install. The other 11 have one or more references (some dynamic or inside workers) and must stay until each is traced.
- Files: the 86 unused files are mostly `src/ibm-*`, `src/scene-studio/vendor/js/Sidebar.Geometry.*`, `src/wallet/*`, `src/solana/vanity/*` and `src/game/hud/*`. Many are loaded by string (vite-served pages, `import()` templates, `vercel.json` routes) that knip cannot see, so none was deleted without a per-file trace.
- Exports: 240 candidates, same caveat.

## How to triage

1. `node scripts/audit-dead-code.mjs`, then read `reports/dead-code.json`.
2. For each candidate, grep the bare name and the path across `api/ src/ pages/ workers/ packages/ scripts/ server/ public/ vercel.json`. Include dynamic forms (`import() templates`, route strings, cron handlers, worker entry points).
3. Delete only when nothing references it. Commit per topic with the counts moved.
4. Record the new counts in the table above.

# Secrets history (gitleaks)

`npm run audit:secrets-history` runs `scripts/audit-secrets-history.mjs`. It downloads gitleaks 8.30.1 into `.cache/gitleaks/` on first use, verifies the pinned SHA-256 (a mismatch fails closed, nothing is extracted), then scans every commit with `.gitleaks.toml` and `--redact`. Output is rule, file, line and commit only. Exit 1 means an unallowlisted finding; exit 2 means the scan could not run. A real finding is fixed by rotating the key at its provider, never by rewriting history. `check:secrets` stays the diff-scoped push guard; this is the whole-history second opinion. Tests: `tests/audit-secrets-history.test.js`.
