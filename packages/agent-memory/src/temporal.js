// Temporal validity helpers. A fact is true over [validFrom, validTo): validFrom
// inclusive, validTo exclusive, validTo null while the fact is still current.
// Pure and dependency-free so the SDK, the benchmark harness and callers that
// hold memories locally all answer "what was true then" the same way.

function toMs(value, label) {
	if (value === null || value === undefined || value === '') return null;
	const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(String(value));
	if (!Number.isFinite(ms)) throw new RangeError(`${label} must be an ISO 8601 date, a Date or epoch milliseconds`);
	return ms;
}

/** Normalize a Date, ISO string or epoch-ms to epoch milliseconds (or null). */
export function toEpochMs(value, label = 'time') {
	return toMs(value, label);
}

/** True when `memory`'s interval contains `at` (default: now). */
export function isValidAt(memory, at = Date.now()) {
	const atMs = toMs(at, 'at') ?? Date.now();
	const from = toMs(memory.validFrom ?? memory.createdAt, 'validFrom');
	const to = toMs(memory.validTo, 'validTo');
	if (from !== null && from > atMs) return false;
	return to === null || to > atMs;
}

/** True when the fact has not been closed or superseded as of `at` (default: now). */
export function isCurrent(memory, at = Date.now()) {
	return isValidAt(memory, at);
}

/** The memories that were true at `at`, in their original order. */
export function asOf(memories, at) {
	return memories.filter((m) => isValidAt(m, at));
}

/** Current versions first, history after; each group keeps its own order. */
export function currentFirst(memories, at = Date.now()) {
	const now = [];
	const past = [];
	for (const m of memories) (isCurrent(m, at) ? now : past).push(m);
	return [...now, ...past];
}

/**
 * Supersede facts in a local list. Returns a new list in which every fact named
 * by `supersedes` has its interval closed at the new fact's validFrom (never
 * before it began) and points at the new fact through `supersededBy`; the new
 * fact is appended with its provenance. Inputs are not mutated.
 *
 * @param {Array<object>} facts
 * @param {{ id: string, content: string, validFrom?: any, sourceRef?: string|null, supersedes?: string[] }} next
 */
export function supersede(facts, next) {
	if (!next || typeof next.id !== 'string' || !next.id) throw new TypeError('supersede() needs a fact with an `id`.');
	const startMs = toMs(next.validFrom, 'validFrom') ?? Date.now();
	const targets = new Set(next.supersedes || []);
	const known = new Set(facts.map((f) => f.id));
	for (const id of targets) {
		if (!known.has(id)) throw new RangeError(`cannot supersede unknown fact ${id}`);
	}
	const closed = facts.map((f) => {
		if (!targets.has(f.id)) return f;
		if (toMs(f.validTo, 'validTo') !== null) throw new RangeError(`fact ${f.id} is already superseded`);
		const began = toMs(f.validFrom ?? f.createdAt, 'validFrom') ?? 0;
		return { ...f, validTo: Math.max(began, startMs), supersededBy: next.id };
	});
	return [
		...closed,
		{
			id: next.id,
			content: next.content,
			validFrom: startMs,
			validTo: null,
			sourceRef: next.sourceRef ?? null,
			supersededBy: null,
		},
	];
}
