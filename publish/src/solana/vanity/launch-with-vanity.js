/**
 * Vanity-launch helper: grind a vanity mint address client-side, POST it to
 * /api/pump/launch-prep so the unsigned tx is built around the vanity pubkey,
 * then return the prep payload + the locally-held mint keypair for co-signing.
 *
 * The mint secret never leaves the browser.
 *
 * Usage:
 *   const { prep, mintKeypair } = await launchWithVanity({
 *     agentId, walletAddress, name, symbol, uri,
 *     suffix: 'pump',
 *     onProgress: ({ rate, eta }) => console.log(rate, eta),
 *   });
 *   // ...co-sign prep.tx_base64 with both `mintKeypair` and the user wallet,
 *   // submit, then POST /api/pump/launch-confirm with the tx_signature.
 */

import { Keypair } from '@solana/web3.js';
import { grindVanity } from './grinder.js';

/**
 * @param {object} args
 * @param {string} args.agentId
 * @param {string} args.walletAddress
 * @param {string} args.name
 * @param {string} args.symbol
 * @param {string} args.uri
 * @param {'mainnet'|'devnet'} [args.network]
 * @param {number} [args.buybackBps]
 * @param {number} [args.solBuyIn]
 * @param {string} [args.prefix]
 * @param {string} [args.suffix]
 * @param {boolean} [args.ignoreCase]
 * @param {AbortSignal} [args.signal]
 * @param {(p: { attempts: number, rate: number, eta: string }) => void} [args.onProgress]
 * @param {typeof fetch} [args.fetchImpl]
 * @param {string} [args.endpoint='/api/pump/launch-prep']
 * @returns {Promise<{ prep: object, mintKeypair: Keypair }>}
 */
export async function launchWithVanity(args) {
	const { prefix, suffix, ignoreCase, signal, onProgress } = args;
	if (!prefix && !suffix) throw new Error('prefix or suffix required for vanity launch');

	const ground = await grindVanity({ prefix, suffix, ignoreCase, signal, onProgress });
	const mintKeypair = Keypair.fromSecretKey(ground.secretKey);

	const fetchImpl = args.fetchImpl || globalThis.fetch;
	const res = await fetchImpl(args.endpoint || '/api/pump/launch-prep', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			agent_id: args.agentId,
			wallet_address: args.walletAddress,
			name: args.name,
			symbol: args.symbol,
			uri: args.uri,
			network: args.network ?? 'mainnet',
			buyback_bps: args.buybackBps ?? 0,
			sol_buy_in: args.solBuyIn ?? 0,
			mint_address: mintKeypair.publicKey.toBase58(),
		}),
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(`launch-prep failed: ${res.status} ${body.error_description ?? body.error ?? ''}`);
	}
	const prep = await res.json();
	if (prep.mint !== mintKeypair.publicKey.toBase58()) {
		throw new Error('server returned a different mint than the vanity pubkey we sent');
	}
	return { prep, mintKeypair, vanity: { attempts: ground.attempts, durationMs: ground.durationMs, workers: ground.workers } };
}
