// Launches from the robinhood-feed worker (workers/robinhood-feed), which
// watches every launch venue observed on Robinhood Chain and grades each
// deployer. This is the network boundary: the worker's payload is untrusted, so
// each field is checked before it reaches a caller, and an unreachable worker
// yields an empty list rather than invented launches.

const FEED_URL = process.env.ROBINHOOD_FEED_URL || 'http://localhost:8788';
const TIMEOUT_MS = 3000;
const EVM_ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_RE = /^0x[a-fA-F0-9]{64}$/;
const FLAGS = new Set(['dev_sold', 'serial_exit', 'prior_dev_exit', 'serial_deployer']);

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

/** One worker launch event → the /api/v1/robinhood/launches row shape, or null when unusable. */
export function launchFromFeedEvent(ev) {
	const d = ev?.kind === 'launch' ? ev.data : null;
	if (!d || typeof d !== 'object' || !EVM_ADDR_RE.test(d.mint || '')) return null;
	const dep = d.deployer && typeof d.deployer === 'object' ? d.deployer : null;
	const venue = d.venue && typeof d.venue === 'object' && typeof d.venue.id === 'string' ? d.venue : null;
	const ts = finite(d.timestamp);
	return {
		launchpad: venue?.label || (typeof d.launchpad === 'string' ? d.launchpad : 'Unknown'),
		type: venue?.kind || 'launchpad',
		venue: venue
			? { id: venue.id, label: String(venue.label || venue.id), kind: String(venue.kind || 'launchpad'), address: EVM_ADDR_RE.test(venue.address || '') ? venue.address : null }
			: null,
		token: d.mint,
		deployer: EVM_ADDR_RE.test(d.creator || '') ? d.creator : null,
		deployerRecord: dep
			? {
				priorLaunches: count(dep.prior_launches),
				priorDevExits: count(dep.prior_dev_exits),
				inspected: count(dep.inspected),
				windowBlocks: count(dep.window_blocks),
			}
			: null,
		devSold: typeof d.dev_sold === 'boolean' ? d.dev_sold : null,
		devSoldPct: finite(d.dev_sold_pct),
		flags: Array.isArray(d.flags) ? d.flags.filter((f) => FLAGS.has(f)) : [],
		block: finite(d.block_number) ?? 0,
		txHash: TX_RE.test(d.signature || '') ? d.signature : null,
		timestamp: ts != null ? new Date(ts * 1000).toISOString() : null,
		symbol: typeof d.symbol === 'string' ? d.symbol : null,
		name: typeof d.name === 'string' ? d.name : null,
	};
}

/**
 * Newest launches across every observed venue. Returns [] when the worker does not answer.
 */
export async function recentFeedLaunches({ limit = 40 } = {}) {
	const res = await fetch(`${FEED_URL}/recent?kind=launch&limit=${Math.min(200, limit)}`, {
		headers: { accept: 'application/json' },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	}).catch(() => null);
	if (!res?.ok) return [];
	const body = await res.json().catch(() => null);
	const events = Array.isArray(body?.events) ? body.events : [];
	return events.map(launchFromFeedEvent).filter(Boolean);
}
