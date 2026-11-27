// The seven drawn cards of the 2026-11-25 Grok for Startups thread, shared by
// scripts/grok-startups-post-cards.mjs (that thread, "NN / 09") and
// scripts/grok-startups-repost-cards.mjs (the 2026-11-27 repost, "NN / 19"),
// so both threads draw them identically and only the counter changes.
//
// Every figure is real:
//   models  three models made through /api/mcp-grok (forge_free, refine_model
//           "make it chrome", forge_avatar), rendered with three.js
//   look    the frames look_at_model returned for the prop, as returned
//   usage   the window traced in docs/partners/xai-comarketing-kit.md

import { join } from 'node:path';
import { dataUrl, esc, frame, torusKnot } from './x-card-kit.mjs';

// Usage window, 2026-10-08 to 2026-11-20 (co-marketing kit appendix).
export const USAGE = {
	window: 'Grok connector, before acceptance, Oct 8 to Nov 20, 2026',
	calls: '5,547',
	days: '44 of 44',
	errors: '2',
	prompts: '718',
	renders: '426',
	weeks: [
		['Oct 5', 1125],
		['Oct 12', 180],
		['Oct 19', 362],
		['Oct 26', 1552],
		['Nov 2', 1381],
		['Nov 9', 473],
		['Nov 16', 474],
	],
};

/** True when models.json holds everything the model cards need. */
export const hasAnnounceModels = (models) => ['prop', 'chrome', 'character', 'look'].every((k) => models[k]);

/** Render the three model tiles with a renderer from openRenderer(). */
export async function renderAnnounceModels(shot, models) {
	return {
		prop: await shot(models.prop.glb_url),
		chrome: await shot(models.chrome.glb_url),
		character: await shot((models.character_rig || models.character).glb_url, { skeleton: true, yaw: 0.35, pitch: 0.08 }),
	};
}

/**
 * The original cards keyed by their 2026-11-25 post number (2, 3, 5, 6, 7, 8, 9).
 * `num` maps that number to the counter shown on this thread; `total` is the
 * thread length; `smokePassed` shows the "all 6 passed" line on the examples
 * card, which only belongs there when a smoke run proved it. `showErrors` keeps
 * the error count as the usage card's third figure; without it that slot shows
 * the distinct prompts from people and agents we have never met instead.
 * `usage` replaces USAGE when a thread carries refreshed figures.
 */
export function announceCards({ renders, models, srcDir, total, num = (n) => n, smokePassed, showErrors = true, usage = USAGE }) {
	const look = models.look || { frames: [], views: [] };
	const lookFrames = look.frames.map((f, i) => ({ src: dataUrl(join(srcDir, f), 'image/png'), view: (look.views[i] || '').replace('-', ' ') }));
	const geo = look.geometry || {};
	const geoLine = [geo.triangles != null && `${Number(geo.triangles).toLocaleString('en-US')} triangles`, geo.materials != null && `${geo.materials} material${geo.materials === 1 ? '' : 's'}`, geo.textures != null && `${geo.textures} texture${geo.textures === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
	const maxWeek = Math.max(...usage.weeks.map((w) => w[1]));
	const f = (n, body, css) => frame(num(n), total, body, css);

	const modelCards = !renders ? {} : {
		2: f(
			2,
			`<div class="head"><h1>Ask Grok for a 3D model.</h1><div class="sub">A real textured GLB. Rigged when it is a character. Edited when you ask.</div></div>
			<div class="row">
				${[
					['Textured GLB', renders.prop.png, `"${models.prop.prompt.split(' with ')[0]}"`],
					['"Make it chrome"', renders.chrome.png, 'one sentence later, a new version'],
					['Rigged character', renders.character.png, `${renders.character.bones} bones, ready to animate`],
				]
					.map(([label, png, cap], i) => `<figure><div class="tile"><img class="${i === 2 ? 'tall' : ''}" src="${png}"></div><div class="label">${esc(label)}</div><div class="cap">${esc(cap)}</div></figure>`)
					.join('')}
			</div>`,
			`.row { position: absolute; left: 72px; right: 72px; top: 214px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
			figure { margin: 0; }
			.tile { height: 262px; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; background: radial-gradient(ellipse at 50% 40%, #15161b 0%, #09090c 75%); display: flex; align-items: center; justify-content: center; overflow: hidden; }
			.tile img { height: 112%; width: auto; }
			.tile img.tall { height: 94%; }
			.label { margin-top: 16px; color: #e8e8ee; }
			.cap { margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
		),

		3: f(
			3,
			`<div class="head"><h1>Grok checks its own work.</h1><div class="sub">Before it answers, it renders the model from every side and looks.</div></div>
			<div class="row">${lookFrames.map((fr) => `<figure><div class="tile"><img src="${fr.src}"></div><div class="label">${esc(fr.view)}</div></figure>`).join('')}</div>
			<div class="stat"><span class="big">${usage.renders}</span><span class="label">render checks so far</span>${geoLine ? `<span class="cap">${esc(geoLine)}</span>` : ''}</div>`,
			`.row { position: absolute; left: 72px; right: 72px; top: 200px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
			figure { margin: 0; }
			.tile { height: 236px; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; overflow: hidden; background: #0b0b0e; }
			.tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
			.row .label { margin-top: 12px; }
			.stat { position: absolute; left: 72px; right: 72px; top: 506px; display: flex; align-items: baseline; gap: 14px; }
			.stat .big { font-size: 40px; font-weight: 600; letter-spacing: -0.03em; }
			.stat .cap { margin-left: auto; }`,
		),
	};

	return {
		...modelCards,
		5: f(
			5,
			`<div class="head"><h1>One URL.<br>Every place you use Grok.</h1></div>
			<svg class="wires" width="1200" height="675" viewBox="0 0 1200 675" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="1.2">
				${[0, 1, 2, 3, 4].map((i) => `<path d="M552 ${430} C 640 430, 640 ${262 + i * 66}, 720 ${262 + i * 66}"/>`).join('')}
			</svg>
			<div class="hub"><div class="label">Remote MCP server</div><div class="url">three.ws/api/mcp-grok</div></div>
			<div class="targets">${[
				['grok.com', 'custom connector'],
				['Grok Bot', 'connector'],
				['Grok Build', 'plugin'],
				['Cursor', 'MCP server'],
				['xAI API', 'remote MCP tool'],
			]
				.map(([name, how]) => `<div class="t"><span class="dot"></span><span class="name">${name}</span><span class="cap">${how}</span></div>`)
				.join('')}</div>
			<div class="foot cap">Free account. No tool that can spend money.</div>`,
			`.hub { position: absolute; left: 72px; top: 386px; width: 480px; height: 88px; border: 1px solid rgba(255,255,255,0.22); border-radius: 14px; padding: 18px 22px; background: #0b0b0e; }
			.hub .url { margin-top: 10px; font: 500 24px/1 'JBMono', monospace; letter-spacing: -0.01em; }
			.wires { position: absolute; inset: 0; }
			.targets { position: absolute; left: 720px; top: 244px; }
			.t { height: 66px; display: flex; align-items: center; gap: 16px; }
			.t .dot { width: 9px; height: 9px; border-radius: 50%; background: #fff; margin-left: -4px; }
			.t .name { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; width: 170px; }
			.foot { position: absolute; left: 72px; top: 494px; font-size: 14px; color: #7a7a84; }`,
		),

		6: f(
			6,
			`<div class="head"><h1>Six runnable examples.</h1><div class="sub">For builders on the Grok API.</div></div>
			<div class="list">${[
				['grok-curl', 'bash, curl', 'remote MCP call, job poll, render'],
				['grok-node-responses', 'Node', 'the Responses API, then a PNG'],
				['grok-python-mcp', 'Python', 'search the catalog, make if none fits'],
				['grok-remote-mcp', 'Node', 'zero dependencies'],
				['grok-agent-avatar', 'Node', 'a 3D avatar with Grok as its brain'],
				['grok-x-search-to-3d', 'Node', 'X search to a 3D prop'],
			]
				.map(([name, stack, what]) => `<div class="li"><span class="name">${name}</span><span class="stack label">${stack}</span><span class="cap">${what}</span></div>`)
				.join('')}</div>
			<div class="term"><span class="p">$</span> npm run grok:examples-smoke<br>${smokePassed ? '<span class="ok">all 6 example(s) passed</span>' : '<span class="p">runs all six against production</span>'}</div>`,
			`.list { position: absolute; left: 72px; right: 72px; top: 214px; border-top: 1px solid rgba(255,255,255,0.12); }
			.li { height: 50px; display: grid; grid-template-columns: 360px 150px 1fr; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); }
			.li .name { font: 500 19px/1 'JBMono', monospace; color: #f1f1f5; }
			.li .cap { font-size: 14px; color: #7d7d87; }
			.term { position: absolute; right: 72px; top: 76px; font: 400 15px/1.7 'JBMono', monospace; color: #c9c9d1; text-align: left; border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 14px 20px; background: #0b0b0e; }
			.term .p { color: #5f5f69; }
			.term .ok { color: #8fe3b0; }`,
		),

		7: f(
			7,
			`<div class="head"><div class="label">${esc(usage.window)}</div></div>
			<div class="stats">
				<div><div class="big">${usage.calls}</div><div class="label">tool calls</div></div>
				<div><div class="big">${usage.days}</div><div class="label">days with traffic</div></div>
				${showErrors ? `<div><div class="big">${usage.errors}</div><div class="label">errors</div></div>` : `<div><div class="big">${usage.prompts}</div><div class="label">distinct prompts</div></div>`}
			</div>
			<div class="chart">${usage.weeks
				.map(([wk, n]) => `<div class="col"><div class="n cap">${n.toLocaleString('en-US')}</div><div class="bar" style="height:${Math.round((n / maxWeek) * 150)}px"></div><div class="wk cap">${wk}</div></div>`)
				.join('')}</div>
			<div class="chartlabel label">Tool calls per week</div>`,
			`.head { top: 72px; }
			.stats { position: absolute; left: 72px; right: 72px; top: 118px; display: flex; justify-content: space-between; }
			.big { font-size: 92px; font-weight: 600; letter-spacing: -0.05em; line-height: 1; white-space: nowrap; }
			.stats .label { margin-top: 14px; }
			.chart { position: absolute; left: 72px; right: 72px; top: 330px; height: 210px; display: flex; align-items: flex-end; gap: 22px; }
			.col { flex: 1; display: flex; flex-direction: column; align-items: stretch; }
			.bar { background: #fff; opacity: 0.88; border-radius: 3px 3px 0 0; }
			.n { text-align: center; margin-bottom: 8px; }
			.wk { text-align: center; margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.14); padding-top: 8px; }
			.chartlabel { position: absolute; right: 72px; top: 300px; color: #5d5d66; }`,
		),

		8: f(
			8,
			`<div class="figure">${torusKnot({ width: 640, height: 600, rings: 200, tilt: 0.95, turn: 0.2 })}</div>
			<div class="left"><div class="mega">No VC.</div><div class="lines"><div>Funded by our community.</div><div class="dim">Approved for xAI's Grok<br>for Startups program.</div></div></div>`,
			`.figure { position: absolute; right: -120px; top: 46%; transform: translateY(-50%); opacity: 0.9; }
			.left { position: absolute; left: 72px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 28px; }
			.mega { font-size: 148px; font-weight: 700; letter-spacing: -0.06em; line-height: 0.9; }
			.lines { font-size: 30px; line-height: 1.35; letter-spacing: -0.02em; font-weight: 500; }
			.dim { color: #8e8e98; font-weight: 400; }`,
		),

		9: f(
			9,
			`<div class="figure">${torusKnot({ width: 620, height: 620, p: 2, q: 3, rings: 220, tube: 0.2, tilt: 0.7, turn: 0.45 })}</div>
			<div class="left"><h1>Ask Grok for<br>anything in 3D.</h1><div class="sub">A character for your game. A prop for your scene. A product for your store. A machine you want to understand.</div><div class="url">three.ws/grok</div></div>`,
			`.figure { position: absolute; right: -10px; top: 50%; transform: translateY(-50%); }
			.left { position: absolute; left: 72px; top: 0; bottom: 0; width: 600px; display: flex; flex-direction: column; justify-content: center; }
			h1 { font-size: 68px; }
			.sub { margin-top: 22px; max-width: 520px; }
			.url { margin-top: 34px; font: 500 22px/1 'JBMono', monospace; color: #fff; border: 1px solid rgba(255,255,255,0.22); border-radius: 999px; padding: 14px 22px; align-self: flex-start; }`,
		),
	};
}
