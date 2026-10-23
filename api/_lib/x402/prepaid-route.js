// api/_lib/x402/prepaid-route.js
//
// The request path for `paidEndpoint({ mode: 'prepaid' })`. A buyer with a
// prepaid balance proves who they are with a SIGN-IN-WITH-X header (no X-PAYMENT)
// and the call is debited from their balance instead of settled on-chain.
//
// Charge only success. The debit is RESERVED before the handler runs and
// committed only if the handler returns normally and the client is still
// connected. A thrown handler (4xx or 5xx), a 5xx written by the handler itself,
// or a cancelled request is refunded in full, so a failed request is never billed.
//
// A route in this mode stays a normal x402 route: with no usable balance the
// buyer gets the usual 402 challenge and can still pay per call.

import { randomUUID } from 'node:crypto';
import { respondError } from '../http.js';
import { logPaymentEvent } from './audit-log.js';
import { clientIp } from '../rate-limit.js';
import { NETWORK_SOLANA_MAINNET, X402Error, send402 } from '../x402-spec.js';
import {
	commitDebit,
	isLedgerUnavailable,
	refundDebit,
	reserveDebit,
} from './prepaid-ledger.js';
import { USDC_MINT_SOLANA } from './prepaid-chain.js';

export const PREPAID_EXTENSION_KEY = 'prepaid';

/**
 * The accept entry a prepaid debit is priced from: Solana USDC.
 * @param {Array<Record<string, any>>} requirements
 */
export function prepaidRequirement(requirements) {
	return (
		requirements.find(
			(r) =>
				r.network === NETWORK_SOLANA_MAINNET &&
				r.asset === USDC_MINT_SOLANA &&
				r.payTo &&
				/^\d+$/.test(String(r.amount ?? '')),
		) || null
	);
}

/**
 * The `prepaid` extension declared on the 402 body, so a buyer's client can
 * discover where to deposit and what a debit costs.
 * @param {{ requirement: Record<string, any>, origin: string }} args
 */
export function declarePrepaidExtension({ requirement, origin }) {
	return {
		[PREPAID_EXTENSION_KEY]: {
			info: {
				version: '1',
				network: requirement.network,
				asset: requirement.asset,
				amount: String(requirement.amount),
				depositUrl: `${origin}/api/x402-prepaid/deposit`,
				balanceUrl: `${origin}/api/x402-prepaid/balance`,
				auth: 'sign-in-with-x',
			},
		},
	};
}

/**
 * Serve one request from a prepaid balance.
 *
 * @returns {Promise<'served' | 'insufficient' | 'unavailable'>}
 *   `served`: a response was written. `insufficient`: the balance cannot cover
 *   it; the caller re-issues the 402. `unavailable`: the ledger could not be
 *   reached; the caller falls back to the normal per-call challenge.
 */
export async function servePrepaid({
	req,
	res,
	payer,
	requirement,
	route,
	resourceUrl,
	handler,
	challenge,
	mimeType,
	startedAt,
}) {
	const key = { payer, network: requirement.network, asset: requirement.asset };
	let debit;
	try {
		debit = await reserveDebit({
			...key,
			amountAtomics: requirement.amount,
			payee: requirement.payTo,
			route,
			ref: randomUUID(),
		});
	} catch (err) {
		console.error(
			`[x402-prepaid] reserve failed (${isLedgerUnavailable(err) ? 'table_missing' : 'db_unavailable'}):`,
			err?.message || err,
		);
		return 'unavailable';
	}
	if (!debit.ok) return 'insufficient';

	let aborted = false;
	const onClose = () => {
		if (!res.writableEnded) aborted = true;
	};
	req.on?.('close', onClose);

	const refund = async (reason) => {
		try {
			return await refundDebit(debit.entryId, reason);
		} catch (err) {
			// The stale sweep refunds an unresolved reservation, so a failed refund
			// here delays the money back rather than losing it.
			console.error('[x402-prepaid] refund failed, stale sweep will return it:', err?.message || err);
			return null;
		}
	};

	let result;
	try {
		result = await handler({
			req,
			res,
			requirement,
			payer,
			prepaid: { entryId: debit.entryId, balanceAtomics: debit.balanceAtomics },
		});
	} catch (err) {
		req.off?.('close', onClose);
		await refund('handler_error');
		if (err instanceof X402Error && err.status === 402) {
			await send402(res, { ...challenge, error: err.message });
			return 'served';
		}
		respondError(res, err.status || 500, err.code || 'internal_error', err);
		return 'served';
	}
	req.off?.('close', onClose);

	const handlerEnded = res.writableEnded;
	const failedStatus = handlerEnded && res.statusCode >= 400;
	if (aborted || res.destroyed || failedStatus) {
		await refund(aborted || res.destroyed ? 'client_cancelled' : 'handler_error');
		return 'served';
	}

	let committed = false;
	try {
		committed = await commitDebit(debit.entryId);
	} catch (err) {
		console.error('[x402-prepaid] commit failed:', err?.message || err);
	}
	if (!committed) {
		// The reservation was already refunded (stale sweep) or the commit could not
		// be recorded. The buyer is not billed and the call is delivered.
		res.setHeader?.('x-prepaid-charged', '0');
	} else if (!handlerEnded) {
		res.setHeader('x-prepaid-charged', String(requirement.amount));
		res.setHeader('x-prepaid-balance', debit.balanceAtomics.toString());
	}
	if (handlerEnded) return 'served';
	res.setHeader('cache-control', 'no-store');
	res.setHeader('content-type', `${mimeType}; charset=utf-8`);
	res.end(typeof result === 'string' ? result : JSON.stringify(result));
	logPaymentEvent({
		eventType: 'prepaid_debit',
		route,
		resourceUrl,
		payer,
		network: requirement.network,
		durationMs: Date.now() - startedAt,
		ipAddress: clientIp(req),
		userAgent: req.headers?.['user-agent']?.slice(0, 512) || null,
		metadata: { amountAtomics: String(requirement.amount), committed },
	});
	return 'served';
}
