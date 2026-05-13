# ERC-8004 Contract Deployments

All three registries are deployed via CREATE2, giving the same address on every
supported EVM chain within each environment class (mainnet vs. testnet).

## Mainnet

Chains: Ethereum (1), Optimism (10), BSC (56), Gnosis (100), Polygon (137),
Fantom (250), zkSync Era (324), Moonbeam (1284), Mantle (5000), Base (8453),
Arbitrum One (42161), Celo (42220), Avalanche (43114), Linea (59144), Scroll (534352)

| Contract             | Address                                      | Tx Hash              |
| -------------------- | -------------------------------------------- | -------------------- |
| IdentityRegistry     | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | TODO: fill after deployment |
| ReputationRegistry   | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | TODO: fill after deployment |
| ValidationRegistry   | `TODO: fill after deployment` (same address on all chains) | TODO: one tx hash per chain |

## Testnet

Chains: BSC Testnet (97), Ethereum Sepolia (11155111), Base Sepolia (84532),
Arbitrum Sepolia (421614), Optimism Sepolia (11155420), Polygon Amoy (80002),
Avalanche Fuji (43113)

| Contract             | Address                                      | Tx Hash              |
| -------------------- | -------------------------------------------- | -------------------- |
| IdentityRegistry     | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | TODO: fill after deployment |
| ReputationRegistry   | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | TODO: fill after deployment |
| ValidationRegistry   | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | TODO: fill after deployment |

## CREATE2 Factory (ThreeWSFactory)

Custom vanity-prefixed CREATE2 deployer used to obtain matching addresses across chains.

| Chain            | Address                                      | Deployer EOA             | Deployed   |
| ---------------- | -------------------------------------------- | ------------------------ | ---------- |
| BSC (56)         | `0x00000000D49195AE81759cd247cFeDD9D0B479df` | `0x4022de2D...C0564f402` | 2026-05-11 |
| Base (8453)      | `0x00000000D49195AE81759cd247cFeDD9D0B479df` | `0x4022de2D...C0564f402` | —          |
| Arbitrum (42161) | `0x00000000D49195AE81759cd247cFeDD9D0B479df` | `0x4022de2D...C0564f402` | —          |

Bytecode SHA-256 `424e78aad2b19a37…` (1278 bytes) is identical on all three chains.

- Source: `ThreeWSFactory.sol`, solc v0.8.35, optimizer 200 runs, MIT, verified on BscScan.
- ABI:
  - `deploy(bytes32 salt, bytes initCode) → address` — wraps `CREATE2(0, initCode, salt)`, reverts `"create2 failed"` on zero address.
  - `predict(bytes32 salt, bytes32 initCodeHash) → address` (view).
  - Event: `Deployed(address indexed addr, bytes32 indexed salt)`.
- Vanity 8-byte zero prefix (`0x00000000…`) saves calldata gas on every `deploy`/`predict` call.
- To replicate on a new chain, use the same EOA + nonce + init code so CREATE2 yields the same address.

## Notes

- Addresses are authoritative in [`src/erc8004/abi.js`](../src/erc8004/abi.js) (`REGISTRY_DEPLOYMENTS`).
- Changing any address requires redeployment and updating `REGISTRY_DEPLOYMENTS` in `abi.js` and `api/_lib/erc8004-chains.js`.
- Deploy scripts: [`script/Deploy.s.sol`](script/Deploy.s.sol) (testnet), [`script/DeployValidationMainnet.s.sol`](script/DeployValidationMainnet.s.sol) (mainnet ValidationRegistry).
- 15-chain deploy command list: [`script/deploy-validation-registry.sh`](script/deploy-validation-registry.sh).
- After deployment: run `computeAddress(DEPLOYER_ADDRESS)` in the script (dry-run) to confirm the address, then update `validationRegistry` in `src/erc8004/abi.js` and `sdk/src/erc8004/abi.js`.
