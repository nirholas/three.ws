---
name: wallet-security-review
description: Assess wallet security practices including key management, signing hygiene, approval management, and operational security to protect against common crypto theft vectors.
license: MIT
metadata:
  category: security
  difficulty: beginner
  author: sperax-team
  tags: [security, wallet, phishing, approvals, key-management]
---

# Wallet Security Review

## When to use this skill

Use when the user asks about:
- How to secure their crypto wallet
- Reviewing their current security setup
- Managing token approvals and permissions
- Protecting against phishing and scams
- Setting up multisig or hardware wallet security
- Recovering from a suspected compromise

## Security Review Checklist

### 1. Key Management Assessment

Evaluate how private keys are stored and managed:
- **Wallet type**: Hardware wallet (Ledger, Trezor), software wallet (MetaMask, Rabby), or mobile
- **Seed phrase storage**: Written on paper/metal plate in secure location? Never digital photos or cloud storage
- **Key derivation**: Using standard BIP-39/BIP-44 paths?
- **Backup verification**: Has the user tested recovery from their backup?
- **Key separation**: Different wallets for different purposes (trading, holding, DeFi)?

Recommended setup:
- Cold storage (hardware wallet) for long-term holdings
- Hot wallet with limited funds for daily DeFi interaction
- Separate wallet for minting/interacting with unknown contracts

### 2. Token Approval Audit

Review existing approvals that could drain funds:
- **Check approvals** on tools like Revoke.cash or Etherscan token approval checker
- **Unlimited approvals**: Flag any infinite approval to a contract — especially old or unknown ones
- **Revoke unused approvals**: Any approval to a contract you no longer use should be revoked
- **Approval hygiene**: Set exact amounts instead of unlimited when possible
- **Regular audit frequency**: Review approvals monthly

### 3. Transaction Signing Safety

Best practices for signing:
- **Read before signing**: Always verify the function being called and the parameters
- **Simulation tools**: Use tools like Tenderly or wallet simulators to preview transaction outcomes
- **Permit signatures**: Be cautious with off-chain signatures (EIP-2612 permits) — they can authorize token transfers without on-chain approval
- **Blind signing**: Never blind-sign transactions — if your wallet cannot decode it, do not sign
- **Hardware wallet verification**: Always confirm the transaction details on the hardware device screen, not just the software

### 4. Phishing and Social Engineering Defense

Common attack vectors to watch for:
- **Fake websites**: Always verify URLs — bookmark legitimate sites rather than searching
- **Fake airdrops**: Unknown tokens in your wallet may be phishing traps — do not interact
- **Impersonation**: Support staff will never DM you first or ask for seed phrases
- **Malicious links**: Do not click links in unsolicited DMs, emails, or social media messages
- **Address poisoning**: Verify the full address on every transaction, not just first/last characters
- **Clipboard hijacking**: Malware that replaces copied addresses — always double-check pasted addresses

### 5. Operational Security (OpSec)

Broader security practices:
- **Dedicated device**: Consider a separate device for high-value crypto operations
- **VPN usage**: Use a reputable VPN when accessing wallets on public networks
- **2FA on exchanges**: Use hardware keys (YubiKey) or TOTP apps — never SMS 2FA
- **Email security**: Dedicated email for crypto accounts with strong 2FA
- **Social exposure**: Avoid publicly disclosing holdings amounts or wallet addresses
- **Software updates**: Keep wallet software and browser extensions updated

### 6. Multisig Considerations

For users with significant holdings:
- **Threshold**: A 2-of-3 or 3-of-5 multisig provides security + recovery
- **Key distribution**: Store keys in geographically separate locations
- **Diverse signers**: Use different wallet brands/types for each key
- **Social recovery**: Consider wallets with social recovery features for personal use
- **Testing**: Periodically test signing and recovery workflows

### 7. Incident Response Checklist

If the user suspects compromise:
1. Do NOT interact further with the compromised wallet
2. Immediately transfer remaining assets to a secure wallet from a clean device
3. Revoke all token approvals from a different clean wallet interface
4. Check for outstanding permit signatures — these may still be exploitable
5. Identify the attack vector (phishing, malware, leaked key) to prevent recurrence
6. Report the malicious address/contract to relevant platforms

### 8. Output Format

- **Security score**: Strong / Adequate / Needs improvement / Critical risk
- **Key management**: Assessment and recommendations
- **Approval hygiene**: Number of active approvals, flagged approvals
- **Top risks**: The 3 most urgent security improvements
- **Action items**: Prioritized list of concrete steps to take
- **Estimated time**: How long each improvement takes (5 min, 30 min, etc.)
