---
name: agent-wallet-security
description: Security best practices for AI agents handling cryptocurrency wallets — key management, transaction signing, approval hygiene, phishing detection, and operational security. Critical for any OpenClaw agent interacting with DeFi or managing wallet operations.
license: MIT
metadata:
  category: security
  difficulty: intermediate
  author: clawhub
  tags: [security, agent-wallet-security]
---

# Agent Wallet Security Guide

When AI agents interact with crypto wallets and DeFi protocols, security becomes critical. This guide covers best practices for keeping user funds safe.

## Threat Model

### What Can Go Wrong

| Threat | Impact | Likelihood |
|--------|--------|-----------|
| Phishing (fake protocol) | Total fund loss | High |
| Unlimited approval exploit | Token drain | Medium |
| Transaction manipulation | Swap to wrong token/address | Medium |
| Private key exposure | Total fund loss | Low (with proper setup) |
| Social engineering | Unauthorized transactions | Medium |
| Smart contract exploit | Partial/total fund loss | Low-Medium |

## Key Management

### Wallet Architecture

**Recommended setup for agent-assisted DeFi**:

```
Cold Wallet (Hardware/Multisig)
  └── Long-term storage (>80% of portfolio)
  └── Never connected to DeFi directly

Hot Wallet (Browser/Mobile)
  └── Active DeFi operations (<20% of portfolio)
  └── Agent assists with transactions
  └── Regular approval audits

Burner Wallet (Temporary)
  └── Testing new protocols
  └── Airdrop claims from unknown sources
  └── Minimal funds
```

### Agent Access Levels

| Level | What Agent Can Do | When to Use |
|-------|------------------|-------------|
| Read-only | View balances, track positions | Portfolio monitoring |
| Quote | Get prices, simulate transactions | Trade planning |
| Propose | Build unsigned transactions | User signs manually |
| Execute | Submit signed transactions | Automated strategies |

**Recommendation**: Keep agents at "Propose" level for most users. User should always review and sign.

## Transaction Safety

### Before Every Transaction

1. **Verify recipient address** — check first and last 4 characters
2. **Verify contract address** — match against known protocol deployments
3. **Check transaction value** — confirm amount matches intent
4. **Review function call** — understand what the transaction does
5. **Check gas estimate** — unusually high gas may indicate a revert

### Red Flags

| Signal | Risk |
|--------|------|
| Unknown contract address | Possible scam contract |
| Unusually high gas estimate | Transaction may fail |
| Approve for unlimited amount | Token drain if compromised |
| Redirect to unexpected domain | Phishing site |
| Urgent "act now" pressure | Social engineering |
| Token with transfer tax >5% | Likely honeypot/scam |

### Address Verification

Always verify addresses against canonical sources:

| Protocol | Verification Source |
|----------|-------------------|
| Uniswap | Official docs + Etherscan verified |
| Aave | aave.com/developers |
| Sperax | docs.chat.sperax.io |
| Any protocol | Verified contract on block explorer |

**Never trust**: Addresses from social media, DMs, or unverified sources.

## Approval Management

### Best Practices

1. **Use exact-amount approvals** when possible
2. **Revoke unused approvals** monthly
3. **Keep a separate DeFi wallet** — don't approve from your main holdings
4. **Check approvals at Revoke.cash** before large deposits

### High-Risk Approval Patterns

- Approving a contract you've never interacted with
- Approving right after clicking a link (could be phishing)
- Approving permits (EIP-2612) — these happen off-chain and are harder to track

## Phishing Detection

### Common Phishing Vectors

| Vector | How It Works | Prevention |
|--------|-------------|-----------|
| Fake DEX frontend | Clones real UI, sends funds to attacker | Bookmark real URLs |
| Fake airdrop claim | "Claim your tokens" → drains wallet | Verify on official channels |
| DNS hijacking | Real domain → attacker's server | Check SSL cert |
| Approval phishing | Sign a permit → attacker gets approval | Read what you sign |
| Address poisoning | Sends $0 from similar address | Verify full address |

### Verification Checklist

- [ ] URL matches the official protocol domain exactly
- [ ] SSL certificate is valid and from expected issuer
- [ ] Contract address matches official deployment (check docs)
- [ ] Transaction details match your intent
- [ ] No unexpected approvals in the transaction

## Operational Security

### For Agent Operators

1. **Never store private keys in agent config** — use hardware wallets or secure key management
2. **Set transaction limits** — cap the amount an agent can transact
3. **Use separate wallets** — different wallets for storage vs DeFi
4. **Enable alerts** — get notified of all transactions
5. **Regular audits** — review agent activity and approval states

### For Automated Strategies

1. **Whitelist contracts** — agents should only interact with pre-approved contracts
2. **Set guards** — maximum trade size, maximum slippage, minimum output
3. **Time delays** — non-urgent transactions can wait for human review
4. **Kill switch** — ability to immediately stop agent operation
5. **Logging** — record all transactions for audit trail

### Multi-Sig for High-Value Operations

For significant funds:
- Use a multisig wallet (Safe/Gnosis)
- Require 2+ signatures for large transactions
- Agent proposes → owners confirm

## Emergency Response

### If Wallet Is Compromised

1. **Immediately** transfer remaining funds to a secure wallet
2. **Revoke all approvals** from the compromised address
3. **Check transaction history** for unauthorized activity
4. **Do NOT reuse** the compromised wallet for anything
5. **Report** the incident to relevant protocols

### If You Signed a Malicious Transaction

1. **Check what was approved** — use Etherscan/Revoke.cash
2. **Revoke the approval immediately** if it's an approve() call
3. **Move tokens** to a new wallet if the approval is for unlimited amount
4. **Time is critical** — act within minutes

## Agent Tips

When assisting with wallet operations:
1. **Always verify addresses** — never trust addresses from conversation context alone
2. **Warn before approvals** — explain what the user is granting access to
3. **Recommend hardware wallets** for amounts >$5K
4. **Never ask for seed phrases or private keys** — legitimate tools never need them
5. **Suggest Arbitrum** for routine DeFi — low gas means less cost per security measure

## Links

- Revoke.cash: https://revoke.cash
- Safe Multisig: https://safe.global
- Sperax (secure DeFi on Arbitrum): https://app.sperax.io
- ERC-8004 (on-chain agent identity): https://eips.ethereum.org/EIPS/eip-8004
