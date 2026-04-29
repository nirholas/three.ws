/**
 * Solana deploy flow — Metaplex Core NFT minted via the user's wallet.
 *
 * Mirrors the EVM register flow in deploy-button.js but for Solana:
 *   1. POST /api/agents/solana-register-prep    — server builds an unsigned
 *      Metaplex Core createV1 transaction (base64) for `wallet_address`.
 *   2. Phantom (or any compatible Solana wallet) signs and submits the tx.
 *   3. POST /api/agents/solana-register-confirm — server verifies the tx and
 *      upserts the agent_identity row with chain_type='solana'.
 *
 * Wallet must be linked to the user account via SIWS first; the prep endpoint
 * returns 403 otherwise.
 */

import { Connection, Transaction, VersionedTransaction } from '@solana/web3.js';

/** Detect an injected Solana wallet (Phantom / Backpack / Solflare). */
export function detectSolanaWallet() {
	if (typeof window === 'undefined') return null;
	if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
	if (window.solana?.isPhantom) return window.solana;
	if (window.backpack?.solana) return window.backpack.solana;
	if (window.solflare?.isSolflare) return window.solflare;
	return null;
}

const RPC = {
	mainnet: 'https://api.mainnet-beta.solana.com',
	devnet: 'https://api.devnet.solana.com',
};

export function solanaTxExplorerUrl(network, sig) {
	return network === 'devnet'
		? `https://explorer.solana.com/tx/${sig}?cluster=devnet`
		: `https://solscan.io/tx/${sig}`;
}

/** @param {string} b64 */
function decodeBase64Tx(b64) {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	// Server uses Umi's buildAndSign which produces a versioned tx.
	try {
		return VersionedTransaction.deserialize(bytes);
	} catch {
		return Transaction.from(bytes);
	}
}

/**
 * Run the Solana deploy flow end-to-end.
 *
 * @param {object} opts
 * @param {object} opts.agent       Agent record. Required: id, name. Optional: avatarId, description.
 * @param {'mainnet'|'devnet'} opts.network
 * @returns {Promise<{ assetPubkey: string, txSignature: string, network: string, agent: object }>}
 */
export async function runSolanaDeploy({ agent, network }) {
	const wallet = detectSolanaWallet();
	if (!wallet) {
		const err = new Error('No Solana wallet detected. Install Phantom to continue.');
		err.code = 'NO_WALLET';
		throw err;
	}

	const conn = await wallet.connect();
	const walletAddress = (conn?.publicKey || wallet.publicKey)?.toString();
	if (!walletAddress) throw new Error('Could not read Solana wallet address.');

	const prepResp = await fetch('/api/agents/solana-register-prep', {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			name: agent.name || 'Agent',
			description: agent.description || '',
			avatar_id: agent.avatarId || agent.avatar_id,
			wallet_address: walletAddress,
			network,
		}),
	});
	if (!prepResp.ok) {
		const data = await prepResp.json().catch(() => ({}));
		const err = new Error(
			data.error_description || `solana-register-prep returned ${prepResp.status}`,
		);
		err.status = prepResp.status;
		err.code = data.error;
		throw err;
	}
	const prep = await prepResp.json();
	const tx = decodeBase64Tx(prep.tx_base64);

	// Phantom + Backpack expose signAndSendTransaction; Solflare does too.
	const endpoint = RPC[network] || RPC.mainnet;
	let signature;
	if (typeof wallet.signAndSendTransaction === 'function') {
		const res = await wallet.signAndSendTransaction(tx);
		signature = res?.signature || res;
	} else {
		const signed = await wallet.signTransaction(tx);
		const conn2 = new Connection(endpoint, 'confirmed');
		const raw = signed.serialize();
		signature = await conn2.sendRawTransaction(raw);
	}

	// Wait for confirmation before calling the server.
	const conn3 = new Connection(endpoint, 'confirmed');
	await conn3.confirmTransaction(signature, 'confirmed');

	const confirmResp = await fetch('/api/agents/solana-register-confirm', {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			tx_signature: signature,
			asset_pubkey: prep.asset_pubkey,
			wallet_address: walletAddress,
			network,
			name: agent.name,
			description: agent.description || '',
			avatar_id: agent.avatarId || agent.avatar_id,
		}),
	});
	if (!confirmResp.ok) {
		const data = await confirmResp.json().catch(() => ({}));
		const err = new Error(
			data.error_description || `solana-register-confirm returned ${confirmResp.status}`,
		);
		err.status = confirmResp.status;
		err.code = data.error;
		err.txSignature = signature;
		throw err;
	}
	const confirmed = await confirmResp.json();
	return {
		assetPubkey: prep.asset_pubkey,
		txSignature: signature,
		network,
		agent: confirmed.agent,
	};
}
