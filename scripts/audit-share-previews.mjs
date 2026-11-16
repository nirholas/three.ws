#!/usr/bin/env node
// npm run audit:share-previews [-- --base https://three.ws]
//
// Fetches a sample of real URLs per page type from --base (default production),
// fetches each page's og:image, and validates both against the LinkedIn and
// Teams preview rules (scripts/lib/share-preview-rules.mjs). Exit 1 with the
// exact offending tag per URL when anything fails.

import { checkPreview, imageSize, readMeta } from './lib/share-preview-rules.mjs';

const args = process.argv.slice(2);
const baseArg = args.indexOf('--base');
const base = (baseArg >= 0 ? args[baseArg + 1] : process.env.AUDIT_BASE || 'https://three.ws').replace(/\/$/, '');
const UA = 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)';

async function get(url, init = {}) {
	return fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(25000) });
}

async function json(path) {
	try {
		const r = await get(`${base}${path}`, { headers: { accept: 'application/json' } });
		return r.ok ? await r.json() : null;
	} catch { return null; }
}

async function sampleTargets() {
	const targets = [
		{ type: 'forge', path: '/forge' },
		{ type: 'marketplace', path: '/marketplace' },
		{ type: 'viewer', path: '/app' },
	];
	const creations = await json('/api/creations?limit=3');
	for (const c of (creations?.creations || []).slice(0, 2)) targets.push({ type: 'creation', path: `/m/${c.id}` });
	const agents = await json('/api/marketplace/agents?limit=3');
	for (const a of (agents?.data?.items || []).slice(0, 2)) {
		targets.push({ type: 'agent', path: `/agents/${a.id}`, discovered: true });
		if (a.avatar_id) targets.push({ type: 'avatar', path: `/avatars/${a.avatar_id}`, discovered: true });
	}
	return targets;
}

async function imageFacts(src) {
	const r = await get(src);
	const buf = Buffer.from(await r.arrayBuffer());
	const size = imageSize(buf) || {};
	return { status: r.status, contentType: r.headers.get('content-type') || '', bytes: buf.length, ...size };
}

let failures = 0;
for (const t of await sampleTargets()) {
	const url = `${base}${t.path}`;
	let problems;
	try {
		const r = await get(url);
		if (r.status === 404 && t.discovered) { console.log(`skip ${t.type.padEnd(11)} ${url} (listed but not public: HTTP 404)`); continue; }
		else if (!r.ok) problems = [{ tag: "page", problem: `HTTP ${r.status}` }];
		else {
			const html = await r.text();
			const img = readMeta(html).find((m) => m.key === 'og:image')?.content;
			let facts = {};
			if (img) {
				try { facts = { image: await imageFacts(img) }; }
				catch (e) { problems = [{ tag: 'og:image', problem: `fetch failed: ${e.message}` }]; }
			}
			problems = [...(problems || []), ...checkPreview(html, facts)];
		}
	} catch (e) {
		problems = [{ tag: 'page', problem: `fetch failed: ${e.message}` }];
	}
	if (problems.length) {
		failures++;
		console.log(`FAIL ${t.type.padEnd(11)} ${url}`);
		for (const p of problems) console.log(`       ${p.tag}: ${p.problem}`);
	} else {
		console.log(`ok   ${t.type.padEnd(11)} ${url}`);
	}
}
console.log(failures ? `\n${failures} page(s) violate the preview rules` : '\nall sampled previews pass');
process.exit(failures ? 1 : 0);
