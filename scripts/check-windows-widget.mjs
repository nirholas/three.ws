#!/usr/bin/env node
/**
 * Verifies the Windows 11 "Agent glance" widget against the contract the
 * widgets board actually enforces.
 *
 *   node scripts/check-windows-widget.mjs
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
 * with each other and with the board's documented contract. It does not mean
 * anyone has seen the widget on a board; that is still a human step, and it is
 * the last open line of prompts/finish/916-roadmap-native-widgets.md.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { Template } from 'adaptivecards-templating';
import { adaptiveTemplate } from '../api/_lib/glance-adaptive.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(REPO, rel), 'utf8');

const problems = [];
const fail = (msg) => problems.push(msg);
let checks = 0;
const pass = (msg) => {
	checks++;
	console.log(`[windows-widget] ok   ${msg}`);
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

/** The worker's own payload builder, which is what the board binds. */
function loadPayloadBuilder() {
	const self = { addEventListener() {}, registration: {} };
	runInNewContext(sw, {
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

const glancePayload = loadPayloadBuilder();
if (typeof glancePayload !== 'function') {
	fail('the worker no longer exposes its payload builder, so the card cannot be checked against it');
} else {
	const STATES = [
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
	const template = adaptiveTemplate();
	for (const [label, body] of STATES) {
		let card;
		try {
			card = new Template(structuredClone(template)).expand({ $root: glancePayload(body) });
		} catch (err) {
			fail(`the card does not expand in the board's engine for "${label}": ${err.message}`);
			continue;
		}
		const text = JSON.stringify(card);
		if (text.includes('${')) {
			fail(`the card still holds unbound expressions for "${label}", which draw as empty rows`);
		}
		for (const action of card.actions || []) {
			if (!/^https:\/\//.test(action.url || '')) {
				fail(`the "${action.title}" button goes to "${action.url}" for "${label}", not a real route`);
			}
		}
	}
	pass(`the card expands in the board's own engine for all ${STATES.length} states`);
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

// ---------------------------------------------------------------- verdict ---

if (problems.length) {
	console.error('');
	for (const problem of problems) console.error(`[windows-widget] FAIL ${problem}`);
	console.error(`\n[windows-widget] ${problems.length} problem(s). See docs/native-widgets.md.`);
	process.exit(1);
}
console.log(`[windows-widget] ${checks} checks passed`);
