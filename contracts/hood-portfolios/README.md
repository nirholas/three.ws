# Robinhood Portfolios: contracts

**A basket of Robinhood Chain tokens, held in kind, rebalanced back to published targets on a
schedule.**

Robinhood Chain (`eip155:4663`) is the one chain where tokenized equities, crypto majors and
memecoins trade against each other in the same pools, so a portfolio holding NVDA, WETH and a
launchpad token is three ERC-20s in one vault rather than a cross-chain problem. These contracts are
the vault, and the registry that makes the methodology behind it binding.

Product surface: [three.ws/markets/robinhood/portfolios](https://three.ws/markets/robinhood/portfolios).
Full protocol write-up: [`docs/robinhood-portfolios.md`](../../docs/robinhood-portfolios.md).

## Contracts

| Contract | What it is |
|---|---|
| [`PortfolioRegistry.sol`](src/PortfolioRegistry.sol) | The published methodology: a content-addressed manifest hash, an EIP-712 attester signature, a parent pointer forming the lineage tree, and the fee split that routes up it. Manifests are immutable by construction. |
| [`Portfolio.sol`](src/Portfolio.sol) | ERC-20 shares over a basket. In-kind issue and redeem, derived backing, halt awareness, and the scheduled rebalance auction. |
| [`PortfolioFactory.sol`](src/PortfolioFactory.sol) | Deploys a vault for a published manifest and links it in one transaction. Holds no assets and has no privileges. |
| [`interfaces/IStockToken.sol`](src/interfaces/IStockToken.sol) | The two functions Robinhood's tokenized equities add to a plain ERC-20: `paused()` and `uiMultiplier()`. |

## The three properties that matter

**Backing is derived, never tracked.** `units_i = balance_i * 1e18 / totalSupply`, recomputed on
every call. Deliveries round up, payouts round down, so `balance_i * 1e18 >= units_i * totalSupply`
holds as a consequence of the arithmetic rather than as an assertion.

**Everything is in kind, so nothing needs a price.** Deliver every constituent to mint, receive
every constituent to redeem. No oracle is on any code path, which is what makes this buildable on a
chain where only 34 of 95 registry equities have a Chainlink feed and no memecoin has one.

**Nobody can trade the fund's assets.** There is no such function. A rebalance is proposed by the
creator when the published schedule comes due, timelocked, then opened as a descending-price offer
any address may fill. `endPayoutBps` is capped at `MAX_END_PAYOUT_BPS` in the constructor, so the
most a rebalance can cost holders is a property of the deployed vault.

## Build and test

```bash
cd contracts/hood-portfolios
forge build          # zero warnings in src/ is the standard
forge test           # 38 offline tests: unit, fuzz and stateful invariants
```

Against the live chain (5 more tests, skipped rather than failed when unset, so the default run
stays hermetic):

```bash
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test
```

The fork suite proves the assumptions the rest of the suite takes for granted: that the tokenized
equities really are transferable ERC-20s a vault can custody, that they carry the issuer's halt
switch, and that a basket spanning an equity, a major and a memecoin can be issued and redeemed on
chain 4663 as deployed.

### Invariants

| Invariant | What it rules out |
|---|---|
| `backingAlwaysCoversOutstandingShares` | NAV extraction through mint/redeem asymmetry |
| `minimumLiquidityStaysLocked` | first-depositor share-price manipulation |
| `legsOnlyEmptyWhenTheirTargetIsZero` | a rebalance draining a position the manifest still wants held |
| `feeSplitSumsToWhole` | lineage fees exceeding the fees collected |

Dependencies are the ones already vendored by the parent `contracts/` project (`../lib`), so this
directory adds no second copy of forge-std or OpenZeppelin, and keeps its own profile so the parent's
`solc_version`/`evm_version` (which its deployed bytecode depends on) are never changed on its
behalf.

## Deploy

Simulate first. Without `--broadcast` this runs the whole script against live state and prints the
addresses without spending anything.

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url https://rpc.mainnet.chain.robinhood.com
```

Then, with `OWNER` set to a multisig and `ATTESTER` to the key that will sign manifests:

```bash
OWNER=0x… ATTESTER=0x… forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --private-key $DEPLOYER_KEY \
  --broadcast
```

## Creating a portfolio

1. **Publish the manifest.** Hash the canonical manifest document (`manifestHash()` in
   [`api/_lib/hood-portfolios.js`](../../api/_lib/hood-portfolios.js) produces exactly the committed
   value), have an attester sign it over EIP-712, and call `PortfolioRegistry.publish`.
2. **Deploy the vault.** Call `PortfolioFactory.deploy` with a `Portfolio.Config`. The factory checks
   you are the manifest's creator and links the vault to it.
3. **Seed it.** The first `issue` delivers `seedUnits` per share and permanently locks
   `MINIMUM_LIQUIDITY` shares. Every later issuance is priced off the vault's own balances.

A refinement is step 1 again with `parent` set to the previous id. It never mutates the original.

## Known limits

- **A halted constituent stops issuance, redemption and rebalancing.** This is not a policy choice
  that could have gone the other way: a halted token cannot move at any price, and paying out only
  the transferable legs would hand a redeemer the liquid assets and leave everyone else backing the
  frozen one.
- **`proposeRebalance` is creator-only.** The creator chooses the destination and never the price,
  and cannot touch the assets, but a creator who stops proposing leaves the vault drifting from its
  published weights until they resume.
- **Constituents are fixed at deployment.** Adding or removing one means a new version with a lineage
  pointer, which is the same mechanism as a refinement.
