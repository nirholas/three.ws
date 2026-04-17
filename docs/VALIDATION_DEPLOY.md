# ValidationRegistry Mainnet Deployment Runbook

Deploys `ValidationRegistry` to 15 mainnet chains via CREATE2 (deterministic address parity). This contract manages allow-listed validators that attest off-chain proofs for agents.

**Status:** Not yet deployed to mainnet (testnet: `0x8004Cb1BF31DAf7788923b405b754f57acEB4272`).

---

## Deployment Overview

| Property | Value |
|---|---|
| **Script** | `contracts/script/DeployValidationMainnet.s.sol` |
| **Constructor args** | `(identityRegistry: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432, owner: msg.sender)` |
| **CREATE2 salt** | `keccak256(abi.encodePacked("ValidationRegistry", uint256(1)))` |
| **Expected address** | See "Expected Addresses" section below |
| **Time to deploy all chains** | ~2–4 hours (wait for block finality between chains) |

---

## Pre-Deployment Checklist

- [ ] Read and understand [contracts/CLAUDE.md](../contracts/CLAUDE.md)
- [ ] Confirm deployer wallet has enough gas on all 15 chains (est. ≈0.01–0.5 ETH per chain depending on L2 vs. L1)
- [ ] Have Etherscan API keys for all 15 chains (or at least the L1s)
- [ ] Build and test: `cd contracts && forge build && forge test`
- [ ] Dry-run at least one chain before any broadcasts

---

## Step 1: Build & Test

```bash
cd contracts
forge build
forge test
```

Output should show all tests passing:
```
...
Test result: ok. X passed; 0 failed; 0 skipped
```

---

## Step 2: Environment Variables

Create a `.env.local` file in the repo root or set these in your shell:

```bash
# Deployer private key (must have gas on all 15 chains)
export DEPLOYER_PK=0x...

# Etherscan API keys (name convention: CHAIN_ETHERSCAN_API_KEY)
export ETHEREUM_ETHERSCAN_API_KEY=...
export BASE_ETHERSCAN_API_KEY=...
export OPTIMISM_ETHERSCAN_API_KEY=...
# ... (see "Etherscan API Keys" table below)

# Optional: override RPC endpoints (defaults use public providers)
export ETHEREUM_RPC_URL=https://...
export BASE_RPC_URL=https://...
# ... (see "RPC Endpoints" table below)
```

**Do not commit `.env.local`.** It contains secrets.

---

## Step 3: Dry-Run (No Broadcasting)

Before broadcasting to any chain, verify the deployment locally:

```bash
cd contracts
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://ethereum-rpc.publicnode.com \
  --sender 0x...
```

Expected output:
```
Expected ValidationRegistry: 0x...
IdentityRegistry:            0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
Deployer (owner):            0x...
---
Traces:
  ...
```

**Do not see `--broadcast` in the command.** This is a local simulation only.

---

## Step 4: Deployment Commands (All Chains)

Deploy to each mainnet chain using `--broadcast`. Suggested order: **L1s first** (Ethereum, Polygon), then L2s.

### Ethereum Mainnet

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://ethereum-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $ETHEREUM_ETHERSCAN_API_KEY
```

Expected gas: ≈0.5 ETH @ standard rates.
Expected address: `0x8004Cb1BF31DAf7788923b405b754f57acEB42ab` (run `cast create2` below to verify).

### Base

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://base-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $BASE_ETHERSCAN_API_KEY
```

Expected gas: ≈0.01 ETH (L2).
Expected address: **identical to Ethereum** (CREATE2 determinism).

### Optimism

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://optimism-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $OPTIMISM_ETHERSCAN_API_KEY
```

Expected gas: ≈0.01 ETH (L2).
Expected address: **identical to all others**.

### Arbitrum One

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://arbitrum-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $ARBITRUM_ETHERSCAN_API_KEY
```

Expected gas: ≈0.01 ETH (L2).
Expected address: **identical to all others**.

### Polygon (Matic)

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://polygon-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $POLYGON_ETHERSCAN_API_KEY
```

Expected gas: ≈0.001 ETH (sidechain).
Expected address: **identical to all others**.

### BNB Chain

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://bsc-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $BSC_ETHERSCAN_API_KEY
```

Expected gas: ≈0.002 ETH.
Expected address: **identical to all others**.

### Avalanche C-Chain

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://avalanche-c-chain-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $AVALANCHE_ETHERSCAN_API_KEY
```

Expected gas: ≈0.005 ETH.
Expected address: **identical to all others**.

### Gnosis

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://gnosis-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $GNOSIS_ETHERSCAN_API_KEY
```

Expected gas: ≈0.002 ETH.
Expected address: **identical to all others**.

### Linea

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://linea-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $LINEA_ETHERSCAN_API_KEY
```

Expected gas: ≈0.005 ETH (L2).
Expected address: **identical to all others**.

### Scroll

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://scroll-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $SCROLL_ETHERSCAN_API_KEY
```

Expected gas: ≈0.005 ETH (L2).
Expected address: **identical to all others**.

### zkSync Era

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://zksync-mainnet-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $ZKSYNC_ETHERSCAN_API_KEY
```

Expected gas: ≈0.005 ETH (L2).
Expected address: **identical to all others**.

### Mantle

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://mantle-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $MANTLE_ETHERSCAN_API_KEY
```

Expected gas: ≈0.005 ETH (L2).
Expected address: **identical to all others**.

### Celo

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://celo-mainnet-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $CELO_ETHERSCAN_API_KEY
```

Expected gas: ≈0.001 ETH (sidechain).
Expected address: **identical to all others**.

### Ink

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://ink-mainnet-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $INK_ETHERSCAN_API_KEY
```

Expected gas: ≈0.01 ETH (L2).
Expected address: **identical to all others**.

### Unichain

```bash
forge script script/DeployValidationMainnet.s.sol:DeployValidationMainnet \
  --rpc-url https://unichain-mainnet-rpc.publicnode.com \
  --sender $DEPLOYER_WALLET \
  --private-key $DEPLOYER_PK \
  --broadcast --verify --etherscan-api-key $UNICHAIN_ETHERSCAN_API_KEY
```

Expected gas: ≈0.01 ETH (L2).
Expected address: **identical to all others**.

---

## Reference: RPC Endpoints & Etherscan Keys

| Chain | Chain ID | RPC Endpoint | Etherscan URL | API Key Env Var |
|---|---|---|---|---|
| Ethereum | 1 | https://ethereum-rpc.publicnode.com | https://etherscan.io | `ETHEREUM_ETHERSCAN_API_KEY` |
| Base | 8453 | https://base-rpc.publicnode.com | https://basescan.org | `BASE_ETHERSCAN_API_KEY` |
| Optimism | 10 | https://optimism-rpc.publicnode.com | https://optimistic.etherscan.io | `OPTIMISM_ETHERSCAN_API_KEY` |
| Arbitrum One | 42161 | https://arbitrum-rpc.publicnode.com | https://arbiscan.io | `ARBITRUM_ETHERSCAN_API_KEY` |
| Polygon | 137 | https://polygon-rpc.publicnode.com | https://polygonscan.com | `POLYGON_ETHERSCAN_API_KEY` |
| BNB Chain | 56 | https://bsc-rpc.publicnode.com | https://bscscan.com | `BSC_ETHERSCAN_API_KEY` |
| Avalanche C-Chain | 43114 | https://avalanche-c-chain-rpc.publicnode.com | https://snowtrace.io | `AVALANCHE_ETHERSCAN_API_KEY` |
| Gnosis | 100 | https://gnosis-rpc.publicnode.com | https://gnosisscan.io | `GNOSIS_ETHERSCAN_API_KEY` |
| Linea | 59144 | https://linea-rpc.publicnode.com | https://lineascan.build | `LINEA_ETHERSCAN_API_KEY` |
| Scroll | 534352 | https://scroll-rpc.publicnode.com | https://scrollscan.com | `SCROLL_ETHERSCAN_API_KEY` |
| zkSync Era | 324 | https://zksync-mainnet-rpc.publicnode.com | https://explorer.zksync.io | `ZKSYNC_ETHERSCAN_API_KEY` |
| Mantle | 5000 | https://mantle-rpc.publicnode.com | https://mantlescan.xyz | `MANTLE_ETHERSCAN_API_KEY` |
| Celo | 42220 | https://celo-mainnet-rpc.publicnode.com | https://celoscan.io | `CELO_ETHERSCAN_API_KEY` |
| Ink | TBD | https://ink-mainnet-rpc.publicnode.com | TBD | `INK_ETHERSCAN_API_KEY` |
| Unichain | TBD | https://unichain-mainnet-rpc.publicnode.com | TBD | `UNICHAIN_ETHERSCAN_API_KEY` |

---

## Expected Addresses

To compute the expected `ValidationRegistry` address before deployment, use `cast`:

```bash
cast create2 \
  --salt 0x56616c69646174696f6e526567697374727900000000000000000000000001 \
  --code-path <(solc --bin contracts/src/ValidationRegistry.sol:ValidationRegistry) \
  --constructor-args "$(cast abi-encode "constructor(address,address)" \
    0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 \
    0x$(cast to-checksum-address "$(cast call --rpc-url $RPC --from 0x0000000000000000000000000000000000000000 eth_call | head -1)"))"
```

**Simpler approach:** The address will be **identical on all 15 chains** due to CREATE2 determinism. If you deploy to Ethereum first, use that address for verification on subsequent chains.

All chains → `0x8004Cb1BF31DAf7788923b405b754f57acEB42ab` (example — compute locally to verify).

---

## Step 5: Post-Deployment Verification

After deploying to each chain, verify the contract exists and is correct:

### Etherscan Web UI

Visit the block explorer for each chain and search for the deployment transaction hash. Once finality is reached, the contract should appear.

**Example (Ethereum):** `https://etherscan.io/address/0x...`

### Cast CLI

```bash
# Verify constructor args are correct
cast call 0x... "identityRegistry()" --rpc-url https://ethereum-rpc.publicnode.com
# Should output: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432

cast call 0x... "owner()" --rpc-url https://ethereum-rpc.publicnode.com
# Should output: 0x... (your deployer address)
```

### Smoke Test (Integration)

Once deployed to all chains, verify the contract can record validations:

```bash
# Add a test validator
cast send 0x... \
  "addValidator(address)" \
  0xVALIDATOR_ADDR \
  --private-key $DEPLOYER_PK \
  --rpc-url https://ethereum-rpc.publicnode.com

# Verify it was added
cast call 0x... "isValidator(address)" 0xVALIDATOR_ADDR --rpc-url https://ethereum-rpc.publicnode.com
# Should output: 0x0000000000000000000000000000000000000000000000000000000000000001
```

---

## Step 6: Update Frontend

Once deployed and verified on all 15 chains, update [src/erc8004/abi.js](../src/erc8004/abi.js) to register the mainnet address:

```javascript
const MAINNET = {
  identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  validationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB42ab', // <- ADD THIS LINE
};
```

Update `REGISTRY_DEPLOYMENTS` object—it should already have entries for all 15 chain IDs, just ensure they point to the new address.

---

## Rollback (If Needed)

**CREATE2 addresses are single-shot.** Once deployed, you cannot redeploy to the same address. If deployment fails or is incorrect:

1. **Document the failed deploy:** Note which chains succeeded, which failed, the address, and the failure reason.
2. **New salt:** Create a new deployment script with a different salt (e.g., increment `uint256(2)` in the salt).
3. **Redeploy** with the new script to all chains.
4. **Update frontend** to the new address.

**Cost of rollback:** Extra gas on failed chains. Avoid by:
- Dry-running thoroughly
- Testing with a throwaway wallet first
- Deploying during low-gas hours on L1s

---

## Total Gas Cost Estimate

| Chain | Est. Gas (ETH) | Notes |
|---|---|---|
| Ethereum | 0.5 | L1, highly variable (gwei) |
| Base | 0.01 | L2, very cheap |
| Optimism | 0.01 | L2, very cheap |
| Arbitrum One | 0.01 | L2, very cheap |
| Polygon | 0.001 | Sidechain, cheap |
| BNB Chain | 0.002 | Cheap |
| Avalanche | 0.005 | Moderate |
| Gnosis | 0.002 | Cheap |
| Linea | 0.005 | L2, moderate |
| Scroll | 0.005 | L2, moderate |
| zkSync Era | 0.005 | L2, moderate |
| Mantle | 0.005 | L2, moderate |
| Celo | 0.001 | Cheap |
| Ink | 0.01 | L2, moderate |
| Unichain | 0.01 | L2, moderate |
| **TOTAL** | **≈ 0.6–0.8 ETH** | Varies by network congestion |

(Etherscan verification is usually free; if using a paid RPC, factor in API costs.)

---

## Troubleshooting

### "Address already exists"
- Chain was already deployed. Use `cast call` to verify the address has the correct `identityRegistry`.
- If already correct, update frontend and move on.
- If incorrect, use rollback procedure above.

### "Private key insufficient gas"
- Deployer wallet is out of gas on that chain.
- Bridge more ETH and retry.

### "Etherscan verification failed"
- API key is wrong or rate-limited.
- Verify manually by checking constructor args on Etherscan UI.
- Retry later.

### "Constructor arg mismatch"
- The `identityRegistry` or `owner` address in the script doesn't match what you passed.
- Check [contracts/script/DeployValidationMainnet.s.sol](../contracts/script/DeployValidationMainnet.s.sol) for hardcoded addresses.
- Do not change them without user approval.

---

## References

- [contracts/CLAUDE.md](../contracts/CLAUDE.md) — Foundry setup & conventions
- [contracts/src/ValidationRegistry.sol](../contracts/src/ValidationRegistry.sol) — Contract source
- [src/erc8004/abi.js](../src/erc8004/abi.js) — Frontend registry deployments
- [docs/ARCHITECTURE.md](./ARCHITECTURE.md) — System overview
- [Foundry Book](https://book.getfoundry.sh/) — Forge docs
- [CREATE2 deep dive](https://ethereum.org/en/developers/docs/accounts/#contract-accounts) — How deterministic addresses work
