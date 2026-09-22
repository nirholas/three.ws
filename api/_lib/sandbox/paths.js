// Workspace path rules, shared by every backend, the store and the runner.
//
// A workspace path is relative, POSIX, and stays inside the workspace: no
// leading slash, no `..`, no NUL, no empty segment. The model may write
// `/workspace/out/chart.png` because that is where the code runs; the prefix is
// accepted and stripped so the stored path is always `out/chart.png`.
//
// This module has no imports so the in-container runner can copy it verbatim.

export const WORKSPACE_ROOT = '/workspace';
/** Where the terminal session lives inside a workspace. */
export const STATE_DIR = '.three_ws';

const MAX_PATH = 256;

export class SandboxPathError extends Error {
	constructor(message) {
		super(message);
		this.code = 'bad_path';
		this.status = 400;
		this.expose = true;
	}
}

/**
 * @param {unknown} input
 * @returns {string} the normalized relative path
 */
export function normalizeWorkspacePath(input) {
	if (typeof input !== 'string' || !input.trim()) throw new SandboxPathError('path is required');
	let p = input.trim().replace(/\\/g, '/');
	if (p === WORKSPACE_ROOT || p === `${WORKSPACE_ROOT}/`) throw new SandboxPathError('path must name a file');
	if (p.startsWith(`${WORKSPACE_ROOT}/`)) p = p.slice(WORKSPACE_ROOT.length + 1);
	while (p.startsWith('./')) p = p.slice(2);
	if (p.startsWith('/')) throw new SandboxPathError('path must be inside /workspace');
	if (p.includes('\0')) throw new SandboxPathError('path contains a NUL byte');
	for (const part of p.split('/')) {
		if (part === '' || part === '.' || part === '..') throw new SandboxPathError(`invalid path segment in "${input}"`);
	}
	if (p.length > MAX_PATH) throw new SandboxPathError(`path is longer than ${MAX_PATH} characters`);
	return p;
}

/** Whether a stored path is runtime state rather than a user file. */
export function isStatePath(p) {
	return p === STATE_DIR || p.startsWith(`${STATE_DIR}/`);
}

function normalizeGlob(glob) {
	let g = String(glob || '').trim().replace(/\\/g, '/');
	if (g.startsWith(`${WORKSPACE_ROOT}/`)) g = g.slice(WORKSPACE_ROOT.length + 1);
	while (g.startsWith('./')) g = g.slice(2);
	return g;
}

/** Minimal glob: `*` within a segment, `**` across segments, `?` one character. */
export function globToRegExp(glob) {
	const g = normalizeGlob(glob);
	let re = '';
	for (let i = 0; i < g.length; i++) {
		const c = g[i];
		if (c === '*') {
			if (g[i + 1] === '*') {
				i++;
				if (g[i + 1] === '/') {
					i++;
					re += '(?:.*/)?';
				} else re += '.*';
			} else re += '[^/]*';
		} else if (c === '?') re += '[^/]';
		else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${re}$`);
}

/** Filter paths by a list of globs; an empty list matches everything. */
export function matchAny(paths, globs) {
	if (!Array.isArray(globs) || globs.length === 0) return paths;
	const res = globs.map(globToRegExp);
	return paths.filter((p) => res.some((r) => r.test(p)));
}

const MIME = {
	png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
	csv: 'text/csv', tsv: 'text/tab-separated-values', txt: 'text/plain', md: 'text/markdown', log: 'text/plain',
	json: 'application/json', html: 'text/html', pdf: 'application/pdf', py: 'text/x-python', js: 'text/javascript',
	mjs: 'text/javascript', sh: 'text/x-shellscript', glb: 'model/gltf-binary', zip: 'application/zip',
	parquet: 'application/vnd.apache.parquet', xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml',
};

export function contentTypeFor(p) {
	const ext = String(p).split('.').pop().toLowerCase();
	return MIME[ext] || 'application/octet-stream';
}

export function isTextType(ct) {
	return /^text\/|json|javascript|xml|yaml|x-python|shellscript/.test(String(ct));
}
