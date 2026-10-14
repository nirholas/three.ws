// The six Solana linkage signals in scope (wallet-sleuth also has EVM signals
// such as `evm-deployer`/`gas-funding`; those are out of scope here, Solana
// first). Each signal inspects a pair of collected activity bundles (see
// collect.js) and either finds nothing (`null`) or returns
// `{ id, weight, evidence: [{ kind, signature|account, detail }] }`, the exact
// shape the /api/crypto/linkage endpoint and the noisy-OR scorer (score.js)
// both expect.

const DUST_SOL = 0.001; // below this, a "direct transfer" is noise, not a link
const BURST_WINDOW_S = 24 * 3600;
const BURST_RATIO = 2; // same funder, amounts within 2x of each other count as a burst
const RECENCY_HALF_LIFE_S = 180 * 24 * 3600; // 180 days

// A third-party address that shows up as funder/fee-payer for three or more of
// the addresses under analysis (or sits on the runtime exclusion list) reads
// as a shared exchange/service wallet, not evidence those addresses share a
// controller: the false-positive the work order calls out by name.
function isHubOrExcluded(address, ctx) {
	if (!address) return true;
	if (ctx.exclusions.has(address)) return true;
	if ((ctx.sharedBy.get(address) ?? 0) >= 3) return true;
	return false;
}

export function solanaAccountControl(a, b) {
	const evidence = [];
	if (a.facts.tokenOwner === b.address) {
		evidence.push({ kind: 'token_account_owner', account: a.address, detail: `${a.address} is a token account owned by ${b.address}` });
	}
	if (b.facts.tokenOwner === a.address) {
		evidence.push({ kind: 'token_account_owner', account: b.address, detail: `${b.address} is a token account owned by ${a.address}` });
	}
	if (a.rentPayer === b.address) {
		evidence.push({ kind: 'rent_payer', account: a.address, detail: `${b.address} paid to create ${a.address}` });
	}
	if (b.rentPayer === a.address) {
		evidence.push({ kind: 'rent_payer', account: b.address, detail: `${a.address} paid to create ${b.address}` });
	}
	if (!evidence.length) return null;
	return { id: 'solana-account-control', weight: 1, evidence };
}

export function solanaFeePayer(a, b, ctx) {
	const shared = [...a.payers].filter((p) => b.payers.has(p) && !isHubOrExcluded(p, ctx));
	if (!shared.length) return null;
	return {
		id: 'solana-fee-payer',
		weight: 0.9,
		evidence: shared.map((payer) => ({
			kind: 'shared_fee_payer',
			account: payer,
			detail: `${a.address} and ${b.address} both have transactions signed and paid for by ${payer}`,
		})),
	};
}

export function peerFirstFunding(a, b) {
	const evidence = [];
	if (a.firstInbound?.from === b.address) {
		evidence.push({ kind: 'first_funder', signature: a.firstInbound.signature, detail: `${a.address}'s first inbound transfer came from ${b.address}` });
	}
	if (b.firstInbound?.from === a.address) {
		evidence.push({ kind: 'first_funder', signature: b.firstInbound.signature, detail: `${b.address}'s first inbound transfer came from ${a.address}` });
	}
	if (!evidence.length) return null;
	return { id: 'peer-first-funding', weight: 0.9, evidence };
}

export function commonFirstFunder(a, b, ctx) {
	const fa = a.firstInbound?.from;
	const fb = b.firstInbound?.from;
	if (!fa || !fb || fa !== fb) return null;
	if (fa === a.address || fa === b.address) return null;
	if (isHubOrExcluded(fa, ctx)) return null;
	return {
		id: 'common-first-funder',
		weight: 0.8,
		evidence: [
			{
				kind: 'common_first_funder',
				account: fa,
				signature: a.firstInbound.signature,
				detail: `${a.address} and ${b.address} were both first funded by ${fa}`,
			},
		],
	};
}

export function directTransfer(a, b) {
	const now = Date.now() / 1000;
	const direct = a.transfers.filter(
		(t) => t.amount >= DUST_SOL && ((t.from === a.address && t.to === b.address) || (t.from === b.address && t.to === a.address)),
	);
	if (!direct.length) return null;
	const evidence = direct
		.slice()
		.sort((x, y) => (y.blockTime ?? 0) - (x.blockTime ?? 0))
		.slice(0, 5)
		.map((t) => ({
			kind: 'direct_transfer',
			signature: t.signature,
			detail: `${t.amount} ${t.asset} moved directly from ${t.from} to ${t.to}`,
		}));
	// Recency discount: a transfer from long ago is weaker evidence of a
	// CURRENT shared controller than one from last week.
	const mostRecent = Math.max(...direct.map((t) => t.blockTime ?? 0));
	const ageS = Math.max(0, now - mostRecent);
	const recencyFactor = Math.pow(0.5, ageS / RECENCY_HALF_LIFE_S);
	return { id: 'direct-transfer', weight: 0.75 * Math.max(0.3, recencyFactor), evidence };
}

export function fundingBurst(a, b, ctx) {
	const bFunders = new Map();
	for (const t of b.transfers) {
		if (t.to === b.address && t.from && t.from !== a.address) bFunders.set(t.from, t);
	}
	for (const t of a.transfers) {
		if (t.to !== a.address || !t.from || t.from === b.address) continue;
		const match = bFunders.get(t.from);
		if (!match) continue;
		if (isHubOrExcluded(t.from, ctx)) continue;
		const dt = Math.abs((t.blockTime ?? 0) - (match.blockTime ?? 0));
		if (dt > BURST_WINDOW_S) continue;
		const ratio = t.amount > match.amount ? t.amount / match.amount : match.amount / t.amount;
		if (ratio > BURST_RATIO) continue;
		return {
			id: 'funding-burst',
			weight: 0.6,
			evidence: [
				{
					kind: 'funding_burst',
					account: t.from,
					signature: t.signature,
					detail: `${t.from} funded both ${a.address} (${t.amount} ${t.asset}) and ${b.address} (${match.amount} ${match.asset}) within ${Math.round(dt / 3600)}h`,
				},
			],
		};
	}
	return null;
}

export const ALL_SIGNALS = [solanaAccountControl, solanaFeePayer, peerFirstFunding, commonFirstFunder, directTransfer, fundingBurst];

/**
 * Run every in-scope signal over one address pair. A single signal throwing
 * (a malformed bundle, an unexpected shape) never blocks the others: the
 * noisy-OR scorer degrades gracefully with fewer inputs instead of failing
 * the whole pair.
 */
export function runSignals(a, b, ctx) {
	const results = [];
	for (const signal of ALL_SIGNALS) {
		try {
			const r = signal(a, b, ctx);
			if (r) results.push(r);
		} catch {
			// See docstring above.
		}
	}
	return results;
}
