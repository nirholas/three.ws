#!/usr/bin/env node
// Live proof of the 360 capture MCP tools against a running server
// (scripts/mcp-pano-live-server.mjs): JSON-RPC over HTTP on /api/mcp-studio,
// exactly as an MCP client sends it. Prints one JSON report line.
//
//   node scripts/mcp-pano-live-proof.mjs --base http://localhost:3345 --key-file <path>
//     [--video-url https://...] [--photo-url https://...]
//
// Without --video-url / --photo-url only the start-less reads run plus the start
// calls, which on a deployment with no worker answer `unconfigured`. With them
// and workers configured, it starts real jobs and polls to completion.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BASE = flag('--base', 'http://localhost:3345').replace(/\/$/, '');
const TOKEN = readFileSync(flag('--key-file'), 'utf8').trim();
const VIDEO = flag('--video-url', 'https://example.com/pano.mp4');
const PHOTO = flag('--photo-url', 'https://example.com/pano.jpg');

let id = 0;
async function rpc(method, params, token = TOKEN) {
	const res = await fetch(`${BASE}/api/mcp-studio`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
		body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
	});
	const text = await res.text();
	const line = text.startsWith('event:') ? text.split('\n').find((l) => l.startsWith('data:')).slice(5) : text;
	return { http: res.status, ...JSON.parse(line) };
}
const callTool = (name, args2, token) => rpc('tools/call', { name, arguments: args2 }, token);

const report = {};
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pano-proof', version: '1' } });
report.initialize = init.result?.serverInfo;
const list = await rpc('tools/list', {});
report.tools_listed = list.result.tools.map((t) => t.name).filter((n) => n.startsWith('pano_'));

const anon = await callTool('pano_capture_list', {}, '');
report.anonymous_list = anon.result?.structuredContent?.status ?? anon.error;

const mine = await callTool('pano_capture_list', {});
report.list = { isError: !!mine.result.isError, text: mine.result.content[0].text, captures: mine.result.structuredContent?.captures?.length };

const start = await callTool('pano_capture_start', { source_url: VIDEO, source_kind: 'equirect_video', quality: 'preview' });
report.capture_start = { isError: !!start.result.isError, structured: start.result.structuredContent, text: start.result.content[0].text };

const scene = await callTool('pano_scene_create', { image_url: PHOTO, source_kind: 'equirect_image' });
report.scene_create = { isError: !!scene.result.isError, structured: scene.result.structuredContent, text: scene.result.content[0].text };

const missing = await callTool('pano_capture_status', { job_id: '00000000-0000-4000-8000-000000000000' });
report.status_unknown_job = { isError: !!missing.result?.isError, structured: missing.result?.structuredContent };

async function poll(tool, jobId, label) {
	const t0 = Date.now();
	for (;;) {
		const r = await callTool(tool, { job_id: jobId });
		const sc = r.result.structuredContent;
		if (r.result.isError || sc.status === 'succeeded') return { seconds: Math.round((Date.now() - t0) / 1000), final: sc, isError: !!r.result.isError };
		if (Date.now() - t0 > 3 * 3600e3) return { timeout: label };
		await new Promise((r2) => setTimeout(r2, 20000));
	}
}
if (start.result.structuredContent?.job_id && !start.result.isError) report.capture_done = await poll('pano_capture_status', start.result.structuredContent.job_id, 'capture');
if (scene.result.structuredContent?.job_id && !scene.result.isError) report.scene_done = await poll('pano_scene_status', scene.result.structuredContent.job_id, 'scene');

process.stdout.write(`${JSON.stringify(report)}\n`);
