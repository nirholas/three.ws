// Records one real exchange with production Forge into test/fixtures/forge-exchange.json:
// the submit answer, every poll answer until done, and the cached answer Forge gives when
// the same prompt is sent again. The tests replay it, so they exercise the client against
// what production actually says.
//
//   THREE_WS_API_KEY=sk_live_... node test/record-fixture.mjs
//   FORGE_PROMPT="a ceramic teapot" FORGE_BASE_URL=https://three.ws  (optional)

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const key = process.env.THREE_WS_API_KEY;
if (!key) {
	console.error('Set THREE_WS_API_KEY (create one at https://three.ws/dashboard/api).');
	process.exit(1);
}
const base = (process.env.FORGE_BASE_URL || 'https://three.ws').replace(/\/+$/, '');
const prompt = process.env.FORGE_PROMPT || 'a ceramic teapot with a bamboo handle';
const headers = { authorization: `Bearer ${key}`, accept: 'application/json', 'x-forge-client': 'airtable-extension' };
const body = JSON.stringify({ prompt, tier: 'draft', path: 'image', aspect_ratio: '1:1' });

async function call(path, init = {}) {
	const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.body ? { 'content-type': 'application/json' } : {}) } });
	return { status: res.status, body: await res.json() };
}

const submit = await call('/api/forge', { method: 'POST', body });
console.log('submit', submit.status, submit.body.status);
const polls = [];
if (submit.body.job_id) {
	for (let i = 0; i < 150; i++) {
		await new Promise((r) => setTimeout(r, 3000));
		const poll = await call(`/api/forge?job=${encodeURIComponent(submit.body.job_id)}`);
		const last = polls.at(-1);
		if (!last || last.body.status !== poll.body.status || ['done', 'failed'].includes(poll.body.status)) polls.push(poll);
		console.log('poll', poll.status, poll.body.status);
		if (['done', 'failed'].includes(poll.body.status)) break;
	}
}
const cached = await call('/api/forge', { method: 'POST', body });
console.log('cached', cached.status, cached.body.status);
const unauthorized = await fetch(`${base}/api/forge`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body });
const strip = (b) => { const { manage_token, ...rest } = b; return rest; };
const out = {
	recorded: new Date().toISOString().slice(0, 10),
	prompt,
	submit: { status: submit.status, body: strip(submit.body) },
	polls: polls.map((p) => ({ status: p.status, body: strip(p.body) })),
	cached: { status: cached.status, body: strip(cached.body) },
	unauthorized: { status: unauthorized.status, body: await unauthorized.json() },
};
writeFileSync(fileURLToPath(new URL('./fixtures/forge-exchange.json', import.meta.url)), `${JSON.stringify(out, null, '\t')}\n`);
console.log('wrote test/fixtures/forge-exchange.json');
