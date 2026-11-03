// Which agents /drive offers as the copilot: the signed-in owner's own, else
// the public featured set. The owner list is only requested with a session:
// /api/auth/me answers anonymous callers 200 { user: null }, so a signed-out
// head unit or phone never logs a 401 for a list it cannot have.
import { log } from '../shared/log.js';

async function signedIn(fetchImpl) {
	try {
		const res = await fetchImpl('/api/auth/me', { credentials: 'include' });
		if (!res.ok) return false;
		const j = await res.json();
		return Boolean(j?.user);
	} catch {
		return false;
	}
}

async function ownChoices(fetchImpl) {
	try {
		const mine = await fetchImpl('/api/avatars?limit=24', { credentials: 'include' });
		if (!mine.ok) return null;
		const j = await mine.json();
		return Array.isArray(j?.avatars) && j.avatars.length ? { avatars: j.avatars, owned: true } : null;
	} catch (err) {
		log.warn('[drive] own avatars unavailable:', err?.message);
		return null;
	}
}

export async function listChoices(fetchImpl = fetch) {
	const own = (await signedIn(fetchImpl)) ? await ownChoices(fetchImpl) : null;
	if (own) return own;
	const featured = await fetchImpl('/api/avatars/featured?limit=24');
	if (!featured.ok) throw new Error(`Could not load agents (${featured.status}).`);
	const j = await featured.json();
	return { avatars: j?.avatars || [], owned: false };
}
