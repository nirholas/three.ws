/**
 * Agent Memory System
 * -------------------
 * Same primitive types as Claude's MEMORY.md pattern — because agents are just JSON too.
 * Stores to localStorage immediately, syncs to backend asynchronously.
 *
 * Memory types:
 *   user       — who the user is, preferences, expertise
 *   feedback   — corrections and confirmations that shape future behaviour
 *   project    — ongoing work context, goals, deadlines
 *   reference  — pointers to external resources
 */

export const MEMORY_TYPES = {
	USER: 'user',
	FEEDBACK: 'feedback',
	PROJECT: 'project',
	REFERENCE: 'reference',
};

/**
 * @typedef {Object} MemoryEntry
 * @property {string}   id
 * @property {string}   type       — MEMORY_TYPES.*
 * @property {string}   content    — the actual memory text
 * @property {string[]} tags
 * @property {Object}   [context]  — freeform metadata
 * @property {number}   salience   — 0-1, how important/recent this memory is
 * @property {number}   createdAt  — timestamp
 * @property {number}   [expiresAt]
 */

export class AgentMemory {
	/**
	 * @param {string} agentId
	 * @param {{ backendSync?: boolean }} [opts]
	 */
	constructor(agentId, { backendSync = false } = {}) {
		this.agentId = agentId;
		this.backendSync = backendSync;
		this._entries = [];
		this._dirty = false;
		this._syncTimer = null;

		this._hydrate();
	}

	// ── CRUD ──────────────────────────────────────────────────────────────────

	/**
	 * Store a new memory entry.
	 * @param {{ type: string, content: string, tags?: string[], context?: Object, expiresAt?: number }} entry
	 * @returns {string} new entry id
	 */
	add(entry) {
		const id = _uuid();
		const now = Date.now();
		const mem = {
			id,
			type: entry.type || MEMORY_TYPES.PROJECT,
			content: String(entry.content).trim(),
			tags: Array.isArray(entry.tags) ? entry.tags : [],
			context: entry.context || {},
			salience: _computeSalience(entry, now),
			createdAt: now,
			expiresAt: entry.expiresAt || null,
		};
		this._entries.push(mem);
		this._scheduleSync(mem);
		return id;
	}

	/**
	 * Query memory entries.
	 * @param {{ type?: string, tags?: string[], limit?: number, since?: number }} [opts]
	 * @returns {MemoryEntry[]}
	 */
	query({ type, tags, limit = 50, since = 0 } = {}) {
		const now = Date.now();
		let results = this._entries.filter((m) => {
			if (m.expiresAt && m.expiresAt < now) return false;
			if (m.createdAt < since) return false;
			if (type && m.type !== type) return false;
			if (tags && tags.length) {
				const hasTags = tags.every((t) => m.tags.includes(t));
				if (!hasTags) return false;
			}
			return true;
		});

		// Sort by salience × recency — most relevant first
		results.sort((a, b) => {
			const scoreA = a.salience * _recencyBoost(a.createdAt, now);
			const scoreB = b.salience * _recencyBoost(b.createdAt, now);
			return scoreB - scoreA;
		});

		return results.slice(0, limit);
	}

	/**
	 * Remove a memory by id.
	 * @param {string} id
	 */
	forget(id) {
		const idx = this._entries.findIndex((m) => m.id === id);
		if (idx !== -1) {
			this._entries.splice(idx, 1);
			this._persist();
			if (this.backendSync) this._syncForget(id);
		}
	}

	/**
	 * Remove all memories of a given type (or all if type omitted).
	 * @param {string} [type]
	 */
	clear(type) {
		if (type) {
			this._entries = this._entries.filter((m) => m.type !== type);
		} else {
			this._entries = [];
		}
		this._persist();
	}

	/** Most recent N entries regardless of type */
	get recentEntries() {
		return this._entries.slice(-20).reverse();
	}

	/** Count by type */
	get stats() {
		const s = {};
		for (const t of Object.values(MEMORY_TYPES)) {
			s[t] = this._entries.filter((m) => m.type === t).length;
		}
		s.total = this._entries.length;
		return s;
	}

	// ── Persistence ──────────────────────────────────────────────────────────

	_storageKey() {
		return `agent_memory_${this.agentId}`;
	}

	_hydrate() {
		try {
			const raw = localStorage.getItem(this._storageKey());
			if (raw) {
				const parsed = JSON.parse(raw);
				this._entries = Array.isArray(parsed) ? parsed : [];
			}
		} catch {
			this._entries = [];
		}

		// Backend sync — hydrate from server (async, non-blocking)
		if (this.backendSync && this.agentId) this._hydrateFromBackend();
	}

	_persist() {
		try {
			localStorage.setItem(this._storageKey(), JSON.stringify(this._entries));
		} catch {
			// localStorage quota exceeded — prune oldest low-salience entries
			this._prune();
			try {
				localStorage.setItem(this._storageKey(), JSON.stringify(this._entries));
			} catch {}
		}
	}

	_prune() {
		// Remove expired, then lowest salience until we're under 150 entries
		const now = Date.now();
		this._entries = this._entries.filter((m) => !m.expiresAt || m.expiresAt > now);
		if (this._entries.length > 150) {
			this._entries.sort((a, b) => b.salience - a.salience);
			this._entries = this._entries.slice(0, 150);
		}
	}

	_scheduleSync(entry) {
		this._persist();
		if (!this.backendSync || !this.agentId) return;
		fetch(`/api/agents/${this.agentId}/memories`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				type: entry.type,
				content: entry.content,
				tags: entry.tags,
				salience: entry.salience,
				expiresAt: entry.expiresAt,
			}),
		}).catch(() => {});
	}

	async _syncForget(id) {
		try {
			await fetch(`/api/agents/${this.agentId}/memories/${id}`, {
				method: 'DELETE',
				credentials: 'include',
			});
		} catch {}
	}

	async _hydrateFromBackend() {
		try {
			const resp = await fetch(`/api/agents/${this.agentId}/memories`, {
				credentials: 'include',
			});
			if (!resp.ok) return;
			const { data } = await resp.json();
			if (!Array.isArray(data)) return;

			const localIds = new Set(this._entries.map((m) => m.id));
			for (const row of data) {
				if (!localIds.has(row.id)) {
					this._entries.push({
						id: row.id,
						type: row.type,
						content: row.content,
						tags: row.tags || [],
						context: {},
						salience: row.salience || 0.5,
						createdAt: new Date(row.created_at).getTime(),
						expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
					});
				}
			}
			this._persist();
		} catch {
			/* Backend unavailable — localStorage data is the fallback */
		}
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _uuid() {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
	});
}

function _computeSalience(entry, now) {
	// Explicit importance flag overrides everything
	if (entry.important) return 1.0;
	// Feedback and user memories are inherently higher salience
	const typeBonus = { feedback: 0.3, user: 0.2, project: 0.1, reference: 0.0 };
	const base = 0.5 + (typeBonus[entry.type] || 0);
	// Tag count slightly boosts salience (more tagged = more deliberate)
	const tagBonus = Math.min((entry.tags?.length || 0) * 0.05, 0.2);
	return Math.min(base + tagBonus, 1.0);
}

function _recencyBoost(createdAt, now) {
	// Exponential decay with 7-day half-life
	const ageMs = now - createdAt;
	const halfLife = 7 * 24 * 60 * 60 * 1000;
	return Math.exp((-0.693 * ageMs) / halfLife);
}
