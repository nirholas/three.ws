/**
 * Privy wallet integration.
 *
 * Wraps @privy-io/js-sdk-core so users can connect via:
 *   - MetaMask, Coinbase Wallet, WalletConnect, etc.
 *   - Email → Privy embedded wallet (no browser extension needed)
 *   - Social login → embedded wallet
 *
 * Setup:
 *   1. Create a Privy app at https://dashboard.privy.io
 *   2. Set VITE_PRIVY_APP_ID in your .env
 *   3. npm install @privy-io/js-sdk-core
 */

import { BrowserProvider } from 'ethers';

let _privy = null;
let _initPromise = null;

const APP_ID = import.meta.env.VITE_PRIVY_APP_ID || '';

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * Lazily initialize the Privy client. Returns null if no app ID is set.
 */
export async function initPrivy() {
	if (_privy) return _privy;
	if (_initPromise) return _initPromise;
	if (!APP_ID) return null;

	_initPromise = (async () => {
		try {
			const mod = await import('@privy-io/js-sdk-core');
			const PrivyClient = mod.PrivyClient || mod.default;
			_privy = new PrivyClient({ appId: APP_ID });
			return _privy;
		} catch (err) {
			console.warn('[privy] Failed to load — falling back to injected wallet.', err.message);
			_initPromise = null;
			return null;
		}
	})();

	return _initPromise;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Login via Privy — opens the Privy auth modal.
 * Supports email, wallet, and social login methods.
 */
export async function loginWithPrivy() {
	const privy = await initPrivy();
	if (!privy) throw new Error('Privy not configured. Set VITE_PRIVY_APP_ID in .env');
	return privy.login({ loginMethods: ['wallet', 'email', 'google'] });
}

/**
 * Logout from Privy.
 */
export async function logoutPrivy() {
	if (_privy?.logout) await _privy.logout();
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

/**
 * Connect a wallet through Privy and return an ethers-compatible wallet.
 *
 * If the user isn't logged in to Privy yet, opens the login modal first.
 * Then obtains an EIP-1193 provider (either from the user's external wallet
 * or from Privy's embedded wallet) and wraps it in an ethers BrowserProvider.
 *
 * @returns {Promise<{provider: BrowserProvider, signer: import('ethers').Signer, address: string, chainId: number}>}
 */
export async function connectWithPrivy() {
	const privy = await initPrivy();
	if (!privy) throw new Error('Privy not configured. Set VITE_PRIVY_APP_ID in .env');

	// Authenticate if not already
	if (!privy.authenticated && !privy.user) {
		await privy.login({ loginMethods: ['wallet', 'email'] });
	}

	// Get EIP-1193 provider from Privy (works for both embedded + external wallets)
	const eip1193 = await privy.getEthereumProvider();
	if (!eip1193) throw new Error('No wallet available. Please connect a wallet through Privy.');

	const provider = new BrowserProvider(eip1193);
	const signer = await provider.getSigner();
	const address = await signer.getAddress();
	const { chainId } = await provider.getNetwork();

	return { provider, signer, address, chainId: Number(chainId) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @returns {boolean} Whether a Privy app ID is configured. */
export function isPrivyConfigured() {
	return Boolean(APP_ID);
}

/** @returns {object|null} The Privy client instance (null if not initialized). */
export function getPrivy() {
	return _privy;
}
