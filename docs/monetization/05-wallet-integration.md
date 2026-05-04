---
status: not-started
---

# Prompt 5: Wallet Integration

## Objective
Integrate a Solana wallet adapter to allow users to connect their wallets (e.g., Phantom, Solflare) to the web application.

## Explanation
To enable on-chain payments, the first step is allowing users to connect their cryptocurrency wallets. We will use the official Solana wallet-adapter libraries to provide a smooth, standardized connection experience for users. This will add a "Connect Wallet" button to the application's header and make the user's public key available to the frontend.

## Instructions
1.  **Install Dependencies:**
    *   Add the required Solana wallet-adapter libraries to your project's `package.json`. You'll need `@solana/wallet-adapter-base`, `@solana/wallet-adapter-react`, `@solana/wallet-adapter-wallets`, and potentially UI components for your framework (e.g., `@solana/wallet-adapter-react-ui`).
    *   Run `npm install` or `yarn` to install them.

2.  **Set up the Wallet Provider:**
    *   In your main application component (e.g., `app.js` or a root-level layout component), wrap your application with the `ConnectionProvider`, `WalletProvider`, and `WalletModalProvider`.
    *   The `ConnectionProvider` needs an RPC endpoint for the Solana cluster you're targeting (e.g., mainnet-beta or devnet).
    *   The `WalletProvider` needs a list of the wallet adapters you want to support (e.g., `PhantomWalletAdapter`, `SolflareWalletAdapter`).

3.  **Add the Connect Button:**
    *   In your site's header component (e.g., `nav.js` or `header.html`), add the `WalletMultiButton` component from the UI library. This single component handles all connection states (Connect, Connected, Disconnect).
    *   Ensure you style the button to match your site's aesthetic. You will need to import the adapter's CSS file (`@solana/wallet-adapter-react-ui/styles.css`).

4.  **Access Wallet State:**
    *   Use the `useWallet` hook in your components to access the user's wallet state, such as `publicKey`, `connected`, `signTransaction`, etc.
    *   For example, you can now show or hide certain UI elements based on whether `connected` is true or false.

## Code Example (React-like, for `app.js` or similar)

```javascript
import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';

// Default styles that can be overridden
require('@solana/wallet-adapter-react-ui/styles.css');

export const App = () => {
    const network = WalletAdapterNetwork.Mainnet;
    const endpoint = useMemo(() => clusterApiUrl(network), [network]);
    const wallets = useMemo(() => [
        new PhantomWalletAdapter(),
        new SolflareWalletAdapter(),
    ], [network]);

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    {/* Your existing app layout */}
                    <header>
                        {/* ... other header items ... */}
                        <WalletMultiButton />
                    </header>
                    <main>
                        {/* ... rest of your app ... */}
                    </main>
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
};
```
