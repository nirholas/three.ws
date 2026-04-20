// HTTP-level sweep: for each HTML path, fetch it, then fetch every <script src>, <link href>,
// and <img src> it references. Report broken (4xx/5xx) sub-resources.

import { load as loadHtml } from 'cheerio';

const BASE = 'http://127.0.0.1:4173';

const paths = [
	'/',
	'/app.html',
	'/home.html',
	'/features.html',
	'/create.html',
	'/agent-home.html',
	'/agent-edit.html',
	'/agent-embed.html',
	'/embed.html',
	'/a-embed.html',
	'/login.html',
	'/register.html',
	'/agent/',
	'/dashboard/',
	'/dashboard/storage.html',
	'/dashboard/usage.html',
	'/dashboard/wallets.html',
	'/dashboard/sessions.html',
	'/dashboard/embed-policy.html',
	'/hydrate/',
	'/studio/',
	'/explore/',
	'/artifact/',
	'/widgets-gallery/',
	'/docs-widgets.html',
	'/reputation/',
	'/discover/',
	'/wallet-connect-demo.html',
];

async function probe(url) {
	try {
		const r = await fetch(url, { redirect: 'manual' });
		return {
			status: r.status,
			ok: r.ok || r.status < 400,
			body: r.status < 400 ? await r.text() : null,
		};
	} catch (e) {
		return { status: 0, ok: false, err: e.message };
	}
}

async function head(url) {
	try {
		const r = await fetch(url, { method: 'GET', redirect: 'manual' });
		return r.status;
	} catch {
		return 0;
	}
}

const findings = [];
for (const p of paths) {
	const r = await probe(BASE + p);
	const entry = { path: p, status: r.status, broken: [] };
	if (!r.ok || !r.body) {
		console.log(`[SKIP ${r.status}] ${p}`);
		findings.push(entry);
		continue;
	}
	try {
		const $ = loadHtml(r.body);
		const refs = new Set();
		$('script[src]').each((_, el) => refs.add($(el).attr('src')));
		$('link[href]').each((_, el) => refs.add($(el).attr('href')));
		$('img[src]').each((_, el) => refs.add($(el).attr('src')));
		const refList = [...refs].filter(
			(u) => u && !u.startsWith('http') && !u.startsWith('//') && !u.startsWith('data:'),
		);
		const results = await Promise.all(
			refList.map(async (ref) => {
				const abs = ref.startsWith('/') ? BASE + ref : new URL(ref, BASE + p).toString();
				return { ref, status: await head(abs) };
			}),
		);
		for (const { ref, status } of results) {
			if (status >= 400 || status === 0) entry.broken.push({ ref, status });
		}
	} catch (e) {
		entry.broken.push({ ref: '<parse>', status: e.message });
	}
	const n = entry.broken.length;
	console.log(`[${n === 0 ? 'OK' : 'BAD'}] ${p}  ${n} broken sub-resource${n === 1 ? '' : 's'}`);
	findings.push(entry);
}

console.log('\n==== DETAILS ====');
for (const f of findings) {
	if (!f.broken?.length) continue;
	console.log(`\n${f.path}  (status ${f.status}):`);
	for (const b of f.broken) console.log(`  ${b.status}  ${b.ref}`);
}
