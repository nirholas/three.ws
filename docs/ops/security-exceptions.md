# Security exceptions (accepted `npm audit` findings)

Durable, citable answers for advisories that `npm audit` at the repo root keeps reporting and that no dependency bump can close. Each entry names the advisory, the chain, why the vulnerable path is unreachable from three.ws code, and the date measured. Re-measure with `npm audit --json` before trusting an entry; delete the entry the day a patched release exists and is installed.

Scope: the ROOT `node_modules` tree only. Vendored worker dependencies are tracked by their own fix orders and must stay byte-identical across workers (`npm run check:vendored`).

## Measured 2026-10-25

| Advisory | Package | Chain | Patched release | Status |
|---|---|---|---|---|
| GHSA-3gc7-fjrx-p6mg (CVSS 7.5, buffer overflow in `toBigIntLE` / `toBufferLE`) | `bigint-buffer@1.1.5` | `@solana/spl-token` -> `@solana/buffer-layout-utils` -> `bigint-buffer` (also via `@solana/spl-stake-pool` under `@kamino-finance/klend-sdk`) | None. `1.1.5` is the only and latest version. | Accepted, unreachable |
| GHSA-p6mc-m468-83gw (CVSS 7.4, prototype pollution in `lodash.set`) | `lodash.set@4.3.2` | `@bnb-chain/greenfield-js-sdk@2.2.2` -> `lodash.set` | None. `4.3.2` is the latest; the SDK is at its latest `2.2.2`. | Accepted, unreachable |
| GHSA-86w9-cpqp-85rv (CVSS 7.5, RSA PKCS#1 v1.5 signature verification) | `node-forge@1.4.0` | `agent0-sdk@1.7.1` -> `helia` -> `@ipshipyard/libp2p-auto-tls` -> `acme-client` -> `node-forge` | None. `1.4.0` is the registry latest. | Accepted, unreachable |

### bigint-buffer

Reachability: `grep -rn "bigint-buffer\|toBigIntLE\|toBufferLE" api src scripts` finds nothing. The function is only reached inside `@solana/spl-token` / `@solana/buffer-layout-utils` when they decode u64 / u128 fields of SPL account and mint layouts. Those layouts have fixed byte widths set by the library; no three.ws call site passes a caller-chosen length into them. Account data is read from our own RPC lanes, not from user-supplied buffers. Mitigation if this ever changes: validate the buffer length before any direct `bigint-buffer` call and never add one that takes request-derived input.

### lodash.set

Reachability: `@bnb-chain/greenfield-js-sdk` is a live dependency (`api/_lib/bnb/greenfield.js`, `greenfield-write.js`, `vault-store.js` and the vault endpoints), so it is not dead code. `lodash.set` is called inside the SDK on SDK-owned object paths while building its own request structures. three.ws passes bucket names, object names and byte payloads, never an attacker-chosen property path, so no request field becomes a `set` key. Mitigation if this changes: never pass user-controlled strings as path arguments to SDK message builders, and allowlist keys.

### node-forge

Reachability: `grep -rn "agent0-sdk" api src scripts` shows only `api/agents/8004/agent.js` and `api/agents/8004/search.js`, and both import only the constants `DEFAULT_SUBGRAPH_URLS` and `DEFAULT_REGISTRIES`. No `Helia`, libp2p node, or auto-TLS (ACME certificate ordering) is ever constructed, and `grep -rn "helia\|auto-tls" api src scripts` is empty. The vulnerable RSA signature verification therefore never runs. The same dormant chain accounts for the other `helia` / `libp2p` / `@libp2p/kad-dht` / `@libp2p/peer-store` findings in the audit. Mitigation if this changes: do not start a libp2p node inside a request handler.

## `@solana/pay` stays on 0.2.6 at the root

The root pin `^0.2.6` is intentional. `@solana/pay` 1.x (used by `multiplayer/` and `character-studio/` at `1.0.16`, registry latest `1.0.26`) is a rewrite on `@solana/kit`: `findReference` takes a kit `Rpc<GetSignaturesForAddressApi>` and a kit `Address`, and `validateTransfer` takes `Rpc<GetTransactionApi>`, a kit `Signature`, and bigint-based `TransferFields`. The root call sites (`api/_lib/purchase-confirm.js`, `api/_lib/subscription-checkout.js`, `api/marketplace/buy-asset.js`, `api/print/orders/[id]/confirm.js`, `api/_lib/circulation.js`) pass a `@solana/web3.js` `Connection`, `PublicKey` and `BigNumber`, and `findReference(conn, key, { finality })` uses an option name 1.x renamed to `commitment`. A bump swaps in an incompatible API on the payment-verification path. 0.2.6 is the last release of the web3.js API.

Migration, when taken, must move those five verifiers (and their RPC fallback wrapper) to kit together, behind the existing purchase and checkout tests. It is a payments-path rewrite, not a version bump, and is not required to close any advisory above.
