// Plugin registry — load JSON plugin manifests, bridge to LLM tool system.
// Manifest format: { schema_version: "plugin/1.0", identifier, meta, api[], settings[], system_role }
// Compatible with LobeHub plugin manifest v1 (superset).

const STORAGE_KEY = 'installed_plugins_v1';

// ── Validation ────────────────────────────────────────────────────────────────

export function validatePluginManifest(json) {
	if (!json || typeof json !== 'object') throw new Error('Plugin manifest must be a JSON object');
	if (!json.schema_version?.startsWith('plugin/'))
		throw new Error('Missing or invalid schema_version — expected "plugin/1.x"');
	if (!json.identifier || typeof json.identifier !== 'string')
		throw new Error('Plugin manifest missing required field: identifier');
	if (!json.meta?.title) throw new Error('Plugin manifest missing meta.title');
	if (!Array.isArray(json.api) || json.api.length === 0)
		throw new Error('Plugin manifest must declare at least one api tool');
	for (const tool of json.api) {
		if (!tool.name || !tool.description)
			throw new Error(`Plugin tool "${tool.name || '?'}" missing name or description`);
	}
	return true;
}

export async function fetchPluginManifest(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Manifest fetch failed: ${url} (${res.status})`);
	const ct = res.headers.get('content-type') || '';
	if (!ct.includes('json') && !ct.includes('octet'))
		throw new Error(`Expected JSON response from ${url}, got ${ct}`);
	const json = await res.json();
	validatePluginManifest(json);
	return { ...json, _manifest_url: url };
}

// ── PluginRegistry ────────────────────────────────────────────────────────────

export class PluginRegistry {
	constructor() {
		this._plugins = new Map(); // identifier → manifest
		this._loadFromStorage();
	}

	_loadFromStorage() {
		try {
			const raw =
				typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
			if (!raw) return;
			for (const p of JSON.parse(raw)) this._plugins.set(p.identifier, p);
		} catch {
			// ignore corrupt storage
		}
	}

	_saveToStorage() {
		try {
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(this.list()));
			}
		} catch {
			// storage full or unavailable
		}
	}

	/** Install from a URL string or a pre-fetched manifest object. */
	async install(urlOrManifest) {
		const manifest =
			typeof urlOrManifest === 'string'
				? await fetchPluginManifest(urlOrManifest)
				: urlOrManifest;
		validatePluginManifest(manifest);
		this._plugins.set(manifest.identifier, manifest);
		this._saveToStorage();
		return manifest;
	}

	uninstall(identifier) {
		const had = this._plugins.delete(identifier);
		if (had) this._saveToStorage();
		return had;
	}

	isInstalled(identifier) {
		return this._plugins.has(identifier);
	}

	get(identifier) {
		return this._plugins.get(identifier) ?? null;
	}

	list() {
		return Array.from(this._plugins.values());
	}

	// ── LLM integration ───────────────────────────────────────────────────────

	/**
	 * Convert installed plugin tools to the Anthropic tool format so the LLM
	 * can call them alongside built-in tools.
	 */
	toClaudeTools() {
		const tools = [];
		for (const plugin of this._plugins.values()) {
			for (const api of plugin.api) {
				tools.push({
					name: api.name,
					description: `[${plugin.meta.title}] ${api.description}`,
					input_schema: api.parameters ?? { type: 'object', properties: {} },
					// private routing fields (stripped before sending to Anthropic)
					_plugin: plugin.identifier,
					_url: api.url ?? null,
					_method: (api.method ?? 'POST').toUpperCase(),
				});
			}
		}
		return tools;
	}

	/** System prompt fragments injected for installed plugins. */
	systemPrompt() {
		const parts = [];
		for (const plugin of this._plugins.values()) {
			if (plugin.system_role) {
				parts.push(
					`<plugin name="${plugin.identifier}">\n${plugin.system_role}\n</plugin>`,
				);
			}
		}
		return parts.join('\n');
	}

	/**
	 * Execute a plugin tool by POSTing args to its declared URL.
	 * Returns the parsed JSON response body.
	 */
	async invoke(toolName, args, { fetchFn = fetch } = {}) {
		for (const plugin of this._plugins.values()) {
			const tool = plugin.api.find((t) => t.name === toolName);
			if (!tool) continue;
			if (!tool.url) throw new Error(`Plugin tool "${toolName}" has no url`);
			const method = (tool.method ?? 'POST').toUpperCase();
			const res = await fetchFn(tool.url, {
				method,
				headers: { 'content-type': 'application/json' },
				body: method !== 'GET' ? JSON.stringify(args) : undefined,
			});
			if (!res.ok)
				throw new Error(`Plugin tool "${toolName}" returned HTTP ${res.status}`);
			return res.json();
		}
		throw new Error(`No installed plugin handles tool "${toolName}"`);
	}
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _registry;
export function getPluginRegistry() {
	if (!_registry) _registry = new PluginRegistry();
	return _registry;
}
