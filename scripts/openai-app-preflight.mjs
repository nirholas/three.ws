#!/usr/bin/env node
/**
 * Runs the five ChatGPT App Directory test cases against the live connector,
 * exactly the way ChatGPT and the viewer widget drive it, before anyone records
 * the review demo. A take recorded against a broken lane is a wasted take and,
 * worse, a fourth rejection.
 *
 * For each case it makes the tool call the Testing tab names, then does what
 * api/_mcp-studio/component.js does with the answer: polls check_job until the
 * model lands (passing the refine envelope through), and runs rig_mesh when the
 * envelope says next: 'rig'. Every single tool call is timed against ChatGPT's
 * hard 60-second limit, and every final GLB is fetched to prove it downloads.
 *
 * The prompts come from prompts/store-submissions/_generated/openai-portal-fields.md
 * (Testing tab). The three negative prompts cannot be checked here: they test
 * whether ChatGPT chooses to call the plugin, which only ChatGPT can show.
 *
 *   node scripts/openai-app-preflight.mjs              # all five cases, in parallel
 *   node scripts/openai-app-preflight.mjs --cases=1,3  # case 3 always runs after 1
 *   node scripts/openai-app-preflight.mjs --json
 *   node scripts/openai-app-preflight.mjs --endpoint=https://three.ws/api/mcp-chatgpt
 *
 * Exits non-zero when any case fails, so it can gate a resubmission.
 */

const args = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const [k, ...v] = a.replace(/^--/, '').split('=');
		return [k, v.length ? v.join('=') : true];
	}),
);
const ENDPOINT = args.endpoint || 'https://three.ws/api/mcp-chatgpt';
const CHATGPT_LIMIT_MS = 60_000;
const POLL_MS = 10_000;
const CASE_DEADLINE_MS = 10 * 60_000;
// component.js gives up after this many consecutive retryable check failures.
const MAX_POLL_FAILURES = 6;
const ARMCHAIR = 'https://three.ws/cdn/objects/polyhaven/glb/ArmChair_01.glb';

// ChatGPT stamps every tool call with an opaque per-user `openai/subject`, and
// the connector keys its generation rate limits on it (api/_mcp-studio/handler.js)
// rather than on the caller's IP. One synthetic subject per run makes this
// script one reviewer, as ChatGPT would present it. Without it every case shares
// this machine's IP bucket and the parallel run trips the per-IP burst cap,
// which no reviewer ever sees.
const SUBJECT = `preflight-${crypto.randomUUID()}`;

let rpcId = 0;
async function callTool(name, toolArgs) {
	const started = Date.now();
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
		body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: toolArgs, _meta: { 'openai/subject': SUBJECT } } }),
		signal: AbortSignal.timeout(CHATGPT_LIMIT_MS + 30_000),
	});
	const raw = await res.text();
	const ms = Date.now() - started;
	const body = raw.trim().startsWith('{') ? raw : raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop();
	let json;
	try {
		json = JSON.parse(body);
	} catch {
		throw new Error(`${name}: HTTP ${res.status}, unparseable body: ${raw.slice(0, 200)}`);
	}
	if (json.error) throw new Error(`${name}: JSON-RPC error ${json.error.code} ${json.error.message}`);
	const result = json.result || {};
	return { ms, out: result.structuredContent || {}, content: result.content || [], isError: !!result.isError };
}

async function glbDownloads(url) {
	const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
	if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
	const buf = Buffer.from(await res.arrayBuffer());
	const magic = buf.subarray(0, 4).toString('latin1');
	return { ok: magic === 'glTF', detail: `${(buf.length / 1024 / 1024).toFixed(2)} MB, magic ${JSON.stringify(magic)}` };
}

/** Mirrors the widget: initial answer, then check_job / rig_mesh until a GLB lands. */
async function drive(name, toolArgs, log) {
	const started = Date.now();
	const first = await callTool(name, toolArgs);
	log.push({ tool: name, ms: first.ms, status: first.out.status || (first.out.glbUrl ? 'done' : 'answered') });
	if (first.isError) throw new Error(`${name} returned isError: ${first.content.map((c) => c.text).join(' ').slice(0, 300)}`);
	let out = first.out;
	let { next, refine } = out;
	let stage = out.stage;
	let jobId = out.jobId;
	let failures = 0;
	while (true) {
		if (Date.now() - started > CASE_DEADLINE_MS) throw new Error(`no model after ${CASE_DEADLINE_MS / 60000} minutes`);
		if (out.status === 'pending' && out.jobId) jobId = out.jobId;
		if ((out.status === 'pending' && out.jobId) || (out.retryable && jobId)) {
			const wait = out.retryable && Number(out.retry_after) > 0 ? Number(out.retry_after) * 1000 : POLL_MS;
			await new Promise((r) => setTimeout(r, wait));
			const poll = await callTool('check_job', refine ? { job_id: jobId, refine } : { job_id: jobId });
			log.push({ tool: 'check_job', ms: poll.ms, status: poll.out.status || (poll.isError ? 'error' : 'done') });
			if (poll.isError) {
				// Same rule as the widget: a retryable error means the job is fine and
				// only this check failed, so check again; anything else is final.
				if (!poll.out.retryable) throw new Error(`check_job failed: ${poll.content.map((c) => c.text).join(' ').slice(0, 300)}`);
				if (++failures >= MAX_POLL_FAILURES) throw new Error(`check_job failed ${failures} times in a row (the widget gives up here): ${poll.out.message || ''}`.slice(0, 300));
			} else {
				failures = 0;
			}
			out = poll.out;
			continue;
		}
		if (out.glbUrl && next === 'rig' && !out.rigged && stage !== 'rig') {
			const rig = await callTool('rig_mesh', { glb_url: out.glbUrl });
			log.push({ tool: 'rig_mesh', ms: rig.ms, status: rig.out.status || 'done' });
			if (rig.isError) throw new Error(`rig_mesh returned isError: ${rig.content.map((c) => c.text).join(' ').slice(0, 300)}`);
			stage = 'rig';
			refine = null;
			out = rig.out;
			if (out.glbUrl && !out.status) out = { ...out, rigged: true };
			continue;
		}
		if (out.glbUrl) return { out: stage === 'rig' ? { ...out, rigged: true } : out, totalMs: Date.now() - started };
		throw new Error(`${name} ended without a model: ${JSON.stringify(out).slice(0, 300)}`);
	}
}

function verdict(log, checks) {
	const slow = log.filter((c) => c.ms >= CHATGPT_LIMIT_MS);
	const failed = checks.filter((c) => !c.ok);
	if (slow.length) failed.push({ name: `every call under 60s`, ok: false, detail: slow.map((c) => `${c.tool} ${(c.ms / 1000).toFixed(1)}s`).join(', ') });
	return failed;
}

async function caseRobotThenMatte(results) {
	const log1 = [];
	const c1 = { id: 1, title: 'robot mascot (forge_free)', log: log1, checks: [] };
	results.push(c1);
	try {
		const { out, totalMs } = await drive('forge_free', { prompt: 'Make a 3D model of a friendly round robot mascot, glossy white plastic.' }, log1);
		c1.totalMs = totalMs;
		c1.glbUrl = out.glbUrl;
		c1.checks.push({ name: 'GLB downloads', ...(await glbDownloads(out.glbUrl)) });
	} catch (e) {
		c1.checks.push({ name: 'model lands', ok: false, detail: e.message });
	}
	if (!selected.has(3)) return;
	const log3 = [];
	const c3 = { id: 3, title: 'make the shell matte (refine_model)', log: log3, checks: [] };
	results.push(c3);
	if (!c1.glbUrl) {
		c3.checks.push({ name: 'case 1 model to refine', ok: false, detail: 'case 1 produced no model' });
		return;
	}
	try {
		const { out, totalMs } = await drive('refine_model', { glb_url: c1.glbUrl, instruction: "Make the robot's shell matte instead of glossy." }, log3);
		c3.totalMs = totalMs;
		c3.glbUrl = out.glbUrl;
		const lineage = Array.isArray(out.lineage) ? out.lineage : [];
		c3.checks.push({ name: 'Versions strip (lineage of 2+)', ok: lineage.length >= 2, detail: lineage.map((v) => v.label || v.index).join(' > ') || 'no lineage' });
		c3.checks.push({ name: 'anchored to the robot', ok: lineage.some((v) => v.glbUrl === c1.glbUrl), detail: lineage.length ? 'original GLB in lineage' : 'no lineage to check' });
		c3.checks.push({ name: 'GLB downloads', ...(await glbDownloads(out.glbUrl)) });
	} catch (e) {
		c3.checks.push({ name: 'refinement lands', ok: false, detail: e.message });
	}
}

async function caseKnight(results) {
	const log = [];
	const c = { id: 2, title: 'rigged knight (forge_avatar)', log, checks: [] };
	results.push(c);
	try {
		const { out, totalMs } = await drive('forge_avatar', { prompt: 'Make a rigged, animation-ready knight character I can pose.' }, log);
		c.totalMs = totalMs;
		c.glbUrl = out.glbUrl;
		c.checks.push({ name: 'rigged', ok: !!out.rigged, detail: out.rigged ? 'chip reads rigged model' : 'no rigged flag' });
		c.checks.push({ name: 'GLB downloads', ...(await glbDownloads(out.glbUrl)) });
	} catch (e) {
		c.checks.push({ name: 'rigged model lands', ok: false, detail: e.message });
	}
}

async function caseArmchair(results) {
	const log = [];
	const c = { id: 4, title: 'armchair (look_at_model)', log, checks: [] };
	results.push(c);
	try {
		const r = await callTool('look_at_model', { glb_url: ARMCHAIR });
		log.push({ tool: 'look_at_model', ms: r.ms, status: r.isError ? 'error' : 'done' });
		c.totalMs = r.ms;
		const images = r.content.filter((x) => x.type === 'image').length;
		c.checks.push({ name: 'frames returned as images', ok: images >= 1, detail: `${images} image block(s)` });
		c.checks.push({ name: 'model_url for the viewer', ok: /^https:\/\//.test(r.out.model_url || ''), detail: r.out.model_url || 'missing' });
	} catch (e) {
		c.checks.push({ name: 'look_at_model answers', ok: false, detail: e.message });
	}
}

async function caseTelescope(results) {
	const log = [];
	const c = { id: 5, title: 'brass telescope (mesh_forge)', log, checks: [] };
	results.push(c);
	try {
		const { out, totalMs } = await drive('mesh_forge', { prompt: 'Use the art-directed generator to make a detailed vintage brass telescope on a wooden tripod.' }, log);
		c.totalMs = totalMs;
		c.glbUrl = out.glbUrl;
		c.checks.push({ name: 'GLB downloads', ...(await glbDownloads(out.glbUrl)) });
	} catch (e) {
		c.checks.push({ name: 'model lands', ok: false, detail: e.message });
	}
}

const selected = new Set(String(args.cases || '1,2,3,4,5').split(',').map(Number));
const results = [];
const jobs = [];
if (selected.has(1) || selected.has(3)) jobs.push(caseRobotThenMatte(results));
if (selected.has(2)) jobs.push(caseKnight(results));
if (selected.has(4)) jobs.push(caseArmchair(results));
if (selected.has(5)) jobs.push(caseTelescope(results));
await Promise.all(jobs);
results.sort((a, b) => a.id - b.id);

let failures = 0;
for (const r of results) {
	r.failed = verdict(r.log, r.checks);
	r.ok = r.failed.length === 0;
	if (!r.ok) failures++;
}

if (args.json) {
	console.log(JSON.stringify({ endpoint: ENDPOINT, at: new Date().toISOString(), results }, null, 2));
} else {
	console.log(`ChatGPT app preflight against ${ENDPOINT}\n`);
	for (const r of results) {
		const slowest = Math.max(0, ...r.log.map((c) => c.ms));
		console.log(`${r.ok ? 'PASS' : 'FAIL'}  case ${r.id}: ${r.title}`);
		console.log(`      ${r.log.length} call(s), slowest ${(slowest / 1000).toFixed(1)}s, model in ${r.totalMs ? (r.totalMs / 1000).toFixed(0) + 's' : 'n/a'}`);
		for (const ch of r.checks) console.log(`      ${ch.ok ? 'ok ' : 'NO '} ${ch.name}: ${ch.detail}`);
		for (const f of r.failed.filter((x) => !r.checks.includes(x))) console.log(`      NO  ${f.name}: ${f.detail}`);
		if (r.glbUrl) console.log(`      ${r.glbUrl}`);
	}
	console.log(`\n${failures ? `${failures} case(s) failed` : 'All cases pass. Safe to record.'}`);
}
process.exit(failures ? 1 : 0);
