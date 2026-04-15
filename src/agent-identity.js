/**
 * Agent Identity
 * --------------
 * Every agent deserves a body, a place, a name, and a history.
 * This module is that. It persists to localStorage + backend,
 * links to an ERC-8004 on-chain presence, and maintains a signed
 * action log — the agent's provenance trail.
 *
 * Think of it as the agent's passport + diary.
 */

import { AgentMemory } from './agent-memory.js';

const STORAGE_KEY = 'agent_identity';

/**
 * @typedef {Object} AgentRecord
 * @property {string}   id
 * @property {string}   name
 * @property {string}   [description]
 * @property {string}   [avatarId]      — R2 avatar UUID
 * @property {string}   [homeUrl]       — /agent/:id
 * @property {string}   [walletAddress]
 * @property {number}   [chainId]
 * @property {string[]} skills          — enabled skill names
 * @property {Object}   meta
 * @property {number}   createdAt
 * @property {boolean}  isRegistered    — ERC-8004 on-chain
 */

export class AgentIdentity {
	/**
	 * @param {{ userId?: string, agentId?: string, autoLoad?: boolean }} [opts]
	 */
	constructor({ userId = null, agentId = null, autoLoad = true } = {}) {
		this.userId  = userId;
		this._record = null;
		this._loaded = false;
		this.memory  = null;

		// Pre-seed agentId from arg or storage so callers can use it synchronously
		this._agentId = agentId || this._readStoredId();

		if (autoLoad) this._loadAsync();
	}

	// ── Public getters ────────────────────────────────────────────────────────

	get id()            { return this._record?.id           || this._agentId; }
	get name()          { return this._record?.name         || 'Agent'; }
	get description()   { return this._record?.description  || ''; }
	get avatarId()      { return this._record?.avatarId     || null; }
	get homeUrl()       { return this._record?.homeUrl      || (this.id ? `/agent/${this.id}` : null); }
	get walletAddress() { return this._record?.walletAddress || null; }
	get chainId()       { return this._record?.chainId      || null; }
	get skills()        { return this._record?.skills       || []; }
	get meta()          { return this._record?.meta         || {}; }
	get isLoaded()      { return this._loaded; }
	get isRegistered()  { return Boolean(this._record?.isRegistered); }

	// ── Load + Save ───────────────────────────────────────────────────────────

	async load() {
		await this._loadAsync();
	}

	async save() {
		if (!this._record) return;
		this._persist();
		try {
			const resp = await fetch(`/api/agents/${this._record.id}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					name:        this._record.name,
					description: this._record.description,
					avatar_id:   this._record.avatarId,
					skills:      this._record.skills,
					meta:        this._record.meta,
				}),
			});
			if (resp.ok) {
				const { agent } = await resp.json();
				this._record = _normalise(agent);
				this._persist();
			}
		} catch { /* localStorage is authoritative */ }
	}

	/**
	 * Update identity fields locally and push to backend.
	 * @param {Partial<AgentRecord>} patch
	 */
	async update(patch) {
		if (!this._record) await this._loadAsync();
		Object.assign(this._record, patch);
		await this.save();
	}

	// ── Wallet ────────────────────────────────────────────────────────────────

	async linkWallet(address, chainId) {
		await this.update({ walletAddress: address, chainId });
		try {
			await fetch(`/api/agents/${this.id}/wallet`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ wallet_address: address, chain_id: chainId }),
			});
		} catch {}
	}

	async unlinkWallet() {
		await this.update({ walletAddress: null, chainId: null });
		try {
			await fetch(`/api/agents/${this.id}/wallet`, {
				method: 'DELETE',
				credentials: 'include',
			});
		} catch {}
	}

	// ── Action History ────────────────────────────────────────────────────────

	/**
	 * Append an action to the agent's signed history.
	 * Fire-and-forget — never blocks the caller.
	 * @param {import('./agent-protocol.js').ActionPayload} action
	 */
	recordAction(action) {
		fetch('/api/agent-actions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				agent_id:     this.id,
				type:         action.type,
				payload:      action.payload,
				source_skill: action.sourceSkill || null,
			}),
		}).catch(() => {}); // non-critical
	}

	/**
	 * Fetch recent actions from backend.
	 * @param {{ limit?: number, cursor?: string }} [opts]
	 * @returns {Promise<Object[]>}
	 */
	async getActionHistory({ limit = 50, cursor } = {}) {
		try {
			const params = new URLSearchParams({ agent_id: this.id, limit: String(limit) });
			if (cursor) params.set('cursor', cursor);
			const resp = await fetch(`/api/agent-actions?${params}`, { credentials: 'include' });
			if (!resp.ok) return [];
			const { actions } = await resp.json();
			return actions || [];
		} catch {
			return [];
		}
	}

	// ── ERC-8004 Registration ────────────────────────────────────────────────

	/**
	 * Register this agent on-chain via the ERC-8004 registry.
	 * @param {File} glbFile
	 * @param {string} apiToken
	 */
	async register(glbFile, apiToken) {
		const { registerAgent } = await import('./erc8004/agent-registry.js');
		const result = await registerAgent(glbFile, apiToken);
		await this.update({ isRegistered: true, meta: { ...this.meta, erc8004: result } });
		return result;
	}

	// ── Internal ──────────────────────────────────────────────────────────────

	async _loadAsync() {
		// 1. Try localStorage first (instant)
		const local = this._readLocal();
		if (local) {
			this._record  = local;
			this._agentId = local.id;
			this._loaded  = true;
			this.memory   = new AgentMemory(local.id, { backendSync: true });
		}

		// 2. Try backend (authoritative if user is signed in)
		try {
			const agentId = this._agentId;
			const url     = agentId ? `/api/agents/${agentId}` : '/api/agents/me';
			const resp    = await fetch(url, { credentials: 'include' });

			if (resp.ok) {
				const { agent } = await resp.json();
				// Server returns { agent: null } for anonymous /me — treat as
				// "no server identity" and fall through to local-only.
				if (agent) {
					this._record  = _normalise(agent);
					this._agentId = this._record.id;
					this._loaded  = true;
					this._persist();
					if (!this.memory) {
						this.memory = new AgentMemory(this._record.id, { backendSync: true });
					}
					return;
				}
			}

			// Any non-2xx or a 2xx with null agent → use local record if we have
			// one, otherwise synthesize a local-only identity. Tolerant of 5xx
			// so a backend blip doesn't brick the avatar for the visitor.
			if (!this._record) {
				this._record  = _makeDefault(this._agentId);
				this._agentId = this._record.id;
				this._loaded  = true;
				this._persist();
				this.memory   = new AgentMemory(this._agentId, { backendSync: false });
			}
		} catch {
			// Offline — use local record if we have one
			if (!this._record) {
				this._record  = _makeDefault(this._agentId);
				this._agentId = this._record.id;
				this._loaded  = true;
				this._persist();
				this.memory   = new AgentMemory(this._agentId, { backendSync: false });
			}
		}
	}

	_readStoredId() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) return JSON.parse(raw).id || null;
		} catch {}
		return null;
	}

	_readLocal() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			return raw ? JSON.parse(raw) : null;
		} catch {
			return null;
		}
	}

	_persist() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this._record));
		} catch {}
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _uuid() {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
		const r = (Math.random() * 16) | 0;
		return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
	});
}

function _makeDefault(existingId) {
	return {
		id:           existingId || _uuid(),
		name:         'Agent',
		description:  'A 3D AI agent',
		avatarId:     null,
		homeUrl:      null,
		walletAddress: null,
		chainId:      null,
		skills:       ['greet', 'present-model', 'validate-model', 'remember', 'think'],
		meta:         {},
		createdAt:    Date.now(),
		isRegistered: false,
	};
}

function _normalise(apiRecord) {
	return {
		id:            apiRecord.id,
		name:          apiRecord.name || 'Agent',
		description:   apiRecord.description || '',
		avatarId:      apiRecord.avatar_id    || apiRecord.avatarId    || null,
		homeUrl:       apiRecord.home_url     || apiRecord.homeUrl     || `/agent/${apiRecord.id}`,
		walletAddress: apiRecord.wallet_address || apiRecord.walletAddress || null,
		chainId:       apiRecord.chain_id      || apiRecord.chainId    || null,
		skills:        apiRecord.skills        || [],
		meta:          apiRecord.meta          || {},
		createdAt:     apiRecord.created_at
			? new Date(apiRecord.created_at).getTime()
			: (apiRecord.createdAt || Date.now()),
		isRegistered:  Boolean(apiRecord.erc8004_agent_id || apiRecord.isRegistered),
	};
}
