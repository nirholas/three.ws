# Vanity CREATE2 Grind Artifacts

JSON snapshots of every salt grind performed for the three.ws on-chain stack on
2026-05-10. Kept for reproducibility — any deployed address can be re-derived
from `keccak256(0xff ‖ deployer ‖ salt ‖ initCodeHash)[12:]`.

## Files

| File | initCodeHash | Status |
| ---- | ------------ | ------ |
| `factory-deployed.json` | `0x30f9d9020bf9…` | ✅ Live: `ThreeWSFactory` at `0x00000000D49195AE81759cd247cFeDD9D0B479df` (BSC, Base, Arbitrum) |
| `factory-runnerup.json` | `0x30f9d9020bf9…` | Unused — earlier 7-zero grind, superseded by the 8-zero result |
| `payments-bsc-deployed.json` | `0xb55479df540c…` | ✅ Live on BSC: `ThreeWSPayments` at `0x00000000381f09742a30a5a49975514AeC1B72Cc` (deployed via factory). Same salt produced different addresses on Arbitrum / Base because each chain's USDC token enters the init code |
| `payments-via-factory-candidate.json` | `0xad5ab625…` | Candidate — re-grind with the new factory but a build using owner `0x4022de2d…`. Not deployed |
| `payments-historical-via-arachnid.json` | `0x1673dbac…`, `0xc1c88d7d…` | Historical grinds from before `ThreeWSFactory` existed; all unused |

## Reproducing an address

```js
import { keccak_256 } from '@noble/hashes/sha3';
const factory = '4e59b44847b379578588920ca78fbf26c0b4956c'; // or ThreeWSFactory
const salt    = 'fc1ecd1953bb17cf798c1eaeed287873008f3a3038f438e9e74c3b33ce370ef5';
const ich     = '30f9d9020bf9622bbe7f8a1625d447efe350dfafd0a91e6dbd62d56547db835f';
const buf = Buffer.from('ff' + factory + salt + ich, 'hex');
console.log('0x' + Buffer.from(keccak_256(buf)).slice(12).toString('hex'));
// → 0x00000000d49195ae81759cd247cfedd9d0b479df
```

The grind tool is `public/eth-vanity.html` (browser, offline) — see also
`scripts/build-vanity-offline.mjs` for the standalone build target.
