# PDA Reference — @pump-fun/agent-payments-sdk

All PDAs are derived from program `AgenTMiC2hvxGebTsgmsD4HHBa8WEcqGFf87iwRRxLo7` unless noted.

## Derivation Helpers

```ts
import {
  getGlobalConfigPDA,
  getTokenAgentPaymentsPDA,
  getPaymentInCurrencyPDA,
  getInvoiceIdPDA,
  getBuybackAuthorityPDA,
  getWithdrawAuthorityPDA,
  getBondingCurvePDA,
} from "@pump-fun/agent-payments-sdk";
```

All functions return `[PublicKey, number]` (address + bump).

---

### `getGlobalConfigPDA()`
Seeds: `["global-config"]`

Protocol-wide config account. Stores authorities and the list of supported currency mints.

---

### `getTokenAgentPaymentsPDA(mint)`
Seeds: `["token-agent-payments", mint]`

Per-agent config account. One per token mint. Stores authority, buyback BPS, and mint.

---

### `getPaymentInCurrencyPDA(tokenMint, currencyMint)`
Seeds: `["payment-in-currency", tokenMint, currencyMint]`

Per-agent per-currency accounting. Tracks total payments, buybacks, withdrawals, and tokens burned.

---

### `getInvoiceIdPDA(tokenMint, currencyMint, amount, memo, startTime, endTime)`
Seeds: `["invoice-id", tokenMint, currencyMint, amount_le8, memo_le8, startTime_le8, endTime_le8]`

Unique invoice identifier. Used to prevent double-payment and to validate whether an invoice was settled. `amount`, `memo`, `startTime`, `endTime` are `BN` encoded as little-endian 8-byte buffers.

---

### `getBuybackAuthorityPDA(tokenMint)`
Seeds: `["buyback-authority", tokenMint]`

PDA that acts as the owner of the buyback vault ATA. Only the protocol buyback authority can trigger swaps from here.

---

### `getWithdrawAuthorityPDA(tokenMint)`
Seeds: `["withdraw-authority", tokenMint]`

PDA that acts as the owner of the withdraw vault ATA. Only the agent authority can withdraw from here.

---

### `getBondingCurvePDA(mint)`
Seeds: `["bonding-curve", mint]`
Program: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` (Pump bonding curve program)

Read-only reference to the Pump bonding curve state for a token. Used during `agentInitialize` to verify the caller is the bonding-curve creator.

---

## PDA Seeds (raw)

```ts
import {
  GLOBAL_CONFIG_SEED,
  TOKEN_AGENT_PAYMENTS_SEED,
  PAYMENT_IN_CURRENCY_SEED,
  INVOICE_ID_SEED,
  BUYBACK_AUTHORITY_SEED,
  WITHDRAW_AUTHORITY_SEED,
  BONDING_CURVE_SEED,
} from "@pump-fun/agent-payments-sdk";
```

| Constant | Value |
|---|---|
| `GLOBAL_CONFIG_SEED` | `Buffer.from("global-config")` |
| `TOKEN_AGENT_PAYMENTS_SEED` | `Buffer.from("token-agent-payments")` |
| `PAYMENT_IN_CURRENCY_SEED` | `Buffer.from("payment-in-currency")` |
| `INVOICE_ID_SEED` | `Buffer.from("invoice-id")` |
| `BUYBACK_AUTHORITY_SEED` | `Buffer.from("buyback-authority")` |
| `WITHDRAW_AUTHORITY_SEED` | `Buffer.from("withdraw-authority")` |
| `BONDING_CURVE_SEED` | `Buffer.from("bonding-curve")` |

---

## Vault ATAs

Vault token accounts are standard ATAs owned by the PDA authorities:

```ts
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const [tokenAgentPayments] = getTokenAgentPaymentsPDA(mint);
const [buybackAuthority]   = getBuybackAuthorityPDA(mint);
const [withdrawAuthority]  = getWithdrawAuthorityPDA(mint);

const paymentVaultAta = getAssociatedTokenAddressSync(currencyMint, tokenAgentPayments, true, tokenProgram);
const buybackVaultAta = getAssociatedTokenAddressSync(currencyMint, buybackAuthority,   true, tokenProgram);
const withdrawVaultAta = getAssociatedTokenAddressSync(currencyMint, withdrawAuthority,  true, tokenProgram);
```

`PumpAgent.getBalances(currencyMint)` returns all three with their current balances.
