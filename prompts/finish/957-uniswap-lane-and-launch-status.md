Remaining from this order (everything else shipped and verified: lane config and picker, idempotent EVM launches, GET /api/launches/:id, generated docs/launch-lanes.md, 18 launcher contract tests passing on a Base mainnet fork).

1. Owner deploys the launcher contract on Base from contracts/src/ThreeWsUniswapLauncher.sol (deploy script in contracts/script), then sets UNISWAP_LAUNCHER_ADDRESS on the three-ws-api Cloud Run service with `gcloud run services update --update-env-vars`. Until then GET /api/launches/lanes reports the lane as unavailable with that reason. Deploying is an owner-gated, irreversible on-chain action.
2. Owner-run first real launch through /launch/uniswap with the confirmation table, then `GET /api/launches/:id` until finalized. Confirm the Idempotency-Key retry returns the same record.

Spend gate and the commit gate in CLAUDE.md apply. Never name any competitor in a committed file.
