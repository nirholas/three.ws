# pump-fun-skills Audit

Source: https://github.com/nirholas/pump-fun-skills  
Audited: 2026-04-29

The upstream repo contains one skill domain: **tokenized-agents** (`tokenized-agents/SKILL.md`).  
The SKILL.md describes three key SDK operations from `@pump-fun/agent-payments-sdk`.

## Skill table

| name | description | status | local file |
| :--- | :--- | :--- | :--- |
| `pumpfun-accept-payment` (buildAcceptPaymentInstructions) | Build Solana instructions to accept an agent payment on-chain. Serialises unsigned tx for browser wallet to sign. | superseded | [src/agent-skills-pumpfun.js](../src/agent-skills-pumpfun.js) — `pumpfun-accept-payment` covers the browser-wallet flow; `pumpfun-self-pay` (action: `accept`) covers the server-side flow |
| `pumpfun-verify-payment` (validateInvoicePayment) | Server-side verification that a payment was received on-chain. Queries Pump HTTP API with RPC fallback; returns `verified: true/false`. Must match all seven invoice fields exactly. | **missing → ported** | [src/agent-skills-pumpfun.js](../src/agent-skills-pumpfun.js) |
| `pumpfun-invoice-pda` (getInvoiceIdPDA) | Derive the deterministic on-chain Invoice ID PDA from invoice parameters. Useful for pre-checking duplicate invoices before building the payment tx. | **missing → ported** | [src/agent-skills-pumpfun.js](../src/agent-skills-pumpfun.js) |
| wallet-integration (WALLET_INTEGRATION.md) | React wallet adapter setup (WalletProvider, WalletMultiButton, useWallet hook). | skipped: UI only — frontend React component scaffolding, not an agent skill |  |

## Notes

- No new npm dependencies were required; both ported skills use `@pump-fun/agent-payments-sdk` already present in `node_modules`.
- The upstream repo has no skills that require external paid APIs beyond what is already in-tree.
- `pumpfun-self-pay` with `action: 'balances'` partially overlaps with the upstream description of reading vault state, but that was already present before this audit.
