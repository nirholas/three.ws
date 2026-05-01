---
name: token-approval-safety
description: Guide to ERC-20 token approvals — how they work, why unlimited approvals are risky, how to check and revoke approvals, and best practices. Use when helping users manage approvals, audit wallet security, or understand approval-related risks.
license: MIT
metadata:
  category: security
  difficulty: intermediate
  author: clawhub
  tags: [security, token-approval-safety]
---

# Token Approval Safety Guide

Token approvals are one of the most overlooked security risks in DeFi. This guide helps AI agents protect users from approval-related attacks.

## How Approvals Work

When you interact with a DeFi protocol, you must first "approve" it to spend your tokens:

```
1. You call approve(spenderAddress, amount) on the token contract
2. The spender (DEX, protocol) can now transfer up to `amount` of your tokens
3. When you swap/deposit, the protocol calls transferFrom() to move your tokens
```

### The Problem: Unlimited Approvals

Most DeFi UIs request **unlimited approval** (`type(uint256).max`):
- Saves gas on future interactions (no re-approval needed)
- But: the protocol can spend ALL your tokens FOREVER
- If the protocol gets hacked, attackers drain your tokens via the approval

## Risk Levels

| Approval Type | Risk | When to Use |
|--------------|------|-------------|
| Exact amount | Low | Large deposits, untrusted protocols |
| Limited amount | Medium | Regular use with trusted protocols |
| Unlimited | High | Only with battle-tested protocols (Uniswap, Aave) |
| Permit (EIP-2612) | Medium | Gasless approvals, common in modern DeFi |

## How to Check Approvals

### On-Chain (Direct)

Query the token contract: `allowance(ownerAddress, spenderAddress)`

### Tools

| Tool | URL | Features |
|------|-----|----------|
| Revoke.cash | https://revoke.cash | Most popular, multi-chain |
| Etherscan Token Approvals | https://etherscan.io/tokenapprovalchecker | Ethereum-only |
| Arbiscan | https://arbiscan.io/tokenapprovalchecker | Arbitrum |

### What to Look For

- **Unlimited approvals** to contracts you no longer use
- **Approvals to unknown contracts** you don't recognize
- **Old approvals** from months/years ago
- **Approvals for valuable tokens** (USDC, USDT, WETH)

## Revoking Approvals

Revoking sets the allowance to 0:

```
approve(spenderAddress, 0)
```

**Cost**: Small gas fee per revocation

**When to revoke**:
- After you're done using a protocol
- If a protocol announces a security incident
- During regular security checkups (monthly recommended)
- Before a token migration or contract upgrade

## Common Attack Vectors

### 1. Approval Phishing

Attacker tricks you into approving a malicious contract:
- Fake DEX frontends
- Phishing links disguised as protocol UIs
- "Claim airdrop" scam sites

**Prevention**: Always verify the contract address before approving

### 2. Compromised Protocol

If a protocol with your approval gets hacked:
- Attacker can drain your approved tokens immediately
- They don't need your private key — just the approval

**Prevention**: Use exact-amount approvals, revoke unused approvals

### 3. Permit Signature Phishing

EIP-2612 permits are signed off-chain (no gas). Attackers can trick you into signing a permit that grants them unlimited approval:

- Looks like a harmless "sign this message" request
- Actually authorizes token spending
- No on-chain transaction to alert you

**Prevention**: Read what you're signing carefully, use wallets that show permit details

## Best Practices

### For Regular Users

1. **Use exact-amount approvals** when possible
2. **Review approvals monthly** using Revoke.cash
3. **Revoke approvals to protocols you no longer use**
4. **Use a dedicated DeFi wallet** — don't hold all tokens where you approve
5. **Read approval prompts** — check the spender address matches the expected protocol

### For Frequent DeFi Users

1. **Separate hot/cold wallets** — cold wallet for storage, hot wallet for DeFi
2. **Batch revocations** when gas is low
3. **Prefer EIP-2612 permits** for modern protocols (single-use)
4. **Set up alerts** for large approval events on your address
5. **Audit before depositing large amounts** — check existing approvals first

### Approval Hygiene Checklist

- [ ] Check all active approvals at least monthly
- [ ] Revoke any approvals to contracts you don't recognize
- [ ] Revoke approvals to protocols you've stopped using
- [ ] Use exact amounts for new approvals when available
- [ ] Verify contract addresses on block explorers before approving

## Agent Tips

When helping users with approvals:
1. **Always warn about unlimited approvals** — suggest exact-amount when possible
2. **Before any large DeFi interaction** — suggest checking existing approvals
3. **After security incidents** — immediately recommend revoking approvals to affected protocol
4. **New users** — explain approvals before their first DeFi transaction
5. **Gas consideration** — revocations cost gas, batch them when gas is low

## Links

- Revoke.cash: https://revoke.cash
- Etherscan Approval Checker: https://etherscan.io/tokenapprovalchecker
- Sperax (secure DeFi on Arbitrum): https://app.sperax.io
