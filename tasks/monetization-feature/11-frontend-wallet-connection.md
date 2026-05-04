---
status: not-started
---
# Prompt 11: Frontend Wallet Connection

**Status:** Not Started

## Objective
Implement a "Connect Wallet" feature allowing users to connect their Solana wallets (e.g., Phantom) to the application.

## Explanation
To perform on-chain transactions, the application needs permission to interact with the user's wallet. This task involves adding a UI element for connecting a wallet and using a library like `@solana/wallet-adapter` to handle the connection logic.

## Instructions
1.  **Add the necessary libraries to your project:**
    ```bash
    npm install @solana/wallet-adapter-base @solana/wallet-adapter-react @solana/wallet-adapter-wallets @solana/web3.js
    ```
    *(Note: If not using React, you can use the base libraries and implement your own UI bindings.)*
2.  **Add a "Connect Wallet" button to your site's main header.**
3.  **Wrap your application's main component with `ConnectionProvider`, `WalletProvider`, and add a `WalletModalProvider` for the connection dialog.**
4.  **Use the `useWallet` hook (or equivalent) to get the connection status and public key.**
    - When connected, change the button text to show the user's public key (truncated).
    - Store the user's public key in a global state or variable for use in purchase flows.

## Code Example (Using `@solana/wallet-adapter-react` and components)
```javascript
// In your main layout/app component
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
// ... more adapters

// In your render method
const network = WalletAdapterNetwork.Mainnet;
const endpoint = useMemo(() => clusterApiUrl(network), [network]);
const wallets = useMemo(() => [new PhantomWalletAdapter()], [network]);

return (
    <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
            <WalletModalProvider>
                {/* Your app content */}
                <header>
                    {/* ... other nav items ... */}
                    <WalletMultiButton />
                </header>
                {/* ... rest of your app ... */}
            </WalletModalProvider>
        </WalletProvider>
    </ConnectionProvider>
);
```
*This provides a pre-built button and modal for a quick setup.*
