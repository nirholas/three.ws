#!/usr/bin/env node
/**
 * Verifies the Windows 11 "Agent glance" widget against the contract the
 * widgets board actually enforces.
 *
 *   node scripts/check-windows-widget.mjs            # this working tree
 *   node scripts/check-windows-widget.mjs --live     # what three.ws is serving
 *   node scripts/check-windows-widget.mjs --live --base https://staging.example
 *
 * Why this exists. The board is the one surface no machine in this repo can
 * open: it needs Windows 11, Edge, and the PWA installed. Everything it does
 * is therefore invisible here until somebody pins the widget by hand, and a
 * broken slot renders as nothing at all rather than as an error. Four defects
 * have already reached that state, each of them green in every local check:
 * the worker passing the host a template URL where the card belonged, no
 * periodic sync ever registered, a slot pinned before the worker activated
 * staying empty, and a template written with JavaScript array paths that the
 * board's expression engine refuses to parse.
 *
 * The last one is the reason this runs the real engine rather than reading the
 * template with our own idea of a path. `${stats.0.label}` resolves fine in
 * JavaScript and is a syntax error in Adaptive Expression Language, and the
 * engine throws on the whole card rather than skipping the one binding, so one
 * dotted index empties the entire widget.
 *
 * A green run means the manifest, the worker, the endpoints and the card agree
 * with each other and with the board's documented contract. `--live` says the
 * same about a deployed origin, which the offline run cannot: a fix that is
 * green here is still invisible to the board until it ships, and on 2026-09-09
 * production was serving the unparseable card while every check on this disk
 * passed. It does not mean anyone has seen the widget on a board; that is
 * still a human step, and it is the last open line of
 * prompts/finish/916-roadmap-native-widgets.md.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { Template } from 'adaptivecards-templating';
import { adaptiveTemplate } from '../api/_lib/glance-adaptive.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(REPO, rel), 'utf8');

const argv = process.argv.slice(2);
/** `--base https://x` and `--base=https://x` both work, like the sibling checks. */
function flag(name, fallback) {
	const eq = argv.find((arg) => arg.startsWith(`--${name}=`));
	if (eq) return eq.slice(name.length + 3);
	const at = argv.indexOf(`--${name}`);
	if (at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--')) return argv[at + 1];
	return fallback;
}
const LIVE = argv.includes('--live');
const BASE = flag('base', 'https://three.ws').replace(/\/$/, '');

const problems = [];
const fail = (msg) => problems.push(msg);
let checks = 0;
const pass = (msg) => {
	checks++;
	console.log(`[windows-widget] ok   ${msg}`);
};
/** Print "ok" only when the step that just ran added no problems of its own. */
const passUnless = (before, msg) => {
	if (problems.length === before) pass(msg);
};

// https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/widgets
// `ms_ac_template` and `data` are what make the widget renderable at all; the
// board silently drops a definition that is missing either.
const REQUIRED_FIELDS = [
	'name',
	'description',
	'tag',
	'ms_ac_template',
	'data',
	'type',
	'icons',
	'screenshots',
];

// Every lifecycle event the board fires at the worker. A widget that handles
// only some of them works until the user does the one thing that fires the
// rest, which is exactly how an empty slot survives a casual test.
const REQUIRED_EVENTS = [
	'activate',
	'widgetinstall',
	'widgetresume',
	'widgetclick',
	'widgetuninstall',
	'periodicsync',
];

const pngSize = (rel) => {
	const buf = readFileSync(join(REPO, rel));
	return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
};

// ---------------------------------------------------------------- manifest ---

/** Pull the `widgets:` array literal out of the PWA manifest by brace matching. */
function readWidgetsMember(source) {
	const start = source.search(/\n\t+widgets: \[/);
	if (start < 0) return null;
	const open = source.indexOf('[', start);
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		if (source[i] === '[') depth++;
		else if (source[i] === ']' && --depth === 0) {
			return runInNewContext(`(${source.slice(open, i + 1)})`);
		}
	}
	return null;
}

const viteConfig = read('vite.config.js');
const widgets = readWidgetsMember(viteConfig);
if (!Array.isArray(widgets) || widgets.length !== 1) {
	console.error('[windows-widget] FAIL vite.config.js declares no single widgets member');
	process.exit(1);
}
const widget = widgets[0];
pass(`vite.config.js declares the ${widget.tag} widget`);

for (const field of REQUIRED_FIELDS) {
	if (widget[field] === undefined || widget[field] === null || widget[field] === '') {
		fail(`the widgets member is missing "${field}", which the board requires`);
	}
}
if (widget.type !== 'application/json') {
	fail(`the widgets member declares type "${widget.type}", but the data endpoint serves JSON`);
}
pass(`the widgets member carries all ${REQUIRED_FIELDS.length} required fields`);

// The board shows the screenshot in its widget picker, and it is the only
// picture of the widget a user sees before pinning it.
for (const shot of widget.screenshots || []) {
	if (!shot.label) fail(`the screenshot ${shot.src} has no label, which the picker reads out`);
	const rel = join('public', shot.src);
	if (!existsSync(join(REPO, rel))) {
		fail(`the screenshot ${shot.src} is declared but public/${shot.src} does not exist`);
		continue;
	}
	const real = pngSize(rel);
	if (shot.sizes && real !== shot.sizes) {
		fail(`the screenshot ${shot.src} is ${real} but the manifest declares ${shot.sizes}`);
	}
}
for (const icon of widget.icons || []) {
	const rel = join('public', icon.src);
	if (!existsSync(join(REPO, rel))) {
		fail(`the widget icon ${icon.src} is declared but public/${icon.src} does not exist`);
		continue;
	}
	const real = pngSize(rel);
	if (icon.sizes && real !== icon.sizes) {
		fail(`the widget icon ${icon.src} is ${real} but the manifest declares ${icon.sizes}`);
	}
}
pass(
	`${(widget.screenshots || []).length} screenshot and ${(widget.icons || []).length} icon exist at their declared sizes`,
);

// --------------------------------------------------------------- endpoints ---

const HANDLERS = {
	ms_ac_template: 'api/glance/template.js',
	data: 'api/glance/mine.js',
};
for (const [field, handler] of Object.entries(HANDLERS)) {
	const url = widget[field];
	if (!url || !url.startsWith('/api/glance/')) {
		fail(`the widgets member points ${field} at "${url}", which is not a glance endpoint`);
		continue;
	}
	if (!existsSync(join(REPO, handler))) {
		fail(`${field} is ${url} but ${handler} does not exist to serve it`);
	}
	const expected = `/${handler.replace(/^api\//, 'api/').replace(/\.js$/, '')}`;
	if (url !== expected) fail(`${field} is ${url} but the handler on disk answers ${expected}`);
}
pass('the template and data endpoints resolve to handlers in this repo');

// ------------------------------------------------------------------ worker ---

const sw = read('public/glance-sw.js');

if (!viteConfig.includes("'/glance-sw.js'")) {
	fail('public/glance-sw.js is never imported by the generated service worker, so nothing handles the widget');
}
pass('the generated service worker imports glance-sw.js');

const missingEvents = REQUIRED_EVENTS.filter(
	(name) => !sw.includes(`self.addEventListener('${name}'`),
);
if (missingEvents.length) {
	fail(`the worker never handles ${missingEvents.join(', ')}, so the board's slot goes stale`);
}
pass(`the worker handles all ${REQUIRED_EVENTS.length} board lifecycle events`);

const swTag = (sw.match(/const GLANCE_TAG = '([^']+)'/) || [, ''])[1];
if (swTag !== widget.tag) {
	fail(`the worker updates tag "${swTag}" but the manifest pins the widget to "${widget.tag}"`);
}
const swData = (sw.match(/const GLANCE_DATA_URL = '([^']+)'/) || [, ''])[1];
const swTemplate = (sw.match(/const GLANCE_TEMPLATE_URL = '([^']+)'/) || [, ''])[1];
if (swData !== widget.data) fail(`the worker fetches ${swData} but the manifest declares ${widget.data}`);
if (swTemplate !== widget.ms_ac_template) {
	fail(`the worker falls back to ${swTemplate} but the manifest declares ${widget.ms_ac_template}`);
}
pass('the worker, the manifest and the endpoints agree on the tag and both URLs');

// `msAcTemplate` is the URL of the card. The board fetches nothing on the
// worker's behalf, so a worker that hands `updateByTag` that string draws an
// empty slot. This is the 2026-09-04 defect; keep it fixed.
if (!/fetch\(url,/.test(sw) || !/definition\.msAcTemplate\)/.test(sw)) {
	fail('the worker no longer fetches msAcTemplate as a URL, which leaves every pinned slot empty');
}
if (!/updateByTag\(tag, \{ template, data:/.test(sw)) {
	fail('the worker no longer hands updateByTag the fetched card text');
}
pass('the worker fetches the Adaptive Card rather than passing the host its URL');

// `update` in the manifest is a request; nothing schedules it unless the worker
// registers a periodic sync under the widget's own tag.
if (typeof widget.update !== 'number') {
	fail('the widgets member advertises no update interval');
} else if (!/minInterval: Number\(definition\.update\) \* 1000/.test(sw)) {
	fail(`the manifest advertises a ${widget.update}s refresh that the worker never registers`);
}
if (!/periodicSync/.test(sw)) fail('the worker never touches the Periodic Background Sync API');
pass(`the worker registers the ${widget.update}s refresh the manifest advertises`);

// ------------------------------------------------------------------- card ---

/**
 * The worker's own payload builder, which is what the board binds. Taking the
 * source as an argument is what lets `--live` run the DEPLOYED worker against
 * the DEPLOYED card, rather than proving the two files on this disk agree.
 */
function loadPayloadBuilder(source) {
	const self = { addEventListener() {}, registration: {} };
	runInNewContext(source, {
		self,
		caches: undefined,
		fetch: undefined,
		AbortSignal: { timeout: () => undefined },
		Response: class {},
		Request: class {},
		console,
	});
	return self.__threewsGlancePayload;
}

/** The three states a pinned slot can be in, as the data endpoint reports them. */
const CARD_STATES = [
	['signed out', { signedIn: false, signInUrl: 'https://three.ws/login' }],
	['no agent yet', { signedIn: true, card: null, createUrl: 'https://three.ws/create' }],
	[
		'a live agent',
		{
			signedIn: true,
			card: {
				name: 'Atlas Scout',
				headline: 'Working.',
				url: 'https://three.ws/agents/abc',
				metric: { label: 'Moves today', value: 17 },
				stats: [
					{ label: 'This week', value: 96 },
					{ label: 'All time', value: 400 },
					{ label: 'Days live', value: 12 },
				],
			},
		},
	],
];

/**
 * Bind one card in the board's own templating engine and report what a pinned
 * slot would draw. The engine throws on the whole card rather than skipping a
 * bad binding, so a single unparseable path renders as nothing at all.
 */
function expandCard(template, payload, label, where = '') {
	let card;
	try {
		card = new Template(structuredClone(template)).expand({ $root: payload });
	} catch (err) {
		fail(`${where}the card does not expand in the board's engine for "${label}": ${err.message}`);
		return null;
	}
	if (JSON.stringify(card).includes('${')) {
		fail(`${where}the card still holds unbound expressions for "${label}", which draw as empty rows`);
	}
	for (const action of card.actions || []) {
		if (!/^https:\/\//.test(action.url || '')) {
			fail(`${where}the "${action.title}" button goes to "${action.url}" for "${label}", not a real route`);
		}
	}
	return card;
}

const glancePayload = loadPayloadBuilder(sw);
if (typeof glancePayload !== 'function') {
	fail('the worker no longer exposes its payload builder, so the card cannot be checked against it');
} else {
	const template = adaptiveTemplate();
	for (const [label, body] of CARD_STATES) expandCard(template, glancePayload(body), label);
	pass(`the card expands in the board's own engine for all ${CARD_STATES.length} states`);
}

// The two buttons are the widget's only click targets, and a fallback that
// 404s is worse than no button. Both live URLs are checked against the routes
// this site actually publishes.
const pages = JSON.parse(read('data/pages.json'));
const routes = new Set(pages.sections.flatMap((section) => section.pages).map((page) => page.path));
const fallbacks = [...new Set(JSON.stringify(adaptiveTemplate()).match(/https:\/\/three\.ws[^'"\s)]*/g) || [])];
for (const url of fallbacks) {
	const path = new URL(url).pathname;
	if (path.endsWith('.png')) {
		if (!existsSync(join(REPO, 'public', path))) fail(`the card's fallback image ${path} does not exist`);
		continue;
	}
	if (!routes.has(path)) fail(`the card's fallback button points at ${path}, which is not a published route`);
}
pass(`${fallbacks.length} fallback targets in the card resolve to real routes and assets`);

// ------------------------------------------------------------------- live ---

/**
 * `--live` runs the same contract against a DEPLOYED origin instead of this
 * disk. It exists because every check above passes on a commit that has not
 * shipped: on 2026-09-09 the card fix was green here and production was still
 * serving the template that rendered nothing, which is invisible from Linux
 * and would have cost a human a trip to a Windows board to discover. This
 * fetches what the board fetches, binds it with the deployed worker's own
 * payload builder, and says whether a pinned slot would draw.
 */
async function fetchDeployed(path) {
	const url = new URL(path, BASE).toString();
	const res = await fetch(url, {
		headers: { 'user-agent': 'three-ws-windows-widget-check' },
		signal: AbortSignal.timeout(20000),
	});
	return { url, res, text: res.ok ? await res.text() : '' };
}

async function checkLive() {
	console.log(`[windows-widget] live probe against ${BASE}`);

	let mark = problems.length;
	const manifest = await fetchDeployed('/manifest.webmanifest');
	if (!manifest.res.ok) {
		fail(`live: ${manifest.url} answered ${manifest.res.status}, so the board can find no widget to pin`);
		return;
	}
	const deployedWidget = (JSON.parse(manifest.text).widgets || [])[0];
	if (!deployedWidget) {
		fail('live: the deployed manifest declares no widgets member, so the widget is unpinnable');
		return;
	}
	for (const field of ['tag', 'ms_ac_template', 'data', 'type', 'update']) {
		if (JSON.stringify(deployedWidget[field]) !== JSON.stringify(widget[field])) {
			fail(
				`live: the deployed manifest declares ${field} ${JSON.stringify(deployedWidget[field])} but this tree declares ${JSON.stringify(widget[field])}`,
			);
		}
	}
	passUnless(mark, `live: the deployed manifest declares the ${deployedWidget.tag} widget as this tree does`);

	mark = problems.length;
	const worker = await fetchDeployed('/glance-sw.js');
	if (!worker.res.ok) {
		fail(`live: ${worker.url} answered ${worker.res.status}, so nothing services a pinned slot`);
		return;
	}
	if (worker.text !== sw) {
		fail('live: the deployed /glance-sw.js differs from public/glance-sw.js, so the board runs worker code this check never read');
	}
	passUnless(mark, 'live: the deployed worker is byte-identical to public/glance-sw.js');

	const deployedPayload = loadPayloadBuilder(worker.text);
	if (typeof deployedPayload !== 'function') {
		fail('live: the deployed worker exposes no payload builder, so its card cannot be bound here');
		return;
	}

	mark = problems.length;
	const card = await fetchDeployed(deployedWidget.ms_ac_template);
	if (!card.res.ok) {
		fail(`live: ${card.url} answered ${card.res.status}, so the board has no card to draw`);
		return;
	}
	let deployedTemplate;
	try {
		deployedTemplate = JSON.parse(card.text);
	} catch (err) {
		fail(`live: ${card.url} did not answer JSON: ${err.message}`);
		return;
	}
	if (JSON.stringify(deployedTemplate) !== JSON.stringify(adaptiveTemplate())) {
		fail(
			`live: the deployed Adaptive Card differs from api/_lib/glance-adaptive.js, so ${BASE} predates the card in this tree`,
		);
	}
	passUnless(mark, 'live: the deployed Adaptive Card is the one this tree generates');

	mark = problems.length;
	const data = await fetchDeployed(deployedWidget.data);
	if (!data.res.ok) {
		fail(`live: ${data.url} answered ${data.res.status}, so a pinned slot has nothing to bind`);
		return;
	}
	let body;
	try {
		body = JSON.parse(data.text);
	} catch (err) {
		fail(`live: ${data.url} did not answer JSON: ${err.message}`);
		return;
	}
	expandCard(deployedTemplate, deployedPayload(body), 'the live signed-out response', 'live: ');
	for (const [label, state] of CARD_STATES) {
		expandCard(deployedTemplate, deployedPayload(state), label, 'live: ');
	}
	passUnless(mark, `live: the deployed card binds the live response and all ${CARD_STATES.length} states in the board's engine`);

	mark = problems.length;
	const assets = [...(deployedWidget.icons || []), ...(deployedWidget.screenshots || [])];
	for (const asset of assets) {
		const probe = await fetchDeployed(`/${String(asset.src).replace(/^\//, '')}`);
		if (!probe.res.ok) {
			fail(`live: the widget picker asset ${asset.src} answered ${probe.res.status}`);
			continue;
		}
		const type = probe.res.headers.get('content-type') || '';
		if (!type.startsWith('image/')) fail(`live: ${asset.src} is served as "${type}", not an image`);
	}
	passUnless(mark, `live: all ${assets.length} icons and screenshots the picker shows are served`);
}

if (LIVE) await checkLive();

// ---------------------------------------------------------------- verdict ---

if (problems.length) {
	console.error('');
	for (const problem of problems) console.error(`[windows-widget] FAIL ${problem}`);
	console.error(`\n[windows-widget] ${problems.length} problem(s). See docs/native-widgets.md.`);
	process.exit(1);
}
console.log(`[windows-widget] ${checks} checks passed`);
