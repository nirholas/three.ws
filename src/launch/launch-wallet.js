// Wallet plumbing for /launch: connect + link the wallet to the signed-in
// account, detect Solana transaction v1 support, sign a server-built
// transaction in whichever format it was compiled, broadcast it through the
// same-origin RPC proxy and wait for confirmation.
//
// Signing and sending are split (unlike the onchain SolanaAdapter.signAndSend) because a
// launch needs the signature BEFORE confirmation: a slow confirm must leave the
// page holding the signature so it can finish recording the launch later
// instead of losing track of a coin that did land.

import { Connection, VersionedTransaction } from '@solana/web3.js';
import { getWallets } from '@wallet-standard/app';
import { findV1WalletStandardSigner } from '../onchain/adapters/solana.js';

const RPC_URL = `${typeof window !== 'undefined' ? window.location.origin : 'https://three.ws'}/api/solana-rpc`;

let connection = null;
function rpc() {
	if (!connection) connection = new Connection(RPC_URL, 'confirmed');
	return connection;
}

/** The injected provider the adapter will also pick, for signing v0 transactions. */
export function injectedProvider() {
	if (typeof window === 'undefined') return null;
	if (window.threeWsWallet?.isThreeWs) return window.threeWsWallet;
	if (window.solana?.isThreeWs) return window.solana;
	if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
	if (window.solana?.isPhantom) return window.solana;
	if (window.backpack?.solana) return window.backpack.solana;
	if (window.solflare?.isSolflare) return window.solflare;
	return null;
}

export function walletInstalled() {
	return !!injectedProvider();
}

async function v1SignerFor(address) {
	let signer = findV1WalletStandardSigner(getWallets().get(), address);
	if (signer) return signer;
	// The injected connect does not always populate the Wallet Standard account
	// list. A silent standard:connect on the v1-capable wallets fills it without
	// a second prompt when the site is already approved.
	for (const wallet of getWallets().get()) {
		const v1 = wallet?.features?.['solana:signTransaction']?.supportedTransactionVersions?.includes(1);
		const connect = wallet?.features?.['standard:connect']?.connect;
		if (!v1 || !connect) continue;
		try {
			await connect({ silent: true });
		} catch {
			continue;
		}
		signer = findV1WalletStandardSigner(getWallets().get(), address);
		if (signer) return signer;
	}
	return null;
}

function toBase64(bytes) {
	let out = '';
	for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
	return btoa(out);
}

async function walletIsLinked(address) {
	const res = await fetch('/api/auth/wallets', { credentials: 'include' });
	if (!res.ok) return false;
	const { wallets = [] } = await res.json();
	return wallets.some((w) => w.address === address && w.chain_type === 'solana');
}

/**
 * Link a wallet to the signed-in account with a signed message. This is the
 * account-link endpoint, not SIWS sign-in: SIWS verify replaces the session
 * with the wallet's own account, which would log a creator out of the account
 * that owns their agents. `takeover` moves a wallet another account holds.
 */
export async function linkWallet(address, { takeover = false } = {}) {
	const provider = injectedProvider();
	if (!provider?.signMessage) throw Object.assign(new Error('This wallet cannot sign messages.'), { code: 'NO_PROVIDER' });
	const nonceRes = await fetch('/api/auth/wallets/nonce-solana', {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ address, chainId: 'mainnet' }),
	});
	const nonce = await nonceRes.json().catch(() => ({}));
	if (!nonceRes.ok) throw Object.assign(new Error(nonce.error_description || 'Could not start wallet linking.'), { code: nonce.error });
	let signature;
	try {
		({ signature } = await provider.signMessage(new TextEncoder().encode(nonce.message), 'utf8'));
	} catch (e) {
		throw rejected(e);
	}
	const linkRes = await fetch('/api/auth/wallets/link-solana', {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ message: nonce.message, signature: toBase64(signature), takeover }),
	});
	const link = await linkRes.json().catch(() => ({}));
	if (!linkRes.ok) throw Object.assign(new Error(link.error_description || 'Wallet link failed.'), { code: link.error });
}

/**
 * Connect the browser wallet and make sure it is linked to the signed-in
 * three.ws account (the launch endpoints refuse unlinked signers). A wallet
 * held by another account throws `address_in_use`; the page offers a takeover.
 * @returns {Promise<{ address: string, v1: boolean, name: string }>}
 */
export async function connectLaunchWallet() {
	const provider = injectedProvider();
	if (!provider) throw Object.assign(new Error('No Solana wallet found.'), { code: 'NO_PROVIDER' });
	let address;
	try {
		const resp = await provider.connect();
		address = (resp?.publicKey || provider.publicKey)?.toString();
	} catch (e) {
		throw rejected(e);
	}
	if (!address) throw new Error('Could not read the wallet address.');
	if (!(await walletIsLinked(address))) await linkWallet(address);
	const signer = await v1SignerFor(address);
	const name = signer?.wallet?.name || (provider.isPhantom ? 'Phantom' : provider.isBackpack ? 'Backpack' : provider.isSolflare ? 'Solflare' : 'Wallet');
	return { address, v1: !!signer, name };
}

/** Reconnect silently on page load when the site is already trusted. */
export async function restoreLaunchWallet() {
	const provider = injectedProvider();
	if (!provider?.connect) return null;
	try {
		const resp = await provider.connect({ onlyIfTrusted: true });
		const address = (resp?.publicKey || provider.publicKey)?.toString();
		// An unlinked wallet is left for the Connect button, which runs the link.
		if (!address || !(await walletIsLinked(address))) return null;
		const signer = await v1SignerFor(address);
		return { address, v1: !!signer, name: signer?.wallet?.name || 'Wallet' };
	} catch {
		return null;
	}
}

/**
 * Connect without linking the wallet to an account. Trading on a curve needs only a
 * signature, so a visitor with no three.ws session can still buy and sell.
 * @param {{ silent?: boolean }} [o] silent: reconnect only if the site is already trusted
 * @returns {Promise<{ address: string, name: string } | null>}
 */
export async function connectTradingWallet({ silent = false } = {}) {
	const provider = injectedProvider();
	if (!provider?.connect) {
		if (silent) return null;
		throw Object.assign(new Error('No Solana wallet found.'), { code: 'NO_PROVIDER' });
	}
	try {
		const resp = await provider.connect(silent ? { onlyIfTrusted: true } : undefined);
		const address = (resp?.publicKey || provider.publicKey)?.toString();
		if (!address) return null;
		const name = provider.isPhantom ? 'Phantom' : provider.isBackpack ? 'Backpack' : provider.isSolflare ? 'Solflare' : 'Wallet';
		return { address, name };
	} catch (e) {
		if (silent) return null;
		throw rejected(e);
	}
}

/** Whole-unit balance of `mint` held by `address`, across every token account and either token program. */
export async function tokenBalance(address, mint) {
	const { PublicKey } = await import('@solana/web3.js');
	const { value } = await rpc().getParsedTokenAccountsByOwner(new PublicKey(address), { mint: new PublicKey(mint) }, 'confirmed');
	return value.reduce((sum, a) => sum + (a.account.data.parsed?.info?.tokenAmount?.uiAmount || 0), 0);
}

export async function solBalance(address) {
	const { PublicKey } = await import('@solana/web3.js');
	return (await rpc().getBalance(new PublicKey(address), 'confirmed')) / 1e9;
}

function fromBase64(b64) {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function rejected(e) {
	if (e?.code === 4001 || /reject|denied|cancel/i.test(e?.message || '')) {
		return Object.assign(new Error('Signature cancelled.'), { code: 'USER_REJECTED' });
	}
	return e;
}

/**
 * Sign a server-prepared transaction with the wallet and broadcast it.
 * @param {{ txBase64: string, version: 0|1, address: string }} o
 * @returns {Promise<string>} the transaction signature
 */
export async function signAndBroadcast({ txBase64, version, address }) {
	let raw;
	try {
		if (version === 1) {
			const signer = await v1SignerFor(address);
			if (!signer) {
				throw Object.assign(new Error('This wallet cannot sign Solana transaction v1. Switch the format to v0 or update the wallet.'), {
					code: 'TX_VERSION_UNSUPPORTED',
				});
			}
			const [result] = await signer.feature.signTransaction({
				account: signer.account,
				transaction: fromBase64(txBase64),
				chain: 'solana:mainnet',
				options: { preflightCommitment: 'confirmed' },
			});
			if (!result?.signedTransaction) throw new Error('The wallet returned no signed transaction.');
			raw = result.signedTransaction;
		} else {
			const provider = injectedProvider();
			if (!provider) throw Object.assign(new Error('No Solana wallet found.'), { code: 'NO_PROVIDER' });
			const tx = VersionedTransaction.deserialize(fromBase64(txBase64));
			const signed = await provider.signTransaction(tx);
			raw = signed.serialize();
		}
	} catch (e) {
		throw rejected(e);
	}
	return rpc().sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 });
}

/**
 * Poll until the signature confirms. Resolves true when confirmed, false when
 * the window elapses (it may still land), throws when it failed on-chain.
 */
export async function waitForConfirmation(signature, { timeoutMs = 75_000 } = {}) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { value } = await rpc().getSignatureStatuses([signature], { searchTransactionHistory: true });
		const status = value?.[0];
		if (status?.err) throw Object.assign(new Error(`The transaction failed on-chain: ${JSON.stringify(status.err)}`), { code: 'TX_FAILED' });
		if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return true;
		await new Promise((r) => setTimeout(r, 1_500));
	}
	return false;
}
