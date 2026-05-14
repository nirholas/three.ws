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

| Chain            | Address                                      | Deployer EOA             | Deployed   | Tx |
| ---------------- | -------------------------------------------- | ------------------------ | ---------- | -- |
| BSC (56)         | `0x00000000D49195AE81759cd247cFeDD9D0B479df` | `0x4022de2D...C0564f402` | 2026-05-11 | — |
| Base (8453)      | `0x00000000D49195AE81759cd247cFeDD9D0B479df` | `0x4022de2D...C0564f402` | 2026-05-14 | [`0x20bbd8a8…`](https://basescan.org/tx/0x20bbd8a8f948a1d01eae17e2df919963ab92b6bcb86c326377d28d224bdb6923) |
| Arbitrum (42161) | `0x00000000D49195AE81759cd247cFeDD9D0B479df` | `0x4022de2D...C0564f402` | 2026-05-14 | [`0xa91d7cb7…`](https://arbiscan.io/tx/0xa91d7cb722fdcb1bc739b2161db7acdf911692837ec574bc9434e0eaf5be0747) |

Bytecode SHA-256 `424e78aad2b19a37…` (1278 bytes) is identical on all three chains.

**Vanity salt** (deployed via Arachnid proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C`, prefix `0000000`):
```
0xfc1ecd1953bb17cf798c1eaeed287873008f3a3038f438e9e74c3b33ce370ef5
```
- Factory init code hash: `0x30f9d9020bf9622bbe7f8a1625d447efe350dfafd0a91e6dbd62d56547db835f`
- Grind: 96,448,706 attempts in 101.1 s, generated 2026-05-10T11:40:46Z (lucked into 8 zeros while targeting 7)

- Source: `ThreeWSFactory.sol`, solc v0.8.35, optimizer 200 runs, MIT, verified on BscScan.
- ABI:
  - `deploy(bytes32 salt, bytes initCode) → address` — wraps `CREATE2(0, initCode, salt)`, reverts `"create2 failed"` on zero address.
  - `predict(bytes32 salt, bytes32 initCodeHash) → address` (view).
  - Event: `Deployed(address indexed addr, bytes32 indexed salt)`.
- Vanity 8-byte zero prefix (`0x00000000…`) saves calldata gas on every `deploy`/`predict` call.
- To replicate on a new chain, use the same EOA + nonce + init code so CREATE2 yields the same address.

## ThreeWSPayments (x402 pay-per-call receiver)

Deployed via `ThreeWSFactory.deploy(salt, initCode)`. Constructor takes the chain's
canonical USDC token, so each chain's init code differs → the cross-chain CREATE2
address parity that the factory itself enjoys does **not** apply here. The vanity
8-zero prefix only landed on BSC; Base and Arbitrum produced ordinary addresses
from the same salt.

**Owner:** `0x4022de2d36c334e73c7a108805cea11c0564f402` (deployer EOA)

**Vanity salt** (BSC-targeted, prefix `00000000`, case-insensitive):
```
0x5ef7540f7c609d04ab6d3997bc8c38f0f31ce09acccff2c11bcb3909ad542cde
```
- Factory / deployer:    `0x00000000d49195ae81759cd247cfedd9d0b479df`
- BSC init code hash:    `0xb55479df540c0e4efae39a0181051754cc236a9934f03805a743f4290178569e`
- Grind: 2,859,887,864 attempts in 22.3 s, generated 2026-05-10T13:58:54Z

| Chain            | USDC                                         | ThreeWSPayments                              | Tx |
| ---------------- | -------------------------------------------- | -------------------------------------------- | -- |
| BSC (56)         | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | [`0x00000000381f09742a30a5a49975514AeC1B72Cc`](https://bscscan.com/address/0x00000000381f09742a30a5a49975514AeC1B72Cc) | [`0xc4f4e87f…`](https://bscscan.com/tx/0xc4f4e87f67c70044a8682ea50d59fbc04e9777f453538a6916075f5409e5b7ef) |
| Arbitrum (42161) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | [`0xed3696489490dbfAFD82996ADB11165A56c33c49`](https://arbiscan.io/address/0xed3696489490dbfAFD82996ADB11165A56c33c49) | [`0xca39a600…`](https://arbiscan.io/tx/0xca39a6003e8a6144662aceae43ee2b2c5107e426e16ccf58a406d66d38f34e5f) |
| Base (8453)      | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | predicted `0x31B13cDe47431EfcC8616C8495204e6E6C2Ded34` — ⚠ tx mined success but address has no code, treat as **not deployed** | [`0xb6fcf60b…`](https://basescan.org/tx/0xb6fcf60b4ca16d25e135f91046107e78518fca9aa4f180d5110a5116bcdfe4d0) |

Base deploy must be re-run and the address re-checked before integrations point at it.

Deploy command (run from 3D-Agent repo where `scripts/deploy-multichain.mjs` lives):
```
PK=<deployer-private-key> \
PAYMENTS_SALT=0x5ef7540f7c609d04ab6d3997bc8c38f0f31ce09acccff2c11bcb3909ad542cde \
BASE_RPC_URL=... ARB_RPC_URL=... BSC_RPC_URL=... \
node scripts/deploy-multichain.mjs
```

## Notes

- Addresses are authoritative in [`src/erc8004/abi.js`](../src/erc8004/abi.js) (`REGISTRY_DEPLOYMENTS`).
- Changing any address requires redeployment and updating `REGISTRY_DEPLOYMENTS` in `abi.js` and `api/_lib/erc8004-chains.js`.
- Deploy scripts: [`script/Deploy.s.sol`](script/Deploy.s.sol) (testnet), [`script/DeployValidationMainnet.s.sol`](script/DeployValidationMainnet.s.sol) (mainnet ValidationRegistry).
- 15-chain deploy command list: [`script/deploy-validation-registry.sh`](script/deploy-validation-registry.sh).
- After deployment: run `computeAddress(DEPLOYER_ADDRESS)` in the script (dry-run) to confirm the address, then update `validationRegistry` in `src/erc8004/abi.js` and `sdk/src/erc8004/abi.js`.
