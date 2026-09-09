// The single canonical "my agent" — one resolved agent record shared by every
// Living-Agents surface, persisted across reloads, broadcast on change via the
// agent bus, and kept consistent across tabs. Defined by the Foundation task and
// treated as a FIXED API by every other feature.
//
// Before this module there were three competing notions of "current avatar":
//   • walk-companion's  `walk:companion:avatar`   (an avatar id)
//   • the /play scenes' `cc-avatar`               (an avatar id / URL / guest)
//   • the guest create flow's staged avatar       (guest-avatar.js / IndexedDB)
// None of them agreed and none emitted events, so the avatar was stateless
// decoration. This module is the source of truth: it reconciles those legacy
// keys (reads them as fallbacks, writes through to them on change so the
// companion and /play stay mirrored) and turns "my agent" into live state.

import { apiFetch } from '../api.js';
import { peek as peekGuestAvatar } from '../guest-avatar.js';
import { agentBus } from './agent-bus.js';

const STORAGE_KEY = 'threews:active-agent';
// Legacy keys we reconcile. We READ them as fallbacks when no active agent is
// set, and WRITE through to them on change so existing readers (walk-companion,
// the /play scenes) follow the canonical agent without code changes on their side.
const LEGACY_WALK_AVATAR = 'walk:companion:avatar';
const LEGACY_CC_AVATAR = 'cc-avatar';

let _record = null; // last resolved agent record (or guest pseudo-record, or null)
let _resolving = null; // in-flight resolve promise (deduped)
const _listeners = new Set();

function readStored(key) {
	try {
		return localStorage.getItem(key) || null;
	} catch {
		return null;
	}
}

function writeStoredId(id) {
	try {
		if (id) localStorage.setItem(STORAGE_KEY, id);
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* storage unavailable (private mode) — in-memory state still works */
	}
}

// Mirror the active agent's avatar into the legacy keys so the site-wide
// companion and the /play worlds render the same avatar the canonical agent uses.
// Best-effort: a missing avatar_id leaves the legacy values untouched.
function writeThroughLegacy(agent) {
	const avatarId = agent?.avatar_id || null;
	if (!avatarId) return;
	try {
		localStorage.setItem(LEGACY_WALK_AVATAR, avatarId);
		localStorage.setItem(LEGACY_CC_AVATAR, avatarId);
	} catch {
		/* storage disabled — companion falls back to its own default */
	}
	// If the live companion is mounted, hot-swap it now instead of waiting for a
	// reload to pick up the new localStorage value.
	try {
		window.__walkCompanion?.setAvatar?.(avatarId);
	} catch {
		/* companion not mounted or rejected the swap — the LS write still lands */
	}
}

function notify() {
	for (const cb of _listeners) {
		try {
			cb(_record);
		} catch (err) {
			console.error('[active-agent] listener threw', err);
		}
	}
	agentBus.emit('agent:changed', {
		agentId: _record?.id || null,
		agent: _record,
		ts: _record?.updated_at || new Date().toISOString(),
	});
}

async function resolveById(id) {
	if (!id) return null;
	const r = await apiFetch(`/api/agents/${encodeURIComponent(id)}`, {
		credentials: 'include',
		allowAnonymous: true,
	});
	if (!r.ok) return null;
	const j = await r.json().catch(() => ({}));
	return j.agent || null;
}

// The legacy keys also hold built-in avatar slugs the walk companion ships with
// ('guide', 'realistic-female'), a model URL, or the guest sentinel. Only a real
// avatar id is a UUID, and /api/agents answers anything else with a 400 that the
// browser logs as a console error on every page the companion mounts on. Check
// the shape here instead of asking the server a question it cannot answer.
const AVATAR_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAvatarId(value) {
	return typeof value === 'string' && AVATAR_ID_RE.test(value.trim());
}

// Find the agent backing a given avatar id — the bridge from the legacy avatar
// keys to a canonical agent record.
async function resolveByAvatarId(avatarId) {
	if (!avatarId) return null;
	const r = await apiFetch(`/api/agents?avatar_id=${encodeURIComponent(avatarId)}`, {
		credentials: 'include',
		allowAnonymous: true,
	});
	if (!r.ok) return null;
	const j = await r.json().catch(() => ({}));
	const list = Array.isArray(j.agents) ? j.agents : [];
	return list[0] || null;
}

// The signed-in user's default/most-recent agent (get-or-create). Returns null
// for guests. This is the "most recently used / first owned agent" default.
async function resolveOwnerDefault() {
	const r = await apiFetch('/api/agents/me', { credentials: 'include', allowAnonymous: true });
	if (!r.ok) return null;
	const j = await r.json().catch(() => ({}));
	return j.agent || null;
}

// A synthetic record for a signed-out guest who has staged an avatar in the
// create flow but has no agent yet. agentId is null; surfaces render the avatar
// and treat it as "not yet an account agent".
function guestRecord() {
	const staged = peekGuestAvatar();
	if (!staged) return null;
	return {
		id: null,
		guest: true,
		name: staged.name || 'Your agent',
		avatar_id: null,
		guest_avatar: staged,
	};
}

// The full resolution chain, in priority order:
//   1. the stored canonical id
//   2. a legacy avatar key (walk / cc) → the agent that backs that avatar
//   3. the signed-in user's default agent (/api/agents/me)
//   4. a staged guest avatar (signed-out)
// On a successful non-guest resolution we persist the id and mirror it into the
// legacy keys, collapsing the three old notions into one.
async function resolveActive() {
	const storedId = readStored(STORAGE_KEY);
	if (storedId) {
		const agent = await resolveById(storedId);
		if (agent) {
			writeThroughLegacy(agent);
			return agent;
		}
		writeStoredId(null); // stale id — drop and fall through to derive a default
	}

	const legacyAvatar = readStored(LEGACY_WALK_AVATAR) || readStored(LEGACY_CC_AVATAR);
	if (isAvatarId(legacyAvatar)) {
		const agent = await resolveByAvatarId(legacyAvatar);
		if (agent) {
			writeStoredId(agent.id);
			writeThroughLegacy(agent);
			return agent;
		}
	}

	const owned = await resolveOwnerDefault();
	if (owned) {
		writeStoredId(owned.id);
		writeThroughLegacy(owned);
		return owned;
	}

	return guestRecord();
}

/**
 * Resolve the active agent record. Reads the stored id (or derives a sensible
 * default), fetches once, and caches. Returns null only when there is no agent
 * AND no staged guest avatar. Pass `{ force: true }` to bypass the cache.
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<Object|null>}
 */
export async function getActiveAgent({ force = false } = {}) {
	if (_record && !force) return _record;
	if (_resolving && !force) return _resolving;
	_resolving = resolveActive()
		.then((agent) => {
			_record = agent;
			return agent;
		})
		.finally(() => {
			_resolving = null;
		});
	return _resolving;
}

/** Force a re-fetch of the active agent and broadcast the refreshed record. */
export async function refreshActiveAgent() {
	const agent = await getActiveAgent({ force: true });
	notify();
	return agent;
}

/** Current cached record without triggering a fetch. */
export function peekActiveAgent() {
	return _record;
}

/**
 * The active agent's id, best-effort and synchronous: the cached record's id, or
 * the stored id. Returns null for a guest or before the first resolve. Use
 * {@link getActiveAgent} when you need the derived default resolved.
 * @returns {string|null}
 */
export function getActiveAgentId() {
	return _record?.id || readStored(STORAGE_KEY);
}

// Back-compat alias — earlier surfaces imported `activeAgentId`.
export const activeAgentId = getActiveAgentId;

/**
 * Set the active agent by id, persist, resolve, mirror to legacy keys, and
 * broadcast. Pass null to clear. Returns the resolved record (or null).
 * @param {string|null} id
 * @returns {Promise<Object|null>}
 */
export async function setActiveAgent(id) {
	if (!id) {
		_record = null;
		writeStoredId(null);
		notify();
		return null;
	}
	writeStoredId(id);
	const agent = await resolveById(id);
	_record = agent;
	if (agent) writeThroughLegacy(agent);
	else writeStoredId(null);
	notify();
	return agent;
}

/**
 * Replace the cached record in place (e.g. after an owner edits their agent) and
 * broadcast. The id must match the active agent, or this is a no-op.
 * @param {Object} patch
 * @returns {Object|null}
 */
export function updateActiveAgent(patch) {
	if (!patch || !_record) return _record;
	if (patch.id && patch.id !== _record.id) return _record;
	_record = { ..._record, ...patch };
	if (patch.avatar_id) writeThroughLegacy(_record);
	notify();
	return _record;
}

/**
 * Subscribe to active-agent changes. Fires on set, refresh, in-place update, and
 * cross-tab storage sync. Returns an unsubscribe function.
 * @param {(agent: Object|null) => void} cb
 * @returns {() => void}
 */
export function onActiveAgentChange(cb) {
	_listeners.add(cb);
	return () => _listeners.delete(cb);
}

// Cross-tab sync: a selection made in one tab reflects in the others. We react to
// the canonical key; the legacy keys are write-through outputs, not inputs.
if (typeof window !== 'undefined') {
	window.addEventListener('storage', (e) => {
		if (e.key !== STORAGE_KEY) return;
		const id = e.newValue || null;
		if (id === (_record?.id || null)) return;
		if (!id) {
			_record = null;
			notify();
		} else {
			resolveById(id).then((agent) => {
				_record = agent;
				if (agent) writeThroughLegacy(agent);
				notify();
			});
		}
	});
}
