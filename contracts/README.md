# Contracts

## ThreeWSFactory + ThreeWSPayments

Vanity-address CREATE2 factory and x402 payment receiver deployed across chains.

### ThreeWSFactory — `0x00000000D49195AE81759cd247cFeDD9D0B479df`

8 leading zeros. Deployed via Arachnid proxy on all chains.

| Chain | Explorer |
|-------|---------|
| BSC | [bscscan.com](https://bscscan.com/address/0x00000000D49195AE81759cd247cFeDD9D0B479df) |
| Base | [basescan.org](https://basescan.org/address/0x00000000D49195AE81759cd247cFeDD9D0B479df) |
| Arbitrum | [arbiscan.io](https://arbiscan.io/address/0x00000000D49195AE81759cd247cFeDD9D0B479df) |

Deploy: `node scripts/factory-deploy-bsc.mjs` (same salt works on all chains)
Salt: `0xfc1ecd1953bb17cf798c1eaeed287873008f3a3038f438e9e74c3b33ce370ef5`

### ThreeWSPayments — x402 pay-per-call receiver

Owner: `0x4022de2d36c334e73c7a108805cea11c0564f402`

| Chain | Address | Zeros | USDC |
|-------|---------|-------|------|
| BSC | [`0x00000000381f09742a30a5a49975514AeC1B72Cc`](https://bscscan.com/address/0x00000000381f09742a30a5a49975514AeC1B72Cc) | 8 | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` |
| Base | [`0x00000000b43689a688e51a06fCC0e3F2E058720a`](https://basescan.org/address/0x00000000b43689a688e51a06fCC0e3F2E058720a) | 8 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Arbitrum | [`0x0000000DEDc7C0C21b0F41dB31CA690DDEEC09C8`](https://arbiscan.io/address/0x0000000DEDc7C0C21b0F41dB31CA690DDEEC09C8) | 7 | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |

Deploy: `CHAIN=base|arbitrum|bsc PK=0x... SALT=0x... node scripts/payments-deploy-chain.mjs`

---

# ERC-8004 Contracts (optional / reference)

> **You probably don't need to deploy these.** The canonical ERC-8004 reference
> contracts are already live at the same addresses on every major EVM chain
> (see [`../src/erc8004/abi.js`](../src/erc8004/abi.js)). Identity:
> `0x8004A818...` (mainnet) / `0x8004A169...` (testnet). This directory is kept
> as a local reference implementation — useful if you ever need to fork, audit,
> or run a private deployment.

Three registries implementing [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) for the `3d-agent` project:

- **IdentityRegistry** — ERC-721 agents with `tokenURI`, delegated wallet (EIP-712), and key/value metadata.
- **ReputationRegistry** — one signed score per reviewer per agent, aggregated on-chain.
- **ValidationRegistry** — allow-listed validators attest to off-chain proofs (e.g. glTF-Validator reports).

The browser code in `../src/erc8004/` already targets these ABIs — only the deployed addresses are missing.

## Build & test

```bash
forge build
forge test -vv
```

25 tests across the three contracts. All passing.

## Deploy to Base Sepolia

1. Install Foundry if you haven't:

    ```bash
    curl -L https://foundry.paradigm.xyz | bash && foundryup
    ```

2. Fund a deployer wallet with Base Sepolia ETH: https://www.alchemy.com/faucets/base-sepolia

3. Configure environment:

    ```bash
    cp .env.example .env
    # Fill in DEPLOYER_PK and BASESCAN_API_KEY
    ```

4. Deploy + verify:

    ```bash
    source .env
    forge script script/Deploy.s.sol:Deploy \
        --rpc-url $BASE_SEPOLIA_RPC_URL \
        --private-key $DEPLOYER_PK \
        --broadcast \
        --verify
    ```

5. Copy the three addresses from the console output into [`../src/erc8004/abi.js`](../src/erc8004/abi.js) under the `84532` entry of `REGISTRY_DEPLOYMENTS`.

## Deploy to Base mainnet

Same as above but with `$BASE_RPC_URL`, and update the `8453` entry in `abi.js`.

## After deploy: register the three.ws itself

```js
// Browser console on three.ws with wallet connected to Base Sepolia:
import { registerAgent } from './src/erc8004/index.js';
const r = await registerAgent({
    glbFile: /* your GLB File */,
    name: 'three.ws',
    description: 'AI-powered 3D model viewer & validation agent',
    apiToken: 'YOUR_WEB3STORAGE_TOKEN',
    onStatus: console.log,
});
console.log(r); // { agentId, registrationCID, txHash }
```

Then update [`../public/.well-known/agent-registration.json`](../public/.well-known/agent-registration.json):

```json
"registrations": [
    { "agentId": 1, "agentRegistry": "eip155:84532:0xYourIdentityRegistryAddress" }
]
```

## Allow-list a validator (for on-chain validation records)

After deploy, the deployer owns the ValidationRegistry. Add the three.ws's own wallet (or a dedicated validator key) with:

```bash
cast send $VALIDATION_REGISTRY \
    "addValidator(address)" $VALIDATOR_ADDR \
    --rpc-url $BASE_SEPOLIA_RPC_URL \
    --private-key $DEPLOYER_PK
```

That wallet can then call `recordValidation(agentId, passed, proofHash, proofURI, kind)` via the `recordValidation()` helper in `../src/erc8004/validation-recorder.js`.

## Layout

```
contracts/
├── src/
│   ├── IdentityRegistry.sol
│   ├── ReputationRegistry.sol
│   └── ValidationRegistry.sol
├── test/
│   ├── IdentityRegistry.t.sol
│   ├── ReputationRegistry.t.sol
│   └── ValidationRegistry.t.sol
├── script/
│   └── Deploy.s.sol
├── foundry.toml
├── .env.example
└── README.md
```
