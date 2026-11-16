#!/usr/bin/env node
// Calls production three.ws exactly the way each staged PnP sample does and
// fails on the first contract break. Nothing here is mocked.
//
//   Copilot agent  every operation in the API plugin's OpenAPI file, with the
//                  response_semantics paths from ai-plugin.json resolved
//                  against the real responses
//   Teams          the catalog, directory, agent and preview-image endpoints
//                  the message extension reads; with --bot <url>, real
//                  composeExtension invoke activities posted to the running bot
//   SharePoint     the default model (CORS), the hosted viewer (framable) and
//                  the pinned <agent-3d> runtime (bytes match the SRI hash)
//
// Usage:
//   THREEWS_API_KEY=sk_live_... node integrations/microsoft/pnp-samples/scripts/verify-live.mjs
//     [--generate]                                  also run one real text-to-3D generation
//     [--bot http://localhost:3978/api/messages]   also drive the running Teams bot
//
// The key is read from the environment only and is never printed.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ORIGIN = 'https://three.ws';
const COPILOT = join(root, 'copilot-pro-dev-samples', 'da-threews-3d-studio', 'appPackage');
const SPFX = join(root, 'sp-dev-fx-webparts', 'react-threews-3d-viewer');
const EXAMPLE_AGENT = '15f7354f-518f-41a7-a53b-6927c5c53a86';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

const key = (process.env.THREEWS_API_KEY || '').trim();
const results = [];

function check(label, ok, detail = '') {
	results.push({ label, ok });
	console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
	return ok;
}

async function call(path, { method = 'GET', body, auth = true, params } = {}) {
	const url = new URL(path, ORIGIN);
	for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
	const headers = { Accept: 'application/json' };
	if (auth && key) headers.Authorization = `Bearer ${key}`;
	if (body) headers['Content-Type'] = 'application/json';
	const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	return { status: res.status, headers: res.headers, json, text };
}

/** Resolves the "$.a.b" paths ai-plugin.json uses. */
function jsonPath(value, path) {
	return path
		.replace(/^\$\.?/, '')
		.split('.')
		.filter(Boolean)
		.reduce((acc, part) => (acc == null ? acc : acc[part]), value);
}

function semanticsFor(plugin, fn) {
	return plugin.functions.find((f) => f.name === fn)?.capabilities?.response_semantics;
}

function checkSemantics(label, plugin, fn, response) {
	const sem = semanticsFor(plugin, fn);
	if (!sem) return check(`${label} has response_semantics`, false);
	const items = jsonPath(response, sem.data_path);
	const list = Array.isArray(items) ? items : items ? [items] : [];
	if (!check(`${label} data_path ${sem.data_path}`, list.length > 0, `${list.length} item(s)`)) return false;
	const missing = Object.entries(sem.properties || {}).filter(([, p]) => jsonPath(list[0], p) == null).map(([k, p]) => `${k}=${p}`);
	return check(`${label} response_semantics properties resolve`, missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : '');
}

async function verifyCopilot() {
	console.log('\n== Copilot declarative agent (da-threews-3d-studio)');
	const spec = YAML.parse(readFileSync(join(COPILOT, 'apiSpecificationFile', 'threews.yml'), 'utf8'));
	const plugin = JSON.parse(readFileSync(join(COPILOT, 'ai-plugin.json'), 'utf8'));
	const ops = Object.values(spec.paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
	const fns = plugin.functions.map((f) => f.name);
	check('every plugin function has an OpenAPI operation', fns.every((f) => ops.includes(f)), fns.join(', '));

	const models = await call('/api/catalog', { params: { q: 'office chair', kind: 'object', limit: '5' } });
	if (check('searchModels answers 200', models.status === 200, `status ${models.status}`)) checkSemantics('searchModels', plugin, 'searchModels', models.json);

	const agents = await call('/api/v1/marketplace/agents/public', { params: { q: 'meditation', limit: '5' } });
	if (check('searchAgents answers 200', agents.status === 200, `status ${agents.status}`)) checkSemantics('searchAgents', plugin, 'searchAgents', agents.json);

	const anon = await call('/api/v1/marketplace/agents/my-agents', { auth: false });
	check('listMyAgents without a key answers 401', anon.status === 401, `status ${anon.status}`);
	if (key) {
		const mine = await call('/api/v1/marketplace/agents/my-agents');
		check('listMyAgents with THREEWS_API_KEY answers 200', mine.status === 200 && Array.isArray(mine.json?.data), `status ${mine.status}, ${mine.json?.data?.length ?? 0} agent(s)`);
	} else {
		check('THREEWS_API_KEY is set for listMyAgents', false, 'export THREEWS_API_KEY to verify the keyed operation');
	}

	const badJob = await call('/api/3d/studio', { params: { job: 'not-a-real-job-handle' } });
	check('checkModelJob rejects a malformed handle with 400', badJob.status === 400, `status ${badJob.status}`);

	if (flag('--generate')) {
		const prompt = 'a small ceramic desk lamp with a round shade';
		const started = await call('/api/3d/studio', { method: 'POST', body: { prompt, tier: 'draft' } });
		const state = started.json || {};
		if (!check('generate3DModel answers 200', started.status === 200, `status ${started.status} ${state.status || started.text.slice(0, 120)}`)) return;
		check('generate3DModel returns done or pending with a handle', state.status === 'done' ? !!state.glbUrl : state.status === 'pending' && !!state.job && !!state.watchUrl, state.status);
		let final = state;
		const deadline = Date.now() + 8 * 60 * 1000;
		while (final.status === 'pending' && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 10000));
			final = (await call('/api/3d/studio', { params: { job: state.job, title: prompt } })).json || {};
		}
		if (check('checkModelJob reaches done', final.status === 'done' && !!final.glbUrl, final.status)) {
			checkSemantics('checkModelJob', plugin, 'checkModelJob', final);
			const glb = await fetch(final.glbUrl, { method: 'GET', headers: { Range: 'bytes=0-3' } });
			const magic = Buffer.from(await glb.arrayBuffer()).subarray(0, 4).toString('ascii');
			check('generated file is a GLB', magic === 'glTF', final.glbUrl);
		}
	}
}

async function verifyTeams() {
	console.log('\n== Teams message extension (msgext-threews-3d-models-ts)');
	const initial = await call('/api/catalog', { params: { kind: 'object', limit: '8' } });
	check('initialRun model list (no query) has results', initial.status === 200 && initial.json?.items?.length > 0, `${initial.json?.items?.length ?? 0} item(s)`);
	const item = initial.json?.items?.[0];
	check('catalog items carry url and thumb', !!item?.url && !!item?.thumb, item?.id);

	const none = await call('/api/catalog', { params: { q: 'zzqqxxnotathing', kind: 'object', limit: '8' } });
	check('a query with no match returns an empty list', none.status === 200 && Array.isArray(none.json?.items) && none.json.items.length === 0);

	const agent = await call(`/api/agents/${EXAMPLE_AGENT}`);
	check('agent detail carries an avatar model', agent.status === 200 && !!agent.json?.agent?.avatar_model_url, agent.json?.agent?.name);
	const missing = await call('/api/agents/00000000-0000-4000-8000-000000000000');
	check('an unknown agent answers 404', missing.status === 404, `status ${missing.status}`);

	const og = await fetch(`${ORIGIN}/api/page-og?s=labs&t=${encodeURIComponent('Arm Chair 01')}&p=/viewer`, { signal: AbortSignal.timeout(30000) });
	check('link-unfurl preview image renders', og.ok && /^image\//.test(og.headers.get('content-type') || ''), og.headers.get('content-type'));

	const bot = option('--bot');
	if (!bot) return;
	const common = {
		type: 'invoke',
		channelId: 'msteams',
		serviceUrl: 'https://smba.trafficmanager.net/amer/',
		from: { id: '29:verify-live', name: 'verify-live' },
		recipient: { id: '28:bot', name: 'bot' },
		conversation: { id: 'a:verify-live' },
	};
	const glb = 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/ArmChair_01.glb';
	const cases = [
		['bot searchModels', { name: 'composeExtension/query', value: { commandId: 'searchModels', parameters: [{ name: 'query', value: 'chair' }] } }, (b) => b.composeExtension?.attachments?.length > 0],
		['bot searchModels initialRun', { name: 'composeExtension/query', value: { commandId: 'searchModels', parameters: [{ name: 'initialRun', value: 'true' }] } }, (b) => b.composeExtension?.attachments?.length > 0],
		['bot searchAgents', { name: 'composeExtension/query', value: { commandId: 'searchAgents', parameters: [{ name: 'query', value: 'meditation' }] } }, (b) => b.composeExtension?.attachments?.length > 0],
		['bot unfurls a viewer link with a stage view', { name: 'composeExtension/queryLink', value: { url: `${ORIGIN}/viewer?src=${encodeURIComponent(glb)}&title=Arm%20Chair` } }, (b) => JSON.stringify(b).includes('tabInfo')],
		['bot unfurls an agent link', { name: 'composeExtension/queryLink', value: { url: `${ORIGIN}/agents/${EXAMPLE_AGENT}` } }, (b) => b.composeExtension?.attachments?.length === 1],
	];
	for (const [label, activity, ok] of cases) {
		try {
			const res = await fetch(bot, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...common, id: label, timestamp: new Date().toISOString(), ...activity }) });
			const body = await res.json().catch(() => ({}));
			check(label, res.status === 200 && ok(body), `status ${res.status}`);
		} catch (err) {
			check(label, false, err.message);
		}
	}
}

async function verifySpfx() {
	console.log('\n== SharePoint web part (react-threews-3d-viewer)');
	const manifest = readFileSync(join(SPFX, 'src', 'webparts', 'threeWs3DViewer', 'ThreeWs3DViewerWebPart.manifest.json'), 'utf8');
	const modelUrl = /"modelUrl":\s*"([^"]+)"/.exec(manifest)?.[1];
	const model = await fetch(modelUrl, { headers: { Origin: 'https://contoso.sharepoint.com', Range: 'bytes=0-3' } });
	const magic = Buffer.from(await model.arrayBuffer()).subarray(0, 4).toString('ascii');
	check('default model is a GLB', magic === 'glTF', modelUrl);
	check('default model allows cross-origin loading', ['*', 'https://contoso.sharepoint.com'].includes(model.headers.get('access-control-allow-origin')), model.headers.get('access-control-allow-origin') || 'no header');

	const viewer = await fetch(`${ORIGIN}/viewer?src=${encodeURIComponent(modelUrl)}&title=Arm%20Chair`, { signal: AbortSignal.timeout(30000) });
	const xfo = viewer.headers.get('x-frame-options');
	const csp = viewer.headers.get('content-security-policy') || '';
	const ancestors = /frame-ancestors([^;]*)/.exec(csp)?.[1]?.trim();
	check('hosted viewer answers 200', viewer.ok, `status ${viewer.status}`);
	check('hosted viewer can be framed by SharePoint', !xfo && (!ancestors || /\*|sharepoint\.com/.test(ancestors)), xfo ? `X-Frame-Options ${xfo}` : `frame-ancestors ${ancestors || 'unset'}`);

	const runtime = readFileSync(join(SPFX, 'src', 'webparts', 'threeWs3DViewer', 'helpers', 'runtime.ts'), 'utf8');
	const version = /RUNTIME_VERSION = '([^']+)'/.exec(runtime)?.[1];
	const integrity = /RUNTIME_INTEGRITY = '([^']+)'/.exec(runtime)?.[1];
	const script = await fetch(`${ORIGIN}/agent-3d/${version}/agent-3d.js`, { signal: AbortSignal.timeout(30000) });
	const bytes = Buffer.from(await script.arrayBuffer());
	const actual = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
	check(`<agent-3d> ${version} runtime answers 200`, script.ok, `status ${script.status}`);
	check('<agent-3d> runtime matches the pinned SRI hash', actual === integrity, actual === integrity ? integrity : `served ${actual}`);
	check('<agent-3d> runtime allows anonymous CORS', script.headers.get('access-control-allow-origin') === '*', script.headers.get('access-control-allow-origin') || 'no header');
}

await verifyCopilot();
await verifyTeams();
await verifySpfx();

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed.` : `\nAll ${results.length} live checks passed against ${ORIGIN}.`);
process.exit(failed ? 1 : 0);
