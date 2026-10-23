// GET /api/cron/mcp-registry-sentinel: daily diff of our MCP servers against
// the official MCP registry and npm.
//
// Reads every local server.json at runtime (repo root, mcp-bridge, mcp-server,
// packages/*, robinhood/*, services/*), pages the registry's latest entries for
// our namespace (following metadata.nextCursor), looks up npm latest versions,
// probes each hosted remote, and reports: unpublished, behind, repository URL
// mismatch, registry-only names we do not track, npm behind/missing, remote down.
//
// An ops alert fires only when the finding set changed since the last run (the
// previous keys live in app_settings), so a standing gap alerts once, not daily.
// Diff logic: api/_lib/mcp-registry-sentinel.js. Ops doc: docs/mcp-registry-sentinel.md.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { json, wrapCron, method, error } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sql } from '../_lib/db.js';
import { sendOpsAlert } from '../_lib/alerts.js';
import {
	NAMESPACE,
	diffRegistry,
	findingKeys,
	changedSince,
	alertDetail,
} from '../_lib/mcp-registry-sentinel.js';

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
const NPM = 'https://registry.npmjs.org';
const STATE_KEY = 'mcp_registry_sentinel';
const MAX_PAGES = 20;
const CONCURRENCY = 8;
const ROOT = process.cwd();
const SUBDIR_PARENTS = ['packages', 'robinhood', 'services'];

async function readManifest(dir) {
	try {
		const raw = JSON.parse(await readFile(path.join(ROOT, dir, 'server.json'), 'utf8'));
		if (typeof raw.name !== 'string' || !raw.name.startsWith(NAMESPACE)) return null;
		const npmPkg = (raw.packages || []).find((p) => p.registryType === 'npm');
		return {
			name: raw.name,
			version: String(raw.version || ''),
			repoUrl: raw.repository?.url,
			dir: dir || '.',
			npm: npmPkg ? { identifier: npmPkg.identifier, version: String(npmPkg.version || raw.version || '') } : undefined,
			remotes: (raw.remotes || []).filter((r) => r.url),
		};
	} catch {
		return null;
	}
}

export async function readLocalManifests() {
	const dirs = ['', 'mcp-bridge', 'mcp-server'];
	for (const parent of SUBDIR_PARENTS) {
		try {
			const entries = await readdir(path.join(ROOT, parent), { withFileTypes: true });
			for (const e of entries) if (e.isDirectory()) dirs.push(`${parent}/${e.name}`);
		} catch {
			/* parent absent in this build */
		}
	}
	const found = await Promise.all(dirs.map(readManifest));
	return found.filter(Boolean);
}

export async function fetchRegistryLatest(fetchImpl = fetch) {
	const out = [];
	let cursor = '';
	for (let page = 0; page < MAX_PAGES; page++) {
		const url = `${REGISTRY}?search=${encodeURIComponent(NAMESPACE.slice(0, -1))}&version=latest&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
		const r = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
		if (!r.ok) throw new Error(`registry ${r.status}`);
		const body = await r.json();
		for (const item of body.servers || []) {
			const s = item.server;
			if (!s?.name?.startsWith(NAMESPACE)) continue;
			const meta = item._meta?.['io.modelcontextprotocol.registry/official'];
			if (meta && meta.isLatest === false) continue;
			out.push({ name: s.name, version: String(s.version || ''), repoUrl: s.repository?.url });
		}
		cursor = body.metadata?.nextCursor || '';
		if (!cursor) return out;
	}
	throw new Error(`registry pagination exceeded ${MAX_PAGES} pages`);
}

async function npmLatestVersion(pkg, fetchImpl = fetch) {
	const r = await fetchImpl(`${NPM}/${pkg.replace('/', '%2f')}/latest`, {
		headers: { accept: 'application/json' },
		signal: AbortSignal.timeout(15_000),
	});
	if (r.status === 404) return null;
	if (!r.ok) throw new Error(`npm ${r.status} for ${pkg}`);
	return String((await r.json()).version || '') || null;
}

async function probeRemote(name, url) {
	try {
		const r = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'three-ws-registry-sentinel', version: '1.0.0' } },
			}),
			signal: AbortSignal.timeout(10_000),
		});
		return { name, url, ok: r.status < 500 && r.status !== 404, status: r.status };
	} catch {
		return { name, url, ok: false };
	}
}

async function pool(items, fn) {
	const results = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				results[i] = await fn(items[i]);
			}
		}),
	);
	return results;
}

async function loadPrevious() {
	try {
		const [row] = await sql`SELECT value FROM app_settings WHERE key = ${STATE_KEY}`;
		return row?.value?.keys ?? null;
	} catch {
		return null;
	}
}

async function saveState(keys) {
	await sql`
		INSERT INTO app_settings (key, value) VALUES (${STATE_KEY}, ${JSON.stringify({ keys, at: new Date().toISOString() })}::jsonb)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
	`;
}

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const local = await readLocalManifests();
	if (!local.length) {
		return error(res, 500, 'no_local_manifests', 'no server.json found under the working directory; refusing to run');
	}

	let registry;
	try {
		registry = await fetchRegistryLatest();
	} catch (err) {
		return error(res, 502, 'registry_unreachable', err.message);
	}

	const packages = [...new Set(local.filter((l) => l.npm).map((l) => l.npm.identifier))];
	const npmLatest = {};
	const npmErrors = [];
	await pool(packages, async (pkg) => {
		try {
			npmLatest[pkg] = await npmLatestVersion(pkg);
		} catch (err) {
			npmErrors.push(err.message);
		}
	});
	// A failed npm lookup must not read as "missing on npm": drop the npm leg for that entry only.
	const lookedUp = local.map((l) => (l.npm && !npmLookedUp(npmLatest, l.npm.identifier) ? { ...l, npm: undefined } : l));

	const remoteTargets = local.flatMap((l) => l.remotes.map((r) => ({ name: l.name, url: r.url })));
	const remotes = await pool(remoteTargets, (t) => probeRemote(t.name, t.url));

	const diff = diffRegistry({ local: lookedUp, registry, npmLatest, remotes });
	const keys = findingKeys(diff);
	const previous = await loadPrevious();
	const { added, resolved } = changedSince(previous, keys);

	if (added.length) {
		await sendOpsAlert(
			`MCP registry sentinel: ${added.length} new finding${added.length === 1 ? '' : 's'}`,
			alertDetail(diff, added),
			{ severity: 'warn', signature: `mcp-registry-sentinel:${added.join(',')}` },
		);
	}
	if (added.length || resolved.length || previous === null) await saveState(keys);

	return json(res, 200, {
		ok: true,
		local: local.length,
		registry: registry.length,
		findings: diff,
		alerted: added,
		resolved,
		npm_errors: npmErrors,
	});
});

function npmLookedUp(npmLatest, id) {
	return Object.prototype.hasOwnProperty.call(npmLatest, id);
}
