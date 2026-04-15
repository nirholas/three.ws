# contracts/CLAUDE.md

Scoped guidance for the Foundry project implementing ERC-8004. Read [/CLAUDE.md](../CLAUDE.md) first.

**⚠️ Must-ask-first for any change:** ABI shape, storage layout, deployed address, deploy script. These are on-chain and immutable once deployed.

---

## The three registries

All Solidity 0.8.24, optimizer 200 runs, OpenZeppelin-based.

| Contract | File | Purpose |
|---|---|---|
| **IdentityRegistry** | [src/IdentityRegistry.sol](src/IdentityRegistry.sol) | ERC-721 agents. `register()`, `register(agentURI)`, `register(agentURI, MetadataEntry[])`, `setAgentURI()`, `tokenURI()`, `setAgentWallet()` (EIP-712 delegated), `getAgentWallet()`, `unsetAgentWallet()`, `setMetadata()`, `getMetadata()`, `isAgent()`, `ownerOf()`. |
| **ReputationRegistry** | [src/ReputationRegistry.sol](src/ReputationRegistry.sol) | Signed feedback −100..+100, one review per address per agent. `submitFeedback(agentId, score, uri)`, `getReputation()` → `(avgX100, count)`, `getFeedback()`, `getFeedbackRange()`, `getFeedbackCount()`. |
| **ValidationRegistry** | [src/ValidationRegistry.sol](src/ValidationRegistry.sol) | Allow-listed validators attest off-chain proofs. `recordValidation(agentId, passed, proofHash, proofURI, kind)` (validator-only), `getValidation()`, `getLatestByKind()`, `getValidationRange()`, `addValidator()`, `removeValidator()`, `transferOwnership()`. |

---

## Deployed addresses (immutable — do not change)

Same address on every EVM chain (CREATE2 deterministic). Mirrored in [src/erc8004/abi.js](../src/erc8004/abi.js) `REGISTRY_DEPLOYMENTS`.

### Mainnet (chainIds: 1, 10, 56, 100, 137, 250, 324, 1284, 5000, 8453, 42161, 42220, 43114, 59144, 534352)
- IdentityRegistry:  `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- ReputationRegistry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
- ValidationRegistry: *(not yet deployed on mainnet)*

### Testnet (chainIds: 97, 11155111, 84532, 421614, 11155420, 80002, 43113)
- IdentityRegistry:  `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ReputationRegistry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- ValidationRegistry: `0x8004Cb1BF31DAf7788923b405b754f57acEB4272`

**Changing any of these requires:** user approval → redeploy → update `REGISTRY_DEPLOYMENTS` → update `VALIDATION_REGISTRY_DEPLOYMENTS` → migrate any frontend code calling them.

---

## Deploy workflow

```bash
# 1. Env
export BASE_SEPOLIA_RPC_URL=...
export BASE_RPC_URL=...
export BASESCAN_API_KEY=...
export DEPLOYER_PK=0x...

# 2. Build + test
forge build
forge test

# 3. Deploy (dry-run first)
forge script script/Deploy.s.sol --rpc-url base_sepolia
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify

# 4. Update frontend ABI/addresses
# Edit: ../src/erc8004/abi.js → REGISTRY_DEPLOYMENTS[<chainId>]
```

Configured RPC aliases (from [foundry.toml](foundry.toml)): `base_sepolia`, `base`. Etherscan verification uses Basescan for both. Remappings: `@openzeppelin/` → `lib/openzeppelin-contracts/`, `forge-std/` → `lib/forge-std/src/`.

**Never run `--broadcast` without my explicit approval.**

---

## ABI bridge to the frontend

ABIs are **hardcoded** in [src/erc8004/abi.js](../src/erc8004/abi.js) as ethers v6 human-readable strings (not JSON):

```js
'function register(string agentURI) external returns (uint256 agentId)'
'function tokenURI(uint256 tokenId) external view returns (string)'
```

No generation step. When you add/change a function signature in Solidity:
1. Change the `.sol`
2. Update the string in `abi.js` to match exactly
3. Update any callers in `src/erc8004/*.js`

---

## Don't touch without ask

- [out/](out/), [cache/](cache/) — Foundry artifacts, regenerated
- [lib/](lib/) — forge submodules (openzeppelin-contracts, forge-std)
- Any deployed address anywhere in the repo
- Storage layout of any deployed contract (appending fields is fine if you know what you're doing, reordering is not)
- EIP-712 domain separator version/name in IdentityRegistry (breaks existing delegated wallet signatures)
