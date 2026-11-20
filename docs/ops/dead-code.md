# Dead-code report (knip)

`npm run audit:dead-code` runs [knip](https://github.com/webpro-nl/knip) (ISC) at the pinned version in `scripts/audit-dead-code.mjs`, using the entry points modelled in `knip.json` (page HTML under the root, `pages/`, `public/`, `blog/`, `docs/`, `examples/`, `chat/` and `marketing/`; `api/**`; `server/index.mjs`; `src/main.js`, the `src/lib.js` library build and the stable-URL Rollup inputs from `vite.config.js`; the template-loaded scene-studio geometry panels; `scripts/`; tests; build configs). It writes `reports/dead-code.json` (gitignored), prints a count summary and exits 0. It exits 2 only when knip itself could not run.

Knip runs through `npx` at a pinned version, so it is not a root devDependency and never touches the shared `node_modules`. Move it to a devDependency when someone can run an install deliberately.

## Baseline (2026-11-10, knip 6.45.0)

| Category | First report (2026-11-10) | Before the 2026-11-12 pass | After the 2026-11-12 pass | After the 2026-11-20 pass |
|---|---|---|---|---|
| Unused files | 86 | 86 | 73 | 43 |
| Unused exports | 240 | 243 | 243 | 246 |
| Unused dependencies | 15 | 14 | 14 | 9 |
| Unused devDependencies | 0 | 0 | 0 | 0 |

**2026-11-12 file pass.** Every file in the report was traced by its basename across all tracked files (excluding the lockfile, the report, generated changelogs and `docs/ALL.md`), then the zero-hit files were checked for template loaders (``import(`./x.${y}.js`)``), `vercel.json` routes, `server/index.mjs` and the scripts each page actually loads. 31 had zero hits. 18 of those are `src/scene-studio/vendor/js/Sidebar.Geometry.*.js`, which `Sidebar.Geometry.js` loads through a template `import()`, so they stay. The other 13 were deleted: `server/discover-ssr.mjs`, `src/claim-transfer.js`, `src/ibm-identity.js`, `src/ibm-oracle.js`, `src/ibm-suite-nav.js`, `src/ibm-twin.js`, `src/ibm-vision.js`, `src/mirror/face-tracker.js`, `src/pulse-scene.js`, `src/pump/launch-token-boot.js`, `src/pumpfun-client.js`, `src/reputation-page.js`, `src/solana/vanity/launch-with-vanity.js`. The rerun shows no file newly orphaned by the deletions.

**2026-11-20 pass.** `knip.json` gained the entry points it was missing (the `src/lib.js` library build, the stable-URL Rollup inputs, HTML outside `pages/`, the template-loaded `Sidebar.Geometry.*.js` panels), which alone took the file report from 69 to 49 without deleting anything. Deleted as superseded: `src/mirror/avatar-stage.js` and `src/mirror/recorder.js` (the old "Become your agent" page; `/mirror` is now copy trading and its face tracker went in the previous pass) and the composed `src/game/hud/index.js` system with its `camera-rig`, `radial-menu` and `game-feel` modules and their CSS (`/play` and `/walk` construct `WorldHud` and `Minimap` directly). Five root dependencies with no import anywhere were removed with a lockfile-only regeneration (`npm install --package-lock-only --ignore-scripts`, which works in the shared worktree because it never touches `node_modules`): `idb-keyval`, `qwen-ai-provider` and its `undici` override, `ssh2`, `@solana/wallet-standard-features` and one Solana farms SDK, 335 lockfile entries in all.

- Dependencies: the 9 still reported were each traced on 2026-11-20 and are used through paths knip does not model: `vhtml` is Vite's `jsxFactory`, one loads from a `public/demos/` page, one lives in the `packages/` and `apps/` workspaces, and the rest have dynamic or out-of-scope imports. Keep them.
- Files: of the 43, most are referenced from places knip does not read (`public/dashboard/*.html` importing `/src/dashboard/*`, `vite.config.js` aliases, `public/` copies, e2e specs, dev scripts). The rest are complete modules that nothing mounts yet, kept as product decisions rather than dead code: `src/body-mocap.js`, `src/ibm-galaxy.js`, `src/agent-naming.js`, `src/agent-wallet/ownership.js`, `src/auth/email-auth.js`, `src/auth/walletconnect-bridge.js`, `src/editor/regenerate-panel.js`, `src/erc8004/enumeration.js`, `src/erc8004/reputation-panel.js`, `src/reputation-ui.js`, `src/onchain/payments-buttons.js`, `src/onchain/vanity-wallet-button.js` (with `src/onchain/vanity/index.js`), `src/shared/predictions-core.js` and `src/solana/vanity/pool-protocol.js`. Wire or delete each deliberately; until then any doc that describes one as live is wrong.
- Exports: 246 candidates, same caveat as files.

## How to triage

1. `node scripts/audit-dead-code.mjs`, then read `reports/dead-code.json`.
2. For each candidate, grep the bare name and the path across `api/ src/ pages/ workers/ packages/ scripts/ server/ public/ vercel.json`. Include dynamic forms (`import() templates`, route strings, cron handlers, worker entry points).
3. Delete only when nothing references it. Commit per topic with the counts moved.
4. Record the new counts in the table above.

# Secrets history (gitleaks)

`npm run audit:secrets-history` runs `scripts/audit-secrets-history.mjs`. It downloads gitleaks 8.30.1 into `.cache/gitleaks/` on first use, verifies the pinned SHA-256 (a mismatch fails closed, nothing is extracted), then scans every commit with `.gitleaks.toml` and `--redact`. Output is rule, file, line and commit only. Exit 1 means an unallowlisted finding; exit 2 means the scan could not run. A real finding is fixed by rotating the key at its provider, never by rewriting history. `check:secrets` stays the diff-scoped push guard; this is the whole-history second opinion. Tests: `tests/audit-secrets-history.test.js`.
