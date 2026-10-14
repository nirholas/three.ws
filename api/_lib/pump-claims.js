/**
 * pump-claims.js
 * --------------
 * On-chain pump.fun creator-fee claim scanning. Shared by the HTTP route
 * (`/api/pump/first-claims`) and the agent-sniper worker's first-claim trigger.
 *
 * A "first claim" is the first time a creator EVER pulls their accrued
 * creator/delegated rewards out of the fee vault — an on-chain, irreversible
 * signal that the creator is live and engaged with the coin. `scanFirstClaims`
 * returns only creators whose earliest observed claim falls inside the window.
 *
 * Sources, in priority order:
 *   1. PUMPFUN_BOT_URL (an indexer) when configured — fast, pre-aggregated.
 *   2. Direct RPC scan of the pump program's recent signatures — always works,
 *      no indexer required.
 *
 * A separate GitHub-fee-claim path (`_fetchGithubClaimsFromRpc`) always runs
 * alongside whichever source above is active: it scans the PumpFees program
 * (`PUMP_FEE_PROGRAM_ID`) for `claim_social_fee_pda` withdrawals, which an
 * indexer built around the main pump program does not see. Each one is
 * attributed to a coin (or left unattributed) by `pump-claims-attribution.js`
 * and checked for impersonation before it is merged into the result.
 */

import bs58 from 'bs58';
import { getConnection } from './pump.js';
import { filterFirstClaims } from '../../src/pump/first-claims.js';
import { PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, WSOL_MINT } from './solana/programs.js';
import {
	isSocialClaimLog,
	parseSocialFeeClaim,
	parseTransactionDistributions,
} from './pump-events.js';
import { evidenceForSocialFeePda, evidenceFromPdaHistory, classifyClaimAttribution, assessImpersonation } from './pump-claims-attribution.js';
import { resolveGithubUserById, resolveCoinGithubContext, resolveSameNameTokens } from './pump-claims-github.js';

const PUMP_PROGRAM = PUMP_PROGRAM_ID;
// Anchor discriminators for the three pump.fun fee-claim instruction variants.
const CLAIM_DISCS = new Set(['e8f5c2eeeada3a59', '7a027f010ebf0caf', 'a537817004b3ca28']);
// Pull a wider lookback so prior claimers are visible and "first" is real.
const LOOKBACK_MULT = 8;
// Quote mints that show up in a claim tx but are never the coin being claimed.
const QUOTE_MINTS = new Set([
	'So11111111111111111111111111111111111111112', // wSOL
	'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
]);

// GitHub platform id in SharingConfig.shareholder.platform (claim_social_fee_pda's `platform` byte).
const GITHUB_SOCIAL_PLATFORM = 2;
// Per-request budget: each candidate can cost one GitHub user lookup, one coin
// metadata fetch, and (lacking same-transaction evidence) up to HISTORY_MAX_TX
// extra RPC calls walking the PDA's history. This is a live HTTP handler, not
// the owner's long-running claim-monitor bot, so the per-scan candidate count
// is bounded tightly; claim instructions are rare enough (per the RPC-fallback
// limits below) that this still covers a normal scan window in practice.
const GITHUB_CLAIMS_BUDGET = 8;
// Ported from the owner's pumpfun-github-claims bot (src/claim-monitor.ts).
const HISTORY_MAX_TX = 40;
const HISTORY_MAX_AGE_SEC = 7 * 86400;

function isSolQuote(quoteMint) {
	return !quoteMint || quoteMint === WSOL_MINT || quoteMint === '11111111111111111111111111111111';
}

/**
 * First-time claimers in [sinceTs, now]. Newest first, capped at `limit`.
 * @param {{ sinceTs: number, limit: number }} opts
 * @returns {Promise<Array<{creator,mint,signature,lamports,ts}>>}
 */
export async function scanFirstClaims({ sinceTs, limit }) {
	const lim = Math.max(1, Math.min(50, limit));
	const lookbackTs =
		sinceTs - Math.max(3600, (Math.floor(Date.now() / 1000) - sinceTs) * LOOKBACK_MULT);
	const [baseClaims, githubClaims] = await Promise.all([
		process.env.PUMPFUN_BOT_URL
			? _fetchFromBot(lookbackTs, lim * LOOKBACK_MULT)
			: _fetchFromRpc(lookbackTs, lim * LOOKBACK_MULT),
		_fetchGithubClaimsFromRpc(lookbackTs),
	]);
	return filterFirstClaims([...baseClaims, ...githubClaims], sinceTs, lim);
}

async function _fetchFromBot(lookbackTs, maxItems) {
	const r = await _botCall('getFirstClaims', { sinceTs: lookbackTs, limit: maxItems });
	if (r.ok) return _normalise(r.data);
	const r2 = await _botCall('getRecentClaims', { limit: maxItems });
	if (r2.ok) return _normalise(r2.data);
	return [];
}

async function _botCall(tool, args) {
	const url = process.env.PUMPFUN_BOT_URL;
	if (!url) return { ok: false };
	const headers = { 'content-type': 'application/json', accept: 'application/json' };
	if (process.env.PUMPFUN_BOT_TOKEN)
		headers.authorization = `Bearer ${process.env.PUMPFUN_BOT_TOKEN}`;
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 8000);
	try {
		const resp = await fetch(url.replace(/\/$/, ''), {
			method: 'POST',
			headers,
			signal: ctrl.signal,
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: tool, arguments: args || {} },
			}),
		});
		if (!resp.ok) return { ok: false, error: `bot ${resp.status}` };
		const j = await resp.json();
		if (j.error) return { ok: false, error: j.error.message || 'rpc error' };
		const data = j.result?.structuredContent ?? j.result?.content ?? j.result;
		return { ok: true, data: Array.isArray(data) ? data : (data?.items ?? []) };
	} catch (err) {
		return { ok: false, error: err?.message || 'fetch failed' };
	} finally {
		clearTimeout(t);
	}
}

function _normalise(items) {
	return (items || [])
		.map((x) => ({
			creator: String(x.claimerWallet || x.creator || x.wallet || ''),
			mint: String(x.tokenMint || x.mint || ''),
			signature: String(x.txSignature || x.tx_signature || x.signature || ''),
			lamports: Number(x.amountLamports || x.lamports || 0),
			ts: Number(x.timestamp || x.ts || 0),
		}))
		.filter((x) => x.creator && x.signature && x.ts > 0);
}

async function _fetchFromRpc(lookbackTs, maxItems) {
	try {
		const connection = getConnection({ network: 'mainnet' });
		const { PublicKey } = await import('@solana/web3.js');
		const sigs = await connection.getSignaturesForAddress(new PublicKey(PUMP_PROGRAM), {
			limit: 200,
		});
		const inWindow = sigs.filter((s) => s.blockTime != null && s.blockTime >= lookbackTs && !s.err);
		if (!inWindow.length) return [];
		const toFetch = inWindow.slice(0, Math.min(30, maxItems * 2));
		const settled = await Promise.allSettled(
			toFetch.map((s) =>
				connection.getParsedTransaction(s.signature, {
					maxSupportedTransactionVersion: 1,
					commitment: 'confirmed',
				}),
			),
		);
		const claims = [];
		for (let i = 0; i < settled.length; i++) {
			if (settled[i].status !== 'fulfilled' || !settled[i].value) continue;
			const claim = _parseClaim(settled[i].value, toFetch[i].signature, toFetch[i].blockTime ?? 0);
			if (claim) claims.push(claim);
		}
		return claims;
	} catch {
		return [];
	}
}

function _parseClaim(tx, signature, ts) {
	if (tx?.meta?.err) return null;
	const ixs = tx?.transaction?.message?.instructions ?? [];
	const accountKeys = tx?.transaction?.message?.accountKeys ?? [];
	const pre = tx?.meta?.preBalances ?? [],
		post = tx?.meta?.postBalances ?? [];
	for (const ix of ixs) {
		if (!ix.data || typeof ix.data !== 'string') continue;
		const progKey = accountKeys[ix.programIdIndex];
		const progId = progKey?.pubkey?.toString?.() ?? String(progKey ?? '');
		if (progId !== PUMP_PROGRAM) continue;
		let bytes;
		try {
			bytes = bs58.decode(ix.data);
		} catch {
			continue;
		}
		if (bytes.length < 8) continue;
		const disc = Buffer.from(bytes.subarray(0, 8)).toString('hex');
		if (!CLAIM_DISCS.has(disc)) continue;
		const creator = accountKeys[0]?.pubkey?.toString?.() ?? String(accountKeys[0] ?? '');
		if (!creator) continue;
		let lamports = 0;
		for (let i = 0; i < accountKeys.length; i++) {
			const delta = (post[i] ?? 0) - (pre[i] ?? 0);
			if (delta > lamports) lamports = delta;
		}
		let mint = '';
		if (disc === 'a537817004b3ca28' && bytes.length >= 48) {
			try {
				mint = bs58.encode(bytes.slice(16, 48));
			} catch {}
		}
		// Fallback: the coin's mint appears in the tx token balances. Skip the
		// quote mints (wSOL/USDC) — the snipe target is the coin, not the quote.
		if (!mint) mint = _mintFromBalances(tx) || '';
		return { creator, mint, signature, lamports, ts };
	}
	return null;
}

function _mintFromBalances(tx) {
	const balances = [
		...(tx?.meta?.postTokenBalances ?? []),
		...(tx?.meta?.preTokenBalances ?? []),
	];
	for (const b of balances) {
		if (b?.mint && !QUOTE_MINTS.has(b.mint)) return b.mint;
	}
	return null;
}

/**
 * GitHub-attributed fee-PDA withdrawals since `lookbackTs`, each already
 * labeled by `pump-claims-attribution.js` and checked for impersonation. One
 * entry per `claim_social_fee_pda` transaction on the PumpFees program whose
 * claimed platform is GitHub (platform id 2); a claim that resolved to no
 * coin at all (see `classifyClaimAttribution`'s `unverified` label) is still
 * included; it just has `mint: ''`, matching the base scanner's shape for an
 * unresolvable coin.
 * @param {number} lookbackTs
 * @returns {Promise<Array>}
 */
async function _fetchGithubClaimsFromRpc(lookbackTs) {
	try {
		const connection = getConnection({ network: 'mainnet' });
		const { PublicKey } = await import('@solana/web3.js');
		const sigs = await connection.getSignaturesForAddress(new PublicKey(PUMP_FEE_PROGRAM_ID), {
			limit: 200,
		});
		const inWindow = sigs.filter((s) => s.blockTime != null && s.blockTime >= lookbackTs && !s.err);
		if (!inWindow.length) return [];

		const out = [];
		for (const s of inWindow) {
			if (out.length >= GITHUB_CLAIMS_BUDGET) break;
			const tx = await connection.getParsedTransaction(s.signature, {
				maxSupportedTransactionVersion: 1,
				commitment: 'confirmed',
			});
			const logs = tx?.meta?.logMessages;
			if (!logs || tx?.meta?.err || !isSocialClaimLog(logs)) continue;
			const claim = parseSocialFeeClaim(logs);
			if (!claim || claim.socialPlatform !== GITHUB_SOCIAL_PLATFORM) continue;
			out.push(await _attributeGithubClaim(connection, claim, s.signature, s.blockTime));
		}
		return out;
	} catch {
		return [];
	}
}

/** Attribute and label one decoded GitHub fee-PDA claim. Never throws. */
async function _attributeGithubClaim(connection, claim, signature, blockTime) {
	const amountClaimedRaw = BigInt(claim.amountClaimedRaw);
	let evidence = null;
	let candidateMintCount = 0;

	try {
		const txLogs = await _logsForSignature(connection, signature);
		const sameTx = evidenceForSocialFeePda(parseTransactionDistributions(txLogs), claim.socialFeePda);
		if (sameTx.length) {
			evidence = sameTx[0];
			candidateMintCount = sameTx.length;
		} else {
			const history = await _pdaHistoryDistributions(connection, claim.socialFeePda, signature, blockTime);
			const historyEvidence = evidenceFromPdaHistory(history, claim.socialFeePda, amountClaimedRaw, claim.quoteMint);
			if (historyEvidence.length) {
				evidence = historyEvidence[0];
				candidateMintCount = 1;
			} else {
				candidateMintCount = new Set(history.map((d) => d.mint)).size;
			}
		}
	} catch {
		// Attribution evidence is best-effort; an RPC failure here still leaves
		// a real, unattributed claim worth reporting rather than dropping it.
	}

	const mint = evidence?.mint || '';
	const [githubUser, coinCtx] = await Promise.all([
		resolveGithubUserById(claim.githubUserId).catch(() => null),
		mint ? resolveCoinGithubContext(mint).catch(() => ({})) : Promise.resolve({}),
	]);

	const classification = classifyClaimAttribution({
		evidence,
		candidateMintCount,
		githubLogin: githubUser?.login || null,
		githubRepoOwner: coinCtx.repoOwner || null,
		claimerWallet: claim.recipient,
		tokenCreatorWallet: coinCtx.creatorWallet || null,
	});

	const sameNameTokens = mint && coinCtx.tokenName ? await resolveSameNameTokens(coinCtx.tokenName, mint).catch(() => []) : [];
	const impersonation = assessImpersonation({
		githubUser,
		tokenInfo: coinCtx.usdMarketCap != null ? { usdMarketCap: coinCtx.usdMarketCap } : null,
		sameNameTokens,
		repoInfo: coinCtx.repoCreatedAt ? { createdAt: coinCtx.repoCreatedAt } : null,
	});

	return {
		creator: claim.recipient,
		mint,
		signature,
		lamports: isSolQuote(claim.quoteMint) ? Number(amountClaimedRaw) : 0,
		ts: blockTime ?? 0,
		source: 'github_fee_claim',
		githubUserId: claim.githubUserId,
		githubLogin: githubUser?.login || null,
		quoteMint: claim.quoteMint || null,
		amountRaw: claim.amountClaimedRaw,
		attribution: classification,
		held: impersonation.suspected,
		heldReasons: impersonation.reasons,
	};
}

async function _logsForSignature(connection, signature) {
	const tx = await connection.getParsedTransaction(signature, {
		maxSupportedTransactionVersion: 1,
		commitment: 'confirmed',
	});
	return tx?.meta?.logMessages || [];
}

/**
 * Every DistributeCreatorFeesEvent paid to `socialFeePda` since its previous
 * claim, oldest work first. Walks the PDA's own signature history backward
 * from just before `beforeSignature`, stopping at whichever bound is hit
 * first: the previous `claim_social_fee_pda` on this PDA, `HISTORY_MAX_TX`
 * transactions, or `HISTORY_MAX_AGE_SEC` of age.
 */
async function _pdaHistoryDistributions(connection, socialFeePda, beforeSignature, claimBlockTime) {
	const { PublicKey } = await import('@solana/web3.js');
	const sigs = await connection.getSignaturesForAddress(new PublicKey(socialFeePda), {
		limit: HISTORY_MAX_TX,
		before: beforeSignature,
	});
	const minTs = (claimBlockTime || Math.floor(Date.now() / 1000)) - HISTORY_MAX_AGE_SEC;
	const distributions = [];
	for (const s of sigs) {
		if (s.err || s.blockTime == null || s.blockTime < minTs) continue;
		const logs = await _logsForSignature(connection, s.signature);
		if (!logs.length) continue;
		if (isSocialClaimLog(logs)) break; // the previous claim on this PDA: stop here
		distributions.push(...parseTransactionDistributions(logs));
	}
	return distributions;
}
