---
status: not-started
---

# Prompt 5: Frontend - Solana Wallet Connection for Payments

## Objective
Integrate a Solana wallet adapter to allow users to connect their wallets, which is the first step in enabling payments for skills.

## Explanation
To purchase skills, users will need to connect their Solana wallet (like Phantom or Solflare) to the platform. We will use the official Solana wallet-adapter library to provide a smooth and familiar connection experience for users. This prompt focuses on adding a "Connect Wallet" button and managing the wallet connection state.

## Instructions
1.  **Install Dependencies:**
    *   Add the required Solana wallet-adapter libraries to your project's dependencies in `package.json`. You'll need `@solana/wallet-adapter-base`, `@solana/wallet-adapter-react` (or a vanilla JS equivalent), and adapters for popular wallets like `@solana/wallet-adapter-wallets`.

2.  **Add a "Connect Wallet" Button:**
    *   In the main navigation header of the marketplace (`marketplace.html`), add a "Connect Wallet" button.
    *   This button will be visible to users who are not yet connected.

3.  **Implement the Wallet Connection Logic:**
    *   Initialize the wallet adapter provider.
    *   When the "Connect Wallet" button is clicked, trigger the wallet adapter's connection modal.
    *   Once connected, the button should change to show the user's truncated public key and a "Disconnect" option.
    *   Store the connection state and the user's public key in a global state so that it can be accessed by other components (like the purchase modal that will be built later).

## Code Example (Frontend - `marketplace.js` or a new module)

```javascript
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
    GlowWalletAdapter,
    PhantomWalletAdapter,
    SlopeWalletAdapter,
    SolflareWalletAdapter,
    TorusWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import React, { useMemo } from 'react';

// (This example uses React, but the same principles apply to a vanilla JS implementation)

function App() {
    const network = WalletAdapterNetwork.Devnet;
    const endpoint = useMemo(() => clusterApiUrl(network), [network]);

    const wallets = useMemo(
        () => [
            new PhantomWalletAdapter(),
            new SolflareWalletAdapter(),
            // ... other wallets
        ],
        [network]
    );

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    {/* Your app components */}
                    <WalletMultiButton />
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}
```

## HTML Example (`marketplace.html`)

```html
<!-- In the marketplace header -->
<div class="wallet-adapter-button-container">
  <!-- The wallet adapter button will be rendered here -->
</div>
```
