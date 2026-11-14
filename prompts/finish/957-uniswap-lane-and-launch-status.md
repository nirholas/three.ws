Remaining from this order (everything else shipped and verified: lane config and picker, idempotent EVM launches, GET /api/launches/:id, generated docs/launch-lanes.md, 20 launcher contract tests and 5 deploy-script tests passing on a Base mainnet fork).

Status 2026-11-14:

- The deploy script now exists: `contracts/script/DeployUniswapLauncher.s.sol` (Base only, checks the Uniswap V3 position manager's factory and WETH, reads every immutable back, prints the gcloud command). Fee settings come from `UNISWAP_LAUNCHER_TREASURY`, `UNISWAP_LAUNCHER_FEE_WEI`, `UNISWAP_LAUNCHER_PLATFORM_SHARE_BPS` (all default to zero). See `contracts/README.md`.
- Proven on an anvil fork of Base: the script deployed the launcher (about 4.05M gas, roughly 0.0001 ETH at current Base gas), `uniswapLaneConfig()` flipped to `available: true` with the fee, share and treasury read from the contract, and four launches (no lock, 1 day timelock, 10 year timelock, permanent) mined through the API's own encoder, start-tick math and `Launched` decoder, about 5.7M gas each.
- Fixed on the way: a timelock at the 1 day minimum always reverted (`InvalidUnlockAt`) because the unlock time was counted from when the launch was built, not from the block it mines in, and a 10 year lock could revert when the block timestamp trailed the server clock. `timelockUnlockAt()` in `api/_lib/evm-leg/uniswap-config.js` now clamps into the window every block before the deadline accepts, and the lock end and the deadline share one clock reading. Test: `tests/evm-launch-lanes.test.js` "timelock unlock time".

Owner steps (both irreversible, both need the owner's yes):

1. Deploy on Base, then open the lane:

   ```bash
   cd contracts
   export UNISWAP_LAUNCHER_TREASURY=<address you control>   # omit all three for a free launcher
   export UNISWAP_LAUNCHER_FEE_WEI=<wei per launch>
   export UNISWAP_LAUNCHER_PLATFORM_SHARE_BPS=<0..2000>
   forge script script/DeployUniswapLauncher.s.sol:DeployUniswapLauncher --rpc-url base -vv          # simulate
   forge script script/DeployUniswapLauncher.s.sol:DeployUniswapLauncher --rpc-url base \
     --private-key $DEPLOYER_PK --broadcast --verify                                                 # deploy
   gcloud run services update three-ws-api --region us-central1 --update-env-vars UNISWAP_LAUNCHER_ADDRESS=<printed address>
   curl -s https://three.ws/api/launches/lanes   # the Uniswap lane must report available: true
   ```

   Record the address in `contracts/DEPLOYMENTS.md` and the lane in `data/changelog.json` once it is live.

2. First real launch through /launch/uniswap with the confirmation table, then poll `GET /api/launches/:id` until finalized. Repeat the POST with the same Idempotency-Key and confirm it returns the same record.

Spend gate and the commit gate in CLAUDE.md apply. Never name any competitor in a committed file.
