import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { Connection, PublicKey } from '@solana/web3.js';

let connectedWalletAddress = null;

// Initialize the wallet adapter
const wallet = new PhantomWalletAdapter();

// Listen for connection events
wallet.on('connect', (publicKey) => {
  connectedWalletAddress = publicKey.toBase58();
  console.log(`Wallet connected: ${connectedWalletAddress}`);
  updateWalletState(connectedWalletAddress);
});

wallet.on('disconnect', () => {
  console.log('Wallet disconnected');
  connectedWalletAddress = null;
  updateWalletState(null);
});

async function onConnectWallet() {
  if (!wallet.connected) {
    try {
      await wallet.connect();
    } catch (error) {
      console.error('Wallet connection failed:', error);
    }
  }
}

export function updateWalletState(address) {
  const btn = document.getElementById('connect-wallet-btn');
  if (btn) {
    if (address) {
      // Display shortened address
      btn.textContent = `${address.slice(0, 4)}...${address.slice(-4)}`;
    } else {
      btn.textContent = 'Connect Wallet';
    }
  }
}

export function initWalletButton() {
  const btn = document.getElementById('connect-wallet-btn');
  if (btn) {
    btn.addEventListener('click', onConnectWallet);
  }
  // Auto-connect if wallet is already connected
  if (wallet.autoConnect) {
     wallet.autoConnect();
  }
}

export function getConnectedWallet() {
    return wallet.connected ? wallet : null;
}

export function getConnectedWalletAddress() {
    return connectedWalletAddress;
}
