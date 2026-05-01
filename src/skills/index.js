// Skill registry — loads skill bundles and exposes the ctx API.
// See specs/SKILL_SPEC.md

import { resolveURI } from '../ipfs.js';
import { getHost } from './sandbox-host.js';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parseFrontmatter(text) {
	const m = text.match(FRONTMATTER_RE);
	if (!m) return { meta: {}, body: text };
	const meta = {};
	for (const line of m[1].split('\n')) {
		const [k, ...rest] = line.split(':');
		if (!k) continue;
		const val = rest.join(':').trim();
		// Handle simple arrays
		if (val.startsWith('-')) continue; // skip, multi-line array
		meta[k.trim()] = val;
	}
	return { meta, body: m[2] };
}

function joinURI(base, rel) {
	if (/^([a-z]+:|\/)/i.test(rel)) return rel;
	if (!base.endsWith('/')) base += '/';
	return base + rel;
}

export class Skill {
	constructor({ uri, manifest, instructions, tools, handlers, handlersSrc }) {
		this.uri = uri;
		this.manifest = manifest;
		this.name = manifest.name;
		this.version = manifest.version;
		this.instructions = instructions;
		this.tools = tools || [];
		// trusted-main-thread: populated from dynamic import; sandbox: populated from handlersSrc
		this.handlers = handlers || {};
		this.handlersSrc = handlersSrc || null;
	}

	async invoke(toolName, args, ctx) {
		const paymentProof = ctx?.agentId
			? await checkPaymentGate(toolName, ctx.agentId)
			: null;
		const scoped = {
			...ctx,
			skillBaseURI: this.uri,
			...(paymentProof && { paymentProof }),
		};

		// Owner-signed skills may opt out of the sandbox via sandboxPolicy: "trusted-main-thread"
		if (this.manifest.sandboxPolicy === 'trusted-main-thread') {
			const handler = this.handlers[toolName];
			if (!handler) {
				throw new Error(`Skill "${this.name}" has no handler for tool "${toolName}"`);
			}
			return handler(args, scoped);
		}

		if (!this.handlersSrc) {
			throw new Error(`Skill "${this.name}" has no handler source for tool "${toolName}"`);
		}
		return getHost().invoke(this.uri, toolName, args, this.handlersSrc, scoped);
	}

	systemPromptFragment() {
		// The LLM sees the skill's markdown body as part of its system context.
		if (!this.instructions) return '';
		return `\n\n<skill name="${this.name}" version="${this.version}">\n${this.instructions}\n</skill>`;
	}
}

export class SkillRegistry {
	constructor({ fetchFn = fetch.bind(globalThis), trust = 'owned-only', ownerAddress } = {}) {
		this.fetchFn = fetchFn;
		this.trust = trust;
		this.ownerAddress = ownerAddress?.toLowerCase();
		this.skills = new Map();
	}

	async install(spec, { bundleBase } = {}) {
		// spec: { uri, version? } — uri may be relative, ipfs://, or https://
		const uri = this._resolveBundleURI(spec.uri, bundleBase);
		if (this.skills.has(uri)) return this.skills.get(uri);

		const manifest = await this._fetchJSON(`${uri}manifest.json`);
		this._enforceTrust(manifest);

		const isTrusted = manifest.sandboxPolicy === 'trusted-main-thread';

		const [instructions, toolsJSON, handlersData] = await Promise.all([
			this._fetchText(`${uri}SKILL.md`).catch(() => ''),
			this._fetchJSON(`${uri}tools.json`).catch(() => ({ tools: [] })),
			isTrusted
				? this._fetchHandlers(`${uri}handlers.js`).catch(() => null)
				: this._fetchHandlersSrc(`${uri}handlers.js`).catch(() => null),
		]);

		const skill = new Skill({
			uri,
			manifest,
			instructions,
			tools: toolsJSON.tools || [],
			handlers: isTrusted ? handlersData || {} : {},
			handlersSrc: isTrusted ? null : handlersData,
		});

		// Recursively install skill dependencies
		if (manifest.dependencies) {
			for (const [depURI, depVer] of Object.entries(manifest.dependencies)) {
				await this.install({ uri: depURI, version: depVer });
			}
		}

		this.skills.set(uri, skill);
		return skill;
	}

	uninstall(name) {
		for (const [uri, skill] of this.skills) {
			if (skill.name === name) {
				this.skills.delete(uri);
				return true;
			}
		}
		return false;
	}

	all() {
		return Array.from(this.skills.values());
	}

	allTools() {
		// Merge tool schemas from all skills. Later skills override earlier on name collision.
		const merged = new Map();
		for (const skill of this.skills.values()) {
			for (const tool of skill.tools) {
				if (merged.has(tool.name)) {
					console.warn(
						`[skills] tool "${tool.name}" overridden by skill "${skill.name}"`,
					);
				}
				merged.set(tool.name, { ...tool, _skill: skill.name });
			}
		}
		return Array.from(merged.values());
	}

	findSkillForTool(toolName) {
		for (const skill of this.skills.values()) {
			if (skill.tools.some((t) => t.name === toolName)) return skill;
		}
		return null;
	}

	systemPrompt() {
		return this.all()
			.map((s) => s.systemPromptFragment())
			.join('');
	}

	_resolveBundleURI(uri, base) {
		let resolved = uri;
		if (!/^([a-z]+:|\/)/i.test(uri) && base) {
			resolved = joinURI(base, uri);
		}
		// Normalize trailing slash
		if (!resolved.endsWith('/')) resolved += '/';
		// Resolve ipfs:// → https gateway
		if (resolved.startsWith('ipfs://') || resolved.startsWith('ar://')) {
			resolved = resolveURI(resolved);
		}
		return resolved;
	}

	async _fetchJSON(url) {
		const res = await this.fetchFn(url);
		if (!res.ok) throw new Error(`Fetch failed: ${url} (${res.status})`);
		return res.json();
	}

	async _fetchText(url) {
		const res = await this.fetchFn(url);
		if (!res.ok) throw new Error(`Fetch failed: ${url} (${res.status})`);
		return res.text();
	}

	async _fetchHandlers(url) {
		// Used only for trusted-main-thread skills — direct import into main thread.
		try {
			const mod = await import(/* @vite-ignore */ url);
			return mod;
		} catch (e) {
			console.warn(`[skills] handlers load failed: ${url}`, e);
			return null;
		}
	}

	async _fetchHandlersSrc(url) {
		// Fetch handler source as text for sandboxed execution in the worker.
		const res = await this.fetchFn(url);
		if (!res.ok) throw new Error(`Fetch failed: ${url} (${res.status})`);
		return res.text();
	}

	_enforceTrust(manifest) {
		if (this.trust === 'any') return;
		if (this.trust === 'owned-only') {
			const author = (manifest.author || '').toLowerCase();
			if (author && this.ownerAddress && author !== this.ownerAddress) {
				throw new Error(
					`Skill "${manifest.name}" author ${author} not trusted under owned-only policy`,
				);
			}
		}
		if (this.trust === 'whitelist') {
			// Whitelist check would consult a configured allowlist; left as hook.
		}
	}
}

// ── Payment gate ──────────────────────────────────────────────────────────────

const KNOWN_MINT_SYMBOLS = {
	'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
	'4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 'USDC',
	'So11111111111111111111111111111111111111112': 'SOL',
};

function mintSymbol(mint) {
	return KNOWN_MINT_SYMBOLS[mint] || `${String(mint).slice(0, 4)}…${String(mint).slice(-4)}`;
}

async function fetchAgentSnippet(agentId) {
	try {
		const r = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { credentials: 'include' });
		if (!r.ok) return {};
		const data = await r.json();
		const payments = data?.agent?.payments || data?.agent?.meta?.payments || data?.payments;
		return { payments, meta: { payments } };
	} catch {
		return {};
	}
}

/**
 * Returns the intentId string if payment was collected, null if the skill is free.
 * Throws (with code=PAYMENT_CANCELLED) if the user dismisses the modal.
 */
async function checkPaymentGate(toolName, agentId) {
	if (typeof document === 'undefined') return null;

	let manifest;
	try {
		const r = await fetch(
			`/api/agents/x402/manifest?agent_id=${encodeURIComponent(agentId)}&skill=${encodeURIComponent(toolName)}`,
			{ credentials: 'include' },
		);
		if (r.status !== 200) return null;
		manifest = await r.json();
		if (manifest?.version !== 'x402/0.1' || manifest?.kind !== 'agent-skill') return null;
	} catch {
		return null;
	}

	const [{ showPaymentGateModal }, { getPaymentsAdapter }, { getAdapter }] = await Promise.all([
		import('../components/payment-gate-modal.jsx'),
		import('../onchain/payments/index.js'),
		import('../onchain/adapters/index.js'),
	]);

	const progressLabels = {
		connect: 'Connecting wallet…',
		prep: 'Building payment…',
		sign: 'Sign in your wallet…',
		submit: 'Submitting…',
		confirm: 'Verifying…',
	};

	return showPaymentGateModal({
		skill: toolName,
		amount: manifest.amount,
		currencySymbol: mintSymbol(manifest.currency),
		chain: 'Solana',
		onPay: async ({ setStatus }) => {
			const wallet = getAdapter('solana');
			if (!wallet.isAvailable()) {
				throw Object.assign(
					new Error('No Solana wallet detected. Please install Phantom or Backpack.'),
					{ code: 'NO_PROVIDER' },
				);
			}
			const agentSnippet = await fetchAgentSnippet(agentId);
			const adapter = getPaymentsAdapter('pumpfun');
			const paid = await adapter.payAgent({
				agent: { id: agentId, ...agentSnippet },
				currencyMint: manifest.currency,
				amount: manifest.amount,
				onProgress: (step) => setStatus(progressLabels[step] || step),
			});
			return paid.intentId;
		},
		onCancel: () => {},
	});
}
