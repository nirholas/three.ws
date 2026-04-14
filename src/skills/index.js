// Skill registry — loads skill bundles and exposes the ctx API.
// See specs/SKILL_SPEC.md

import { resolveURI } from '../ipfs.js';

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
	constructor({ uri, manifest, instructions, tools, handlers }) {
		this.uri = uri;
		this.manifest = manifest;
		this.name = manifest.name;
		this.version = manifest.version;
		this.instructions = instructions;
		this.tools = tools || [];
		this.handlers = handlers || {};
	}

	async invoke(toolName, args, ctx) {
		const handler = this.handlers[toolName];
		if (!handler) {
			throw new Error(`Skill "${this.name}" has no handler for tool "${toolName}"`);
		}
		const scoped = { ...ctx, skillBaseURI: this.uri };
		return handler(args, scoped);
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

		const [instructions, toolsJSON, handlersMod] = await Promise.all([
			this._fetchText(`${uri}SKILL.md`).catch(() => ''),
			this._fetchJSON(`${uri}tools.json`).catch(() => ({ tools: [] })),
			this._fetchHandlers(`${uri}handlers.js`).catch(() => null),
		]);

		const skill = new Skill({
			uri,
			manifest,
			instructions,
			tools: toolsJSON.tools || [],
			handlers: handlersMod || {},
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
					console.warn(`[skills] tool "${tool.name}" overridden by skill "${skill.name}"`);
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
		return this.all().map((s) => s.systemPromptFragment()).join('');
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
		// Dynamic import the handlers module. Browser-side, this uses the import()
		// intrinsic and respects CORS. For tighter sandboxing, swap in a Realms
		// shim or Workers-based execution in a future version.
		try {
			const mod = await import(/* @vite-ignore */ url);
			return mod;
		} catch (e) {
			console.warn(`[skills] handlers load failed: ${url}`, e);
			return null;
		}
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
