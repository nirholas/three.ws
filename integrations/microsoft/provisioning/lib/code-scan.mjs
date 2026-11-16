// Read what the code actually asks Microsoft for, so the provisioning manifest
// (../resources.json) can be checked against it. Pure string scanning: no
// module under api/ is imported, so the scan runs without a database or env.
//
// A "Microsoft auth file" is any source file that talks to the Microsoft
// identity platform (it names login.microsoftonline.com). Inside those files:
//   redirect paths  every /api/.../callback path
//   permissions     Graph scope and permission names in string literals on
//                   lines that build a scope or permission list
//   audiences       the resource behind every `<resource>/.default` scope and
//                   every `*_RESOURCE` constant
// Across the whole tree:
//   env vars        every MS_* name read from the environment or templated
//                   into a package manifest

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const SCAN_ROOTS = ['api', 'scripts', 'server', 'integrations/microsoft'];
const SOURCE_EXT = /\.(?:m?js|json)$/;
const SKIP_DIRS = new Set(['node_modules', 'schema', 'dist', '.git', 'provisioning']);
const OIDC_SCOPES = new Set(['openid', 'profile', 'email', 'offline_access']);
const GRAPH_PERMISSION = /^[A-Z][A-Za-z]*(?:\.[A-Z][A-Za-z]*){1,3}$/;
const REDIRECT_PATH = /\/api\/[a-z0-9\-/]+\/callback\b/g;
const ENV_REF = /(?:process\.env\.|\benv\.|envValue\(\s*['"`]|['"`]|\$\{)(MS_[A-Z][A-Z0-9_]*[A-Z0-9])\b/g;

function walk(root, dir, out) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const name of entries) {
		if (SKIP_DIRS.has(name)) continue;
		const full = join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) walk(root, full, out);
		else if (SOURCE_EXT.test(name) && st.size < 2_000_000) out.push(relative(root, full));
	}
	return out;
}

/** Every scannable source file under the repo root, as repo-relative paths. */
export function listSourceFiles(repoRoot, roots = SCAN_ROOTS) {
	return roots.flatMap((r) => walk(repoRoot, join(repoRoot, r), [])).sort();
}

function isCommentLine(line) {
	const t = line.trim();
	return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** Literal string contents on a line: '...', "..." and `...` (template parts kept raw). */
function stringLiterals(line) {
	const out = [];
	const re = /'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\\n]*)`/g;
	let m;
	while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
	return out;
}

/** `NAME = '<value>'` constants in a file, for resolving `${NAME}/.default`. */
function stringConstants(text) {
	const map = new Map();
	const re = /\b([A-Z][A-Z0-9_]*)\s*=\s*['"`]([^'"`\n]+)['"`]/g;
	let m;
	while ((m = re.exec(text))) map.set(m[1], m[2]);
	return map;
}

function normalizeAudience(value) {
	return value.replace(/\/\.default$/, '').replace(/\/$/, '');
}

/**
 * Scan one file's text. Returns redirect paths, permissions and audiences it
 * requests (empty sets when the file does not talk to Microsoft identity).
 */
export function scanMicrosoftAuthText(text) {
	const result = { redirects: new Set(), permissions: new Set(), audiences: new Set() };
	if (!text.includes('login.microsoftonline.com')) return result;
	const constants = stringConstants(text);
	for (const m of text.matchAll(REDIRECT_PATH)) result.redirects.add(m[0]);
	for (const line of text.split('\n')) {
		if (isCommentLine(line)) continue;
		const scopeLine = /scope/i.test(line) || /PERMISSIONS/.test(line);
		const resourceLine = /_RESOURCE\s*=|\bresource\s*:/.test(line);
		if (!scopeLine && !resourceLine) continue;
		for (const lit of stringLiterals(line)) {
			const resolved = lit.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (all, name) => constants.get(name) ?? all);
			for (const token of resolved.split(/\s+/).filter(Boolean)) {
				if (scopeLine && (OIDC_SCOPES.has(token) || GRAPH_PERMISSION.test(token))) result.permissions.add(token);
				if (scopeLine && token.endsWith('/.default') && !token.includes('${')) result.audiences.add(normalizeAudience(token));
				if (resourceLine && /^https:\/\/[^\s]+$/.test(token)) result.audiences.add(normalizeAudience(token));
			}
		}
	}
	return result;
}

/** MS_* environment names referenced in a file's text. */
export function scanEnvRefs(text) {
	const names = new Set();
	for (const m of text.matchAll(ENV_REF)) names.add(m[1]);
	return names;
}

/**
 * Scan the repo. Each value maps to the files that reference it, so a drift
 * report can say where a new scope or redirect came from.
 */
export function scanRepo(repoRoot, { files = listSourceFiles(repoRoot), read = (f) => readFileSync(join(repoRoot, f), 'utf8') } = {}) {
	const out = { redirects: new Map(), permissions: new Map(), audiences: new Map(), env: new Map() };
	const add = (map, key, file) => {
		if (!map.has(key)) map.set(key, new Set());
		map.get(key).add(file);
	};
	for (const file of files) {
		const text = read(file);
		const auth = scanMicrosoftAuthText(text);
		for (const r of auth.redirects) add(out.redirects, r, file);
		for (const p of auth.permissions) add(out.permissions, p, file);
		for (const a of auth.audiences) add(out.audiences, a, file);
		for (const e of scanEnvRefs(text)) add(out.env, e, file);
	}
	return out;
}

/**
 * Compare a repo scan with the manifest. Returns human-readable problems; an
 * empty array means the manifest covers everything the code asks for.
 */
export function driftProblems(manifest, scan) {
	const problems = [];
	const redirects = new Set(manifest.apps.flatMap((a) => a.redirectUris.map((r) => r.path)));
	const permissions = new Set(manifest.apps.flatMap((a) => a.permissions.map((p) => p.name)));
	const audiences = new Set(manifest.apps.flatMap((a) => a.tokenAudiences.map((t) => normalizeAudience(t.resource))));
	const env = new Set([...manifest.env.cloudRun, ...manifest.env.package, ...Object.keys(manifest.env.unmanaged)]);
	const where = (set) => [...set].join(', ');
	for (const [path, files] of scan.redirects) if (!redirects.has(path)) problems.push(`redirect URI ${path} (in ${where(files)}) is not in resources.json`);
	for (const [name, files] of scan.permissions) if (!permissions.has(name)) problems.push(`Microsoft scope or permission ${name} (in ${where(files)}) is not in resources.json`);
	for (const [aud, files] of scan.audiences) if (!audiences.has(aud)) problems.push(`token audience ${aud} (in ${where(files)}) is not in resources.json`);
	for (const [name, files] of scan.env) if (!env.has(name)) problems.push(`env var ${name} (in ${where(files)}) is neither provisioned nor listed under env.unmanaged in resources.json`);
	return problems;
}

/**
 * The reverse direction: every manifest entry must still be used by the file
 * it names, so stale entries do not linger after code moves.
 */
export function staleEntries(manifest, scan) {
	const stale = [];
	for (const app of manifest.apps) {
		for (const r of app.redirectUris) if (!scan.redirects.get(r.path)?.has(r.usedBy)) stale.push(`${app.key}: redirect ${r.path} is no longer requested by ${r.usedBy}`);
		for (const p of app.permissions) for (const f of p.usedBy) if (!scan.permissions.get(p.name)?.has(f)) stale.push(`${app.key}: ${p.name} is no longer requested by ${f}`);
		for (const t of app.tokenAudiences) if (!scan.audiences.get(normalizeAudience(t.resource))?.has(t.usedBy)) stale.push(`${app.key}: audience ${t.resource} is no longer used by ${t.usedBy}`);
	}
	for (const name of [...manifest.env.cloudRun, ...manifest.env.package]) if (!scan.env.has(name)) stale.push(`env var ${name} is no longer referenced by code`);
	return stale;
}
