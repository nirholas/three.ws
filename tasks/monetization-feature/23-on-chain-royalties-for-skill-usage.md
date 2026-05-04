---
status: not-started
---

# Prompt 23: On-Chain Royalties for Skill Usage

**Status:** Not Started

## Objective
Explore a more advanced model where creators earn royalties *every time* their skill is used, not just when it's sold.

## Explanation
This moves towards a "pay-per-use" model, which might be more suitable for certain high-value AI skills. It requires every skill execution to be a micro-transaction.

## Instructions
- [ ] **This is a significant architectural change.** Instead of a one-time access check, every call to `/api/agent/invoke` for a paid skill will now be a transaction.
- [ ] **The `invoke` endpoint will now behave like a Solana Pay API:**
    - 1. It receives the skill execution request.
    - 2. It calculates the per-use price.
    - 3. It returns a transaction that both pays the creator and includes the instructions to execute the skill (this may require an on-chain program).
- [ ] **The frontend needs to be updated** to handle this new flow. Every paid skill use will now require a wallet signature.
- [ ] **Consider using Solana Actions** to simplify this. The "invoke" button could be a Blink (Solana Action URL), which wallets can render and execute natively.

**Note:** This is a complex, forward-looking feature. The initial focus should be on the "purchase access" model. This prompt is for planning the next stage of the platform's evolution.
