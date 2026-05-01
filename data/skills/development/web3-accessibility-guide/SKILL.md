---
name: web3-accessibility-guide
description: Guide to W3AG (Web3 Accessibility Guidelines) — accessibility standards and patterns for Web3 applications. Covers wallet connect UX, transaction confirmation patterns, error handling, screen reader support, and inclusive design for dApps. Making DeFi usable by everyone.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, web3-accessibility-guide]
---

# W3AG — Web3 Accessibility Guidelines

W3AG defines accessibility standards for Web3 applications. Wallet connect flows, transaction confirmations, gas estimation UX, error handling — all designed to be usable by everyone, including people with disabilities.

## Why Web3 Accessibility?

| Problem | Impact | Users Affected |
|---------|--------|---------------|
| Tiny hex addresses | Illegible for low vision | 285M globally |
| No screen reader support | Blind users excluded | 39M globally |
| Complex jargon | Cognitive barriers | 200M+ globally |
| Mouse-only interactions | Motor disabilities | 75M globally |
| Flashing animations | Seizure triggers | 50M globally |
| No keyboard navigation | Physical disabilities | 110M globally |

## Core Principles

### 1. Perceivable
All information must be presentable in ways users can perceive.

```tsx
// ❌ Bad: Address with no label
<span>0x742d35Cc6634C0532925a3b844Bc9...</span>

// ✅ Good: Labeled, truncated, copyable
<AddressDisplay
  address="0x742d35Cc6634C0532925a3b844Bc9..."
  label="Your Wallet"
  truncate={true}
  copyable={true}
  aria-label="Your wallet address: 0x742d...Bc9"
/>
```

### 2. Operable
All functionality must be operable via keyboard and assistive tech.

```tsx
// ❌ Bad: onClick only
<div onClick={connectWallet}>Connect</div>

// ✅ Good: Button with keyboard support
<button
  onClick={connectWallet}
  onKeyDown={(e) => e.key === 'Enter' && connectWallet()}
  aria-label="Connect your wallet"
  role="button"
  tabIndex={0}
>
  Connect Wallet
</button>
```

### 3. Understandable
Content and operations must be understandable.

```tsx
// ❌ Bad: Jargon without explanation
<span>Gas: 23 Gwei | Slippage: 0.5%</span>

// ✅ Good: With tooltips and plain language
<Tooltip content="Transaction fee paid to network validators. Currently low.">
  <span>Network Fee: ~$0.02</span>
</Tooltip>
<Tooltip content="Maximum price difference you'll accept. Higher = faster trade, lower = better price.">
  <span>Price Tolerance: 0.5%</span>
</Tooltip>
```

### 4. Robust
Content must be interpretable by assistive technologies.

## Wallet Connection Patterns

### Accessible Wallet Modal

```tsx
function WalletConnectModal({ isOpen, onClose }) {
  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      aria-labelledby="wallet-title"
      aria-describedby="wallet-desc"
    >
      <h2 id="wallet-title">Connect Your Wallet</h2>
      <p id="wallet-desc">
        Choose how you'd like to connect. Your wallet lets you interact with DeFi protocols.
      </p>
      
      <WalletOption
        name="MetaMask"
        icon={metamaskIcon}
        description="Browser extension wallet"
        onClick={connectMetaMask}
      />
      <WalletOption
        name="Social Login"
        icon={socialIcon}
        description="Sign in with Google, Apple, or email"
        onClick={connectSocial}
      />
      
      <button onClick={onClose} aria-label="Close wallet connection dialog">
        Cancel
      </button>
    </Dialog>
  );
}
```

## Transaction Confirmation

```tsx
function TransactionConfirmation({ tx }) {
  return (
    <div role="alertdialog" aria-labelledby="tx-title">
      <h3 id="tx-title">Confirm Transaction</h3>
      
      <dl>
        <dt>Action</dt>
        <dd>Swap 100 USDC for SPA tokens</dd>
        
        <dt>You Pay</dt>
        <dd aria-label="You pay 100 USDC">100 USDC</dd>
        
        <dt>You Receive</dt>
        <dd aria-label="You receive approximately 8,130 SPA">~8,130 SPA</dd>
        
        <dt>Network Fee</dt>
        <dd aria-label="Network fee approximately 2 cents">~$0.02</dd>
      </dl>
      
      <div role="alert" aria-live="polite">
        {tx.status === 'pending' && 'Transaction is being processed...'}
        {tx.status === 'success' && 'Transaction completed successfully!'}
        {tx.status === 'error' && `Transaction failed: ${tx.error}`}
      </div>
    </div>
  );
}
```

## Checklist

| Category | Requirement | Priority |
|----------|------------|----------|
| **Wallet** | Keyboard-navigable wallet connect | P0 |
| **Wallet** | Screen reader announces connection status | P0 |
| **Addresses** | Truncated with copy button | P0 |
| **Addresses** | Full address available to screen readers | P1 |
| **Transactions** | Step-by-step confirmation with plain language | P0 |
| **Transactions** | Status updates via aria-live regions | P0 |
| **Errors** | Clear error messages, not just error codes | P0 |
| **Charts** | Alt text or data table alternative | P1 |
| **Forms** | All inputs labeled with aria-label | P0 |
| **Navigation** | Full keyboard navigation | P0 |
| **Motion** | Respect prefers-reduced-motion | P1 |
| **Color** | 4.5:1 contrast ratio minimum | P0 |

## SperaxOS Compliance

SperaxOS follows W3AG guidelines:
- All wallet flows are keyboard accessible
- Transaction statuses announced to screen readers
- Plain language explanations for DeFi terms
- High contrast mode support
- Reduced motion support

## Links

- GitHub: https://github.com/nirholas/w3ag
- WCAG 2.1: https://www.w3.org/WAI/WCAG21/quickref/
- Sperax: https://app.sperax.io
