# pump-dashboard.html — wire every panel to REAL APIs

Audit target: [/pump-dashboard.html](../../pump-dashboard.html)

Every prompt in this folder is **independent**. Pick any one and ship it end‑to‑end without depending on another file in this folder being done first. No mocks. No fake data. No placeholders. No `Math.random()` standing in for real cryptography. No `setTimeout` fake-loading. No commented-out code. No hardcoded sample arrays. No fallback rows. If credentials are missing, locate them in `.env` or `vercel env ls` — do not stub.

Each task must satisfy [CLAUDE.md](../../CLAUDE.md):
- Wired into the UI and reachable.
- Dev server (`npm run dev`) started, exercised in a real browser, no console errors, network tab shows real upstream calls succeeding.
- Empty / loading / error states are real.
- Existing tests still green (`npm test`).
- Run the **completionist** subagent on the changed files before claiming done.

## Tasks

- [01-featured-agent-real-data.md](01-featured-agent-real-data.md)
- [02-wallet-snapshot-real.md](02-wallet-snapshot-real.md)
- [03-market-chart-real.md](03-market-chart-real.md)
- [04-market-chart-token-selector.md](04-market-chart-token-selector.md)
- [05-vanity-generator-real-keypair.md](05-vanity-generator-real-keypair.md)
- [06-custom-agents-table-real.md](06-custom-agents-table-real.md)
- [07-dashboard-stat-cards-real.md](07-dashboard-stat-cards-real.md)
- [08-revenue-page-real.md](08-revenue-page-real.md)
- [09-api-keys-management-real.md](09-api-keys-management-real.md)
- [10-config-validate-connection.md](10-config-validate-connection.md)
- [11-tts-speech-real.md](11-tts-speech-real.md)
- [12-alerts-server-persist.md](12-alerts-server-persist.md)
