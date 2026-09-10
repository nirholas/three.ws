#!/usr/bin/env node
// Renders the four diagrams for the IBM Community article draft
// docs/ibm-community-defi-3d-sperax.md into docs/media/.
//
// Styled for IBM Community's light theme (IBM Plex Sans, Carbon greys, IBM
// blue) so they sit natively in the post rather than looking pasted in.
//
// Every value drawn is read from the shipped source it describes:
//   - the emotion decay seconds come from SperaxOS src/components/Avatar3D/emotions.ts
//   - the tool names come from public/sperax/manifest.json
//   - the ported packages come from STRUCTURE.md and each package README
//
//   node scripts/render-ibm-sperax-diagrams.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'docs/media');
mkdirSync(outDir, { recursive: true });

const BLUE = '#0f62fe';
const TEAL = '#007d79';
const PURPLE = '#8a3ffc';
const MAGENTA = '#d02670';
const GREEN = '#198038';
const INK = '#161616';
const MUTE = '#525252';
const LINE = '#e0e0e0';

const shell = (w, body, extraCss = '') => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{ margin:0; padding:0; box-sizing:border-box; }
  html,body{ width:${w}px; background:#fff; color:${INK};
    font-family:'IBM Plex Sans', system-ui, sans-serif; }
  .wrap{ width:100%; padding:56px 64px; display:flex; flex-direction:column; }
  .kicker{ font-size:19px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:${BLUE}; margin-bottom:10px; }
  h1{ font-size:42px; font-weight:600; letter-spacing:-.01em; line-height:1.15; }
  .sub{ font-size:21px; color:${MUTE}; margin-top:12px; line-height:1.45; max-width:1500px; }
  .mono{ font-family:'IBM Plex Mono', ui-monospace, monospace; }
  .foot{ margin-top:44px; padding-top:22px; border-top:1px solid ${LINE};
    display:flex; justify-content:space-between; font-size:17px; color:${MUTE}; }
  ${extraCss}
</style></head><body><div class="wrap">${body}</div></body></html>`;

const foot = (left) =>
	`<div class="foot"><span>${left}</span><span class="mono">three.ws &times; SperaxOS</span></div>`;

// ── 1. Two integration paths ────────────────────────────────────────────────
const paths = () =>
	shell(
		2000,
		`
  <div class="kicker">Embedding an agent in someone else's application</div>
  <h1>Two integration paths. Ship both, in this order.</h1>
  <div class="sub">The choice is not how to render an avatar. It is who owns the React tree.</div>
  <div class="cols">
    ${[
			{
				n: '1',
				c: BLUE,
				t: 'Standalone plugin',
				w: 'The host will not take your code',
				items: [
					['One hosted manifest', 'served with CORS at a well-known URL'],
					['One hosted iframe', 'the visible avatar panel'],
					['Four HTTP endpoints', 'render_agent, speak, gesture, emote'],
				],
				pro: 'Live in a day. Nothing to vendor, review, or audit.',
				con: 'No shared context. A second renderer. Cannot compose into a message.',
			},
			{
				n: '2',
				c: PURPLE,
				t: 'Native component',
				w: 'The host wants the dependency',
				items: [
					['npm install three.ws', 'the &lt;agent-3d&gt; custom element'],
					['Same React tree', 'no iframe, no sandbox'],
					['Client tool lane', 'animation calls never leave the browser'],
				],
				pro: 'Composes into chat messages. Finds the bugs the iframe hides.',
				con: 'A dependency the host has to trust and upgrade.',
			},
		]
			.map(
				(p) => `<div class="card" style="border-top:6px solid ${p.c}">
      <div class="cn" style="color:${p.c}">Path ${p.n}</div>
      <div class="ct">${p.t}</div>
      <div class="cw">When: ${p.w}</div>
      <div class="rows">${p.items
			.map(
				(i) =>
					`<div class="row"><div class="rt mono" style="color:${p.c}">${i[0]}</div><div class="rs">${i[1]}</div></div>`,
			)
			.join('')}</div>
      <div class="verdict"><span class="tag good">Gets you</span>${p.pro}</div>
      <div class="verdict"><span class="tag bad">Costs you</span>${p.con}</div>
    </div>`,
			)
			.join('')}
  </div>
  ${foot('SperaxOS is in both camps at once, so the integration has both halves')}`,
		`
  .cols{ display:grid; grid-template-columns:1fr 1fr; gap:34px; margin-top:36px; }
  .card{ border:1px solid ${LINE}; background:#f4f4f4; padding:32px 34px 30px; display:flex; flex-direction:column; }
  .cn{ font-size:17px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; }
  .ct{ font-size:34px; font-weight:600; margin-top:6px; }
  .cw{ font-size:20px; color:${MUTE}; margin-top:6px; }
  .rows{ margin-top:24px; display:flex; flex-direction:column; gap:14px; }
  .row{ background:#fff; border:1px solid ${LINE}; padding:14px 18px; }
  .rt{ font-size:20px; font-weight:500; }
  .rs{ font-size:18px; color:${MUTE}; margin-top:3px; }
  .verdict{ font-size:19px; color:${INK}; margin-top:18px; line-height:1.45; }
  .tag{ display:inline-block; font-size:15px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
    padding:3px 9px; margin-right:10px; vertical-align:2px; }
  .good{ background:#defbe6; color:${GREEN}; }
  .bad{ background:#fff1f1; color:${MAGENTA}; }`,
	);

// ── 2. Two halves per tool call ─────────────────────────────────────────────
// The connector is one SVG rather than CSS pseudo-elements: borders on the
// boxes plus 1px pseudo-element rules read as an unintended open rectangle.
const forkConnector = () => {
	const W = 1872;
	const H = 92;
	const cx = W / 2;
	const lx = W * 0.235;
	const rx = W * 0.765;
	const head = (x) =>
		`<path d="M ${x - 8} ${H - 13} L ${x} ${H - 1} L ${x + 8} ${H - 13}" fill="none" stroke="${MUTE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
	return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">
    <path d="M ${cx} 0 L ${cx} ${H / 2} M ${lx} ${H / 2} L ${rx} ${H / 2} M ${lx} ${H / 2} L ${lx} ${H - 2} M ${rx} ${H / 2} L ${rx} ${H - 2}"
      fill="none" stroke="${MUTE}" stroke-width="2"/>
    ${head(lx)}${head(rx)}
  </svg>`;
};

const halves = () =>
	shell(
		2000,
		`
  <div class="kicker">The rule that keeps the body honest</div>
  <h1>Every tool call runs in two halves, in parallel.</h1>
  <div class="sub">The model never asserts that it waved. It receives a result saying the wave was dispatched, and the panel is what actually waved.</div>
  <div class="flow">
    <div class="step host">
      <div class="sl">Host application</div>
      <div class="sb mono">the model calls a tool<br><span style="color:${BLUE}">speak(text, sentiment)</span></div>
    </div>
    ${forkConnector()}
    <div class="fork">
      <div class="branch" style="border-top:5px solid ${PURPLE}">
        <div class="bl" style="color:${PURPLE}">2a &nbsp;the visible body</div>
        <div class="sb">host frames <span class="mono">ui.url</span> and posts the call into it<br>
          <span class="mono" style="color:${PURPLE}">&lt;agent-3d&gt;</span> animates the avatar in the panel</div>
      </div>
      <div class="branch" style="border-top:5px solid ${TEAL}">
        <div class="bl" style="color:${TEAL}">2b &nbsp;the model-facing result</div>
        <div class="sb">gateway POSTs the arguments to <span class="mono">api[].url</span><br>
          <span class="mono" style="color:${TEAL}">{ ok: true, action: "speak", spoken: "..." }</span></div>
      </div>
    </div>
  </div>
  <div class="note"><strong>The bug this prevents:</strong> the first version confirmed any agent ID. A user with a typo got a model
  saying "I have bound to your agent" over an empty panel, forever. The endpoint now resolves the ID before it answers, and a
  database outage degrades to an unverified binding rather than a 500, so an outage on one side never takes the host's chat panel down.</div>
  ${foot('Both halves run on every call')}`,
		`
  .flow{ margin-top:40px; display:flex; flex-direction:column; align-items:center; }
  .step{ border:1px solid ${LINE}; background:#f4f4f4; padding:22px 34px; text-align:center; min-width:660px; }
  .host{ border-top:5px solid ${BLUE}; }
  .sl{ font-size:17px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:${MUTE}; }
  .sb{ font-size:21px; margin-top:8px; line-height:1.55; }
  .fork{ display:grid; grid-template-columns:1fr 1fr; gap:56px; width:100%; }
  .branch{ border:1px solid ${LINE}; background:#fff; padding:24px 30px; }
  .bl{ font-size:19px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; margin-bottom:6px; }
  .note{ margin-top:38px; border-left:5px solid ${BLUE}; background:#edf5ff; padding:20px 26px;
    font-size:20px; line-height:1.55; color:${INK}; }`,
	);

// ── 3. Empathy Layer decay curves ───────────────────────────────────────────
// intensity(t) = exp(-ln(20) * t / decaySeconds): a full spike reaches 0.05 at
// decaySeconds, matching DECAY_FLOOR in emotions.ts.
const EMOTIONS = [
	{ name: 'celebration', secs: 6, color: MAGENTA, why: 'bright but brief' },
	{ name: 'curiosity', secs: 8, color: BLUE, why: 'alert, engaged' },
	{ name: 'concern', secs: 12, color: '#ff832b', why: 'lingers, so a risk stays on the face' },
	{ name: 'empathy', secs: 13, color: PURPLE, why: 'slow to fade, like the real thing' },
	{ name: 'patience', secs: 20, color: TEAL, why: 'sustained waiting state' },
];

function decayChart() {
	const W = 1080;
	const H = 470;
	const PADL = 74;
	const PADB = 62;
	const PADT = 18;
	const TMAX = 22;
	const x = (t) => PADL + (t / TMAX) * (W - PADL - 30);
	const y = (v) => PADT + (1 - v) * (H - PADT - PADB);
	const ln20 = Math.log(20);
	const curves = EMOTIONS.map((e) => {
		const pts = [];
		for (let i = 0; i <= 220; i++) {
			const t = (i / 220) * TMAX;
			pts.push(`${x(t).toFixed(1)},${y(Math.exp((-ln20 * t) / e.secs)).toFixed(1)}`);
		}
		return `<polyline points="${pts.join(' ')}" fill="none" stroke="${e.color}" stroke-width="3.5" stroke-linecap="round"/>
      <circle cx="${x(e.secs).toFixed(1)}" cy="${y(0.05).toFixed(1)}" r="5" fill="${e.color}"/>`;
	}).join('');
	const grid = [0, 0.25, 0.5, 0.75, 1]
		.map(
			(v) =>
				`<line x1="${PADL}" y1="${y(v)}" x2="${W - 30}" y2="${y(v)}" stroke="${LINE}" stroke-width="1"/>
       <text x="${PADL - 14}" y="${y(v) + 6}" text-anchor="end" font-size="17" fill="${MUTE}" font-family="IBM Plex Mono">${v.toFixed(2)}</text>`,
		)
		.join('');
	const ticks = [0, 5, 10, 15, 20]
		.map(
			(t) =>
				`<text x="${x(t)}" y="${H - PADB + 30}" text-anchor="middle" font-size="17" fill="${MUTE}" font-family="IBM Plex Mono">${t}s</text>`,
		)
		.join('');
	return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${grid}
    <line x1="${PADL}" y1="${y(0.05)}" x2="${W - 30}" y2="${y(0.05)}" stroke="${MUTE}" stroke-width="1" stroke-dasharray="5 5"/>
    <text x="${W - 32}" y="${y(0.05) - 12}" text-anchor="end" font-size="17" fill="${MUTE}" font-family="IBM Plex Mono">DECAY_FLOOR 0.02 to 0.05</text>
    ${curves}${ticks}
    <text x="${PADL}" y="${H - 12}" font-size="18" fill="${MUTE}">time since the event spiked the emotion</text>
  </svg>`;
}

const empathy = () =>
	shell(
		2000,
		`
  <div class="kicker">Section 2 &middot; the Empathy Layer</div>
  <h1>A continuous blend, not a state machine.</h1>
  <div class="sub">Each emotion is a float in [0, 1]. Events spike it, and it decays exponentially at its own rate. Every active
  emotion is blended into morph targets and body language on every frame, so a face can hold three feelings at once.</div>
  <div class="grid">
    <div class="chart">${decayChart()}</div>
    <div class="legend">
      <div class="lh">Decay is the personality</div>
      ${EMOTIONS.map(
				(e) => `<div class="li">
        <span class="swatch" style="background:${e.color}"></span>
        <span class="ln mono">${e.name}</span>
        <span class="ls mono">${e.secs}s</span>
        <span class="lw">${e.why}</span>
      </div>`,
			).join('')}
      <div class="blendbox">
        <div class="lh" style="margin-bottom:14px">What a face holds at one moment</div>
        ${[
					['concern', 40, '#ff832b'],
					['curiosity', 30, BLUE],
					['neutral', 30, '#8d8d8d'],
				]
					.map(
						([n, p, c]) => `<div class="bar">
          <span class="bn mono">${n}</span>
          <span class="btrack"><span class="bfill" style="width:${p}%;background:${c}"></span></span>
          <span class="bp mono">${p}%</span></div>`,
					)
					.join('')}
        <div class="bnote">A state machine has to pick one of these. That snap is what reads as a cartoon.</div>
      </div>
    </div>
  </div>
  ${foot('Values read from the shipped emotion table, ported between both codebases')}`,
		`
  .grid{ display:grid; grid-template-columns:1080px 1fr; gap:44px; margin-top:32px; align-items:start; }
  .chart{ border:1px solid ${LINE}; background:#f4f4f4; padding:16px 10px 4px; }
  .legend{ display:flex; flex-direction:column; }
  .lh{ font-size:19px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:${MUTE}; margin-bottom:16px; }
  .li{ display:flex; align-items:baseline; gap:12px; padding:11px 0; border-bottom:1px solid ${LINE}; }
  .swatch{ width:16px; height:16px; flex:0 0 16px; }
  .ln{ font-size:21px; font-weight:500; width:170px; }
  .ls{ font-size:21px; color:${INK}; width:64px; }
  .lw{ font-size:18px; color:${MUTE}; }
  .blendbox{ margin-top:34px; border:1px solid ${LINE}; background:#edf5ff; padding:24px 26px; }
  .bar{ display:flex; align-items:center; gap:14px; margin-bottom:12px; }
  .bn{ font-size:19px; width:140px; }
  .btrack{ flex:1; height:16px; background:#fff; border:1px solid ${LINE}; }
  .bfill{ display:block; height:100%; }
  .bp{ font-size:19px; width:60px; text-align:right; }
  .bnote{ font-size:18px; color:${MUTE}; margin-top:14px; line-height:1.5; }`,
	);

// ── 4. Two-way code exchange ────────────────────────────────────────────────
const exchange = () =>
	shell(
		2000,
		`
  <div class="kicker">Section 5 &middot; the part nobody puts in a press release</div>
  <h1>Most of the code moved in the direction opposite to the marketing.</h1>
  <div class="sub">If you are negotiating an integration, this is the clause to push for: a shared right to port implementation between the two codebases.</div>
  <div class="ex">
    <div class="side">
      <div class="sh" style="color:${BLUE}">three.ws &rarr; SperaxOS</div>
      ${[
				['Empathy Layer', 'continuous emotion blend, engine kept pure'],
				['Lip-sync driver', 'RMS amplitude to a jaw morph, composed on top'],
				['Inline 3D chat element', 'a live model inside a markdown message'],
				['Client tool dispatcher', 'animation calls never round-trip a server'],
				['Hash-chained action ledger', 'plus the reconcile job that reads it'],
			]
				.map(
					(i) =>
						`<div class="item"><div class="it">${i[0]}</div><div class="is">${i[1]}</div></div>`,
				)
				.join('')}
    </div>
    <div class="arrows"><div class="a" style="color:${BLUE}">&rarr;</div><div class="a" style="color:${TEAL}">&larr;</div></div>
    <div class="side">
      <div class="sh" style="color:${TEAL}">SperaxOS &rarr; three.ws</div>
      ${[
				['@three-ws/defi-utils', 'chain and token constants, address validation'],
				['@three-ws/tool-sdk', 'defineTool, defineExecutor, toMcpTools'],
				['Liquidation collector', 'three exchange streams, since hardened'],
				['Rigor about sourcing', 'no figure ships that cannot be read live'],
				['A second production host', 'the environment that found our real bugs'],
			]
				.map(
					(i) =>
						`<div class="item"><div class="it">${i[0]}</div><div class="is">${i[1]}</div></div>`,
				)
				.join('')}
    </div>
  </div>
  ${foot('A partnership measured in merged code ages better than one measured in announcements')}`,
		`
  .ex{ display:grid; grid-template-columns:1fr 120px 1fr; gap:0; margin-top:38px; align-items:start; }
  .side{ border:1px solid ${LINE}; background:#f4f4f4; padding:28px 30px; }
  .sh{ font-size:23px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; margin-bottom:20px; }
  .item{ background:#fff; border:1px solid ${LINE}; padding:14px 18px; margin-bottom:12px; }
  .it{ font-size:22px; font-weight:500; }
  .is{ font-size:18px; color:${MUTE}; margin-top:3px; }
  .arrows{ display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding-top:90px; gap:26px; }
  .a{ font-size:56px; line-height:1; }`,
	);

const JOBS = [
	['ibm-sperax-integration-paths.png', paths()],
	['ibm-sperax-tool-call-halves.png', halves()],
	['ibm-sperax-empathy-decay.png', empathy()],
	['ibm-sperax-code-exchange.png', exchange()],
];

// Height is whatever the content needs: a fixed canvas leaves a band of dead
// white under every diagram, which reads as a broken image in a blog post.
const browser = await chromium.launch();
for (const [file, html] of JOBS) {
	const page = await browser.newPage({ viewport: { width: 2000, height: 800 }, deviceScaleFactor: 1 });
	await page.setContent(html, { waitUntil: 'networkidle' });
	await page.evaluate(() => document.fonts.ready);
	await page.screenshot({ path: resolve(outDir, file), fullPage: true });
	const box = await page.evaluate(() => document.body.scrollHeight);
	await page.close();
	console.log(`wrote docs/media/${file}  (2000x${box})`);
}
await browser.close();
