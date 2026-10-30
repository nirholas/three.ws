// HMAC key for signed purchase receipts. Shared by the signer in
// api/_lib/purchase-confirm.js and api/marketplace/buy-asset.js so both always
// agree. There is deliberately no public fallback: a constant seed (the old
// `SESSION_SECRET || 'dev'`) lets anyone forge a valid receipt signature.

import { createHash } from 'node:crypto';

const MIN_SECRET_LENGTH = 32;

export function resolveReceiptKey() {
	const dedicated = process.env.PURCHASE_RECEIPT_KEY;
	if (dedicated) return dedicated;
	const session = process.env.SESSION_SECRET;
	if (session && session.length >= MIN_SECRET_LENGTH) {
		return createHash('sha256').update(session + ':receipts').digest('hex');
	}
	throw new Error(
		'receipt signing key unavailable: set PURCHASE_RECEIPT_KEY (or a SESSION_SECRET of at least 32 characters)',
	);
}
