/**
 * Decode one PumpFees log notification into a stored row, or null when the
 * entry isn't a GitHub social-fee-PDA claim. Shared by the live listener
 * (index.js) and the RPC backfill (backfill.js) so both paths attribute a
 * claim identically: they call the exact same `attributeGithubClaim` the
 * HTTP route's RPC fallback uses (api/_lib/pump-claims.js), never a
 * re-implementation.
 */

import { isSocialClaimLog, parseSocialFeeClaim } from '../../api/_lib/pump-events.js';
import { attributeGithubClaim, GITHUB_SOCIAL_PLATFORM } from '../../api/_lib/pump-claims.js';

/**
 * Decode a GitHub social-fee-PDA claim out of one transaction's logs, or null
 * when the transaction failed, carries no claim event, or claims a non-GitHub
 * platform.
 * @param {{signature: string, logs?: string[], err?: unknown}} entry
 */
export function decodeClaim(entry) {
	if (!entry || entry.err) return null;
	const logs = entry.logs || [];
	if (!isSocialClaimLog(logs)) return null;
	const claim = parseSocialFeeClaim(logs);
	if (!claim || claim.socialPlatform !== GITHUB_SOCIAL_PLATFORM) return null;
	return claim;
}

/**
 * Decode + attribute one log notification into the shape store.js writes, or
 * null when it isn't a GitHub claim. Never throws: `attributeGithubClaim`
 * already degrades to an unattributed-but-real claim on an RPC hiccup.
 * @param {import('@solana/web3.js').Connection} connection
 * @param {{signature: string, logs?: string[], err?: unknown}} entry
 * @param {{blockTime?: number}} [opts] blockTime from a confirmed signature
 *   (backfill); omitted on the live path, where the claim just happened and
 *   "now" is the accurate timestamp.
 */
export async function processLogEntry(connection, entry, { blockTime } = {}) {
	const claim = decodeClaim(entry);
	if (!claim) return null;
	const ts = blockTime ?? Math.floor(Date.now() / 1000);
	return attributeGithubClaim(connection, claim, entry.signature, ts);
}
