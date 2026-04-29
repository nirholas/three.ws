# Repo integrations — task prompts

Self-contained task prompts that integrate features from the user's other GitHub repos into the 3D-Agent platform. Each prompt is independent — no prompt depends on another. Pick one, hand to a fresh Claude Code agent, ship the PR.

## Source repos referenced

| Repo | URL | Used in |
| :--- | :--- | :--- |
| pumpkit | https://github.com/nirholas/pumpkit | 01, 02, 03, 04 |
| pumpfun-claims-bot | https://github.com/nirholas/pumpfun-claims-bot | 05, 06 |
| pump-fun-workers | https://github.com/nirholas/pump-fun-workers | 07 |
| pump-fun-skills | https://github.com/nirholas/pump-fun-skills | 08, 09 |
| pump-swap-sdk | https://github.com/nirholas/pump-swap-sdk | 10 |
| kol-quest | https://github.com/nirholas/kol-quest | 11, 12, 13 |
| scrape-smart-wallets | https://github.com/nirholas/scrape-smart-wallets | 14, 15 |
| analyze-memecoin-socials | https://github.com/nirholas/analyze-memecoin-socials | 16, 17 |
| visualize-web3-realtime | https://github.com/nirholas/visualize-web3-realtime | 18, 19 |
| solana-launchpad-ui | https://github.com/nirholas/solana-launchpad-ui | 20, 21 |
| solana-wallet-toolkit | https://github.com/nirholas/solana-wallet-toolkit | 22, 23 |
| carbon | https://github.com/nirholas/carbon | 24 |
| pumpfun-mcp (cross-cutting) | — | 25, 26, 27, 28 |
| 3D-agent reactions (cross-cutting) | — | 29, 30 |
| Embeddable widgets (cross-cutting) | — | 31, 32 |
| x402 + ERC-8004 monetization | — | 33, 34 |
| Polish / docs / tests | — | 35, 36, 37, 38 |

## House rules (apply to every prompt)

- One deliverable per prompt, one PR per prompt.
- Every prompt is standalone — do **not** assume any other prompt has shipped.
- Cite exact file paths. Don't invent APIs; read the existing code first.
- Prefer editing existing files over creating new ones.
- All new JS uses ES modules (`type: "module"`).
- Test path: `node --check` new JS, `npx vite build`, `npx vitest run` if tests touched.
- Output a reporting block at the end of the PR: shipped / skipped / broke / unrelated bugs noticed.
