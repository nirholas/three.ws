import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const dockerfile = readFileSync(resolve(ROOT, 'workers/agent-orders/Dockerfile'), 'utf8');

const copied = [...dockerfile.matchAll(/^COPY\s+(?!--)(\S+)\s+\S+\s*$/gm)].map((m) =>
	m[1].replace(/^\.\//, '').replace(/\/$/, ''),
);
const isCopied = (rel) => copied.some((c) => rel === c || rel.startsWith(c + '/'));

function localImports(file) {
	const src = readFileSync(file, 'utf8');
	const out = new Set();
	for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
		const target = resolve(dirname(file), m[1].split('?')[0]);
		if (existsSync(target) && /\.(m?js|json)$/.test(target)) out.add(target);
	}
	for (const m of src.matchAll(/new URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url/g)) {
		const target = resolve(dirname(file), m[1]);
		if (existsSync(target) && /\.(m?js|json)$/.test(target)) out.add(target);
	}
	return out;
}

describe('agent-orders image', () => {
	it('copies every local module the worker can import at runtime', () => {
		const seen = new Set();
		const queue = [resolve(ROOT, 'workers/agent-orders/index.js')];
		const missing = new Set();
		while (queue.length) {
			const f = queue.pop();
			if (seen.has(f)) continue;
			seen.add(f);
			const rel = relative(ROOT, f);
			if (!isCopied(rel)) {
				missing.add(rel);
				continue;
			}
			if (/\.m?js$/.test(f)) for (const dep of localImports(f)) queue.push(dep);
		}
		expect([...missing]).toEqual([]);
	});
});

// gcloud reads .gcloudignore with gitignore semantics: the last matching rule
// wins, and a path under an excluded directory cannot be re-included. This
// evaluator covers the rule shapes the verify allowlist uses (anchored "/x",
// directory-only "x/", "**/x/", "!" negation and "*" within one segment).
function compileRule(line) {
	let pat = line;
	const negate = pat.startsWith('!');
	if (negate) pat = pat.slice(1);
	const dirOnly = pat.endsWith('/');
	if (dirOnly) pat = pat.slice(0, -1);
	const anchored = pat.startsWith('/') || pat.replace(/^\*\*\//, '').includes('/');
	pat = pat.replace(/^\//, '');
	const body = pat
		.split('/')
		.map((seg) => (seg === '**' ? '(?:.*/)?' : seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '/'))
		.join('')
		.replace(/\/$/, '');
	const re = new RegExp(anchored && !pat.startsWith('**/') ? `^${body}$` : `(?:^|/)${body}$`);
	return { negate, dirOnly, re };
}

function uploaded(rel, rules) {
	const parts = rel.split('/');
	for (let i = 1; i <= parts.length; i++) {
		const path = parts.slice(0, i).join('/');
		const isDir = i < parts.length || (existsSync(resolve(ROOT, path)) && statSync(resolve(ROOT, path)).isDirectory());
		let excluded = false;
		for (const r of rules) {
			if (r.dirOnly && !isDir) continue;
			if (r.re.test(path)) excluded = !r.negate;
		}
		if (excluded) return false;
	}
	return true;
}

describe('agent-orders build-only verify upload', () => {
	it('uploads every path the Dockerfile copies', () => {
		const rules = readFileSync(resolve(ROOT, 'workers/agent-orders/verify.gcloudignore'), 'utf8')
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith('#'))
			.map(compileRule);
		const sources = [...dockerfile.matchAll(/^COPY\s+(?!--)(.+)$/gm)].flatMap((m) => {
			const args = m[1].trim().split(/\s+/);
			return args.slice(0, -1).map((s) => s.replace(/^\.\//, '').replace(/\*$/, '').replace(/\/$/, ''));
		});
		const dropped = sources.filter((s) => existsSync(resolve(ROOT, s)) && !uploaded(s, rules));
		expect(dropped).toEqual([]);
	});

	it('still keeps dependency trees and git metadata out of the upload', () => {
		const rules = readFileSync(resolve(ROOT, 'workers/agent-orders/verify.gcloudignore'), 'utf8')
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith('#'))
			.map(compileRule);
		expect(uploaded('api/_lib/orders.js', rules)).toBe(true);
		expect(uploaded('agent-payments-sdk/node_modules/x/index.js', rules)).toBe(false);
		expect(uploaded('dist/index.html', rules)).toBe(false);
		expect(uploaded('public/index.html', rules)).toBe(false);
	});
});
