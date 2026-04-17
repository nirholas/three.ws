// Agent memory — file-based, human-readable, Claude-shaped.
// See specs/MEMORY_SPEC.md

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parseFrontmatter(text) {
	const m = text.match(FRONTMATTER_RE);
	if (!m) return { meta: {}, body: text };
	const meta = {};
	for (const line of m[1].split('\n')) {
		const [k, ...rest] = line.split(':');
		if (!k) continue;
		meta[k.trim()] = rest.join(':').trim();
	}
	return { meta, body: m[2] };
}

function stringifyFrontmatter(meta, body) {
	const lines = ['---'];
	for (const [k, v] of Object.entries(meta)) lines.push(`${k}: ${v}`);
	lines.push('---', '', body);
	return lines.join('\n');
}

export class Memory {
	constructor({ mode = 'local', namespace, index = {}, files = {}, timeline = [] } = {}) {
		this.mode = mode;
		this.namespace = namespace;
		this.files = new Map(Object.entries(files));
		this.timeline = timeline;
		this.indexText = index.text || '';
		this._dirty = false;
	}

	static async load({ mode = 'local', namespace, manifestURI, fetchFn }) {
		if (mode === 'none') return new Memory({ mode: 'none', namespace });
		if (mode === 'local') return Memory._loadLocal(namespace);
		if (mode === 'ipfs' || mode === 'encrypted-ipfs') {
			return Memory._loadIPFS({ mode, namespace, manifestURI, fetchFn });
		}
		throw new Error(`Unknown memory mode: ${mode}`);
	}

	static _loadLocal(namespace) {
		const key = `agent:${namespace}:memory`;
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return new Memory({ mode: 'local', namespace });
			const data = JSON.parse(raw);
			return new Memory({ mode: 'local', namespace, ...data });
		} catch {
			return new Memory({ mode: 'local', namespace });
		}
	}

	static async _loadIPFS({ mode, namespace, manifestURI, fetchFn }) {
		// Minimal IPFS mode — fetch memory/ from the manifest bundle.
		const base = manifestURI.replace(/manifest\.json$/, '');
		try {
			const idxRes = await fetchFn(`${base}memory/MEMORY.md`);
			const indexText = idxRes.ok ? await idxRes.text() : '';
			const files = {};
			// Parse MEMORY.md links to discover files
			const linkRe = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
			let m;
			while ((m = linkRe.exec(indexText))) {
				const file = m[2];
				try {
					const r = await fetchFn(`${base}memory/${file}`);
					if (r.ok) files[file] = await r.text();
				} catch {
					/* skip missing */
				}
			}
			return new Memory({ mode, namespace, index: { text: indexText }, files });
		} catch {
			return new Memory({ mode, namespace });
		}
	}

	read(key) {
		const file = key.endsWith('.md') ? key : `${key}.md`;
		const raw = this.files.get(file);
		if (!raw) return null;
		return parseFrontmatter(raw);
	}

	write(key, { name, description, type, body, decay }) {
		const file = key.endsWith('.md') ? key : `${key}.md`;
		const now = new Date().toISOString().slice(0, 10);
		const existing = this.files.get(file);
		const created = existing ? parseFrontmatter(existing).meta.created || now : now;
		const meta = { name, description, type, created, updated: now };
		if (decay) meta.decay = decay;
		this.files.set(file, stringifyFrontmatter(meta, body || ''));
		this._rebuildIndex();
		this._dirty = true;
		this._persist();
	}

	note(type, data) {
		const entry = { ts: new Date().toISOString(), type, ...data };
		this.timeline.push(entry);
		// Cap timeline to 1000 entries in-memory
		if (this.timeline.length > 1000) this.timeline = this.timeline.slice(-1000);
		this._dirty = true;
		this._persist();
	}

	async recall(query, { limit = 5 } = {}) {
		// Placeholder: naive substring match. Real impl: embeddings via runtime.
		const q = query.toLowerCase();
		const hits = [];
		for (const [file, raw] of this.files) {
			const { meta, body } = parseFrontmatter(raw);
			const hay = `${meta.name || ''} ${meta.description || ''} ${body}`.toLowerCase();
			if (hay.includes(q)) hits.push({ file, meta, body, score: hay.split(q).length - 1 });
		}
		return hits.sort((a, b) => b.score - a.score).slice(0, limit);
	}

	_rebuildIndex() {
		const byType = { user: [], feedback: [], project: [], reference: [] };
		for (const [file, raw] of this.files) {
			const { meta } = parseFrontmatter(raw);
			const t = meta.type || 'user';
			if (!byType[t]) byType[t] = [];
			byType[t].push({ file, name: meta.name || file, description: meta.description || '' });
		}
		const lines = ['# Memory', ''];
		const headings = {
			user: '## User',
			feedback: '## Feedback',
			project: '## Project',
			reference: '## Reference',
		};
		for (const [t, items] of Object.entries(byType)) {
			if (!items.length) continue;
			lines.push(headings[t] || `## ${t}`);
			for (const it of items) lines.push(`- [${it.name}](${it.file}) — ${it.description}`);
			lines.push('');
		}
		this.indexText = lines.join('\n');
	}

	_persist() {
		if (this.mode !== 'local' || !this.namespace) return;
		const key = `agent:${this.namespace}:memory`;
		const data = {
			index: { text: this.indexText },
			files: Object.fromEntries(this.files),
			timeline: this.timeline.slice(-200), // persist only recent timeline
		};
		try {
			localStorage.setItem(key, JSON.stringify(data));
		} catch (e) {
			console.warn('[memory] persist failed', e);
		}
	}

	// Budget-aware context serialization for LLM injection
	contextBlock({ maxTokens = 8192 } = {}) {
		// Rough token estimate: 4 chars/token
		const budget = maxTokens * 4;
		const parts = ['# Agent Memory', '', this.indexText];
		let used = parts.join('\n').length;
		// Include top-matching file bodies until budget exhausted
		for (const [file, raw] of this.files) {
			if (used + raw.length > budget) break;
			parts.push('', `## ${file}`, raw);
			used += raw.length;
		}
		if (this.timeline.length) {
			const recent = this.timeline.slice(-20);
			const tl = recent.map((e) => JSON.stringify(e)).join('\n');
			if (used + tl.length < budget) {
				parts.push('', '## Recent timeline', '```', tl, '```');
			}
		}
		return parts.join('\n');
	}

	async export() {
		return {
			version: 'memory/0.1',
			index: this.indexText,
			files: Object.fromEntries(this.files),
			timeline: this.timeline,
		};
	}

	async import(blob, { strategy = 'merge' } = {}) {
		if (strategy === 'replace') {
			this.files = new Map(Object.entries(blob.files || {}));
			this.timeline = blob.timeline || [];
		} else {
			for (const [k, v] of Object.entries(blob.files || {})) {
				if (!this.files.has(k)) this.files.set(k, v);
			}
			this.timeline = [...this.timeline, ...(blob.timeline || [])].slice(-1000);
		}
		this._rebuildIndex();
		this._persist();
	}
}
