#!/usr/bin/env node
// One card per post of the 2026-11-27 Grok for Startups repost thread
// (docs/x-posts/2026-11-27-grok-for-startups-repost.md), in the original
// thread's look: near-black ground, Inter, thin white line art, footer marks.
//
//   node scripts/grok-startups-post-models.mjs --set repost   # once: the repost's own models
//   node scripts/grok-startups-repost-cards.mjs [--only post-07.png,post-16.png]
//
// Media per post (19 posts):
//   1   public/x-media/grok-startups-announce/head.mp4 (head.png still), unchanged
//   2, 3, 6, 8, 15, 18, 19   the original layouts, counter "NN / 19" (scripts/lib/grok-startups-cards.mjs),
//         with this thread's own models (src/models.json: a red electric sports car, its
//         "make it chrome" refine, a rigged humanoid robot, the render check on the car)
//         and no error count on the usage card (15)
//   4   public/x-media/grok-startups-announce/ffsc-engine.mp4, unchanged
//   5   post-05-launch-stack.mp4, a real render of the launch stack cutaway:
//         node scripts/anatomy-cutaway-video.mjs --id d72da3e9-8aae-47cd-a96c-45ccd33bf1a0 \
//           --out public/x-media/grok-startups-repost/post-05-launch-stack.mp4
//   7, 9, 10, 11, 12, 13, 16, 17   new cards drawn here
//   14  filled by order 452 once the Grok eval has every row
//
// Every figure on a new card is real:
//   7   the Grok Build plugin in integrations/grok/three-ws (commands, agent)
//   9   a live run of satellites/grok-3d-starter on grok-4.7 asking for a rocket (src/starter.json)
//   10  the four task templates and their measured runtimes on /grok
//   11  the event names, signature and retry schedule in api/_lib/webhook-dispatch.js
//   12  the five pano tools in api/_mcp-studio/pano-tools.js
//   13  the Grok 4.7 prices in api/_lib/chat-models.js
//   16  /api/status/mcp, fetched when this script runs (written to src/live.json)
//   17  the Ask @grok text that src/shared/grok-ask.js builds for a real model (the pickup in src/models.json)
//
// Output: public/x-media/grok-startups-repost/post-NN.png, 1200x675 at 2x.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { esc, frame, launchBrowser, openRenderer, shootCards } from './lib/x-card-kit.mjs';
import { USAGE, announceCards, hasAnnounceModels, renderAnnounceModels } from './lib/grok-startups-cards.mjs';
import { GROK_MODELS } from '../api/_lib/chat-models.js';
import { grokAskText } from '../src/shared/grok-ask.js';

const TOTAL = 19;
const outDir = resolve('public/x-media/grok-startups-repost');
const srcDir = join(outDir, 'src');
const modelsPath = join(srcDir, 'models.json');
const models = existsSync(modelsPath) ? JSON.parse(readFileSync(modelsPath, 'utf8')) : {};
if (!hasAnnounceModels(models) || !models.pickup) throw new Error(`${modelsPath} is incomplete: run node scripts/grok-startups-post-models.mjs --set repost`);
const starterPath = join(srcDir, 'starter.json');
if (!existsSync(starterPath)) throw new Error('src/starter.json is missing: run satellites/grok-3d-starter scripts/live-xai.mjs and record its two GLBs there');
const starter = JSON.parse(readFileSync(starterPath, 'utf8'));
// Old post number (2026-11-25 thread) to its number in the repost.
const RENUMBER = { 2: 2, 3: 3, 5: 6, 6: 8, 7: 15, 8: 18, 9: 19 };
// Refreshed usage figures (posts 3 and 15), when a numbers run has written
// src/usage.json; the 2026-11-25 window otherwise.
const usagePath = join(srcDir, 'usage.json');
const usage = { ...USAGE, ...(existsSync(usagePath) ? JSON.parse(readFileSync(usagePath, 'utf8')) : {}) };
// The examples smoke line returns only once order 458 proves all six live.
const smokePassed = process.argv.includes('--smoke-passed');
const card = (n, body, css) => frame(n, TOTAL, body, css);

// ---------------------------------------------------------------------------
// Live and derived data

async function liveUptime() {
	const res = await fetch('https://three.ws/api/status/mcp');
	if (!res.ok) throw new Error(`/api/status/mcp answered ${res.status}`);
	const body = await res.json();
	const grok = body.servers.find((s) => s.path === '/api/mcp-grok');
	if (!grok?.windows?.['7d']) throw new Error('/api/status/mcp has no 7 day window for /api/mcp-grok');
	const w = grok.windows['7d'];
	return { fetchedAt: body.generatedAt || new Date().toISOString(), intervalSeconds: body.probeIntervalSeconds, ...w };
}

const grok47 = GROK_MODELS.find((m) => m.id === 'grok-4.7');
if (!grok47) throw new Error('grok-4.7 is not in api/_lib/chat-models.js');
const usd = (n) => `$${n.toFixed(2)}`;

const askEntity = { kind: 'forge', id: models.pickup.glb_url.match(/([0-9a-f-]{36})\.glb$/)[1], prompt: models.pickup.prompt };
const askText = grokAskText(askEntity, { url: 'https://three.ws' });

const n = (v) => Number(v).toLocaleString('en-US');

// A wire globe for the 360 card: meridians and parallels as thin ellipses.
function globe(size) {
	const r = size / 2 - 2;
	const c = size / 2;
	const lines = [];
	for (let i = 1; i < 6; i++) lines.push(`<ellipse cx="${c}" cy="${c}" rx="${(r * Math.abs(Math.cos((i * Math.PI) / 6))).toFixed(2)}" ry="${r}" stroke-opacity="0.45"/>`);
	for (let i = 1; i < 6; i++) {
		const y = c - r * Math.cos((i * Math.PI) / 6);
		const half = r * Math.sin((i * Math.PI) / 6);
		lines.push(`<ellipse cx="${c}" cy="${y.toFixed(2)}" rx="${half.toFixed(2)}" ry="${(half * 0.22).toFixed(2)}" stroke-opacity="0.3"/>`);
	}
	return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" stroke="#fff" stroke-width="1"><circle cx="${c}" cy="${c}" r="${r}" stroke-opacity="0.7"/>${lines.join('')}</svg>`;
}

// ---------------------------------------------------------------------------
// New cards

function newCards({ uptime, starterRenders, askRender }) {
	const term = `.term { position: absolute; right: 72px; top: 76px; font: 400 15px/1.7 'JBMono', monospace; color: #c9c9d1; border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 14px 20px; background: #0b0b0e; }
		.term .p { color: #5f5f69; }`;
	const tile = `.tile { border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; background: radial-gradient(ellipse at 50% 40%, #15161b 0%, #09090c 75%); display: flex; align-items: center; justify-content: center; overflow: hidden; }`;

	return {
		'post-07.png': card(
			7,
			`<div class="head"><h1>three.ws in Grok Build.</h1><div class="sub">xAI's coding agent. One plugin, nothing to execute.</div></div>
			<div class="list">${[
				['/make-3d', 'a textured GLB from a sentence, catalog first'],
				['/rig', 'a humanoid GLB, ready to animate'],
				['/embed', 'paste-ready HTML for any model'],
				['/three-ws-init', '3D asset rules in your AGENTS.md'],
				['3d-art-director', 'agent: one model, four views, at most two rounds'],
			]
				.map(([cmd, what]) => `<div class="li"><span class="name">${esc(cmd)}</span><span class="what">${esc(what)}</span></div>`)
				.join('')}</div>
			<div class="foot cap">Cursor gets /make-3d, /rig and /embed as a plugin of its own.</div>`,
			`.list { position: absolute; left: 72px; right: 72px; top: 214px; border-top: 1px solid rgba(255,255,255,0.12); }
			.li { height: 50px; display: grid; grid-template-columns: 340px 1fr; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); }
			.li .name { font: 500 20px/1 'JBMono', monospace; color: #f1f1f5; }
			.li .what { font-size: 17px; color: #8e8e98; letter-spacing: -0.01em; }
			.foot { position: absolute; left: 72px; top: 486px; font-size: 14px; color: #7a7a84; }`,
		),

		'post-09.png': card(
			9,
			`<div class="head"><h1>Grok and 3D in your own app.</h1><div class="sub">Fork the Grok 3D starter. Chat on the left, a lit stage on the right.</div></div>
			<div class="calls"><div class="label">${esc(starter.model)}, live run</div>${[
				[`"${starter.ask}"`, ['search_catalog', 'forge_free', 'check_job']],
				[`"${starter.followUp}"`, ['refine_model', 'check_job']],
			]
				.map(([said, tools]) => `<div class="turn"><div class="said">${esc(said)}</div>${tools.map((t) => `<div class="tool">${t}</div>`).join('')}</div>`)
				.join('')}<div class="cap small">1 Node server · 1 page · 1 dependency</div></div>
			<div class="row">${[
				[starterRenders.first.png, starter.firstLabel, `forge_free, ready at ${starter.first.seconds} s`],
				[starterRenders.second.png, `"${starter.followUp[0].toUpperCase()}${starter.followUp.slice(1)}"`, `refine_model, ready at ${starter.second.seconds} s`],
			]
				.map(([png, label, cap]) => `<figure><div class="tile"><img src="${png}"></div><div class="label">${esc(label)}</div><div class="cap">${esc(cap)}</div></figure>`)
				.join('')}</div>`,
			`${tile}
			.calls { position: absolute; left: 72px; top: 214px; width: 330px; height: 262px; border: 1px solid rgba(255,255,255,0.14); border-radius: 14px; background: #0b0b0e; padding: 18px 20px; }
			.turn { margin-top: 14px; }
			.said { font-size: 17px; font-weight: 500; color: #f1f1f5; margin-bottom: 6px; letter-spacing: -0.01em; }
			.tool { font: 400 13.5px/1.55 'JBMono', monospace; color: #8e8e98; padding-left: 14px; position: relative; }
			.tool::before { content: ''; position: absolute; left: 2px; top: 9px; width: 5px; height: 5px; border-radius: 50%; background: #5f5f69; }
			.small { position: absolute; left: 20px; bottom: 16px; font-size: 12px; }
			.row { position: absolute; left: 426px; right: 72px; top: 214px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
			figure { margin: 0; }
			.tile { height: 262px; }
			.tile img { height: 108%; width: auto; }
			.row .label { margin-top: 16px; color: #e8e8ee; }
			.row .cap { margin-top: 6px; }`,
		),

		'post-10.png': card(
			10,
			`<div class="head"><h1>Four Grok Bot tasks.</h1><div class="sub">Paste one as it stands. Each was timed on production.</div></div>
			<div class="term"><span class="p">$</span> npx three-ws setup --client grok-bot<br><span class="p">connector fields, URL copied, live check</span></div>
			<div class="grid">${[
				['Catalog only', 'Home-office scene kit', ['search_catalog', 'get_catalog_item', 'get_item_source'], '3.0 s', 'nothing generated'],
				['Every Monday', 'Game-jam prop pack', ['search_catalog', 'forge_free', 'get_job'], '194.0 s', '3 from the catalog, 1 made'],
				['From a photo', 'Product photo to 3D', ['mesh_forge', 'check_job', 'look_at_model'], '301.6 s', 'model, two views, shape check'],
				['Rigged', 'Mascot avatar', ['forge_avatar', 'check_job'], '455.4 s', 'generation plus rigging'],
			]
				.map(([kind, title, tools, time, note]) => `<div class="t"><div class="label">${kind}</div><div class="title">${title}</div><div class="tools">${tools.map((x) => `<div>${x}</div>`).join('')}</div><div class="time">${time}</div><div class="cap">${note}</div></div>`)
				.join('')}</div>`,
			`${term}
			.grid { position: absolute; left: 72px; right: 72px; top: 214px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
			.t { height: 278px; border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; background: #0b0b0e; padding: 18px 18px; position: relative; }
			.title { margin-top: 10px; font-size: 21px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; }
			.tools { margin-top: 14px; font: 400 12.5px/1.65 'JBMono', monospace; color: #7d7d87; }
			.time { position: absolute; left: 18px; bottom: 40px; font-size: 34px; font-weight: 600; letter-spacing: -0.03em; }
			.t .cap { position: absolute; left: 18px; bottom: 16px; font-size: 12px; }`,
		),

		'post-11.png': card(
			11,
			`<div class="head"><h1>three.ws can wake your Grok Bot.</h1></div>
			<svg class="wires" width="1200" height="675" viewBox="0 0 1200 675" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="1.2">
				${[0, 1, 2].map((i) => `<path d="M330 ${262 + i * 76} C 380 ${262 + i * 76}, 380 338, 430 338"/>`).join('')}
				<path d="M730 338 L 790 338"/><path d="M782 332 L 790 338 L 782 344"/>
			</svg>
			<div class="events">${['run.finished', 'forge.completed', 'approval.needed'].map((e) => `<div class="e"><span>${e}</span><span class="dot"></span></div>`).join('')}</div>
			<div class="box mid"><div class="label">three.ws webhook</div><div class="big">Signed, retried</div><div class="cap">Standard Webhooks, HMAC-SHA256<br>8 attempts over about 12 hours<br>every delivery in your log</div></div>
			<div class="box end"><div class="label">Grok Bot routine</div><div class="quote">"If it is approval.needed, summarize what the agent wants to do and message me."</div></div>
			<div class="foot cap">The routine's key is stored encrypted and never shown again.</div>`,
			`.wires { position: absolute; inset: 0; }
			.events { position: absolute; left: 72px; top: 224px; }
			.e { height: 76px; width: 262px; display: flex; align-items: center; justify-content: space-between; font: 500 19px/1 'JBMono', monospace; color: #f1f1f5; }
			.e .dot { width: 9px; height: 9px; border-radius: 50%; background: #fff; margin-right: -4px; }
			.box { position: absolute; top: 250px; height: 176px; border: 1px solid rgba(255,255,255,0.22); border-radius: 14px; padding: 18px 22px; background: #0b0b0e; }
			.mid { left: 430px; width: 300px; }
			.end { left: 790px; width: 338px; }
			.big { margin-top: 12px; font-size: 26px; font-weight: 600; letter-spacing: -0.02em; }
			.mid .cap { margin-top: 12px; font-size: 12.5px; color: #7d7d87; }
			.quote { margin-top: 14px; font-size: 19px; line-height: 1.4; color: #d9d9e0; letter-spacing: -0.01em; }
			.foot { position: absolute; left: 72px; top: 470px; font-size: 14px; color: #7a7a84; }`,
		),

		'post-12.png': card(
			12,
			`<div class="head"><h1>360 in. A 3D scene out.</h1><div class="sub">Five tools on the Grok connector, free with an account.</div></div>
			<div class="globe">${globe(250)}</div>
			<div class="rows">${[
				['360 video', 'pano_capture_start', 'Gaussian splat', 'a scene you can walk through'],
				['One 360 photo', 'pano_scene_create', 'Depth shell GLB', 'real metres, camera at the centre, plus a point cloud'],
			]
				.map(([from, tool, to, note]) => `<div class="r"><div class="from">${from}</div><div class="arrow"><span class="tool">${tool}</span></div><div class="to"><div class="name">${to}</div><div class="cap">${note}</div></div></div>`)
				.join('')}</div>
			<div class="foot cap">pano_capture_status, pano_scene_status and pano_capture_list follow each job and find past captures.</div>`,
			`.globe { position: absolute; right: 72px; top: 52px; opacity: 0.85; }
			.rows { position: absolute; left: 72px; right: 72px; top: 236px; border-top: 1px solid rgba(255,255,255,0.12); }
			.r { height: 104px; display: grid; grid-template-columns: 210px 330px 1fr; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); }
			.from { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
			.arrow { position: relative; height: 1px; background: rgba(255,255,255,0.32); margin-right: 34px; }
			.arrow::after { content: ''; position: absolute; right: -1px; top: -4px; width: 8px; height: 8px; border-top: 1.2px solid rgba(255,255,255,0.5); border-right: 1.2px solid rgba(255,255,255,0.5); transform: rotate(45deg); }
			.tool { position: absolute; left: 0; top: -26px; font: 400 14px/1 'JBMono', monospace; color: #9a9aa4; }
			.to .name { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
			.to .cap { margin-top: 6px; }
			.foot { position: absolute; left: 72px; top: 470px; font-size: 13.5px; color: #7a7a84; }`,
		),

		'post-13.png': card(
			13,
			`<div class="head"><h1>Your agents can think with Grok.</h1><div class="sub">Add your own xAI key once. Billed to your key, not ours.</div></div>
			<div class="stats">
				<div><div class="big">${esc(grok47.label)}</div><div class="label">every agent you own</div></div>
				<div><div class="big">${usd(grok47.price[0])}<span class="arrow">→</span>${usd(grok47.cachedInputPrice)}</div><div class="label">per 1M input tokens, cached</div></div>
			</div>
			<div class="where">${['3D avatar chat', 'Embeds on your own site', 'Brain playground'].map((w) => `<div class="w"><span class="dot"></span>${w}</div>`).join('')}</div>
			<div class="foot cap">Follow-up turns reuse xAI's prompt cache. When xAI retired Grok Build 0.1, agents on it moved to ${esc(grok47.label)} on their own.</div>`,
			`.stats { position: absolute; left: 72px; right: 72px; top: 222px; display: grid; grid-template-columns: 1fr 1.25fr; gap: 40px; }
			.big { font-size: 72px; font-weight: 600; letter-spacing: -0.045em; line-height: 1; white-space: nowrap; }
			.big .arrow { color: #5f5f69; font-weight: 400; margin: 0 14px; }
			.stats .label { margin-top: 14px; }
			.where { position: absolute; left: 72px; right: 72px; top: 382px; display: flex; gap: 40px; border-top: 1px solid rgba(255,255,255,0.12); padding-top: 22px; }
			.w { display: flex; align-items: center; gap: 12px; font-size: 21px; font-weight: 500; letter-spacing: -0.015em; }
			.w .dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; }
			.foot { position: absolute; left: 72px; top: 476px; font-size: 13.5px; color: #7a7a84; }`,
		),

		'post-16.png': card(
			16,
			`<div class="head"><div class="label">Grok connector, probed the way Grok connects, last 7 days</div></div>
			<div class="stats">
				<div><div class="big">${n(uptime.passed)}<span class="of"> / ${n(uptime.probes)}</span></div><div class="label">checks passed</div></div>
				<div><div class="big">${n(uptime.handshakeP50Ms)} ms</div><div class="label">median handshake</div></div>
				<div><div class="big">${n(uptime.toolCallP50Ms)} ms</div><div class="label">median tool call</div></div>
			</div>
			<div class="steps">${['initialize', 'tools/list', 'tools/call', 'sign-in check'].map((s, i) => `${i ? '<span class="line"></span>' : ''}<span class="s">${s}</span>`).join('')}</div>
			<div class="foot cap">Every ${Math.round(uptime.intervalSeconds / 60)} minutes. Public at three.ws/status.</div>`,
			`.head { top: 72px; }
			.stats { position: absolute; left: 72px; right: 72px; top: 118px; display: flex; justify-content: space-between; }
			.big { font-size: 92px; font-weight: 600; letter-spacing: -0.05em; line-height: 1; white-space: nowrap; }
			.big .of { color: #5f5f69; font-weight: 500; font-size: 56px; letter-spacing: -0.04em; }
			.stats .label { margin-top: 14px; }
			.steps { position: absolute; left: 72px; right: 72px; top: 352px; display: flex; align-items: center; }
			.s { font: 500 17px/1 'JBMono', monospace; border: 1px solid rgba(255,255,255,0.22); border-radius: 999px; padding: 13px 20px; background: #0b0b0e; white-space: nowrap; }
			.line { flex: 1; height: 1px; background: rgba(255,255,255,0.28); }
			.foot { position: absolute; left: 72px; top: 446px; font-size: 14px; color: #7a7a84; }`,
		),

		'post-17.png': card(
			17,
			`<div class="head"><h1>Ask @grok, beside Share on X.</h1><div class="sub">On every model, avatar and cutaway. Nothing posts until you press post.</div></div>
			<div class="left"><div class="tile"><img src="${askRender.png}"></div><div class="btns"><span class="b">Share on X</span><span class="b on">Ask @grok</span></div></div>
			<div class="draft"><div class="label">Opens the composer on X, unsent</div><div class="text">${esc(askText).replace(/\n/g, '<br>')}</div><div class="cap">The link unfurls as a card that shows the model itself.</div></div>`,
			`${tile}
			.left { position: absolute; left: 72px; top: 206px; width: 360px; }
			.tile { height: 222px; }
			.tile img { height: 112%; width: auto; }
			.btns { margin-top: 16px; display: flex; gap: 12px; }
			.b { font-size: 15px; font-weight: 600; border: 1px solid rgba(255,255,255,0.22); border-radius: 999px; padding: 10px 18px; color: #c9c9d1; }
			.b.on { background: #fff; color: #050507; border-color: #fff; }
			.draft { position: absolute; left: 470px; right: 72px; top: 206px; height: 280px; border: 1px solid rgba(255,255,255,0.14); border-radius: 14px; background: #0b0b0e; padding: 22px 26px; }
			.text { margin-top: 16px; font-size: 21px; line-height: 1.45; letter-spacing: -0.01em; color: #ececf1; }
			.draft .cap { position: absolute; left: 26px; bottom: 20px; }`,
		),
	};
}

// ---------------------------------------------------------------------------

const browser = await launchBrowser();
try {
	const uptime = await liveUptime();
	writeFileSync(join(srcDir, 'live.json'), `${JSON.stringify({ uptime, source: 'https://three.ws/api/status/mcp, server /api/mcp-grok, window 7d' }, null, '\t')}\n`);
	console.log(`uptime: ${uptime.passed} of ${uptime.probes} passed, handshake p50 ${uptime.handshakeP50Ms} ms (${uptime.fetchedAt})`);

	const renderer = await openRenderer(browser);
	const renders = await renderAnnounceModels(renderer.shot, models);
	const askRender = await renderer.shot(models.pickup.glb_url);
	const starterRenders = { first: await renderer.shot(starter.first.glb_url), second: await renderer.shot(starter.second.glb_url) };
	await renderer.close();

	const old = announceCards({ renders, models, srcDir, total: TOTAL, num: (k) => RENUMBER[k], smokePassed, showErrors: false, usage });
	const cards = {
		...Object.fromEntries(Object.entries(old).map(([k, html]) => [`post-${String(RENUMBER[k]).padStart(2, '0')}.png`, html])),
		...newCards({ uptime, starterRenders, askRender }),
	};
	const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
	await shootCards(browser, outDir, Object.fromEntries(Object.entries(cards).sort(([a], [b]) => a.localeCompare(b))), only);
} finally {
	await browser.close();
}
