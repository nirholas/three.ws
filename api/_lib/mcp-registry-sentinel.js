// Pure diff logic for the MCP registry sentinel (api/cron/mcp-registry-sentinel.js).
//
// Inputs are plain data (local server.json manifests, the registry's latest
// entries for our namespace, npm latest versions), so every finding type is
// testable against fixtures without a network or a clock.

export const NAMESPACE = 'io.github.nirholas/';

function semverParts(v) {
	const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** @returns {number} 1 when a > b, -1 when a < b, 0 when equal or not comparable. */
export function compareSemver(a, b) {
	const pa = semverParts(a);
	const pb = semverParts(b);
	if (!pa || !pb) return 0;
	for (let i = 0; i < 3; i++) {
		if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
	}
	return 0;
}

function normRepo(url) {
	return String(url || '')
		.trim()
		.toLowerCase()
		.replace(/\.git$/, '')
		.replace(/\/+$/, '');
}

/**
 * @param {object} input
 * @param {Array<{ name: string, version: string, repoUrl?: string, dir: string, npm?: { identifier: string, version: string } }>} input.local
 * @param {Array<{ name: string, version: string, repoUrl?: string }>} input.registry latest entries under our namespace
 * @param {Record<string, string|null>} input.npmLatest npm package -> latest version (null = not on npm)
 * @param {Array<{ name: string, url: string, ok: boolean, status?: number }>} [input.remotes]
 * @returns {{ unpublished: object[], behind: object[], repoMismatch: object[], registryOnly: object[], npmBehind: object[], remoteDown: object[] }}
 */
export function diffRegistry({ local, registry, npmLatest = {}, remotes = [] }) {
	const reg = new Map(registry.map((r) => [r.name, r]));
	const localNames = new Set(local.map((l) => l.name));
	const out = {
		unpublished: [],
		behind: [],
		repoMismatch: [],
		registryOnly: [],
		npmBehind: [],
		remoteDown: [],
	};

	for (const l of local) {
		const r = reg.get(l.name);
		if (!r) {
			out.unpublished.push({ name: l.name, version: l.version, dir: l.dir });
		} else {
			if (compareSemver(l.version, r.version) > 0) {
				out.behind.push({ name: l.name, local: l.version, registry: r.version });
			}
			if (l.repoUrl && r.repoUrl && normRepo(l.repoUrl) !== normRepo(r.repoUrl)) {
				out.repoMismatch.push({ name: l.name, local: l.repoUrl, registry: r.repoUrl });
			}
		}
		if (l.npm) {
			const published = npmLatest[l.npm.identifier];
			if (published === null || published === undefined || compareSemver(l.npm.version, published) > 0) {
				out.npmBehind.push({
					name: l.name,
					package: l.npm.identifier,
					local: l.npm.version,
					npm: published ?? null,
				});
			}
		}
	}

	for (const r of registry) {
		if (!localNames.has(r.name)) out.registryOnly.push({ name: r.name, version: r.version });
	}
	for (const m of remotes) {
		if (!m.ok) out.remoteDown.push({ name: m.name, url: m.url, status: m.status ?? null });
	}

	for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

/** Flat, stable `kind:name` keys, so "changed since last run" is a set comparison. */
export function findingKeys(diff) {
	const kinds = {
		unpublished: 'unpublished',
		behind: 'behind',
		repoMismatch: 'repo_mismatch',
		registryOnly: 'registry_only',
		npmBehind: 'npm_behind',
		remoteDown: 'remote_down',
	};
	const keys = [];
	for (const [field, kind] of Object.entries(kinds)) {
		for (const f of diff[field]) keys.push(`${kind}:${f.name}`);
	}
	return keys.sort();
}

/** @returns {{ added: string[], resolved: string[] }} */
export function changedSince(previousKeys, currentKeys) {
	const prev = new Set(previousKeys || []);
	const cur = new Set(currentKeys);
	return {
		added: currentKeys.filter((k) => !prev.has(k)),
		resolved: [...prev].filter((k) => !cur.has(k)).sort(),
	};
}

export function alertDetail(diff, added) {
	const lines = [];
	const addedSet = new Set(added);
	const line = (kind, f, text) => {
		if (addedSet.has(`${kind}:${f.name}`)) lines.push(`${kind}: ${f.name} ${text}`);
	};
	for (const f of diff.unpublished) line('unpublished', f, `(local ${f.version}, ${f.dir})`);
	for (const f of diff.behind) line('behind', f, `(local ${f.local}, registry ${f.registry})`);
	for (const f of diff.repoMismatch) line('repo_mismatch', f, `(local ${f.local}, registry ${f.registry})`);
	for (const f of diff.npmBehind) line('npm_behind', f, `(${f.package} local ${f.local}, npm ${f.npm ?? 'missing'})`);
	for (const f of diff.registryOnly) line('registry_only', f, `(registry ${f.version}, no local server.json)`);
	for (const f of diff.remoteDown) line('remote_down', f, `(${f.url}, status ${f.status ?? 'unreachable'})`);
	return lines.join('\n');
}
