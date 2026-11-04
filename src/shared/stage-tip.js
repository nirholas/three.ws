// Living Stages, the $THREE tip, shared by every surface that renders a show.
//
// The /stage page (src/stage.js) and the in-world plaza stage
// (src/game/plaza-stage-show.js) tip the same way: the viewer signs a $THREE
// transfer to the host wallet in their own browser wallet, then the settlement
// signature is recorded through POST /api/stage/tip, which verifies the transfer
// on-chain and is idempotent per signature. Keeping the amounts, the error copy
// and the record-and-retry loop here means the two surfaces cannot drift.

import { apiFetch as defaultApiFetch } from '../api.js';

export const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
export const THREE_DECIMALS = 6;
/** The only amounts a stage offers, in whole $THREE. */
export const TIP_PRESETS = Object.freeze([100, 500, 2000, 10000]);
export const MAX_TIP_MESSAGE = 140;
export const GET_THREE_URL = `https://pump.fun/coin/${THREE_MINT}`;

export function tipStageLabel(s) {
	return {
		connecting: 'Connecting your wallet…',
		building: 'Building the transfer…',
		signing: 'Approve in your wallet…',
		sending: 'Sending on-chain…',
		confirming: 'Confirming settlement…',
	}[s] || 'Working…';
}

/**
 * Turn a tip failure into copy the player can act on.
 * @returns {{ text: string, kind: 'warn'|'bad', action?: { label: string, href: string } }}
 */
export function describeTipError(err) {
	const code = err?.name === 'TipError' ? err.code : '';
	if (code === 'cancelled') return { text: 'Tip cancelled. Nothing was sent.', kind: 'warn' };
	if (code === 'no_wallet') {
		return { text: 'No Solana wallet found. Install Phantom, Backpack or Solflare, then try again.', kind: 'bad' };
	}
	if (code === 'no_balance' || code === 'insufficient') {
		return {
			text: 'Your wallet does not hold enough $THREE for this tip.',
			kind: 'bad',
			action: { label: 'Get $THREE', href: GET_THREE_URL },
		};
	}
	if (code === 'self_tip') return { text: 'That wallet is the host. Pick a different wallet to tip from.', kind: 'bad' };
	if (code === 'timeout') {
		return { text: 'Still waiting on the network. The tip may land shortly, check the leaderboard.', kind: 'warn' };
	}
	return { text: err?.message || 'The tip failed. Try again.', kind: 'bad' };
}

/**
 * Settle one tip and record it. Throws whatever tipAgent throws (a TipError for
 * wallet and balance problems) or an Error from the record call.
 *
 * The server verifies the transfer on-chain before it counts. Our RPC can lag
 * the one that confirmed the transfer by a few seconds, in which case it holds
 * the tip and answers `pending`. The POST is idempotent per signature, so
 * re-posting is the retry.
 *
 * @returns {Promise<{ signature: string, pending: boolean }>}
 */
export async function settleStageTip({
	stageId, hostWallet, amount, message = '', sessionId = null,
	tipAgent, apiFetch = defaultApiFetch, onStage, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
	const settle = await tipAgent({
		toAddress: hostWallet,
		token: 'SPL',
		mint: THREE_MINT,
		decimals: THREE_DECIMALS,
		amount,
		network: 'mainnet',
		noBalanceMsg: 'Your wallet holds no $THREE to tip with.',
		onStage,
	});
	const body = JSON.stringify({
		stageId,
		signature: settle.signature,
		currencyMint: THREE_MINT,
		amount: Math.round(amount * 10 ** THREE_DECIMALS),
		message: String(message).trim().slice(0, MAX_TIP_MESSAGE),
		network: 'solana',
		tipperSession: sessionId,
	});
	const post = async () => {
		const res = await apiFetch('/api/stage/tip', {
			method: 'POST',
			allowAnonymous: true,
			headers: { 'content-type': 'application/json' },
			body,
		});
		const out = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(out.message || out.error || 'could not record tip');
		return out;
	};
	let out = await post();
	for (let attempt = 0; out.pending && attempt < 4; attempt++) {
		onStage?.('confirming');
		await sleep(3000);
		out = await post();
	}
	return { signature: settle.signature, pending: !!out.pending };
}
