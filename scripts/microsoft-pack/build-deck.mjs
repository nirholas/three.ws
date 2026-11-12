#!/usr/bin/env node
/**
 * Builds docs/partners/microsoft/deck.pptx: the 10-slide three.ws deck for
 * Microsoft audiences (partner managers, program reviewers, event teams).
 *
 * Library: PptxGenJS 4.0.1 (MIT, https://github.com/gitbrent/PptxGenJS),
 * installed in this folder's package.json so it never ships with the app.
 *
 * Every number comes from MEASURED below, and every MEASURED value is listed
 * with its query or endpoint in docs/partners/microsoft/sources.md. Re-measure
 * there first, update MEASURED, then rebuild:
 *   npm --prefix scripts/microsoft-pack run deck
 *
 * The build fails when any slide text breaks the pack's wording rules
 * (wording.mjs), when a screenshot is missing, or when the written file does
 * not contain exactly 10 slides with their images.
 */
import pptxgen from 'pptxgenjs';
import JSZip from 'jszip';
import sharp from 'sharp';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, wordingProblems } from './wording.mjs';

const packDir = join(repoRoot, 'docs/partners/microsoft');
const outPath = join(packDir, 'deck.pptx');
const shot = (name) => join(packDir, 'screenshots', name);
const brand = (name) => join(repoRoot, 'public/brand', name);

// Read 2026-11-12; sources.md lists the query or endpoint behind each value.
const MEASURED = {
	date: '12 November 2026',
	models: '54,356',
	trellisDone: '29,443',
	trellisJobs: '35,531',
	trellisSince: '8 July 2026',
	agents: '4,936',
	embeds: '655',
	mcpTools: '16',
	stars: '276',
	forks: '78',
	tiers: [
		{ tier: 'Draft', jobs: '1,404', median: '132 s', size: '1.51 MB' },
		{ tier: 'Standard', jobs: '1,956', median: '234 s', size: '6.06 MB' },
		{ tier: 'High', jobs: '275', median: '602 s', size: '17.21 MB' },
	],
	teamsTests: '97',
	manifestSchema: 'v1.30',
};

const C = {
	bg: '08090D',
	panel: '12141B',
	line: '262A35',
	ink: 'F2F3F5',
	dim: '8D93A1',
	soft: 'C7CBD4',
	green: '22C55E',
	amber: 'F59E0B',
	blue: '60A5FA',
};
const DISPLAY = 'Segoe UI Semibold';
const BODY = 'Segoe UI';
const MONO = 'Cascadia Code';

// The footer mark sits on every slide at 0.28 in; the 1 MB brand master would
// be embedded ten times, so it is downscaled once to 2x its printed size.
const MARK_H = 0.28;
const markData = `image/png;base64,${(await sharp(brand('three-ws-mark.png')).resize({ height: 64 }).png().toBuffer()).toString('base64')}`;

const W = 13.333;
const H = 7.5;
const M = 0.6;

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'three.ws';
pptx.company = 'three.ws';
pptx.title = 'three.ws for Microsoft audiences';
pptx.subject = 'A sentence or a photo in. A rigged 3D agent that speaks, out.';

// Every string placed on a slide or in its notes is collected here and run
// through the wording rules before the file is written.
const allText = [];
const record = (t) => {
	const s = Array.isArray(t) ? t.map((r) => r.text).join('') : t;
	allText.push(s);
	return t;
};

function pngSize(path) {
	const b = readFileSync(path);
	return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// Fit an image inside a box without distorting it, centred.
function fitImage(slide, path, box) {
	const { w, h } = pngSize(path);
	const scale = Math.min(box.w / w, box.h / h);
	const iw = w * scale;
	const ih = h * scale;
	slide.addImage({ path, x: box.x + (box.w - iw) / 2, y: box.y + (box.h - ih) / 2, w: iw, h: ih });
}

function newSlide(title, kicker, notes) {
	const slide = pptx.addSlide();
	slide.background = { color: C.bg };
	if (kicker) {
		slide.addText(record(kicker.toUpperCase()), {
			x: M, y: 0.45, w: W - 2 * M, h: 0.3, fontFace: MONO, fontSize: 11, color: C.green, charSpacing: 2, margin: 0,
		});
	}
	if (title) {
		slide.addText(record(title), {
			x: M, y: 0.75, w: W - 2 * M, h: 0.8, fontFace: DISPLAY, fontSize: 30, color: C.ink, margin: 0, valign: 'top',
		});
	}
	slide.addImage({ data: markData, x: W - M - MARK_H * (898 / 1024), y: H - 0.52, w: MARK_H * (898 / 1024), h: MARK_H });
	slide.addText(record('three.ws'), {
		x: M, y: H - 0.52, w: 3, h: 0.28, fontFace: MONO, fontSize: 10, color: C.dim, margin: 0, valign: 'middle',
	});
	if (notes) slide.addNotes(record(notes));
	return slide;
}

function text(slide, value, opts) {
	slide.addText(record(value), { fontFace: BODY, color: C.soft, margin: 0, valign: 'top', ...opts });
}

function panel(slide, { x, y, w, h, accent }) {
	slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: C.panel }, line: { color: C.line, width: 0.75 } });
	if (accent) slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.06, h, fill: { color: accent }, line: { color: accent, width: 0 } });
}

function card(slide, { x, y, w, h, title, body, accent, titleSize = 15, bodySize = 12 }) {
	panel(slide, { x, y, w, h, accent });
	text(slide, title, { x: x + 0.25, y: y + 0.2, w: w - 0.45, h: 0.45, fontFace: DISPLAY, fontSize: titleSize, color: C.ink });
	text(slide, body, { x: x + 0.25, y: y + 0.7, w: w - 0.45, h: h - 0.85, fontSize: bodySize, lineSpacingMultiple: 1.1 });
}

// 1. Title
{
	const s = newSlide(null, null, `three.ws in one line: an open-source platform that turns a sentence or a photo into a rigged 3D agent that speaks, and ships it with one HTML tag. Say the partnership exactly as the slide does. Numbers in this deck were measured ${MEASURED.date}; sources are in docs/partners/microsoft/sources.md.`);
	s.addImage({ path: brand('three-ws-lockup-on-dark.png'), x: M, y: 0.8, w: 2.4, h: 2.4 * (400 / 1592) });
	text(s, 'A sentence or a photo in. A rigged 3D agent that speaks, out.', {
		x: M, y: 1.8, w: 5.9, h: 2.2, fontFace: DISPLAY, fontSize: 36, color: C.ink, lineSpacingMultiple: 0.95,
	});
	text(s, 'Open-source (Apache-2.0) 3D agents for the web, Microsoft 365 and every MCP client.', {
		x: M, y: 4.15, w: 5.9, h: 0.8, fontSize: 16,
	});
	text(s, 'three.ws and Microsoft have announced a partnership, and three.ws is live on Microsoft Marketplace.', {
		x: M, y: 5.2, w: 5.9, h: 0.7, fontSize: 13, color: C.dim,
	});
	const heroW = W - 6.9 - M;
	const heroH = (heroW - 0.2) * (9 / 16) + 0.2;
	panel(s, { x: 6.9, y: 1.8, w: heroW, h: heroH });
	fitImage(s, shot('model-view.png'), { x: 7.0, y: 1.9, w: heroW - 0.2, h: heroH - 0.2 });
	text(s, 'A wooden violin generated from one sentence, in the three.ws viewer', {
		x: 6.9, y: 1.85 + heroH, w: heroW, h: 0.3, fontSize: 10, color: C.dim,
	});
}

// 2. Problem
{
	const s = newSlide('3D and agents are slow, separate, specialist work', 'The problem',
		'Three gaps, all qualitative on purpose: we do not quote market sizes we have not measured.');
	const cols = [
		['3D content needs specialists', 'Modelling, texturing and rigging a character is skilled manual work in desktop tools, so most product teams never ship 3D at all.'],
		['Agents have no presence', 'Assistants answer in a text box. There is no face, voice or body a customer recognises, and nothing to put on a page, in a meeting or in a store.'],
		['Every surface is a new integration', 'The web, Teams, Copilot, Power Platform and a company intranet each need their own packaging, sign-in and card formats before a single user sees anything.'],
	];
	const cw = (W - 2 * M - 0.5) / 3;
	cols.forEach(([title, body], i) => card(s, { x: M + i * (cw + 0.25), y: 1.95, w: cw, h: 2.55, title, body, accent: C.amber, bodySize: 14 }));
	panel(s, { x: M, y: 4.8, w: W - 2 * M, h: 1.2, accent: C.green });
	text(s, 'three.ws closes all three gaps with one pipeline: the same agent, generated in minutes, runs on a web page, in Teams, in Copilot Studio and in Power Platform.', {
		x: M + 0.35, y: 4.95, w: W - 2 * M - 0.6, h: 0.9, fontFace: DISPLAY, fontSize: 17, color: C.ink, valign: 'middle',
	});
}

// 3. Product
{
	const s = newSlide('One pipeline from a sentence to a speaking agent', 'The product',
		'Walk left to right. The snippet is the real embed from docs/embedding.md: a bare GLB body plus brain="free" gives a talking agent with no key and no backend.');
	const steps = [
		['Generate', 'Text, photo or sketch to a textured 3D model (GLB) on our own GPU fleet.'],
		['Rig', 'A humanoid skeleton and skin weights, so the model can pose and animate.'],
		['Give it a voice', 'Persona, memory and skills, with speech and lip-sync in the browser.'],
		['Ship it', 'One HTML tag, MCP servers and SDKs put the agent anywhere.'],
	];
	const sw = (W - 2 * M - 0.6) / 4;
	steps.forEach(([title, body], i) => {
		card(s, { x: M + i * (sw + 0.2), y: 1.95, w: sw, h: 2.0, title: `${i + 1}  ${title}`, body, accent: C.green, bodySize: 13 });
	});
	panel(s, { x: M, y: 4.25, w: W - 2 * M, h: 2.3 });
	text(s, 'The whole install', { x: M + 0.3, y: 4.4, w: 4, h: 0.35, fontFace: DISPLAY, fontSize: 14, color: C.ink });
	text(s, [
		'<script type="module" src="https://unpkg.com/three.ws"></script>\n',
		'<agent-3d\n',
		'  body="https://three.ws/avatars/realistic-female.glb"\n',
		'  brain="free"\n',
		'  instructions="You are Maya, a friendly guide to this site."\n',
		'></agent-3d>',
	].join(''), { x: M + 0.3, y: 4.85, w: W - 2 * M - 0.6, h: 1.6, fontFace: MONO, fontSize: 13, color: C.ink });
}

// 4. Microsoft surfaces
{
	const s = newSlide('Microsoft surfaces: live today, and built for what comes next', 'Microsoft surfaces',
		'Left column runs in production for real users. Right column is in the open-source repository, passes its automated checks, and waits on a publication step in Partner Center or a store. Nothing on the right is described as approved or listed.');
	const live = [
		['Microsoft Marketplace', 'Publisher listing live. Same platform as three.ws; nothing forks for the channel.'],
		['TRELLIS (Microsoft Research, MIT)', `Self-hosted image-to-3D on NVIDIA L4 GPUs: ${MEASURED.trellisJobs} jobs since ${MEASURED.trellisSince}.`],
		['ONNX Runtime Web', 'Wake word, voice activity and transcription in the visitor\'s browser.'],
		['Adaptive Cards 1.6', 'One agent card layout for chat hosts and the Windows widgets board.'],
	];
	const ready = [
		['App for Teams and Microsoft 365', `Bot, two tabs, search extension, agent connector. Manifest ${MEASURED.manifestSchema}, checks pass.`],
		['MCP server for Copilot Studio and Foundry', `Streamable HTTP, ${MEASURED.mcpTools} tools; certification package drafted.`],
		['Power Platform connector', 'Five actions, OAuth with PKCE, four flow templates.'],
		['Microsoft 365 Copilot connector', 'Agents, models and avatars indexed into the tenant through Microsoft Graph.'],
		['Marketplace SaaS offer', 'Entra sign-in, SaaS Fulfillment v2, hourly metered billing.'],
		['Microsoft Store and Edge Add-ons', 'The web app as MSIX, and the browser extension.'],
	];
	const colW = (W - 2 * M - 0.4) / 2;
	const column = (x, heading, color, rows, rowH) => {
		text(s, heading, { x, y: 1.75, w: colW, h: 0.35, fontFace: MONO, fontSize: 12, color });
		rows.forEach(([title, body], i) => {
			const y = 2.15 + i * (rowH + 0.08);
			panel(s, { x, y, w: colW, h: rowH, accent: color });
			text(s, title, { x: x + 0.25, y: y + 0.08, w: colW - 0.4, h: 0.32, fontFace: DISPLAY, fontSize: 13, color: C.ink });
			text(s, body, { x: x + 0.25, y: y + 0.4, w: colW - 0.4, h: rowH - 0.45, fontSize: 11 });
		});
	};
	column(M, 'LIVE IN PRODUCTION', C.green, live, 1.0);
	column(M + colW + 0.4, 'BUILT, AWAITING PUBLICATION', C.amber, ready, 0.66);
}

// 5. Architecture on Microsoft technology
{
	const s = newSlide('Architecture on Microsoft technology', 'How it fits together',
		'Blue edges mark Microsoft technology. The platform runs on Google Cloud Run; TRELLIS runs on our own NVIDIA L4 GPUs. Speech never leaves the browser: ONNX Runtime Web runs the VAD, the wake word and the transcription models locally.');
	const box = (x, y, w, h, title, body, ms) => {
		panel(s, { x, y, w, h, accent: ms ? C.blue : C.line });
		text(s, title, { x: x + 0.2, y: y + 0.1, w: w - 0.3, h: 0.32, fontFace: DISPLAY, fontSize: 12.5, color: C.ink });
		if (body) text(s, body, { x: x + 0.2, y: y + 0.42, w: w - 0.3, h: h - 0.47, fontSize: 10.5 });
	};
	text(s, 'WHERE PEOPLE MEET THE AGENT', { x: M, y: 1.7, w: 3.6, h: 0.3, fontFace: MONO, fontSize: 10, color: C.dim });
	const left = [
		['Any web page or intranet', '<agent-3d> web component'],
		['Teams and Microsoft 365', 'Bot, tabs and search on Adaptive Cards'],
		['Copilot Studio and Foundry', 'Through the MCP server'],
		['Power Automate and Power Apps', 'Power Platform connector'],
	];
	left.forEach(([t, b], i) => box(M, 2.05 + i * 0.95, 3.6, 0.85, t, b, i > 0));
	text(s, 'THREE.WS PLATFORM (GOOGLE CLOUD RUN)', { x: 4.95, y: 1.7, w: 3.8, h: 0.3, fontFace: MONO, fontSize: 10, color: C.dim });
	box(4.95, 2.05, 3.8, 0.85, 'API and agent runtime', 'Persona, memory, skills, speech and lip-sync', false);
	box(4.95, 3.0, 3.8, 0.85, `MCP server, ${MEASURED.mcpTools} tools`, 'Free, no account and no key', false);
	box(4.95, 3.95, 3.8, 0.85, 'Marketplace SaaS fulfilment', 'Entra sign-in, Fulfillment v2, metering', true);
	box(4.95, 4.9, 3.8, 0.85, 'Adaptive Cards renderer', 'Agent card 1.6, progress card 1.5', true);
	text(s, 'GPU WORKERS', { x: 9.35, y: 1.7, w: 3.4, h: 0.3, fontFace: MONO, fontSize: 10, color: C.dim });
	box(9.35, 2.05, W - 9.35 - M, 1.35, 'TRELLIS on NVIDIA L4', 'Microsoft Research, MIT. Image to textured GLB, one job per GPU', true);
	box(9.35, 3.5, W - 9.35 - M, 1.3, 'TRELLIS.2 worker', 'Deployed and tested; not yet serving the image-to-3D lane', true);
	panel(s, { x: M, y: 5.95, w: W - 2 * M, h: 0.85, accent: C.blue });
	text(s, 'IN THE VISITOR\'S BROWSER: ONNX Runtime Web', { x: M + 0.25, y: 6.02, w: 6, h: 0.3, fontFace: DISPLAY, fontSize: 12.5, color: C.ink });
	text(s, 'Silero VAD, openWakeWord, Moonshine Base (English) and Whisper Base (other languages), all on the WebAssembly execution provider. Audio stays on the device.', {
		x: M + 0.25, y: 6.33, w: W - 2 * M - 0.5, h: 0.45, fontSize: 10.5,
	});
	text(s, 'Blue edge: Microsoft technology', { x: 9.35, y: 5.05, w: W - 9.35 - M, h: 0.3, fontSize: 10, color: C.blue });
}

// 6. Traction
{
	const s = newSlide('Traction, measured', `Production data, ${MEASURED.date}`,
		`Every figure is read from production or a public API on ${MEASURED.date}; sources.md gives the query or endpoint for each. TRELLIS medians are wall time from job accepted to GLB finished, last 30 days, completed jobs only.`);
	const stats = [
		[MEASURED.models, '3D models generated on three.ws'],
		[MEASURED.trellisDone, `models finished by TRELLIS on our GPUs since ${MEASURED.trellisSince}`],
		[MEASURED.agents, 'agents created'],
		[MEASURED.embeds, 'live embeds on other sites'],
		[MEASURED.mcpTools, 'tools on the free MCP server'],
		[`${MEASURED.stars}`, `GitHub stars and ${MEASURED.forks} forks, Apache-2.0`],
	];
	const sw = (W - 2 * M - 0.5) / 3;
	stats.forEach(([n, label], i) => {
		const x = M + (i % 3) * (sw + 0.25);
		const y = 1.85 + Math.floor(i / 3) * 1.6;
		panel(s, { x, y, w: sw, h: 1.45 });
		text(s, n, { x: x + 0.3, y: y + 0.18, w: sw - 0.5, h: 0.65, fontFace: DISPLAY, fontSize: 34, color: C.ink });
		text(s, label, { x: x + 0.3, y: y + 0.88, w: sw - 0.5, h: 0.5, fontSize: 12 });
	});
	const rows = [
		['TRELLIS tier, last 30 days', 'Jobs finished', 'Median wall time', 'Median GLB'].map((t) => ({ text: record(t), options: { bold: true, color: C.ink, fill: { color: C.panel } } })),
		...MEASURED.tiers.map((t) => [t.tier, t.jobs, t.median, t.size].map((v) => ({ text: record(v), options: { color: C.soft, fill: { color: C.panel } } }))),
	];
	s.addTable(rows, {
		x: M, y: 5.15, w: W - 2 * M, colW: [3.9, 2.7, 2.7, 2.83], rowH: 0.32, fontFace: BODY, fontSize: 11, color: C.soft,
		fill: { color: C.panel }, border: { type: 'solid', color: C.line, pt: 0.75 }, margin: [0, 8, 0, 8], valign: 'middle',
	});
}

// 7. What it looks like
{
	const s = newSlide('In Teams, and in any MCP client', 'What people see',
		'Left: the agent tab built for Teams, captured from the live page at /microsoft/teams-tab. Right: the connection details for the free MCP server, from the live docs. Both are real screenshots, refreshed with scripts/microsoft-pack/capture-screenshots.mjs.');
	panel(s, { x: M, y: 1.7, w: 4.6, h: 4.65 });
	fitImage(s, shot('teams-tab.png'), { x: M + 0.15, y: 1.8, w: 4.3, h: 4.45 });
	text(s, 'Agent tab, built for Teams: a live 3D agent with chat', { x: M, y: 6.42, w: 4.6, h: 0.3, fontSize: 10, color: C.dim });
	const rx = M + 4.9;
	const rw = W - rx - M;
	panel(s, { x: rx, y: 1.7, w: rw, h: 2.35 });
	fitImage(s, shot('docs-mcp-studio.png'), { x: rx + 0.15, y: 1.8, w: rw - 0.3, h: 2.15 });
	text(s, 'Free MCP server: no account, no key', { x: rx, y: 4.12, w: rw, h: 0.3, fontSize: 10, color: C.dim });
	card(s, {
		x: rx, y: 4.55, w: rw, h: 1.8, accent: C.green, title: 'Tested, not just drawn',
		body: `${MEASURED.teamsTests} automated tests cover the Teams bot, the generation flow and cards, the agent card, the meeting stage view and the package builder. The app manifest validates against schema ${MEASURED.manifestSchema}.`,
	});
}

// 8. Customer story template
{
	const s = newSlide('Customer story', 'Template',
		'This slide is the frame for the first published customer story. Fill it from programs/case-study-template.md once a customer has approved the wording and every result is a number they measured. Until then, present it as the shape of the story, not as a story.');
	const blocks = [
		['Customer and team', 'Organisation, industry and the team that owns the experience.'],
		['The challenge', 'What they needed a 3D agent for, and what they used before.'],
		['What they built', 'The three.ws pieces and the Microsoft surfaces they used: Teams app, Copilot Studio through MCP, Power Platform connector, Marketplace purchase.'],
		['The result', 'Numbers the customer measured and approved: time to first agent, assets produced, usage after launch.'],
	];
	const bw = (W - 2 * M - 0.25) / 2;
	blocks.forEach(([title, body], i) => card(s, {
		x: M + (i % 2) * (bw + 0.25), y: 1.85 + Math.floor(i / 2) * 2.05, w: bw, h: 1.85, title, body, accent: C.blue, bodySize: 13,
	}));
	text(s, 'A quote from the customer, in their words and approved by them, closes the story.', {
		x: M, y: 6.0, w: W - 2 * M, h: 0.4, fontSize: 13, color: C.dim, italic: true,
	});
}

// 9. Roadmap
{
	const s = newSlide('Roadmap on Microsoft surfaces', 'What comes next',
		'Ordered by the owner checklist in docs/microsoft-marketplace-offer-plan.md, because later steps take values from earlier ones. Each step is a submission by three.ws followed by Microsoft\'s own review, so no dates are promised.');
	const steps = [
		['Marketplace SaaS offer', 'Buy three.ws through an existing Microsoft agreement, with Entra sign-in and metered billing.'],
		['Teams and Microsoft 365 app', 'Bot, tabs, search extension and the agent connector, submitted through Partner Center.'],
		['Copilot Studio and Foundry', 'The MCP server submitted to the Copilot connector catalog.'],
		['Power Platform connector', 'Five actions and four flow templates, submitted for certification.'],
		['Microsoft 365 Copilot connector', 'Agents, models and avatars searchable in the customer\'s tenant.'],
		['Store, Edge and TRELLIS.2', 'MSIX and browser extension listings; TRELLIS.2 serving image-to-3D.'],
	];
	const sw = (W - 2 * M - 0.5) / 3;
	steps.forEach(([title, body], i) => card(s, {
		x: M + (i % 3) * (sw + 0.25), y: 1.85 + Math.floor(i / 3) * 1.95, w: sw, h: 1.75,
		title: `${i + 1}. ${title}`, body, accent: C.amber, titleSize: 14, bodySize: 12.5,
	}));
	text(s, 'Every step is built and checked in the repository today. What remains is the submission and Microsoft\'s review.', {
		x: M, y: 5.85, w: W - 2 * M, h: 0.4, fontSize: 13, color: C.dim,
	});
}

// 10. The ask
{
	const s = newSlide('How Microsoft can help people find this', 'The ask',
		'Each ask maps to a file in docs/partners/microsoft/: the three Tech Community drafts, reactor-session.md, and the program answers in programs/. Close with the contact details; do not describe any program as joined or approved.');
	const asks = [
		'Feature our three Tech Community articles: TRELLIS on production GPUs, a Teams app on Adaptive Cards, and on-device speech with ONNX Runtime Web.',
		'A Microsoft Reactor slot for the 45-minute live build: an agent in Copilot Studio that generates, rigs and voices a 3D character.',
		'Marketplace Rewards co-marketing once the SaaS offer is transactable.',
		'Introductions to the Teams, Copilot Studio and Power Platform ecosystem teams.',
	];
	asks.forEach((a, i) => {
		const y = 1.85 + i * 0.95;
		panel(s, { x: M, y, w: 7.6, h: 0.82, accent: C.green });
		text(s, a, { x: M + 0.3, y: y + 0.12, w: 7.1, h: 0.62, fontSize: 13, valign: 'middle' });
	});
	const cx = M + 7.9;
	const cw = W - cx - M;
	panel(s, { x: cx, y: 1.85, w: cw, h: 3.67 });
	text(s, 'Talk to us', { x: cx + 0.3, y: 2.05, w: cw - 0.5, h: 0.45, fontFace: DISPLAY, fontSize: 20, color: C.ink });
	text(s, 'partnerships@three.ws', { x: cx + 0.3, y: 2.7, w: cw - 0.5, h: 0.4, fontSize: 15, color: C.ink, hyperlink: { url: 'mailto:partnerships@three.ws' } });
	text(s, 'three.ws/docs/microsoft', { x: cx + 0.3, y: 3.25, w: cw - 0.5, h: 0.35, fontFace: MONO, fontSize: 12, hyperlink: { url: 'https://three.ws/docs/microsoft' } });
	text(s, 'github.com/nirholas/three.ws', { x: cx + 0.3, y: 3.7, w: cw - 0.5, h: 0.35, fontFace: MONO, fontSize: 12, hyperlink: { url: 'https://github.com/nirholas/three.ws' } });
	text(s, 'three.ws and Microsoft have announced a partnership, and three.ws is live on Microsoft Marketplace.', {
		x: cx + 0.3, y: 4.3, w: cw - 0.5, h: 0.9, fontSize: 11, color: C.dim,
	});
	text(s, 'three.ws runs on Google Cloud. Microsoft, Microsoft Marketplace, Microsoft 365, Microsoft Teams, Microsoft Entra, Microsoft Graph, Copilot Studio, Microsoft Foundry, Power Platform, Power Automate, Power Apps, Windows, Edge, TRELLIS, ONNX Runtime and Adaptive Cards are trademarks of the Microsoft group of companies. NVIDIA and Google Cloud are trademarks of their owners.', {
		x: M, y: 5.9, w: W - 2 * M, h: 0.7, fontSize: 9, color: C.dim,
	});
}

const problems = allText.flatMap((t, i) => wordingProblems(t, `slide text #${i + 1}`));
if (problems.length) {
	console.error(problems.join('\n'));
	console.error(`\n${problems.length} wording problem(s); deck not written.`);
	process.exit(1);
}

await pptx.writeFile({ fileName: outPath });

// Open what was written and confirm its structure, so a broken file never
// reaches the pack.
const zip = await JSZip.loadAsync(readFileSync(outPath));
const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
const media = Object.keys(zip.files).filter((n) => n.startsWith('ppt/media/')).length;
const kb = (statSync(outPath).size / 1024).toFixed(0);
console.log(`deck.pptx: ${slides} slides, ${media} embedded images, ${kb} KB -> ${outPath}`);
if (slides !== 10) {
	console.error(`expected exactly 10 slides, got ${slides}`);
	process.exit(1);
}
