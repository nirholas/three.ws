# Security exceptions (accepted `npm audit` findings)

Durable, citable answers for advisories that `npm audit` at the repo root keeps reporting and that no dependency bump can close. Each entry names the advisory, the chain, why the vulnerable path is unreachable from three.ws code, and the date measured. Re-measure with `npm audit --json` before trusting an entry; delete the entry the day a patched release exists and is installed.

Scope: the ROOT `node_modules` tree only. Vendored worker dependencies are tracked by their own fix orders and must stay byte-identical across workers (`npm run check:vendored`).

## Measured 2026-11-06

| Advisory | Package | Chain | Patched release | Status |
|---|---|---|---|---|
| GHSA-3gc7-fjrx-p6mg (CVSS 7.5, buffer overflow in `toBigIntLE` / `toBufferLE`) | `bigint-buffer@1.1.5` | `@solana/spl-token` -> `@solana/buffer-layout-utils` -> `bigint-buffer` (also via `@solana/spl-stake-pool` under `@kamino-finance/klend-sdk`) | None upstream. `1.1.5` is the only and latest version. | Still listed by `npm audit` (it matches on the version string); the code path is patched locally and unreachable |

Closed since 2026-11-04, no longer reported by `npm audit`:

- `lodash.set` (GHSA-p6mc-m468-83gw): the root now depends on `file:vendor/lodash.set`, a `4.3.2` shim backed by a maintained `lodash` release, and `overrides` forces every transitive copy (including the one under `@bnb-chain/greenfield-js-sdk`) onto it.
- `helia` / `libp2p` (via `agent0-sdk`) and the earlier `node-forge` RSA advisory: the lockfile resolves patched releases (`helia` 7.x, `node-forge` `^1.4.2` via `overrides`).

### bigint-buffer

Patch: the root `overrides` block points `@solana/buffer-layout-utils` at `file:multiplayer/vendor/bigint-buffer`, a `1.1.5` copy without the native binding that fixes the overflow. `npm audit` cannot see that and keeps reporting the version, so this entry stays until upstream ships a release.

Reachability: `grep -rn "bigint-buffer\|toBigIntLE\|toBufferLE" api src scripts` finds nothing. The function is only reached inside `@solana/spl-token` / `@solana/buffer-layout-utils` when they decode u64 / u128 fields of SPL account and mint layouts. Those layouts have fixed byte widths set by the library; no three.ws call site passes a caller-chosen length into them. Account data is read from our own RPC lanes, not from user-supplied buffers. Mitigation if this ever changes: validate the buffer length before any direct `bigint-buffer` call and never add one that takes request-derived input.

### helia / libp2p (via agent0-sdk)

Reachability, kept as a guard against regressions: `grep -rn "agent0-sdk" api src scripts` shows only `api/agents/8004/agent.js` and `api/agents/8004/search.js`, and both import only the constants `DEFAULT_SUBGRAPH_URLS` and `DEFAULT_REGISTRIES`. No `Helia`, libp2p node, or auto-TLS (ACME certificate ordering) is ever constructed. Mitigation if this changes: do not start a libp2p node inside a request handler.

## `@solana/pay` is on 1.x at the root

The root dependency is `@solana/pay` `^1.0.26` (the same 1.x line `multiplayer/` and `character-studio/` use). 1.x is built on `@solana/kit`: `findReference` takes a kit `Rpc` and `Address`, `validateTransfer` takes a kit `Rpc`, `Signature` and plain-number amounts, and the commitment option is `commitment`. The platform's payment flows still hold `@solana/web3.js` `PublicKey` and `BigNumber` values, so `api/_lib/solana/solana-pay-verify.js` converts once at that boundary over the rotating-RPC kit client in `api/_lib/solana/kit-rpc.js`. The skill, subscription, marketplace (`api/marketplace/buy-asset.js`), print-order (`api/print/orders/[id]/confirm.js`) and circulation (`api/_lib/circulation.js`), agent purchase (`api/_lib/purchase-confirm.js`) and hire-Blink (`api/_lib/hire-blink.js`) verifiers all go through it, behind `tests/solana-pay-verify.test.js`. The earlier pin to 0.2.6 was removed with that migration (commit `058ac75f7`); the `^0.2.6` rationale no longer applies.

The wrapper also closes two gaps in 1.0.26: a payment that creates the recipient token account in the same transaction (no pre-balance entry, which pay rejects) is proven from the post balance instead, and memos are checked against every supported Memo program version rather than pay's v4-only comparison.

`validateTransfer` inspects only the last instruction for the transfer and its reference keys, so any builder that wants a payment found must put the reference-bound leg last.
