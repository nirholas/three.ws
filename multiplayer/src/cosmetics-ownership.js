// Cosmetic ownership ledger — READER (R22 → R23 bridge, game-server side).
//
// The R22 x402 purchase handler (api/x402/cosmetic-purchase.js → api/_lib/
// cosmetics-ownership.js) records every premium cosmetic an account buys into one
// Upstash Redis SET per account: `cosmetics:owned:<account>`. That writer lives on
// the Vercel side; this is its read-only mirror on the Colyseus game server, so
// the authoritative equip path (WalkRoom) can seed a player's owned set from real
// purchases instead of an empty list. Keep the key prefix and the account
// normalisation byte-for-byte in lockstep with api/_lib/cosmetics-ownership.js —
// the two processes share one Redis, and a drifted key would silently hide a
// player's purchases from the world that's meant to render them.
//
// Same Upstash instance, same env, same lazy-singleton + ping pattern the other
// game-server stores use (playerStore.js, feed.js, presence-store.js) so there's
// no new provider and no extra connection pool churn. Reads FAIL OPEN: if Redis is
// unreachable or unconfigured the player simply owns nothing extra this session —
// the world still renders, free cosmetics still equip — matching how the shop and
// the api-side reader degrade. The purchase side fails CLOSED; only reads degrade.

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

// Lockstep with api/_lib/cosmetics-ownership.js — the SET the x402 handler writes.
const OWNED_PREFIX = 'cosmetics:owned:';
// Lockstep with api/_lib/seasonal-drops.js: the SET a seasonal-drop claim on the
// website writes. Gifts, never purchases: kept apart from OWNED_PREFIX so the
// premium-only purchase merge can stay premium-only.
const GRANTED_PREFIX = 'cosmetics:granted:';

let _redis = null;
let _redisReady = null;

if (REDIS_URL && REDIS_TOKEN) {
	_redisReady = import('@upstash/redis')
		.then(async ({ Redis }) => {
			_redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
			await _redis.ping();
			console.log('[cosmetics-ownership] reading purchased cosmetics from Upstash Redis (verified)');
		})
		.catch((err) => {
			_redis = null;
			console.warn('[cosmetics-ownership] Redis unreachable — purchased cosmetics will read as empty:', err?.message);
		});
} else {
	console.log('[cosmetics-ownership] no UPSTASH_REDIS_REST_URL/_TOKEN — purchased cosmetics read as empty (free cosmetics still equip)');
}

// Account ids must be a Solana wallet (base58) or a guest id like `g_…`/`guest-…`.
// Bound the charset + length so a crafted value can't escape the keyspace. Mirrors
// api/_lib/cosmetics-ownership.js so the same account resolves to the same SET on
// both sides. Returns the trimmed id, or '' when it isn't a usable account id.
export function normalizeAccountId(raw) {
	const id = String(raw ?? '').trim();
	if (id.length < 3 || id.length > 80) return '';
	if (!/^[A-Za-z0-9_:-]+$/.test(id)) return '';
	return id;
}

// The premium cosmetic ids `account` has purchased over the R22 x402 rail. Awaits
// the one-time Redis handshake, then a single SMEMBERS. Degrades to [] on any
// error, when no store is configured, or for an unusable account id — the caller
// (WalkRoom equip authority) then grants only the free cosmetics, never throwing
// on the join hot path.
export async function readOwnedCosmetics(account) {
	const id = normalizeAccountId(account);
	if (!id) return [];
	if (_redisReady) { try { await _redisReady; } catch { /* fell back to memory */ } }
	if (!_redis) return [];
	try {
		const members = await _redis.smembers(OWNED_PREFIX + id);
		return Array.isArray(members) ? members : [];
	} catch (err) {
		console.warn('[cosmetics-ownership] read failed:', err?.message);
		return [];
	}
}

// The cosmetic ids granted to a signed-in site account by a seasonal-drop claim
// (api/seasonal/[id].js). Keyed by the account uid from the verified presence
// ticket, never by a client-asserted id. Same fail-open contract as the
// purchase read above: any error reads as "no gifts this session".
export async function readGrantedCosmetics(accountUid) {
	const uid = normalizeAccountId(accountUid);
	if (!uid) return [];
	if (_redisReady) { try { await _redisReady; } catch { /* fell back to memory */ } }
	if (!_redis) return [];
	try {
		const members = await _redis.smembers(`${GRANTED_PREFIX}u:${uid}`);
		return Array.isArray(members) ? members : [];
	} catch (err) {
		console.warn('[cosmetics-ownership] granted read failed:', err?.message);
		return [];
	}
}
