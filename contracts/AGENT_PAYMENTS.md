# AgentPayments — EVM deployment guide

`AgentPayments` ([`src/AgentPayments.sol`](src/AgentPayments.sol)) is the EVM port
of the Solana `pump_agent_payments` program
(`AgenTMiC2hvxGebTsgmsD4HHBa8WEcqGFf87iwRRxLo7`). It is the on-chain engine behind
three.ws **agent tokens** on EVM chains: users pay an agent in any ERC-20 (or
native) currency, the agent's authority withdraws its share, and a configurable
slice is swapped into the agent's own token and burned (buyback).

It exists because the SDK already ships the client side — `EvmAgent` /
`EvmAgentOffline`, the `AGENT_PAYMENTS_ABI`, and the per-chain address table in
[`agent-payments-sdk/src/evm/addresses.ts`](../agent-payments-sdk/src/evm/addresses.ts)
— but every `agentPayments` address there is the zero-address placeholder, so the
SDK throws `"AgentPayments contract is not deployed on chain N"` at construction.
Deploying this contract and filling in those addresses turns the EVM path on.

> **Solana note.** The Solana side needs **no** deployment — the SDK's Solana path
> (`PumpAgent` / `PumpAgentOffline`) binds to pump.fun's already-live mainnet
> program `AgenTMiC2…`. A Solidity contract cannot run on Solana (different VM);
> this contract is the EVM equivalent, not a Solana artifact.

## What it implements

The contract's ABI is byte-for-byte the SDK's `AGENT_PAYMENTS_ABI`. State is keyed
by `(agentToken, currencyToken)`, mirroring the Solana program's per-mint /
per-currency PDAs. Native currency (ETH/BNB/AVAX) is accounted under the EIP-7528
sentinel `0xEee…EeE`.

| Function | Access | Effect |
| --- | --- | --- |
| `createAgent(agentToken, agentAuthority, buybackBps)` | owner only | Register an agent token once |
| `acceptPayment(agentToken, currency, amount, memo, startTime, endTime)` | anyone | Pull ERC-20, credit payment vault, settle invoice |
| `acceptPaymentNative(agentToken, memo, startTime, endTime)` | anyone (payable) | Same, native currency |
| `distributePayments(agentToken, currency)` | anyone | Split payment vault → buyback + withdraw vaults by `buybackBps` |
| `buybackTrigger(agentToken, currency, swapRouter, swapData)` | owner | Swap buyback vault → agent token via allow-listed router, burn it |
| `withdraw(agentToken, currency, receiver)` | agent authority | Send withdraw vault to `receiver` |
| `updateBuybackBps` / `updateAuthority` | agent authority | Reconfigure |
| `setRouterAllowed(router, allowed)` | owner | Manage the buyback router allow-list |
| `getAgentConfig` / `getBalances` / `getPaymentStats` / `isInvoicePaid` | view | Reads used by `EvmAgent` |

Invoice IDs match the SDK's `getInvoiceId()` exactly:
`keccak256(abi.encode(agentToken, currencyToken, amount, memo, startTime, endTime))`.

## Security model

- **Owner = protocol / global buyback authority.** It registers agents on a
  user's behalf, triggers buybacks, and manages the router allow-list. Use the
  **platform multisig**, not a hot EOA, in production.
- **Per-agent authority** controls only its own agent: withdrawals and config.
- **Buyback cannot abuse payer allowances.** Payers grant this contract a
  `maxUint256` ERC-20 allowance (the SDK approves max). `buybackTrigger` therefore
  (a) only calls **allow-listed** routers, (b) forbids the currency/agent token as
  the "router", and (c) approves the router for exactly the buyback amount and
  resets to zero afterward. There is no path for the owner to redirect the
  contract's calls at a token to drain those allowances.
- **Reentrancy.** `acceptPayment*`, `buybackTrigger`, and `withdraw` are
  `nonReentrant`; vault effects are applied before external calls.
- **Fee-on-transfer safe.** ERC-20 payments credit the balance actually received,
  not the requested amount.

Test coverage: [`test/AgentPayments.t.sol`](test/AgentPayments.t.sol) — 16 tests,
all passing (`forge test --match-contract AgentPaymentsTest`).

## Deploy

You fund a deployer EOA with gas on each target chain; everything else is below.

### 1. Install Foundry & configure

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
cd contracts
cp .env.example .env
# Fill in DEPLOYER_PK, BASESCAN_API_KEY (or per-chain scan keys),
# and AGENT_PAYMENTS_OWNER (the platform multisig; defaults to deployer EOA).
forge test --match-contract AgentPaymentsTest   # sanity check
```

### 2. Deploy (testnet first)

```bash
source .env
forge script script/DeployAgentPayments.s.sol:DeployAgentPayments \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PK \
  --broadcast --verify
```

### 3. Deploy to each mainnet chain

Run once per chain the SDK supports, swapping `--rpc-url`. The deployed address
differs per chain (no CREATE2 here — addresses depend on deployer nonce):

| Chain | Chain ID | RPC env |
| --- | --- | --- |
| Ethereum | 1 | `$ETH_RPC_URL` |
| Base | 8453 | `$BASE_RPC_URL` |
| Arbitrum One | 42161 | `$ARB_RPC_URL` |
| Polygon | 137 | `$POLYGON_RPC_URL` |
| BNB Smart Chain | 56 | `$BSC_RPC_URL` |
| Avalanche | 43114 | `$AVAX_RPC_URL` |

```bash
forge script script/DeployAgentPayments.s.sol:DeployAgentPayments \
  --rpc-url $BASE_RPC_URL --private-key $DEPLOYER_PK --broadcast --verify
```

> Want one identical address across all chains (like `ThreeWSPayments`)? Deploy
> through the existing `ThreeWSFactory` CREATE2 deployer at
> `0x00000000d49195ae81759cd247cfedd9d0b479df` with a shared salt. Because the
> constructor takes only `owner` (no chain-specific immutable), the same salt +
> init code yields the **same** address on every chain — unlike `ThreeWSPayments`,
> whose per-chain USDC immutable broke address parity. See
> [`DEPLOYMENTS.md`](DEPLOYMENTS.md) for the factory ABI and salt workflow.

### 4. Allow-list buyback routers (per chain)

Buybacks only call allow-listed routers. Add the chain's canonical DEX
aggregator/router before the first buyback:

```bash
cast send <AGENT_PAYMENTS_ADDR> "setRouterAllowed(address,bool)" <ROUTER> true \
  --rpc-url $BASE_RPC_URL --private-key $DEPLOYER_PK
```

(e.g. the 0x Exchange Proxy or Uniswap Universal Router on each chain. The
`swapData` passed to `buybackTrigger` is the router's own swap calldata, built
off-chain to swap the held currency into the agent token and deliver it here.)

### 5. Wire the addresses into the SDK

Replace the `UNDEPLOYED` placeholders in
[`agent-payments-sdk/src/evm/addresses.ts`](../agent-payments-sdk/src/evm/addresses.ts)
with the deployed address for each chain:

```ts
8453: {
  ...
  agentPayments: "0xYourDeployedBaseAddress",   // was UNDEPLOYED
},
```

Then rebuild the SDK so `dist/` picks up the change:

```bash
cd agent-payments-sdk && npm run build
```

`isAgentPaymentsDeployed(chainId)` flips to `true` for each filled chain and
`new EvmAgent(token, chainId)` stops throwing — the EVM agent-payments path is now
live on that chain.

### 6. Record the deployment

Add a row per chain to the **AgentPayments** table in
[`DEPLOYMENTS.md`](DEPLOYMENTS.md) (address, tx hash, owner, routers allow-listed),
and append a `data/changelog.json` entry (tags: `infra`, `sdk`) noting EVM agent
payments are live.
