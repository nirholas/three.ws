---
name: web3auth-integration-guide
description: Guide to integrating Web3Auth for social login in Web3 dApps. Covers email, Google, Apple, Discord, and Twitter login flows. MPC key management, session handling, RainbowKit integration, and migration from traditional wallet-only flows. Zero-friction onboarding.
license: MIT
metadata:
  category: security
  difficulty: intermediate
  author: nich
  tags: [security, web3auth-integration-guide]
---

# Web3Auth Integration Guide

Web3Auth enables social login (Google, Apple, email) for Web3 apps. Users get a wallet without knowing what a wallet is. Zero-friction onboarding for DeFi.

## Why Web3Auth?

| Traditional Flow | Web3Auth Flow |
|-----------------|--------------|
| 1. Install MetaMask | 1. Click "Sign in with Google" |
| 2. Create wallet | 2. Done ✅ |
| 3. Write down seed phrase | |
| 4. Fund with ETH for gas | |
| 5. Start using dApp | |

## Architecture

```
User clicks "Sign in with Google"
    │
    ▼
Web3Auth SDK → OAuth Provider (Google, Apple, etc.)
    │
    ▼
MPC Key Generation (threshold splitting)
    │
    ├── Share 1: Device (browser)
    ├── Share 2: Web3Auth network
    └── Share 3: Recovery (optional)
    │
    ▼
Ethereum wallet created silently
    │
    ▼
User is logged in with a wallet, no seed phrase needed
```

## Quick Start

```bash
npm install @web3auth/modal @web3auth/ethereum-provider
```

```typescript
import { Web3Auth } from '@web3auth/modal';
import { EthereumPrivateKeyProvider } from '@web3auth/ethereum-provider';

const chainConfig = {
  chainNamespace: 'eip155',
  chainId: '0xa4b1',  // Arbitrum One
  rpcTarget: 'https://arb1.arbitrum.io/rpc',
  displayName: 'Arbitrum One',
  blockExplorerUrl: 'https://arbiscan.io',
  ticker: 'ETH',
  tickerName: 'Ethereum',
};

const web3auth = new Web3Auth({
  clientId: process.env.WEB3AUTH_CLIENT_ID!,
  web3AuthNetwork: 'sapphire_mainnet',
  chainConfig,
  uiConfig: {
    appName: 'SperaxOS',
    mode: 'dark',
    loginMethodsOrder: ['google', 'apple', 'twitter', 'email_passwordless'],
  },
});

await web3auth.initModal();
```

## Login Methods

| Method | Flow | Best For |
|--------|------|---------|
| **Google** | OAuth 2.0 | Most users |
| **Apple** | Sign in with Apple | iOS users |
| **Email** | Passwordless (magic link) | Privacy-focused |
| **Twitter/X** | OAuth | Social-native users |
| **Discord** | OAuth | Gaming/community |
| **SMS** | OTP verification | Mobile users |
| **Passkeys** | WebAuthn/FIDO2 | Security-focused |

## RainbowKit Integration

```typescript
import { RainbowKitProvider, connectorsForWallets } from '@rainbow-me/rainbowkit';
import { web3AuthConnector } from '@web3auth/rainbowkit-connector';

const connectors = connectorsForWallets([
  {
    groupName: 'Social Login',
    wallets: [
      web3AuthConnector({
        web3AuthInstance: web3auth,
        loginParams: { loginProvider: 'google' },
      }),
    ],
  },
  {
    groupName: 'Wallets',
    wallets: [metaMaskWallet, walletConnectWallet, coinbaseWallet],
  },
]);
```

## Session Management

```typescript
// Check if user is logged in
const isConnected = web3auth.connected;

// Get user info
const userInfo = await web3auth.getUserInfo();
// { email, name, profileImage, verifier, verifierId }

// Get Ethereum provider
const provider = web3auth.provider;

// Logout
await web3auth.logout();
```

## MPC Key Management

Web3Auth uses Multi-Party Computation (MPC) for key security:

| Component | Description |
|-----------|-------------|
| **Device Share** | Stored in browser/device |
| **Network Share** | Distributed across Web3Auth nodes |
| **Recovery Share** | Optional backup (email, authenticator) |

Any 2 of 3 shares reconstruct the private key. No single point of failure.

## Gas Abstraction

Pair Web3Auth with account abstraction:
```typescript
// User pays no gas — sponsor covers it
import { AccountAbstraction } from '@web3auth/account-abstraction-provider';

const aa = new AccountAbstraction({
  smartAccountType: 'safe',
  paymasterUrl: process.env.PAYMASTER_URL,
});
```

## SperaxOS Integration

SperaxOS uses Web3Auth for:
- Social login (Google, Apple, email)
- Combined with RainbowKit for traditional wallet options
- Session persistence across page reloads
- Automatic Arbitrum chain configuration for USDs/SPA

## Links

- Web3Auth: https://web3auth.io
- Docs: https://web3auth.io/docs
- GitHub: https://github.com/nirholas/web3auth-integration
- Sperax: https://app.sperax.io
