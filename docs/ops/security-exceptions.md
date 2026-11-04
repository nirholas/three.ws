# Security exceptions (accepted `npm audit` findings)

Durable, citable answers for advisories that `npm audit` at the repo root keeps reporting and that no dependency bump can close. Each entry names the advisory, the chain, why the vulnerable path is unreachable from three.ws code, and the date measured. Re-measure with `npm audit --json` before trusting an entry; delete the entry the day a patched release exists and is installed.

Scope: the ROOT `node_modules` tree only. Vendored worker dependencies are tracked by their own fix orders and must stay byte-identical across workers (`npm run check:vendored`).

## Measured 2026-11-04

| Advisory | Package | Chain | Patched release | Status |
|---|---|---|---|---|
| GHSA-3gc7-fjrx-p6mg (CVSS 7.5, buffer overflow in `toBigIntLE` / `toBufferLE`) | `bigint-buffer@1.1.5` | `@solana/spl-token` -> `@solana/buffer-layout-utils` -> `bigint-buffer` (also via `@solana/spl-stake-pool` under `@kamino-finance/klend-sdk`) | None. `1.1.5` is the only and latest version. | Accepted, unreachable |
| GHSA-p6mc-m468-83gw (CVSS 7.4, prototype pollution in `lodash.set`) | `lodash.set@4.3.2` | `@bnb-chain/greenfield-js-sdk@2.2.2` -> `lodash.set` | None. `4.3.2` is the latest; the SDK is at its latest `2.2.2`. | Accepted, unreachable |

### bigint-buffer

Reachability: `grep -rn "bigint-buffer\|toBigIntLE\|toBufferLE" api src scripts` finds nothing. The function is only reached inside `@solana/spl-token` / `@solana/buffer-layout-utils` when they decode u64 / u128 fields of SPL account and mint layouts. Those layouts have fixed byte widths set by the library; no three.ws call site passes a caller-chosen length into them. Account data is read from our own RPC lanes, not from user-supplied buffers. Mitigation if this ever changes: validate the buffer length before any direct `bigint-buffer` call and never add one that takes request-derived input.

### lodash.set

Reachability: `@bnb-chain/greenfield-js-sdk` is a live dependency (`api/_lib/bnb/greenfield.js`, `greenfield-write.js`, `vault-store.js` and the vault endpoints), so it is not dead code. `lodash.set` is called inside the SDK on SDK-owned object paths while building its own request structures. three.ws passes bucket names, object names and byte payloads, never an attacker-chosen property path, so no request field becomes a `set` key. Mitigation if this changes: never pass user-controlled strings as path arguments to SDK message builders, and allowlist keys.

### helia / libp2p (via agent0-sdk)

The `node-forge` RSA advisory (GHSA-86w9-cpqp-85rv) that used to sit in this chain is closed: the lockfile now resolves a patched release and `npm audit` no longer reports it. The `helia` / `libp2p` findings below remain.

Reachability: `grep -rn "agent0-sdk" api src scripts` shows only `api/agents/8004/agent.js` and `api/agents/8004/search.js`, and both import only the constants `DEFAULT_SUBGRAPH_URLS` and `DEFAULT_REGISTRIES`. No `Helia`, libp2p node, or auto-TLS (ACME certificate ordering) is ever constructed, and `grep -rn "helia\|auto-tls" api src scripts` is empty. The vulnerable code therefore never runs. This dormant chain accounts for the `@helia/bitswap` / `@helia/block-brokers` / `@helia/utils` / `helia` / `libp2p` / `@libp2p/kad-dht` / `@libp2p/peer-store` findings in the audit. Mitigation if this changes: do not start a libp2p node inside a request handler.

## `@solana/pay` is on 1.x at the root

The root dependency is `@solana/pay` `^1.0.26` (the same 1.x line `multiplayer/` and `character-studio/` use). 1.x is built on `@solana/kit`: `findReference` takes a kit `Rpc` and `Address`, `validateTransfer` takes a kit `Rpc`, `Signature` and plain-number amounts, and the commitment option is `commitment`. The platform's payment flows still hold `@solana/web3.js` `PublicKey` and `BigNumber` values, so `api/_lib/solana/solana-pay-verify.js` converts once at that boundary over the rotating-RPC kit client in `api/_lib/solana/kit-rpc.js`. The skill, subscription, marketplace (`api/marketplace/buy-asset.js`), print-order (`api/print/orders/[id]/confirm.js`) and circulation (`api/_lib/circulation.js`) verifiers all go through it, behind `tests/solana-pay-verify.test.js`. The earlier pin to 0.2.6 was removed with that migration (commit `058ac75f7`); the `^0.2.6` rationale no longer applies.

`validateTransfer` inspects only the last instruction for the transfer and its reference keys, so any builder that wants a payment found must put the reference-bound leg last.
