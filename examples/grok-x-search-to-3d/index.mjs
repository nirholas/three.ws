#!/usr/bin/env node
// What is X talking about? Turn it into a 3D prop.
//
// 1. Grok searches X (the x_search tool) for a topic from the last 7 days and
//    answers in a fixed JSON shape: a summary, a prompt for one 3D prop that
//    captures the conversation, and a draft post with a {link} slot.
// 2. The three.ws studio server makes the prop (forge_free, then check_job).
// 3. The script fills the link and prints the draft post. It never posts.
//
//   XAI_API_KEY=... THREE_WS_API_KEY=... node index.mjs "lunar landers"
//   THREE_WS_API_KEY=... node index.mjs --prop "a chrome lunar lander"   skip Grok
//   node index.mjs --check       three.ws leg only (no keys)
//   node index.mjs --dry-run "lunar landers"   print the xAI request (no key, no call)
//
// Zero dependencies. Keys are read from the environment only and never printed.

const XAI_URL = 'https://api.x.ai/v1/responses';
const MCP_URL = process.env.THREE_WS_MCP_URL || 'https://three.ws/api/mcp-studio';
const MODEL = process.env.XAI_MODEL || 'grok-4.7';
const LOOKBACK_DAYS = 7;
const POLL_BUDGET_MS = 6 * 60_000;
const EXIT = { ok: 0, failed: 1, noKey: 2 };

export function parseArgs(argv) {
	const out = { check: false, dryRun: false, prop: null, words: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--check') out.check = true;
		else if (a === '--dry-run') out.dryRun = true;
		else if (a === '--prop') out.prop = argv[++i] || '';
		else out.words.push(a);
	}
	out.topic = out.words.join(' ').trim();
	return out;
}

const day = (d) => d.toISOString().slice(0, 10);

export const BRIEF_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['topic_summary', 'prop_prompt', 'draft_post'],
	properties: {
		topic_summary: { type: 'string', description: 'Two sentences on what people on X are saying about the topic.' },
		prop_prompt: {
			type: 'string',
			description: 'One sentence describing a single physical 3D prop that captures the conversation: shape, material, color. No people, no logos, no text.',
		},
		draft_post: {
			type: 'string',
			description: 'A post under 240 characters introducing the prop, containing the literal placeholder {link} where its 3D viewer link goes.',
		},
	},
};

export function buildRequest(topic, now = new Date()) {
	const from = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
	return {
		model: MODEL,
		input: [
			{
				role: 'user',
				content:
					`Search X for posts about "${topic}" from the last ${LOOKBACK_DAYS} days. ` +
					'Summarize the conversation, then design one 3D prop that captures it and draft a short post that would introduce it.',
			},
		],
		tools: [{ type: 'x_search', from_date: day(from), to_date: day(now) }],
		max_turns: 4,
		include: ['no_inline_citations'],
		text: { format: { type: 'json_schema', name: 'prop_brief', schema: BRIEF_SCHEMA, strict: true } },
	};
}

// The JSON answer, the X posts Grok cited, and how many posts it fetched.
export function readBrief(response) {
	const parts = (response.output || [])
		.filter((item) => item.type === 'message')
		.flatMap((item) => item.content || [])
		.filter((c) => c.type === 'output_text');
	const text = parts.map((c) => c.text).join('');
	const brief = JSON.parse(text);
	for (const key of BRIEF_SCHEMA.required) {
		if (typeof brief[key] !== 'string' || !brief[key].trim()) throw new Error(`Grok's answer has no ${key}`);
	}
	const citations = [
		...new Set(parts.flatMap((c) => c.annotations || []).filter((a) => a.type === 'url_citation').map((a) => a.url)),
	];
	const searches = (response.output || []).filter((item) => item.type === 'custom_tool_call').length;
	const postsFetched = response.usage?.server_side_tool_usage_details?.x_posts_fetched ?? null;
	return { brief, citations, searches, postsFetched };
}

export function fillLink(draft, link) {
	return draft.includes('{link}') ? draft.replaceAll('{link}', link) : `${draft.trim()} ${link}`;
}

async function askGrok(topic) {
	const key = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
	const res = await fetch(XAI_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
		body: JSON.stringify(buildRequest(topic)),
		signal: AbortSignal.timeout(180_000),
	});
	const body = await res.text();
	if (!res.ok) throw new Error(`xAI answered HTTP ${res.status}: ${body.slice(0, 300)}`);
	return readBrief(JSON.parse(body));
}

let rpcId = 0;
async function mcp(method, params, session) {
	const res = await fetch(MCP_URL, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			...(session ? { 'mcp-session-id': session } : {}),
			...(process.env.THREE_WS_API_KEY ? { authorization: `Bearer ${process.env.THREE_WS_API_KEY}` } : {}),
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
		signal: AbortSignal.timeout(90_000),
	});
	if (!res.ok) throw new Error(`${MCP_URL} answered HTTP ${res.status} to ${method}: ${(await res.text()).slice(0, 200)}`);
	const body = await res.json();
	if (body.error) throw new Error(`${method}: ${body.error.message}`);
	return { result: body.result, session: res.headers.get('mcp-session-id') || session };
}

async function openStudio() {
	const init = await mcp('initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'grok-x-search-to-3d-example', version: '1.0.0' },
	});
	return { session: init.session, server: init.result.serverInfo.name };
}

async function callTool(studio, name, args) {
	const { result } = await mcp('tools/call', { name, arguments: args }, studio.session);
	const data = result.structuredContent || {};
	if (result.isError) {
		const text = (result.content || []).map((c) => c.text).join(' ');
		throw new Error(`${name}: ${data.message || data.error || text || 'failed'}`);
	}
	return data;
}

const viewerFor = (glb) => `https://three.ws/viewer?src=${encodeURIComponent(glb)}`;

// A busy generator says how long to wait ("Try again in about 10s").
export function busyWaitSeconds(message) {
	if (!/busy/i.test(message)) return null;
	const s = Number(message.match(/about (\d+)\s*s/i)?.[1]);
	return Number.isFinite(s) && s > 0 ? Math.min(s, 60) : 15;
}

async function submitForge(studio, prompt) {
	const idempotency_key = `x-search-${Date.now().toString(36)}`;
	for (let attempt = 1; ; attempt++) {
		try {
			return await callTool(studio, 'forge_free', { prompt, tier: 'draft', idempotency_key });
		} catch (err) {
			const wait = busyWaitSeconds(err.message);
			if (wait === null || attempt >= 5) throw err;
			console.log(`busy     the generator is busy, trying again in ${wait}s (attempt ${attempt + 1} of 5)`);
			await new Promise((r) => setTimeout(r, wait * 1000));
		}
	}
}

// forge_free answers done or pending; check_job collects a pending job.
async function makeProp(studio, prompt) {
	const started = Date.now();
	let job = await submitForge(studio, prompt);
	while (job.status !== 'done') {
		if (job.status === 'failed') throw new Error(`generation failed: ${job.error || job.message || 'unknown'}`);
		const id = job.job_id || job.jobId;
		if (!id) throw new Error(`forge_free answered without a job: ${JSON.stringify(job).slice(0, 300)}`);
		if (Date.now() - started > POLL_BUDGET_MS) throw new Error(`still ${job.status} after ${Math.round((Date.now() - started) / 1000)}s; collect job ${id} later`);
		const wait = Math.min(Math.max(Number(job.eta_seconds) || 15, 5), 20);
		console.log(`job      ${job.status}${job.phase ? ` (${job.phase})` : ''}, checking again in ${wait}s`);
		await new Promise((r) => setTimeout(r, wait * 1000));
		job = await callTool(studio, 'check_job', { job_id: id });
	}
	const seconds = Math.round((Date.now() - started) / 1000);
	return { glb: job.glb_url, viewer: job.viewer_url || viewerFor(job.glb_url), seconds };
}

// Without a three.ws key nothing is generated: the closest free catalog asset stands in.
async function closestCatalogProp(studio, prompt) {
	const found = await callTool(studio, 'search_catalog', { q: prompt, kind: 'object', limit: 1 });
	const item = found.items?.[0];
	if (!item) throw new Error('no catalog asset matches the prop, and making one needs THREE_WS_API_KEY');
	return { glb: item.url, viewer: viewerFor(item.url), title: item.title };
}

async function check() {
	const studio = await openStudio();
	const { result } = await mcp('tools/list', {}, studio.session);
	const names = result.tools.map((t) => t.name);
	const missing = ['forge_free', 'check_job', 'search_catalog'].filter((n) => !names.includes(n));
	console.log(`server   ${studio.server} (${MCP_URL}), ${names.length} tools`);
	if (missing.length) throw new Error(`the server does not offer: ${missing.join(', ')}`);
	const prop = await closestCatalogProp(studio, 'lunar lander');
	console.log(`catalog  ${prop.title}  ${prop.glb}`);
	console.log('ok       three.ws leg is live');
}

async function run(args) {
	let prompt = args.prop;
	let draft = null;
	if (prompt === null) {
		if (!args.topic) {
			console.error('error    pass a topic, for example: node index.mjs "lunar landers"');
			return EXIT.failed;
		}
		if (!process.env.XAI_API_KEY && !process.env.GROK_API_KEY) {
			console.error('error    set XAI_API_KEY (create one at https://console.x.ai), or pass --prop "<prompt>" to skip Grok');
			return EXIT.noKey;
		}
		console.log(`x_search "${args.topic}", last ${LOOKBACK_DAYS} days`);
		const { brief, citations, searches, postsFetched } = await askGrok(args.topic);
		console.log(`grok     ${searches} search call(s)${postsFetched === null ? '' : `, ${postsFetched} posts fetched`}`);
		for (const url of citations.slice(0, 5)) console.log(`cited    ${url}`);
		console.log(`summary  ${brief.topic_summary}`);
		prompt = brief.prop_prompt;
		draft = brief.draft_post;
	}
	if (prompt.trim().length < 3) throw new Error('the prop prompt is empty');
	console.log(`prop     ${prompt}`);

	const studio = await openStudio();
	let prop;
	if (process.env.THREE_WS_API_KEY) {
		prop = await makeProp(studio, prompt.slice(0, 1000));
		console.log(`glb      ${prop.glb}  (made in ${prop.seconds}s)`);
	} else {
		console.error('note     THREE_WS_API_KEY is not set, so the closest free catalog asset stands in (free key: https://three.ws/dashboard/api-keys)');
		prop = await closestCatalogProp(studio, prompt);
		console.log(`glb      ${prop.glb}  (catalog: ${prop.title})`);
	}
	console.log(`viewer   ${prop.viewer}`);
	if (draft) {
		console.log('\ndraft post (not posted, copy it if you like it):\n');
		console.log(fillLink(draft, prop.viewer));
	}
	return EXIT.ok;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	try {
		if (args.dryRun) {
			console.log(`POST ${XAI_URL}\nauthorization: Bearer <XAI_API_KEY>\n${JSON.stringify(buildRequest(args.topic || 'lunar landers'), null, 2)}`);
		} else if (args.check) {
			await check();
		} else {
			process.exitCode = await run(args);
		}
	} catch (err) {
		console.error(`error    ${err?.message || err}`);
		process.exitCode = EXIT.failed;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
