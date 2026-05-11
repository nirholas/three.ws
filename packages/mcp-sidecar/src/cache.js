// Per-tool TTL in ms. Auth-scoped tools (avatars, models) are excluded — those
// vary by user and should not be shared across sessions.
const TTL = {
	solana_agent_passport: 60_000,
	solana_agent_reputation: 60_000,
	solana_agent_attestations: 30_000,
	pumpfun_token_intel: 30_000,
	pumpfun_creator_intel: 60_000,
	pumpfun_recent_claims: 15_000,
	pumpfun_recent_graduations: 30_000,
	validate_model: 300_000,
	inspect_model: 300_000,
	optimize_model: 300_000,
};

const store = new Map();
let hits = 0;
let misses = 0;

export function getCached(tool, args) {
	const ttl = TTL[tool];
	if (!ttl) return null;
	const key = `${tool}:${JSON.stringify(args)}`;
	const entry = store.get(key);
	if (!entry) { misses++; return null; }
	if (Date.now() > entry.expiresAt) { store.delete(key); misses++; return null; }
	hits++;
	return entry.value;
}

export function setCached(tool, args, value) {
	const ttl = TTL[tool];
	if (!ttl) return;
	const key = `${tool}:${JSON.stringify(args)}`;
	store.set(key, { value, expiresAt: Date.now() + ttl });
}

export function cacheStats() {
	return { hits, misses, size: store.size, hit_rate: hits + misses ? +(hits / (hits + misses)).toFixed(3) : 0 };
}
