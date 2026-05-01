// Plugin registry — load and manage LobeHub/pai-chat compatible plugin manifests.
//
// Manifest format (ToolManifest from pai-chat):
//   { identifier, meta: { title, description?, avatar?, tags? }, api[], systemRole?, type?,
//     settings?: { type:'object', properties:{...}, required?:[] }, version?, openapi?, gateway? }
//
// Also accepts legacy { schema_version:"plugin/1.0", ... } manifests (backcompat).

const STORAGE_KEY = 'installed_plugins_v1';

// ── Validation ────────────────────────────────────────────────────────────────

export function validatePluginManifest(json) {
	if (!json || typeof json !== 'object') throw new Error('Plugin manifest must be a JSON object');
	if (!json.identifier || typeof json.identifier !== 'string')
		throw new Error('Plugin manifest missing required field: identifier');
	if (!json.meta?.title) throw new Error('Plugin manifest missing meta.title');
	if (!Array.isArray(json.api) || json.api.length === 0)
		throw new Error('Plugin manifest must declare at least one api entry');
	for (const tool of json.api) {
		if (!tool.name || !tool.description)
			throw new Error(`Plugin api entry "${tool.name || '?'}" missing name or description`);
	}
	return true;
}

export async function fetchPluginManifest(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Manifest fetch failed: ${url} (${res.status})`);
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
	 * Convert installed plugin tools to Anthropic tool format.
	 * Strips internal routing fields before the array is sent to the API.
	 */
	toClaudeTools() {
		const tools = [];
		for (const plugin of this._plugins.values()) {
			for (const api of plugin.api) {
				tools.push({
					name: api.name,
					description: `[${plugin.meta.title}] ${api.description}`,
					input_schema: api.parameters ?? { type: 'object', properties: {} },
					// routing metadata — caller must strip these before sending to Anthropic
					_plugin: plugin.identifier,
					_url: api.url ?? null,
				});
			}
		}
		return tools;
	}

	/** System prompt fragments injected for installed plugins. */
	systemPrompt() {
		const parts = [];
		for (const plugin of this._plugins.values()) {
			const role = plugin.systemRole ?? plugin.system_role; // support both casings
			if (role) {
				parts.push(`<plugin name="${plugin.identifier}">\n${role}\n</plugin>`);
			}
		}
		return parts.join('\n');
	}

	/**
	 * Execute a plugin tool by calling its declared URL.
	 * Returns the parsed JSON response body.
	 */
	async invoke(toolName, args, { fetchFn = fetch } = {}) {
		for (const plugin of this._plugins.values()) {
			const tool = plugin.api.find((t) => t.name === toolName);
			if (!tool) continue;

			// Route through gateway if set, else tool's own URL
			const url = plugin.gateway ?? tool.url;
			if (!url) throw new Error(`Plugin tool "${toolName}" has no url or gateway`);

			const res = await fetchFn(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ apiName: toolName, arguments: JSON.stringify(args), identifier: plugin.identifier }),
			});
			if (!res.ok) throw new Error(`Plugin tool "${toolName}" returned HTTP ${res.status}`);
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
