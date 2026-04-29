/**
 * PumpfunPaymentsAdapter — frontend facade for the Pump.fun agent-payments-sdk.
 *
 * Two responsibilities:
 *   • Owner side: enableForAgent() — one-time, registers the agent's token to
 *     accept payments. Backend builds the create tx; user signs in Phantom.
 *   • Payer side: payAgent() — creates an invoice intent, builds the
 *     accept-payment tx, user signs and submits.
 *
 * Same prep/sign/submit/confirm shape as the deploy and launch flows. We
 * never trust the wallet's RPC for cluster correctness — Connection is built
 * from the cluster recorded on the agent's payments config.
 */

import { Connection, Transaction, VersionedTransaction } from '@solana/web3.js';
import { getAdapter as getWalletAdapter } from '../adapters/index.js';

const SOLANA_RPC = {
	mainnet: 'https://api.mainnet-beta.solana.com',
	devnet: 'https://api.devnet.solana.com',
};

function decodeTx(b64) {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	try {
		return VersionedTransaction.deserialize(bytes);
	} catch {
		return Transaction.from(bytes);
	}
}

async function waitForConfirmation(conn, sig, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { value } = await conn.getSignatureStatuses([sig]);
		const s = value?.[0];
		if (s) {
			if (s.err) throw new Error(`Tx failed: ${JSON.stringify(s.err)}`);
			if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') return;
		}
		await new Promise((r) => setTimeout(r, 1500));
	}
	throw new Error('Confirmation timed out.');
}

export class PumpfunPaymentsAdapter {
	get provider() {
		return 'pumpfun';
	}

	/**
	 * Owner-side: register the agent's token to accept payments.
	 * Pre: agent.token.mint must exist; caller must own the agent.
	 */
	async enableForAgent({ agent, onProgress = () => {} }) {
		if (!agent?.token?.mint && !agent?.meta?.token?.mint) {
			const e = new Error('Launch the agent token first.');
			e.code = 'PRECONDITION_FAILED';
			throw e;
		}
		const cluster = agent.token?.cluster || agent.meta?.token?.cluster || 'mainnet';
		const wallet = getWalletAdapter('solana');
		if (!wallet.isAvailable()) {
			const e = new Error('No Solana wallet detected.');
			e.code = 'NO_PROVIDER';
			e.installUrl = wallet.installUrl();
			throw e;
		}

		onProgress('connect');
		const { address } = await wallet.connect({ ensureLinked: true, cluster });

		onProgress('prep');
		const prepResp = await fetch('/api/agents/payments/create-prep', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ agent_id: agent.id, wallet_address: address, cluster }),
		});
		if (!prepResp.ok) throw await asError(prepResp, 'create-prep');
		const prep = await prepResp.json();

		onProgress('sign');
		const provider =
			window.phantom?.solana || window.solana || window.backpack?.solana || window.solflare;
		const signed = await provider.signTransaction(decodeTx(prep.tx_base64));

		onProgress('submit');
		const conn = new Connection(SOLANA_RPC[cluster], 'confirmed');
		const sig = await conn.sendRawTransaction(signed.serialize(), {
			preflightCommitment: 'confirmed',
		});
		await waitForConfirmation(conn, sig, 60_000);

		onProgress('confirm');
		const confirmResp = await fetch('/api/agents/payments/create-confirm', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				prep_id: prep.prep_id,
				tx_signature: sig,
				wallet_address: address,
			}),
		});
		if (!confirmResp.ok) throw await asError(confirmResp, 'create-confirm');
		return await confirmResp.json();
	}

	/**
	 * Payer-side: pay an agent. Caller need not own the agent.
	 * @param {{ agent: object, currencyMint: string, amount: string, memo?: string, onProgress?: Function }} opts
	 */
	async payAgent({ agent, currencyMint, amount, memo, onProgress = () => {} }) {
		if (!agent?.payments?.configured && !agent?.meta?.payments?.configured) {
			const e = new Error('This agent has not enabled payments.');
			e.code = 'PRECONDITION_FAILED';
			throw e;
		}
		const cluster =
			agent.payments?.cluster || agent.meta?.payments?.cluster || 'mainnet';

		const wallet = getWalletAdapter('solana');
		if (!wallet.isAvailable()) {
			const e = new Error('No Solana wallet detected.');
			e.code = 'NO_PROVIDER';
			e.installUrl = wallet.installUrl();
			throw e;
		}

		onProgress('connect');
		const { address } = await wallet.connect({ ensureLinked: true, cluster });

		onProgress('prep');
		const prepResp = await fetch('/api/agents/payments/pay-prep', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				agent_id: agent.id,
				currency_mint: currencyMint,
				amount: String(amount),
				memo,
				wallet_address: address,
				cluster,
			}),
		});
		if (!prepResp.ok) throw await asError(prepResp, 'pay-prep');
		const prep = await prepResp.json();

		onProgress('sign');
		const provider =
			window.phantom?.solana || window.solana || window.backpack?.solana || window.solflare;
		const signed = await provider.signTransaction(decodeTx(prep.tx_base64));

		onProgress('submit');
		const conn = new Connection(SOLANA_RPC[cluster], 'confirmed');
		const sig = await conn.sendRawTransaction(signed.serialize(), {
			preflightCommitment: 'confirmed',
		});
		await waitForConfirmation(conn, sig, 60_000);

		onProgress('confirm');
		const confirmResp = await fetch('/api/agents/payments/pay-confirm', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				intent_id: prep.intent_id,
				tx_signature: sig,
				wallet_address: address,
			}),
		});
		if (!confirmResp.ok) throw await asError(confirmResp, 'pay-confirm');
		return { ...(await confirmResp.json()), txSignature: sig, intentId: prep.intent_id };
	}
}

async function asError(resp, where) {
	const data = await resp.json().catch(() => ({}));
	const err = new Error(data.error_description || `${where} returned ${resp.status}`);
	err.status = resp.status;
	err.code = data.error;
	return err;
}
