# Audit reports

Generated and hand-kept audit output. The console sweep is the one with a gate.

## Console sweep

`npm run audit:console` drives every HTML route in `data/pages.json` through headless Chromium at desktop (1440x900) and mobile (390x844) and collects console errors, uncaught page errors, unhandled rejections and failed first-party requests. `--report` writes `console-sweep-<date>.md` here.

### Quiet-box rule

A reading is only evidence when the machine is quiet.

1. Check `uptime`. Run the sweep only when the 1-minute load average is below the core count (`nproc`). The report records the load at start and says so when the box was not quiet.
2. Start your own servers and point the sweep at them with `AUDIT_BASE`. A dev server owned by another session can vanish mid-run.
3. The tool re-runs failing routes serially and keeps the second reading. That clears a momentary spike but not a sweep run beside a long build. On 2026-09-09, 29 of 31 reported failures passed on a quiet box. Re-run just the failures once the load drops before acting on them.
4. Separate working-tree defects from deploy lag: run the repo's own API (`node server/index.mjs`, port 8080) and start Vite with `DEV_API_PROXY=http://localhost:8080`. A route that clears against the local API is deploy lag, not a defect.

```bash
node --env-file-if-exists=.env --env-file-if-exists=.env.local server/index.mjs &
DEV_API_PROXY=http://localhost:8080 npx vite --port 3211 --strictPort &
AUDIT_BASE=http://localhost:3211 CONCURRENCY=3 npm run audit:console -- --report
```

### Baseline gate

`scripts/audit-console.baseline.json` maps route to viewport to the accepted error count. The target is empty. The sweep exits non-zero only when a route/viewport exceeds its baseline, and prints each new error plus any count that dropped. After fixing errors, ratchet the file down with `--update-baseline` (it rewrites only the routes and viewports that were measured and drops zeros). Never add an entry to hide a defect: fix the source, or filter environment noise in `scripts/lib/console-noise.mjs` with a stated reason.

Pure logic lives in `scripts/lib/console-baseline.mjs`, tested by `tests/console-baseline.test.js`.

### Reports

- `console-sweep-2026-09-04.md`, `-09-07.md`, `-09-09.md`: earlier sweeps. The 09-09 one was taken at load 80 to 100 and its failure list is mostly noise.
