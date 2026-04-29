# solana-wallet

Generic Solana primitives. Provides the `ctx.wallet` contract that every signing
skill (pump-fun-trade, jupiter-swap, ...) consumes.

| Tool | Use it for |
|---|---|
| `getAddress` | Wallet pubkey |
| `getBalance` | SOL balance (self or any address) |
| `getSplBalances` | All SPL holdings |
| `transferSol` | Send SOL (capped by `maxTransferSol`) |
| `transferSpl` | Send any SPL token; auto-creates recipient ATA |
| `wrapSol` / `unwrapSol` | wSOL conversions |
| `getRecentSignatures` | Recent activity |

## Wallet contract

The host runtime injects `ctx.wallet` built via [api/_lib/solana-wallet.js](../../../api/_lib/solana-wallet.js):

```ts
{
  publicKey: PublicKey,
  signTransaction(tx): tx,           // Transaction | VersionedTransaction
  sendAndConfirm(tx, conn): string,  // returns signature
}
```

The wallet itself is recovered from an encrypted keypair stored on the agent
record (see `agent_identities.meta.encrypted_secret`). Never accepts keys via
tool args.

## Safety

- `transferSol` is capped by `manifest.config.maxTransferSol`.
- All write ops set a priority fee from `priorityFeeMicroLamports`.
- All write ops record to `ctx.memory` for the orchestrator to audit.
