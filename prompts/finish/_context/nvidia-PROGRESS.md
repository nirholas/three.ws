# nvidia campaign: progress log

Cross-chat handoff log for orders 851 to 869 ([shared context](nvidia-00-CONTEXT.md)). Append one dated entry per finished or paused order at the end of this file: order number, commit SHAs, what is live, the measured number it produced, what waits on the owner and who owns it. Never edit a sibling's entry.

## Entries

- 2026-11-16: campaign filed. 19 independent orders, 851 to 869, dev ports 3251 to 3269. No order started.
- 2026-11-16: 855 (day-0 NIM adoption autopilot) code complete. Commits 6628ae687, 356747ee6, aeb1367c6, 15c5cef4b, 69f8d9c6f, 87d95d47b, 92d44c69b, 6b01347db, 65c4199f0. The free-model-audit cron enqueues new catalog ids into nim_release_evals (migration applied to production); /api/cron/nim-release-eval probes the lane, runs `data/evals/<lane>/` against the live first rung, and stores the verdict, report, config diff and post draft. It never switches production. Board at /admin/nim-releases. Measured: nvidia/nemotron-3.5-bolt-e4b on vision **adopt, quality 86% vs 79%, format 100% vs 79%, p50 588 ms vs 889 ms**. Backlog: super-vl reject (79%), embed-8b baseline 92%, embed-1b adopt but blocked by NIM_EMBED_TAG_PREVIOUS. Waiting on the owner: git push, deploy:gcp:full (three-ws-api), cron sync for nim-release-eval, and the bolt-e4b post after its diff is applied.
