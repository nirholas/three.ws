# Dead-code report (knip)

`npm run audit:dead-code` runs [knip](https://github.com/webpro-nl/knip) (ISC) at the pinned version in `scripts/audit-dead-code.mjs`, using the entry points modelled in `knip.json` (page HTML, `api/**`, `server/index.mjs`, `scripts/`, tests, build configs). It writes `reports/dead-code.json` (gitignored), prints a count summary and exits 0. It exits 2 only when knip itself could not run.

Knip runs through `npx` at a pinned version, so it is not a root devDependency and never touches the shared `node_modules`. Move it to a devDependency when someone can run an install deliberately.

## Baseline (2026-11-10, knip 6.45.0)

| Category | First report (2026-11-10) | Before the 2026-11-12 pass | After the 2026-11-12 pass |
|---|---|---|---|
| Unused files | 86 | 86 | 73 |
| Unused exports | 240 | 243 | 243 |
| Unused dependencies | 15 | 14 | 14 |
| Unused devDependencies | 0 | 0 | 0 |

**2026-11-12 file pass.** Every file in the report was traced by its basename across all tracked files (excluding the lockfile, the report, generated changelogs and `docs/ALL.md`), then the zero-hit files were checked for template loaders (``import(`./x.${y}.js`)``), `vercel.json` routes, `server/index.mjs` and the scripts each page actually loads. 31 had zero hits. 18 of those are `src/scene-studio/vendor/js/Sidebar.Geometry.*.js`, which `Sidebar.Geometry.js` loads through a template `import()`, so they stay. The other 13 were deleted: `server/discover-ssr.mjs`, `src/claim-transfer.js`, `src/ibm-identity.js`, `src/ibm-oracle.js`, `src/ibm-suite-nav.js`, `src/ibm-twin.js`, `src/ibm-vision.js`, `src/mirror/face-tracker.js`, `src/pulse-scene.js`, `src/pump/launch-token-boot.js`, `src/pumpfun-client.js`, `src/reputation-page.js`, `src/solana/vanity/launch-with-vanity.js`. The rerun shows no file newly orphaned by the deletions.

- Dependencies: removing one needs a `package-lock.json` regeneration, which the shared worktree forbids (no root `npm install`; a lockfile-only uninstall is refused too). Re-verified 2026-11-12: `ssh2`, `@solana/wallet-standard-features` (still installed transitively, so only the direct declaration goes) and one Solana lending SDK have zero source references and are safe to drop in a deliberate install. `papaparse` is no longer a candidate: `api/_lib/microsoft-partner-center.js` imports it. The other 11 have one or more references (some dynamic or inside workers) and must stay until each is traced.
- Files: the remaining 73 each have at least one reference by name (a page script tag, a dynamic `import()`, a doc or a test), which knip cannot follow. Each needs a per-file trace before deletion.
- Exports: 243 candidates, same caveat.

## How to triage

1. `node scripts/audit-dead-code.mjs`, then read `reports/dead-code.json`.
2. For each candidate, grep the bare name and the path across `api/ src/ pages/ workers/ packages/ scripts/ server/ public/ vercel.json`. Include dynamic forms (`import() templates`, route strings, cron handlers, worker entry points).
3. Delete only when nothing references it. Commit per topic with the counts moved.
4. Record the new counts in the table above.

# Secrets history (gitleaks)

`npm run audit:secrets-history` runs `scripts/audit-secrets-history.mjs`. It downloads gitleaks 8.30.1 into `.cache/gitleaks/` on first use, verifies the pinned SHA-256 (a mismatch fails closed, nothing is extracted), then scans every commit with `.gitleaks.toml` and `--redact`. Output is rule, file, line and commit only. Exit 1 means an unallowlisted finding; exit 2 means the scan could not run. A real finding is fixed by rotating the key at its provider, never by rewriting history. `check:secrets` stays the diff-scoped push guard; this is the whole-history second opinion. Tests: `tests/audit-secrets-history.test.js`.
