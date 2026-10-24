// Token due diligence: who holds a mint, and how those holders relate.
//
// A contract-flag report (mint authority, freeze authority, LP lock) says what
// a token CAN do. This module answers the other half: what its holders ARE.
// Everything here is derived from chain data we already read (token accounts,
// signature history, first transactions) plus our own tracked wallet history.
// No third-party wallet labels are scraped or trusted.
//
// Definitions and thresholds live in DD_DEFINITIONS / DD_THRESHOLDS below and
// are mirrored in docs/token-due-diligence.md. Percentages are shares of TOTAL
// supply, the same basis as /api/crypto/holders. Every field is null (never a
// guess) when the data it needs could not be read; `coverage` says why.
//
// Layout:
//   pure   computeDueDiligence / buildFundingGraph / clusterHolders ...
//   io     collectChainData (RPC) + getTokenDueDiligence (cache + smart money)
//          and traceFundingGraph, the two-hop funding trace for one wallet

import { PublicKey } from '@solana/web3.js';
import { solanaRpcEndpoints, makeRotatingFetch } from './solana/connection.js';
import { parseMintAccount } from '../v1/token/security.js';
import { pctOfSupply } from './crypto-token-holders.js';
import { parseFunderFromTransaction } from './pump-intel/enrich.js';
import { mapPoolSettled } from './pool.js';
import { cacheWrap } from './cache.js';

const DOC_BASE = 'https://github.com/nirholas/three.ws/blob/main/docs/token-due-diligence.md';

export const DD_TTL_SECONDS = 300;
export const FUNDING_TTL_SECONDS = 6 * 3600;

export const DD_THRESHOLDS = Object.freeze({
	/** Largest token accounts analysed per mint (the chain returns at most 20). */
	analyze_top: 20,
	/** A holder is a sniper when its first receipt of the token landed within this many slots of launch. */
	sniper_slots: 5,
	/** Holders sharing a funder (or a launch slot) are a bundle from this group size up. */
	bundler_min_group: 2,
	/** Same-slot grouping needs one more wallet, because organic buyers do share busy slots. */
	same_slot_min_group: 3,
	/** Wallets funded by one source within this window of each other form a cluster. */
	funding_window_hours: 6,
	/** A wallet is fresh when its first-ever transaction is under this age at its first token receipt. */
	fresh_wallet_max_age_hours: 24,
	/** Smart money: wallet_reputation.smart_money_score at or above this bar. */
	smart_money_min_score: 65,
	/** A funder whose own history exceeds this many signatures is a service (exchange, router), not a coordinator. */
	service_funder_min_sigs: 2000,
	/** A field is reported only when at least this share of analysed wallet holders yielded the evidence it needs; below it the field is null, not a low number. */
	min_evidence_ratio: 0.5,
});

export const DD_FIELDS = ['insider_pct', 'sniper_pct', 'bundler_pct', 'fresh_wallet_pct', 'fresh_wallet_ratio', 'smart_money_holders', 'smart_money_pct'];

/** Field definitions, mirrored one-to-one in docs/token-due-diligence.md#definitions. */
export const DD_DEFINITIONS = Object.freeze({
	insider_pct: {
		label: 'Insider hold rate',
		unit: 'percent of supply',
		definition:
			'Share of supply held by the creator wallet and by holders linked to it: funded by the creator, funding the creator, or funded from the same non-service source within two hops.',
		doc: DOC_BASE + '#insider_pct',
	},
	sniper_pct: {
		label: 'Sniper share',
		unit: 'percent of supply',
		definition: `Share of supply held by wallets whose first receipt of the token landed within ${DD_THRESHOLDS.sniper_slots} slots of the mint's first transaction. The creator is excluded (counted as an insider).`,
		doc: DOC_BASE + '#sniper_pct',
	},
	bundler_pct: {
		label: 'Bundler exposure',
		unit: 'percent of supply',
		definition: `Share of supply held by wallets in a funding cluster (two or more holders funded by one non-service source within ${DD_THRESHOLDS.funding_window_hours}h, directly or through a shared second hop) or in a launch slot where ${DD_THRESHOLDS.same_slot_min_group} or more holders first received the token.`,
		doc: DOC_BASE + '#bundler_pct',
	},
	fresh_wallet_pct: {
		label: 'Fresh-wallet share',
		unit: 'percent of supply',
		definition: `Share of supply held by wallets whose first-ever transaction was under ${DD_THRESHOLDS.fresh_wallet_max_age_hours}h before they first received the token.`,
		doc: DOC_BASE + '#fresh_wallet_pct',
	},
	fresh_wallet_ratio: {
		label: 'Fresh-wallet ratio',
		unit: 'fraction of analysed wallet holders (0 to 1)',
		definition: 'Fresh wallets divided by analysed wallet holders. Pools and other program-owned holders are not wallets and are excluded from both sides.',
		doc: DOC_BASE + '#fresh_wallet_ratio',
	},
	smart_money_holders: {
		label: 'Smart-money holders',
		unit: 'wallet count',
		definition: `Analysed holders whose own realized history in our tracked data (wallet_reputation.smart_money_score) is at least ${DD_THRESHOLDS.smart_money_min_score}. No third-party labels are used.`,
		doc: DOC_BASE + '#smart_money_holders',
	},
	smart_money_pct: {
		label: 'Smart-money share',
		unit: 'percent of supply',
		definition: 'Share of supply held by the smart-money holders above.',
		doc: DOC_BASE + '#smart_money_pct',
	},
});

const round2 = (n) => Math.round(n * 100) / 100;
const HOUR_S = 3600;
const SYSTEM_PROGRAM = '11111111111111111111111111111111';

/** True when an address is an off-curve PDA (a pool, vault or program account), not a user wallet. */
export function isProgramDerived(address) {
	try {
		return !PublicKey.isOnCurve(new PublicKey(address).toBytes());
	} catch {
		return false;
	}
}

// ── pure computation ─────────────────────────────────────────────────────────

/**
 * Cluster wallet holders that share a funding source.
 * Union-find over (a) the same hop-1 funder and (b) the same hop-2 funder, each
 * only when the members were funded within the window and the shared source is
 * not a high-volume service. Returns Map(owner -> clusterId|null) and the list.
 *
 * @param {Array<{owner:string, funder:string|null, funder_at:number|null, funder2:string|null, funder2_at:number|null}>} wallets
 * @param {Set<string>} services funders classified as services
 */
export function clusterHolders(wallets, services = new Set(), thresholds = DD_THRESHOLDS) {
	const parent = new Map(wallets.map((w) => [w.owner, w.owner]));
	const find = (x) => {
		while (parent.get(x) !== x) {
			parent.set(x, parent.get(parent.get(x)));
			x = parent.get(x);
		}
		return x;
	};
	const union = (a, b) => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent.set(ra, rb);
	};
	const windowS = thresholds.funding_window_hours * HOUR_S;
	const linkBy = (keyOf, atOf) => {
		const groups = new Map();
		for (const w of wallets) {
			const key = keyOf(w);
			if (!key || services.has(key)) continue;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(w);
		}
		for (const members of groups.values()) {
			if (members.length < 2) continue;
			const sorted = [...members].sort((a, b) => (atOf(a) ?? 0) - (atOf(b) ?? 0));
			for (let i = 1; i < sorted.length; i++) {
				const prev = atOf(sorted[i - 1]);
				const cur = atOf(sorted[i]);
				// Unknown funding times cannot be placed in a window; the shared source
				// alone still links them when both are unknown (same-source evidence).
				if (prev == null || cur == null ? prev == null && cur == null : cur - prev <= windowS) union(sorted[i - 1].owner, sorted[i].owner);
			}
		}
	};
	linkBy((w) => w.funder, (w) => w.funder_at);
	linkBy((w) => w.funder2, (w) => w.funder2_at);

	const bySize = new Map();
	for (const w of wallets) {
		const root = find(w.owner);
		if (!bySize.has(root)) bySize.set(root, []);
		bySize.get(root).push(w.owner);
	}
	const clusters = [];
	const clusterOf = new Map(wallets.map((w) => [w.owner, null]));
	for (const members of bySize.values()) {
		if (members.length < thresholds.bundler_min_group) continue;
		const id = clusters.length + 1;
		clusters.push({ id, wallets: members });
		for (const m of members) clusterOf.set(m, id);
	}
	return { clusterOf, clusters };
}

/**
 * Compute the due-diligence fields from collected chain facts. Pure.
 *
 * @param {object} d
 * @param {string} d.mint
 * @param {string|null} d.supplyRaw
 * @param {number|null} d.decimals
 * @param {{slot:number|null, time:number|null, creator:string|null, creator_funder:string|null, creator_funder_at?:number|null}} d.launch
 * @param {Array<{owner:string, token_account:string, amount:string, first_slot:number|null, first_time:number|null,
 *   program_derived:boolean, profile:null|{first_time:number|null, history_complete:boolean, funder:string|null,
 *   funder_at:number|null, funder2:string|null, funder2_at:number|null}}>} d.holders
 * @param {Set<string>} [d.services]
 * @param {Map<string,{smart_money_score:number,label:string|null}>} [d.smart]  owner -> reputation
 * @param {boolean} d.smartAvailable whether the reputation lookup ran
 */
export function computeDueDiligence(d, thresholds = DD_THRESHOLDS) {
	const readErrors = d.readErrors ?? 0;
	const services = d.services || new Set();
	const launchSlot = d.launch?.slot ?? null;
	const creator = d.launch?.creator ?? null;
	const pct = (raw) => pctOfSupply(raw, d.supplyRaw) ?? 0;

	const rows = d.holders.map((h) => ({
		owner: h.owner,
		token_account: h.token_account,
		pct: pct(h.amount),
		kind: h.program_derived ? 'program' : 'wallet',
		first_slot: h.first_slot,
		first_time: h.first_time,
		funder: h.profile?.funder ?? null,
		funder_at: h.profile?.funder_at ?? null,
		funder2: h.profile?.funder2 ?? null,
		funder2_at: h.profile?.funder2_at ?? null,
		profile: h.profile,
		flags: [],
	}));
	const wallets = rows.filter((r) => r.kind === 'wallet');

	// ── clusters (bundlers) ────────────────────────────────────────────────
	const { clusterOf, clusters } = clusterHolders(wallets, services, thresholds);
	const slotGroups = new Map();
	for (const w of wallets) {
		if (w.first_slot == null) continue;
		if (!slotGroups.has(w.first_slot)) slotGroups.set(w.first_slot, []);
		slotGroups.get(w.first_slot).push(w.owner);
	}
	const sameSlot = new Set();
	for (const owners of slotGroups.values()) if (owners.length >= thresholds.same_slot_min_group) owners.forEach((o) => sameSlot.add(o));

	// ── insiders (creator-linked) ──────────────────────────────────────────
	const creatorFunder = d.launch?.creator_funder ?? null;
	const creatorCluster = creator ? clusterOf.get(creator) ?? null : null;
	const linkedToCreator = (w) => {
		if (!creator) return false;
		if (w.owner === creator) return true;
		if (w.funder === creator || w.funder2 === creator) return true;
		if (creatorFunder && !services.has(creatorFunder) && (w.owner === creatorFunder || w.funder === creatorFunder || w.funder2 === creatorFunder)) return true;
		return creatorCluster != null && clusterOf.get(w.owner) === creatorCluster;
	};

	// ── fresh wallets ──────────────────────────────────────────────────────
	const freshS = thresholds.fresh_wallet_max_age_hours * HOUR_S;
	const freshState = (w) => {
		const p = w.profile;
		if (!p || p.first_time == null) return null;
		const at = w.first_time ?? null;
		if (at == null) return null;
		// An incomplete history means the true first transaction is older than the
		// oldest one seen, so the age we can prove is a lower bound.
		const age = at - p.first_time;
		if (age < freshS) return p.history_complete ? true : null;
		return false;
	};

	let unresolvedSniper = 0;
	for (const w of wallets) {
		if (creator && w.owner === creator) w.flags.push('creator');
		if (linkedToCreator(w) && w.owner !== creator) w.flags.push('insider');
		if (launchSlot != null && w.first_slot != null && w.owner !== creator) {
			const delta = w.first_slot - launchSlot;
			if (delta >= 0 && delta <= thresholds.sniper_slots) w.flags.push('sniper');
		} else if (launchSlot != null && w.first_slot == null && w.owner !== creator) {
			unresolvedSniper++;
		}
		if (clusterOf.get(w.owner) != null || sameSlot.has(w.owner)) w.flags.push('bundler');
		const fresh = freshState(w);
		if (fresh === true) w.flags.push('fresh');
		w.fresh = fresh;
		w.cluster = clusterOf.get(w.owner) ?? null;
	}
	for (const r of rows) if (r.kind === 'program') r.flags.push('program');

	const sumPct = (pred) => round2(wallets.filter(pred).reduce((s, w) => s + w.pct, 0));
	const has = (flag) => (w) => w.flags.includes(flag) || (flag === 'insider' && w.flags.includes('creator'));

	// Smart money
	const smart = d.smart || new Map();
	for (const w of wallets) {
		const rep = smart.get(w.owner);
		if (rep && rep.smart_money_score >= thresholds.smart_money_min_score) {
			w.flags.push('smart_money');
			w.smart_money_score = rep.smart_money_score;
			w.label = rep.label ?? null;
		}
	}

	const profiled = wallets.filter((w) => w.profile).length;
	const freshKnown = wallets.filter((w) => w.fresh !== null);
	const slotKnown = wallets.filter((w) => w.first_slot != null).length;
	const launchKnown = launchSlot != null;
	// Evidence floor: a share computed from a handful of readable wallets out of
	// many would print a confident-looking number that is really "unknown".
	const enough = (n) => wallets.length > 0 && n / wallets.length >= thresholds.min_evidence_ratio;
	const sniperOk = launchKnown && enough(slotKnown);
	const linkOk = enough(profiled);
	const freshOk = enough(freshKnown.length);

	const fields = {
		insider_pct: creator && linkOk ? sumPct(has('insider')) : null,
		sniper_pct: sniperOk ? sumPct(has('sniper')) : null,
		bundler_pct: linkOk || (enough(slotKnown) && slotGroups.size > 0) ? sumPct(has('bundler')) : null,
		fresh_wallet_pct: freshOk ? sumPct(has('fresh')) : null,
		fresh_wallet_ratio: freshOk ? round2(freshKnown.filter((w) => w.fresh === true).length / freshKnown.length) : null,
		smart_money_holders: d.smartAvailable ? wallets.filter(has('smart_money')).length : null,
		smart_money_pct: d.smartAvailable ? sumPct(has('smart_money')) : null,
	};

	const notes = [];
	if (!creator) notes.push('creator not resolved: insider hold rate is withheld.');
	if (!launchKnown) notes.push('launch slot not resolved (mint history exceeds the scan window): sniper share is withheld.');
	const floorPct = Math.round(thresholds.min_evidence_ratio * 100);
	if (wallets.length && !sniperOk && launchKnown) notes.push(`sniper share withheld: only ${slotKnown} of ${wallets.length} wallet holders had a readable first receipt (floor ${floorPct}%).`);
	if (wallets.length && !linkOk) notes.push(`insider and bundler fields withheld: only ${profiled} of ${wallets.length} wallet holders had a readable funding history (floor ${floorPct}%).`);
	if (wallets.length && !freshOk) notes.push(`fresh-wallet fields withheld: only ${freshKnown.length} of ${wallets.length} wallet holders could be aged (floor ${floorPct}%).`);
	if (unresolvedSniper > 0 && sniperOk) notes.push(`${unresolvedSniper} holder${unresolvedSniper === 1 ? '' : 's'} had token-account history beyond the scan window and are not counted as snipers.`);
	if (readErrors > 0) notes.push(`${readErrors} chain read${readErrors === 1 ? '' : 's'} failed after retries; the affected holders are reported as unknown, not as clean.`);
	if (!d.smartAvailable) notes.push('smart-money lookup unavailable: smart-money fields are withheld.');
	if (freshOk && freshKnown.length < wallets.length) notes.push(`${wallets.length - freshKnown.length} wallet${wallets.length - freshKnown.length === 1 ? '' : 's'} could not be aged and are excluded from the fresh-wallet fields.`);

	return {
		fields,
		holders: rows.map(({ profile, funder_at, funder2_at, ...r }) => r),
		clusters,
		coverage: {
			holders_analyzed: rows.length,
			wallet_holders: wallets.length,
			wallets_profiled: profiled,
			launch_resolved: launchKnown,
			creator_resolved: Boolean(creator),
			analyzed_pct: round2(rows.reduce((s, r) => s + r.pct, 0)),
			read_errors: readErrors,
		},
		notes,
	};
}

/**
 * Funding graph: holders, their funders (hop 1) and those funders' funders
 * (hop 2) as nodes and edges. Pure. Nodes carry what the renderer sizes and
 * colors by; edges point source (funder) -> target (funded).
 *
 * @param {{ holders: Array<object>, clusters: Array<object> }} dd result of computeDueDiligence
 * @param {{ creator?: string|null, profiles?: Map<string, object>, services?: Set<string> }} ctx
 */
export function buildFundingGraph(dd, ctx = {}) {
	const nodes = new Map();
	const edges = [];
	const services = ctx.services || new Set();
	const creator = ctx.creator || null;
	const node = (id, patch) => {
		const cur = nodes.get(id) || { id, kind: 'source', hop: 2, pct: 0, flags: [], service: services.has(id) };
		const next = { ...cur, ...patch, flags: [...new Set([...(cur.flags || []), ...(patch.flags || [])])] };
		if (patch.hop != null) next.hop = Math.min(cur.hop ?? 9, patch.hop);
		nodes.set(id, next);
	};
	const edge = (source, target, hop, lamports) => {
		if (!source || !target || source === target) return;
		if (!edges.some((e) => e.source === source && e.target === target)) edges.push({ source, target, hop, lamports: lamports ?? null });
	};
	for (const h of dd.holders) {
		node(h.owner, { kind: h.kind === 'program' ? 'program' : 'holder', hop: 0, pct: h.pct, flags: h.flags, cluster: h.cluster ?? null });
		if (h.funder) {
			node(h.funder, { kind: 'funder', hop: 1 });
			edge(h.funder, h.owner, 1);
			if (h.funder2) {
				node(h.funder2, { kind: 'source', hop: 2 });
				edge(h.funder2, h.funder, 2);
			}
		}
	}
	if (creator && !nodes.has(creator)) node(creator, { kind: 'holder', hop: 0, flags: ['creator'] });
	const sorted = [...nodes.values()];
	return { nodes: sorted, edges, clusters: dd.clusters?.length ?? 0 };
}

// ── chain IO ─────────────────────────────────────────────────────────────────

const SIG_PAGE = 1000;
const MAX_SIG_PAGES = 6;
const RPC_TIMEOUT_MS = 20_000;

// Keyless lanes that answer getSignaturesForAddress from a pruned window (a few
// hundred recent signatures) or an empty list for an address that has history.
// A truncated history reads as a complete one and would put a late "first
// transaction" into the report as fact, so signature and transaction reads
// skip them. Keyed archival lanes lead the chain in production; the public
// cluster is the keyless fallback that serves full history.
const PRUNED_HISTORY_HOSTS = /publicnode\.com|solanavibestation\.com|tatum\.(io|com)/;

export function realChainDeps() {
	const all = solanaRpcEndpoints('mainnet');
	const rpcFetch = makeRotatingFetch(all);
	const archival = all.filter((u) => !PRUNED_HISTORY_HOSTS.test(u));
	const historyFetch = makeRotatingFetch(archival.length ? archival : all);
	const call = (fetcher) => async (method, params) => {
		let lastErr;
		for (let attempt = 0; attempt < 3; attempt++) {
			if (attempt) await new Promise((r) => setTimeout(r, 350 * attempt));
			try {
				const resp = await fetcher(null, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
					signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
				});
				const body = await resp.json();
				if (body?.error) throw new Error(`rpc ${method}: ${body.error.message || body.error.code}`);
				return body?.result ?? null;
			} catch (err) {
				lastErr = err;
			}
		}
		throw lastErr;
	};
	return {
		// Retried: the keyless lanes throttle bursts, and a single 429 must not turn
		// a wallet into "unknown" when the next attempt would have answered.
		rpc: call(rpcFetch),
		history: call(historyFetch),
		now: () => Math.floor(Date.now() / 1000),
	};
}

// Every address this module looks up (a mint, a token account holding a
// balance, a wallet that holds or sent funds) has history. Some keyless lanes
// answer a lagging or pruned empty list instead of an error, so an empty FIRST
// page is retried before it is believed.
async function signaturePage(rpc, address, before) {
	const params = [address, { limit: SIG_PAGE, commitment: 'confirmed', ...(before ? { before } : {}) }];
	for (let attempt = 0; attempt < 4; attempt++) {
		if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt));
		const sigs = await rpc('getSignaturesForAddress', params);
		if (Array.isArray(sigs) && (sigs.length || before)) return sigs;
	}
	return [];
}

/**
 * Oldest signature of an address, paging back at most MAX_SIG_PAGES pages.
 * `complete` is true only when the true oldest was reached.
 *
 * With `minSlot`, signatures older than that slot are ignored: a token account
 * cannot receive a mint's tokens before the mint exists, and an address can be
 * pre-funded with SOL by anyone, so earlier signatures are not acquisitions.
 * Paging stops as soon as the window is passed, which also bounds the work for
 * accounts with a long prior history.
 *
 * @returns {Promise<null | { oldest: object, count: number, complete: boolean }>}
 */
export async function oldestSignature(address, rpc, { minSlot = null } = {}) {
	let before;
	let count = 0;
	let oldest = null;
	for (let page = 0; page < MAX_SIG_PAGES; page++) {
		const sigs = await signaturePage(rpc, address, before);
		if (!sigs.length) return oldest ? { oldest, count, complete: true } : null;
		const inWindow = minSlot == null ? sigs : sigs.filter((x) => x.slot >= minSlot);
		if (inWindow.length) {
			count += inWindow.length;
			oldest = inWindow[inWindow.length - 1];
		}
		if (inWindow.length < sigs.length || sigs.length < SIG_PAGE) return oldest ? { oldest, count, complete: true } : null;
		before = sigs[sigs.length - 1].signature;
	}
	return { oldest, count, complete: false };
}

const TX_OPTS = { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' };

/**
 * A wallet's age and its direct funder, from its first transaction.
 * @returns {Promise<{ first_time:number|null, first_slot:number|null, history_complete:boolean, sig_count:number,
 *   funder:string|null, funder_at:number|null, funded_lamports:number|null }>}
 */
export async function walletProfile(address, rpc) {
	const o = await oldestSignature(address, rpc);
	if (!o) return { first_time: null, first_slot: null, history_complete: true, sig_count: 0, funder: null, funder_at: null, funded_lamports: null };
	const base = {
		first_time: o.oldest.blockTime ?? null,
		first_slot: o.oldest.slot ?? null,
		history_complete: o.complete,
		sig_count: o.count,
		funder: null,
		funder_at: null,
		funded_lamports: null,
	};
	// Funder is only defined when the first transaction is the one that funded it.
	if (!o.complete) return base;
	const tx = await rpc('getTransaction', [o.oldest.signature, TX_OPTS]);
	const parsed = parseFunderFromTransaction(tx, address);
	return { ...base, funder: parsed?.funder ?? null, funder_at: parsed ? base.first_time : null, funded_lamports: parsed?.lamports ?? null };
}

const profileMemo = new Map();
async function cachedProfile(address, rpc) {
	const hit = profileMemo.get(address);
	if (hit && Date.now() - hit.at < FUNDING_TTL_SECONDS * 1000) return hit.value;
	const value = await walletProfile(address, rpc);
	profileMemo.set(address, { value, at: Date.now() });
	if (profileMemo.size > 5000) profileMemo.delete(profileMemo.keys().next().value);
	return value;
}

const METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

/**
 * Launch slot and creator. A pump.fun mint appears in every trade, so its own
 * signature history is far too long to page to the start. Its Metaplex metadata
 * account is written at creation and almost never touched again, so that
 * account's oldest transaction IS the launch, and its fee payer is the creator.
 * A mint with no metadata history falls back to its own history.
 */
async function resolveLaunch(mint, history) {
	const pda = PublicKey.findProgramAddressSync(
		[Buffer.from('metadata'), new PublicKey(METADATA_PROGRAM).toBuffer(), new PublicKey(mint).toBuffer()],
		new PublicKey(METADATA_PROGRAM),
	)[0].toBase58();
	let o = await oldestSignature(pda, history);
	if (!o || !o.complete) o = await oldestSignature(mint, history);
	if (!o || !o.complete) return { slot: null, time: null, creator: null };
	const tx = await history('getTransaction', [o.oldest.signature, TX_OPTS]);
	const keys = tx?.transaction?.message?.accountKeys || [];
	const payer = typeof keys[0] === 'string' ? keys[0] : keys[0]?.pubkey;
	return { slot: o.oldest.slot ?? null, time: o.oldest.blockTime ?? null, creator: payer || null };
}

async function largestHolders(mint, rpc, analyzeTop) {
	const largest = await rpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
	const value = largest?.value;
	if (!Array.isArray(value)) throw new Error('getTokenLargestAccounts returned no accounts');
	const top = value.filter((a) => Number(a.amount) > 0).slice(0, analyzeTop);
	const accounts = top.length ? await rpc('getMultipleAccounts', [top.map((a) => a.address), { encoding: 'jsonParsed', commitment: 'confirmed' }]) : { value: [] };
	return top.map((a, i) => ({
		token_account: a.address,
		amount: a.amount,
		owner: accounts?.value?.[i]?.data?.parsed?.info?.owner || null,
	})).filter((h) => h.owner);
}

/**
 * Read everything the computation needs from chain. Each per-holder read is
 * isolated: one failing wallet degrades that wallet, never the whole report.
 */
export async function collectChainData(mint, deps = realChainDeps(), thresholds = DD_THRESHOLDS) {
	const { rpc } = deps;
	const history = deps.history || rpc;
	const mintInfo = parseMintAccount(await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]));
	if (!mintInfo) return { status: 'not_found' };

	let readErrors = 0;
	const launch = await resolveLaunch(mint, history).catch(() => {
		readErrors++;
		return { slot: null, time: null, creator: null };
	});
	const top = await largestHolders(mint, rpc, thresholds.analyze_top);

	// Per holder: first receipt of the token (token-account history) and, for
	// real wallets, the owner's age + funder.
	const holderRows = await mapPoolSettled(top, 3, async (h) => {
		const programDerived = isProgramDerived(h.owner);
		const [acq, profile] = await Promise.all([
			oldestSignature(h.token_account, history, { minSlot: launch.slot }).catch(() => {
				readErrors++;
				return null;
			}),
			programDerived
				? null
				: cachedProfile(h.owner, history).catch(() => {
						readErrors++;
						return null;
					}),
		]);
		return {
			owner: h.owner,
			token_account: h.token_account,
			amount: h.amount,
			program_derived: programDerived,
			first_slot: acq?.complete ? acq.oldest.slot ?? null : null,
			first_time: acq?.complete ? acq.oldest.blockTime ?? null : null,
			profile,
		};
	});
	const holders = holderRows.filter((r) => r.ok).map((r) => r.value);

	// Hop 2: who funded the funders. The creator joins the lookup so insider links resolve.
	const creator = launch.creator;
	const creatorProfile = creator ? holders.find((h) => h.owner === creator)?.profile ?? (await cachedProfile(creator, history).catch(() => null)) : null;
	const funderSet = new Set(holders.map((h) => h.profile?.funder).filter(Boolean));
	if (creatorProfile?.funder) funderSet.add(creatorProfile.funder);
	const funderProfiles = new Map();
	const funderRows = await mapPoolSettled([...funderSet].slice(0, 24), 3, async (f) => [f, await cachedProfile(f, history)]);
	for (const r of funderRows) {
		if (r.ok) funderProfiles.set(r.value[0], r.value[1]);
		else readErrors++;
	}

	const services = new Set();
	for (const [f, p] of funderProfiles) if (!p.history_complete || p.sig_count >= thresholds.service_funder_min_sigs) services.add(f);
	for (const h of holders) {
		if (!h.profile) continue;
		const fp = h.profile.funder ? funderProfiles.get(h.profile.funder) : null;
		h.profile = { ...h.profile, funder2: fp?.funder ?? null, funder2_at: fp?.funder_at ?? null };
	}

	return {
		status: 'ok',
		mint,
		supplyRaw: mintInfo.supply,
		decimals: mintInfo.decimals,
		mint_authority_revoked: mintInfo.mint_authority.revoked,
		freeze_authority_revoked: mintInfo.freeze_authority.revoked,
		launch: { ...launch, creator_funder: creatorProfile?.funder ?? null },
		holders,
		services,
		read_errors: readErrors,
		now: deps.now(),
	};
}

/**
 * Own realized history: wallet_reputation rows (scored from the trades we track)
 * at or above the smart-money bar. Lazy db import so the pure paths stay light.
 */
export async function reputationLookup(owners, minScore = DD_THRESHOLDS.smart_money_min_score) {
	if (!owners.length) return [];
	const { sql } = await import('./db.js');
	return sql`
		select wallet, smart_money_score, label
		from wallet_reputation
		where network = 'mainnet' and wallet = any(${owners}) and smart_money_score >= ${minScore}
	`;
}

async function lookupSmartMoney(owners, lookup) {
	try {
		const rows = await lookup(owners);
		const map = new Map();
		for (const r of rows || []) map.set(r.wallet, { smart_money_score: Number(r.smart_money_score), label: r.label ?? null });
		return { available: true, map };
	} catch (err) {
		console.warn('[token-dd] smart-money lookup failed:', err?.message);
		return { available: false, map: new Map() };
	}
}

/**
 * Compute and return the due-diligence report for a mint (cached per mint).
 *
 * @param {string} mint
 * @param {{ deps?: object, smartLookup?: Function, force?: boolean }} [opts]
 * @returns {Promise<{status:'ok', ...}|{status:'not_found'}|{status:'upstream_down'}>}
 */
export async function getTokenDueDiligence(mint, { deps, smartLookup, force = false } = {}) {
	const compute = async () => {
		let raw;
		try {
			raw = await collectChainData(mint, deps);
		} catch (err) {
			console.warn('[token-dd] chain read failed:', err?.message);
			return { status: 'upstream_down' };
		}
		if (raw.status !== 'ok') return raw;
		const owners = raw.holders.filter((h) => !h.program_derived).map((h) => h.owner);
		const lookup = smartLookup || reputationLookup;
		const smart = await lookupSmartMoney(owners, lookup);
		const dd = computeDueDiligence({ ...raw, readErrors: raw.read_errors, smart: smart.map, smartAvailable: smart.available });
		return {
			status: 'ok',
			mint,
			computed_at: new Date(raw.now * 1000).toISOString(),
			ttl_seconds: DD_TTL_SECONDS,
			supply_raw: raw.supplyRaw,
			decimals: raw.decimals,
			creator: raw.launch.creator,
			launch_slot: raw.launch.slot,
			mint_authority_revoked: raw.mint_authority_revoked,
			freeze_authority_revoked: raw.freeze_authority_revoked,
			...dd,
			graph: buildFundingGraph(dd, { creator: raw.launch.creator, services: raw.services }),
			thresholds: DD_THRESHOLDS,
			definitions: DD_DEFINITIONS,
		};
	};
	if (force) return compute();
	// Only successful reads are cached: cacheWrap stores every non-null value,
	// so an outage verdict must not be pinned for the TTL.
	const key = `token-dd:v1:${mint}`;
	const cached = await cacheWrap(key, DD_TTL_SECONDS, async () => {
		const out = await compute();
		return out.status === 'ok' ? out : { __transient: out };
	});
	return cached?.__transient ?? cached;
}

/**
 * Two-hop funding trace for one wallet: the wallet (hop 0), who funded it
 * (hop 1) and who funded that (hop 2), as nodes and edges ready to render.
 * A funder whose history is too long to reach its first transaction is a
 * service (exchange, router): the trace stops there and says so.
 */
export async function traceFundingGraph(wallet, { deps = realChainDeps(), hops = 2 } = {}) {
	const history = deps.history || deps.rpc;
	const nodes = [];
	const edges = [];
	const seen = new Set();
	let current = wallet;
	let truncated = false;
	for (let hop = 0; current && !seen.has(current); hop++) {
		seen.add(current);
		const node = { id: current, hop, kind: hop === 0 ? 'wallet' : 'funder', first_time: null, history_complete: null, service: false };
		nodes.push(node);
		if (hop >= hops) break;
		const p = await cachedProfile(current, history);
		node.first_time = p.first_time;
		node.history_complete = p.history_complete;
		if (!p.history_complete) {
			node.service = true;
			truncated = true;
			break;
		}
		if (!p.funder) break;
		edges.push({ source: p.funder, target: current, hop: hop + 1, lamports: p.funded_lamports, at: p.funder_at });
		current = p.funder;
	}
	return { wallet, hops, nodes, edges, truncated };
}
