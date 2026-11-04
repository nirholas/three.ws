// Citizen memory stream: every projected activity becomes an observation scored
// for importance, then retrieved by recency x importance x relevance when the
// citizen reflects or plans. Pure module, no SDK / DB / network imports, so the
// scoring and retrieval are testable and the world loop can call observe() inline.

export const MAX_MEMORIES = 200;
export const MEMORY_TEXT_MAX = 240;
// Summed importance since the last reflection that triggers a new one.
export const REFLECTION_THRESHOLD = 40;
// Recency half-life: a memory's recency weight halves every 6 hours.
export const RECENCY_HALF_LIFE_MS = 6 * 60 * 60 * 1000;

// Base importance (1..10) per projected activity kind. Losses and economic
// closings outrank bookkeeping, so a slash is remembered longer than a move.
const BASE_IMPORTANCE = Object.freeze({
	moved: 1,
	registered: 4,
	claimed_task: 3,
	posted_task: 4,
	hired: 4,
	paid_service: 3,
	vouched: 5,
	completed_task: 6,
	earned: 6,
	slashed: 9,
	reflection: 8,
});

/**
 * Importance of an event on a 1..10 scale. Monotonic: for a fixed kind it never
 * decreases as the reward or the reputation swing grows, and a kind with a higher
 * base never scores below a lower-base kind at equal magnitude.
 */
export function importanceOf(event) {
	const base = BASE_IMPORTANCE[event.kind] ?? 2;
	let bump = 0;
	const atomic = Number(event.amountAtomic);
	if (Number.isFinite(atomic) && atomic > 0) {
		// One point per order of magnitude above 10^6 atomic units, capped at 2.
		bump += Math.min(2, Math.max(0, Math.floor(Math.log10(atomic)) - 5));
	}
	const repDelta = Math.abs(Number(event.repAfter) - Number(event.repBefore));
	if (Number.isFinite(repDelta) && repDelta > 0) bump += Math.min(2, Math.ceil(repDelta / 10));
	return Math.max(1, Math.min(10, base + bump));
}

const tokens = (text) =>
	new Set(
		String(text || '')
			.toLowerCase()
			.split(/[^a-z0-9$]+/)
			.filter((t) => t.length > 2),
	);

/** Share of the query's words that appear in the memory text (0..1). */
export function relevance(queryTokens, text) {
	if (!queryTokens.size) return 0;
	const mem = tokens(text);
	let hit = 0;
	for (const t of queryTokens) if (mem.has(t)) hit++;
	return hit / queryTokens.size;
}

/** Recency weight in (0, 1]: 1 now, 0.5 one half-life ago. */
export function recency(ageMs) {
	return Math.pow(0.5, Math.max(0, ageMs) / RECENCY_HALF_LIFE_MS);
}

export class MemoryStream {
	constructor({ max = MAX_MEMORIES } = {}) {
		this.max = max;
		/** @type {{id:number,at:number,kind:string,text:string,importance:number}[]} */
		this.memories = [];
		this._seq = 0;
		this._sinceReflection = 0;
	}

	/** Record an observation. Returns the stored memory. */
	observe(event, now = Date.now()) {
		const text = String(event.text || event.narrative || '').trim().slice(0, MEMORY_TEXT_MAX);
		if (!text) return null;
		const importance = event.importance ?? importanceOf(event);
		const memory = { id: ++this._seq, at: now, kind: event.kind || 'observation', text, importance };
		this.memories.push(memory);
		if (memory.kind !== 'reflection') this._sinceReflection += importance;
		if (this.memories.length > this.max) {
			// Evict the least valuable memory (lowest importance, oldest first) so a
			// burst of moves cannot push out a slash or a reflection.
			let worst = 0;
			for (let i = 1; i < this.memories.length; i++) {
				const a = this.memories[i];
				const b = this.memories[worst];
				if (a.importance < b.importance || (a.importance === b.importance && a.at < b.at)) worst = i;
			}
			this.memories.splice(worst, 1);
		}
		return memory;
	}

	/** Top-k memories for a query, scored by recency + importance + relevance. */
	retrieve(query, { k = 8, now = Date.now() } = {}) {
		const q = tokens(query);
		return this.memories
			.map((m) => ({
				m,
				score: recency(now - m.at) + m.importance / 10 + relevance(q, m.text),
			}))
			.sort((a, b) => b.score - a.score || b.m.at - a.m.at)
			.slice(0, k)
			.map((x) => x.m);
	}

	/** True when enough importance has accumulated since the last reflection. */
	shouldReflect(threshold = REFLECTION_THRESHOLD) {
		return this._sinceReflection >= threshold;
	}

	markReflected() {
		this._sinceReflection = 0;
	}

	get pendingImportance() {
		return this._sinceReflection;
	}
}
