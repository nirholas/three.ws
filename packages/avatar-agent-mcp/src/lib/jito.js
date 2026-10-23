// Jito Block Engine helpers.
//
// We submit pre-signed transaction bundles to Jito's mainnet block engine.
// A bundle of 1-5 transactions either all land in the same block or none
// land — atomicity is what enables the launch-and-collect tricks in
// nirholas/atomic (separate funder and creator wallets, leaked-key
// rescues, sniper-resistant launches).
//
// Tip accounts come from ./jito-tip-accounts.js: the live getTipAccounts list
// with a pinned fallback, so a rotation never needs a code change.

import { PublicKey } from '@solana/web3.js';
import { JITO_TIP_ACCOUNTS, randomTipAccountAddress } from './jito-tip-accounts.js';

export const JITO_BUNDLE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

export { JITO_TIP_ACCOUNTS };

export function randomTipAccount() {
	return new PublicKey(randomTipAccountAddress());
}

export async function submitBundle(bs58Txs) {
	const res = await fetch(JITO_BUNDLE_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [bs58Txs] }),
	});
	const body = await res.json().catch(() => ({}));
	if (body.error) {
		const err = new Error(`Jito bundle submit failed: ${JSON.stringify(body.error)}`);
		err.code = 'jito_error';
		err.detail = body.error;
		throw err;
	}
	return {
		bundleId: body.result,
		explorer: `https://explorer.jito.wtf/bundle/${body.result}`,
	};
}

// Poll signature statuses until all are confirmed/failed or the timeout
// elapses. Used after submitting a Jito bundle so callers see a final
// state instead of just the bundle id.
export async function waitForSignatures(connection, signatures, { timeoutMs = 60_000, intervalMs = 2_000 } = {}) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const sigs = await connection.getSignatureStatuses(signatures);
		const all = sigs?.value || [];
		const allConfirmed = all.length === signatures.length
			&& all.every((s) => s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized');
		if (allConfirmed) {
			const anyErr = all.find((s) => s?.err);
			return {
				ok: !anyErr,
				err: anyErr?.err || null,
				statuses: all.map((s) => s?.confirmationStatus || null),
			};
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return { ok: false, err: 'timeout', statuses: null };
}
