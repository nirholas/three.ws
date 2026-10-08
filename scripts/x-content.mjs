#!/usr/bin/env node
// Operator CLI for the @trythreews content queue (data/x-content/queue.json).
// The same engine runs in production as /api/cron/x-content.
//
//   npm run x:content -- check                     validate every item
//   npm run x:content -- plan                      when each item lands, and what is blocking it
//   npm run x:content -- run --dry-run [--id slug]  print the exact X API calls for the next due item
//   npm run x:content -- run --id slug              publish one item now (owner-approved posts only)
//   npm run x:content -- import <blog-slug|url> --as post|article --id slug [--lane l] [--pattern p]
//   npm run x:content -- prepare-video <input> --out public/x-media/<id>/clip.mp4 [--captions file.srt] [--speed 3] [--item slug]
//   npm run x:content -- scout <url> [--format square]      what a page offers a scenario: controls, fields, numbers
//   npm run x:content -- prove <slug> [--no-film]            run the item's scenario against the live product and film it
//   npm run x:content -- prove --status draft               film every item in a status that carries a scenario
//   npm run x:content -- prove --file data/x-content/stories/<slug>.json   film a story that is not in the queue yet
//   npm run x:content -- adopt [<slug>...]                   move finished stories from data/x-content/stories/ into the queue
//   npm run x:content -- advance [<slug>] [--dry-run]        take every draft and review item as far as it can go:
//                                                            film, review, and release by policy where the queue allows it
//   npm run x:content -- advance --ship                      and publish what is approved as bundles, so it goes out
//                                                            without waiting for a deploy (needs X_CONTENT_BUNDLE_SECRET)
//   npm run x:content -- pause <slug>                        take a post back before it goes out
//   npm run x:content -- review <slug> [--no-editor]      the editorial bar: lint, live fact checks, AI editor
//   npm run x:content -- review --status review            review every item awaiting review
//   npm run x:content -- approve <slug>                    owner gate: release a reviewed item
//   npm run x:content -- approve --status review           release every item whose review passed
//
// Env: reads .env.local then .env. DATABASE_URL gives plan/run the shared
// publish ledger; X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET are
// needed only to publish.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { QUEUE_PATH, loadQueue, validateItem, validateQueue } from '../api/_lib/x-content/queue.js';
import { DEFAULT_CADENCE, TIERS, currentSlot, pickDue, reservedKinds, slotLabel, slotOpenings, tierOf } from '../api/_lib/x-content/schedule.js';
import { loadLifts, rankItems } from '../api/_lib/x-content/priority.js';
import { activeHolds, inventory, stockLabel } from '../api/_lib/x-content/runner.js';
import { runTick } from '../api/_lib/x-content/runner.js';
import { dbStore, memoryStore } from '../api/_lib/x-content/state.js';
import { MAX_SPEED, VIDEO_LIMITS, mediaType, parseFfmpegProbe, videoFilterChain } from '../api/_lib/x-content/media.js';
import { weightedLength } from '../api/_lib/x-content/quality.js';
import { approvalProblems, loadReview, reviewItem } from '../api/_lib/x-content/review.js';
import { FORMATS, proofPath, proofProblems, proveItem, scoutPage } from '../api/_lib/x-content/reel.js';
import { approvalPolicy, policyBlockers, releaseDigest, vetoUntil } from '../api/_lib/x-content/approval.js';
import { learnLifts, outcomesStore } from '../api/_lib/x-content/outcomes.js';
import { browserProblem } from '../api/_lib/x-content/verify.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DAY = 24 * 60 * 60_000;

function loadEnvFile(path) {
	if (!existsSync(path)) return;
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
		if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
	}
}
loadEnvFile(resolve(root, '.env.local'));
loadEnvFile(resolve(root, '.env'));

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--id', '--as', '--lane', '--pattern', '--out', '--captions', '--item', '--now', '--status', '--speed', '--format', '--shot', '--file']);
const positional = args.filter((arg, index) => !arg.startsWith('--') && !VALUE_FLAGS.has(args[index - 1]));
const has = (flag) => args.includes(`--${flag}`);
const option = (name, fallback = null) => {
	const inline = args.find((arg) => arg.startsWith(`--${name}=`));
	if (inline) return inline.slice(name.length + 3);
	const index = args.indexOf(`--${name}`);
	return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};
const command = positional[0] || 'check';

function fail(message) {
	console.error(message);
	process.exit(1);
}

// Reviews, proofs and the line all drive a real browser. When this machine
// cannot start one, nothing they record would be about the post.
async function requireBrowser() {
	const problem = await browserProblem();
	if (problem) fail(`x-content: ${problem}. Nothing was reviewed or recorded.`);
}

const store = () => (process.env.DATABASE_URL ? dbStore() : memoryStore());

async function check() {
	const queue = loadQueue(root);
	const state = await store().load();
	const { problems, notes } = validateQueue(queue, root, { state });
	for (const note of notes) console.log(`note  ${note}`);
	let blocking = 0;
	for (const item of queue.items) {
		for (const problem of problems[item.id]) {
			// Drafts are allowed to be unfinished; anything headed for X is not.
			const severe = ['review', 'approved'].includes(item.status);
			if (severe) blocking++;
			console[severe ? 'error' : 'log'](`${severe ? 'error' : 'draft'} ${item.id}: ${problem}`);
		}
	}
	if (blocking) fail(`x-content: ${blocking} problem(s) in items under review or approved`);
	console.log(`x-content: ${queue.items.length} item(s) checked`);
}

async function plan() {
	const queue = loadQueue(root);
	const s = store();
	const state = await s.load();
	const { problems } = validateQueue(queue, root, { state });
	const now = Date.now();
	const cadence = { ...DEFAULT_CADENCE, ...queue.cadence };
	const seed = process.env.X_CONTENT_SCHEDULE_SEED || null;
	const published = new Map((state.published || []).map((row) => [row.id, row]));
	// Rank the way a tick does: with what the account's own posts measured.
	const learned = process.env.DATABASE_URL ? learnLifts((await outcomesStore().load().catch(() => ({ posts: [] }))).posts, { now }) : null;
	const lifts = learned ? Object.assign(loadLifts(root) || new Map(), { learned }) : loadLifts(root);
	const reviews = new Map(queue.items.map((item) => [item.id, loadReview(root, item.id)]));
	const holds = activeHolds(state, queue.items, root, now);
	console.log(`ledger: ${s.label}${seed ? '' : '   (slot minutes are placeholders here: X_CONTENT_SCHEDULE_SEED only exists in production)'}\n`);

	console.log('Slots (T1 flagship, T2 features, T3 proof of work, article every few days):');
	const openings = slotOpenings(now, cadence, seed).filter((slot) => slot.opensAt > now - DAY && slot.opensAt < now + DAY);
	const openKey = currentSlot(now, cadence, seed).slot?.key;
	for (const slot of openings) {
		const used = [...published.values()].find((row) => row.slot === slot.key);
		const state_ = used ? `used by ${used.id}` : slot.key === openKey ? 'OPEN NOW' : slot.opensAt <= now ? 'passed' : 'upcoming';
		console.log(`  ${new Date(slot.opensAt).toISOString().slice(0, 16)}Z  ${slotLabel(slot)}  ${state_}`);
	}

	console.log('\nStock (approved, ready, not held), one slot per tier per day:');
	for (const row of inventory(queue.items.filter((item) => !problems[item.id].length), state, root, now, cadence)) console.log(`  ${stockLabel(row)}${row.low ? '   LOW' : ''}`);

	// Items a kind slot owns are ranked for that slot, not for their tier.
	const reserved = reservedKinds(cadence);
	const groups = [
		...TIERS.map((tier) => ({ label: `T${tier}`, match: (item) => !reserved.has(item.kind) && tierOf(item) === tier })),
		...[...reserved].map((kind) => ({ label: `${kind} slot`, match: (item) => item.kind === kind })),
	];
	for (const group of groups) {
		const waiting = queue.items.filter((item) => group.match(item) && !published.has(item.id));
		if (!waiting.length) continue;
		console.log(`\n${group.label} by priority:`);
		const ranked = rankItems(waiting, { lifts, published: state.published || [], quality: queue.quality, reviews, now });
		for (const row of ranked) {
			const item = row.item;
			const flags = [
				item.status !== 'approved' ? item.status : null,
				problems[item.id].length ? `${problems[item.id].length} problem(s)` : null,
				holds.has(item.id) ? `held until ${state.holds[item.id].until}: ${state.holds[item.id].reason}` : null,
				Date.parse(item.notBefore) > now ? `embargoed until ${item.notBefore}` : null,
			].filter(Boolean);
			const parts = Object.entries(row.parts).map(([key, value]) => `${key} ${value > 0 ? '+' : ''}${value}`).join(', ');
			console.log(`  ${String(row.score).padStart(6)}  ${item.id.padEnd(26)} ${flags.length ? `[${flags.join('; ')}]` : 'ready'}`);
			const outlook = row.volumeChance == null
				? `predicted ${row.predictedLift}x the account median`
				: `${Math.round(row.volumeChance * 100)}% chance of a volume response${row.volumeSignals.length ? `: ${row.volumeSignals.join(', ')}` : ''}`;
			console.log(`          ${parts}  (${outlook})`);
		}
		for (const item of waiting.filter((item) => !ranked.some((row) => row.item.id === item.id))) console.log(`    gone  ${item.id.padEnd(26)} [expired ${item.expiresAt}]`);
	}
	if (published.size) {
		console.log('\nSent:');
		for (const row of published.values()) console.log(`  ${row.publishedAt}  ${row.id.padEnd(26)} ${row.slot ? `slot ${row.slot} ` : ''}${row.url}`);
	}

	const publishable = queue.items.filter((item) => !problems[item.id].length);
	const next = pickDue({ items: publishable, state, now, cadence: queue.cadence, quality: queue.quality, seed, lifts, reviews, exclude: holds });
	console.log(`\nnow: ${next.item ? `${next.item.id} would fill slot ${next.slot.key} (${next.slot.kind ? `${next.slot.kind}, T${next.tier}` : `T${next.tier}`}${next.filledDown ? `, filling a T${next.slot.tier} slot` : ''}, score ${next.score})` : next.reason}`);
}

async function run() {
	const dryRun = has('dry-run');
	if (!dryRun && !process.env.DATABASE_URL) fail('Publishing needs DATABASE_URL so the shared ledger prevents a double post. Use --dry-run to preview.');
	const s = store();
	if (!dryRun && !(await s.acquireLock())) fail('Another publish (the cron or another operator) holds the lock. Try again in a few minutes.');
	try {
		const now = option('now') ? Date.parse(option('now')) : Date.now();
		const result = await runTick({ root, store: s, now, dryRun, requestedId: option('id') });
		for (const row of result.blocked) console.error(`blocked ${row.id}:\n  ${row.problems.join('\n  ')}`);
		if (result.preview) {
			console.log(`Preview of ${result.preview.id} (${result.preview.kind}), score ${result.preview.score ?? 'n/a'}:\n`);
			for (const call of result.preview.calls) console.log(JSON.stringify(call, null, 2));
		} else if (result.published) {
			for (const row of result.held || []) console.log(`held  ${row.id} until ${row.hold.until}: ${row.reason}`);
			console.log(`Published ${result.published.id}: ${result.published.url}`);
		} else {
			for (const row of result.held || []) console.log(`held  ${row.id} until ${row.hold.until}: ${row.reason}`);
			console.log(result.reason);
			if (result.skipped) process.exit(1);
		}
	} finally {
		if (!dryRun) await s.releaseLock();
	}
}

// --- import --------------------------------------------------------------

function slugOk(value) {
	return /^[a-z0-9][a-z0-9-]{1,80}$/.test(String(value || ''));
}

async function fetchBytes(url) {
	const response = await fetch(url, { headers: { 'user-agent': 'three.ws content importer (+https://three.ws)' }, redirect: 'follow' });
	if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
	return { buffer: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') || '' };
}

// A three.ws URL maps onto this checkout, so importing our own blog never
// depends on the live site being deployed.
function localPathFor(url) {
	const parsed = new URL(url);
	if (parsed.hostname !== 'three.ws' && parsed.hostname !== 'www.three.ws') return null;
	const path = decodeURIComponent(parsed.pathname);
	for (const candidate of [path.slice(1), `public${path}`, `${path.slice(1)}.html`]) {
		if (candidate && existsSync(resolve(root, candidate)) && extname(candidate)) return resolve(root, candidate);
	}
	return null;
}

async function loadSource(ref) {
	if (/^https?:\/\//.test(ref)) {
		const local = localPathFor(ref);
		const html = local ? readFileSync(local, 'utf8') : (await fetchBytes(ref)).buffer.toString('utf8');
		return { html, baseUrl: ref };
	}
	if (slugOk(ref) && existsSync(resolve(root, `blog/${ref}.html`))) {
		return { html: readFileSync(resolve(root, `blog/${ref}.html`), 'utf8'), baseUrl: `https://three.ws/blog/${ref}` };
	}
	fail(`${ref} is neither a URL nor a post in blog/`);
}

// Store an image as an upload-ready file under public/x-media/<id>/. SVG and
// AVIF are rasterized because X accepts neither.
async function saveImage(src, baseUrl, dir, name) {
	const absolute = new URL(src, baseUrl).toString();
	const local = localPathFor(absolute);
	const buffer = local ? readFileSync(local) : (await fetchBytes(absolute)).buffer;
	const { default: sharp } = await import('sharp');
	const meta = await sharp(buffer, { animated: true }).metadata();
	let ext = { jpeg: '.jpg', png: '.png', webp: '.webp', gif: '.gif' }[meta.format];
	let bytes = buffer;
	if (!ext) {
		bytes = await sharp(buffer, { density: 192 }).png().toBuffer();
		ext = '.png';
	}
	if (ext !== '.gif' && bytes.length > 5 * 1024 * 1024) {
		bytes = await sharp(bytes).resize({ width: 2400, withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
		ext = '.jpg';
	}
	const path = `${dir}/${name}${ext}`;
	mkdirSync(resolve(root, dir), { recursive: true });
	writeFileSync(resolve(root, path), bytes);
	return path;
}

// The house style bans en and em dashes; imported prose gets a comma instead.
const noDashes = (text) => String(text).replace(/\s*[\u2013\u2014]\s*/g, ', ');

const meta = (doc, selector) => doc.querySelector(selector)?.getAttribute('content')?.trim() || '';

async function importSource() {
	const ref = positional[1];
	const as = option('as', 'post');
	const id = option('id');
	if (!ref) fail('Usage: import <blog-slug|url> --as post|article --id slug');
	if (!['post', 'article'].includes(as)) fail('--as must be post or article');
	if (!slugOk(id)) fail('--id must be a lowercase slug');
	const queue = loadQueue(root);
	if (queue.items.some((item) => item.id === id)) fail(`${id} is already in the queue`);

	const { parse } = await import('node-html-parser');
	const { html, baseUrl } = await loadSource(ref);
	const doc = parse(html);
	const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || meta(doc, 'meta[property="og:url"]') || baseUrl;
	const title = (meta(doc, 'meta[property="og:title"]') || doc.querySelector('title')?.textContent || id).trim();
	const description = meta(doc, 'meta[property="og:description"]') || meta(doc, 'meta[name="description"]');
	const ogImage = meta(doc, 'meta[property="og:image"]') || meta(doc, 'meta[name="twitter:image"]');
	const mediaDir = `public/x-media/${id}`;
	const cover = ogImage ? await saveImage(ogImage, baseUrl, mediaDir, '00-cover') : null;

	const item = {
		id,
		status: 'draft',
		kind: as,
		lane: option('lane', as === 'article' ? 'article' : 'community'),
		pattern: option('pattern', as === 'article' ? 'longform' : 'mechanism'),
		notBefore: new Date(Math.ceil((Date.now() + 86400000) / 3600000) * 3600000).toISOString(),
		source: { url: canonical, importedAt: new Date().toISOString() },
	};

	if (as === 'post') {
		const link = ` ${canonical}`;
		let lead = description || title;
		while (weightedLength(`${lead}${link}`) > 280) lead = lead.replace(/\s+\S+$/, '');
		item.posts = [{ text: `${lead}${link}`, media: cover ? [{ path: cover, alt: description || title }] : [] }];
	} else {
		const { default: TurndownService } = await import('turndown');
		const { gfm } = await import('@joplin/turndown-plugin-gfm');
		const content =
			doc.querySelector('article') || doc.querySelector('main .post-wrap') || doc.querySelector('main') || doc.querySelector('body');
		for (const selector of ['script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'svg', 'canvas', 'iframe', 'video', 'noscript', '.post-meta', '#nav-container', '#footer-container']) {
			for (const node of content.querySelectorAll(selector)) node.remove();
		}
		// Site chrome inside the post body: "← Blog" style back links.
		for (const anchor of content.querySelectorAll('a')) {
			if (/^\s*[\u2190<]/.test(anchor.textContent)) (anchor.parentNode?.textContent.trim() === anchor.textContent.trim() ? anchor.parentNode : anchor).remove();
		}
		// The title becomes the Article title, not a heading inside the body.
		content.querySelector('h1')?.remove();
		let index = 0;
		for (const img of content.querySelectorAll('img')) {
			const src = img.getAttribute('src');
			if (!src || src.startsWith('data:')) {
				img.remove();
				continue;
			}
			try {
				img.setAttribute('src', await saveImage(src, baseUrl, mediaDir, String(++index).padStart(2, '0')));
			} catch (err) {
				console.warn(`skipped image ${src}: ${err.message}`);
				img.remove();
			}
		}
		for (const anchor of content.querySelectorAll('a[href]')) {
			anchor.setAttribute('href', new URL(anchor.getAttribute('href'), baseUrl).toString());
		}
		const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
		turndown.use(gfm);
		turndown.remove(['style', 'script']);
		const markdown = noDashes(turndown.turndown(content.innerHTML))
			.replace(/\n{3,}/g, '\n\n')
			.replace(/(\n\s*(?:\* \* \*|-{3,})\s*)+$/, '')
			.trim();
		const body = `data/x-content/articles/${id}.md`;
		mkdirSync(resolve(root, dirname(body)), { recursive: true });
		writeFileSync(resolve(root, body), `${markdown}\n\n---\n\nOriginally published at [${new URL(canonical).host}${new URL(canonical).pathname}](${canonical}).\n`);
		item.article = { title: noDashes(title.replace(/\s*[|\u2013\u2014-]\s*three\.ws\s*$/i, '')), body };
		if (cover) item.article.cover = { path: cover };
		if (description) item.posts = [{ text: noDashes(description) }];
	}

	queue.items.push(item);
	writeFileSync(resolve(root, QUEUE_PATH), `${JSON.stringify(queue, null, '\t')}\n`);
	console.log(`Added ${id} as a ${as} draft from ${canonical}`);
	if (item.article) console.log(`Article body: ${item.article.body}`);
	console.log(`Media: ${mediaDir}/`);
	console.log('Edit the copy in your own voice, run `npm run x:content -- check`, then set status to review.');
}

// --- video -----------------------------------------------------------------

function ffmpegPath() {
	const bundled = resolve(root, 'node_modules/ffmpeg-static/ffmpeg');
	return existsSync(bundled) ? bundled : 'ffmpeg';
}

function prepareVideo() {
	const input = positional[1];
	const out = option('out');
	if (!input || !existsSync(input)) fail('Usage: prepare-video <input> --out public/x-media/<id>/clip.mp4 [--captions file.srt] [--speed 3] [--item slug]');
	if (!out || !out.startsWith('public/x-media/') || mediaType(out)?.kind !== 'video' || extname(out) !== '.mp4') fail('--out must be an .mp4 under public/x-media/');
	const captions = option('captions');
	if (captions && !existsSync(captions)) fail(`captions file ${captions} is missing`);

	const L = VIDEO_LIMITS;
	// Most of the feed autoplays muted, so burned-in captions carry the story;
	// --speed compensates for a browser recording that could only render a few
	// frames a second. See videoFilterChain for why speeding up beats padding.
	const speed = Number(option('speed', '1'));
	if (!(speed > 0 && speed <= MAX_SPEED)) fail(`--speed must be greater than 0 and at most ${MAX_SPEED}`);
	const filters = videoFilterChain({ speed, subtitlesPath: captions ? resolve(captions) : null, limits: L });
	mkdirSync(resolve(root, dirname(out)), { recursive: true });
	const ffmpeg = ffmpegPath();
	const encode = spawnSync(ffmpeg, [
		'-y', '-hide_banner', '-i', input,
		'-t', String(L.maxDurationSec),
		'-vf', filters.join(','),
		// Audio rides the same speed change, or it drifts out of the picture.
		...(speed === 1 ? [] : ['-af', `atempo=${speed}`]),
		'-fpsmax', String(L.maxFps),
		'-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
		'-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
		'-movflags', '+faststart',
		resolve(root, out),
	], { encoding: 'utf8', stdio: ['ignore', 'inherit', 'pipe'] });
	if (encode.status !== 0) fail(`ffmpeg failed:\n${encode.stderr.split('\n').slice(-15).join('\n')}`);

	const probeRun = spawnSync(ffmpeg, ['-hide_banner', '-i', resolve(root, out)], { encoding: 'utf8' });
	const probe = parseFfmpegProbe(probeRun.stderr);
	if (!probe) fail(`could not read the encoded file:\n${probeRun.stderr}`);
	console.log(`Encoded ${relative(root, resolve(root, out))}`);
	console.log(JSON.stringify(probe, null, '\t'));

	const itemId = option('item');
	if (!itemId) {
		console.log('\nAdd this as the media entry\'s "probe", or rerun with --item <slug> to write it.');
		return;
	}
	const queue = loadQueue(root);
	const item = queue.items.find((row) => row.id === itemId);
	if (!item) fail(`no queue item named ${itemId}`);
	const post = (item.posts ||= [{ text: '' }])[0];
	post.media = [{ path: out, probe }];
	writeFileSync(resolve(root, QUEUE_PATH), `${JSON.stringify(queue, null, '\t')}\n`);
	console.log(`\nAttached to ${itemId} as the head post's only media.`);
}

// --- proof reels -----------------------------------------------------------

async function scout() {
	await requireBrowser();
	const url = positional[1];
	if (!/^https:\/\//.test(String(url))) fail('Usage: scout <https url> [--format landscape|square|portrait] [--shot file.png]');
	const format = option('format', 'landscape');
	if (!FORMATS[format]) fail(`--format must be one of ${Object.keys(FORMATS).join(', ')}`);
	const page = await scoutPage(url, { format, shot: option('shot') });
	console.log(`${page.url}  HTTP ${page.status}  "${page.title}"  (${format}, ${FORMATS[format].width}x${FORMATS[format].height - FORMATS[format].bar} logical)`);
	const section = (title, rows) => rows.length && console.log(`\n${title}\n${rows.map((row) => `  ${row}`).join('\n')}`);
	section('Headings', page.headings);
	section('Controls (click by this text)', page.buttons);
	section('Fields (type "into" the placeholder or label)', page.fields);
	section('Links', page.links);
	section('Canvases', page.canvases);
	section('Lines that carry a number (candidates for read)', page.numbers);
	section('First lines of the page', page.text.slice(0, 25));
}

function printProof(id, proof) {
	console.log(`\n=== ${id}: ${proof.passed ? 'PROVED' : 'FAILED'} ===`);
	for (const step of proof.steps) console.log(`  ${step.ok ? 'pass' : 'FAIL'}  ${String(step.index).padStart(2)}  ${step.kind.padEnd(7)} ${String(step.target).slice(0, 44).padEnd(44)} ${String(step.frames).padStart(4)} frames  ${step.detail}`);
	if (Object.keys(proof.facts).length) console.log(`  read: ${Object.entries(proof.facts).map(([name, value]) => `${name} = "${value}"`).join(', ')}`);
	for (const hit of proof.responses) console.log(`  answered: ${hit.method} ${hit.path} ${hit.status} in ${hit.seconds} s`);
	for (const cut of proof.cuts) console.log(`  cut: ${cut.seconds} s after step ${cut.afterStep}, labelled in the reel`);
	if (proof.video) console.log(`  reel: ${proof.video.path}  ${proof.video.durationSec} s, ${proof.video.width}x${proof.video.height}, ${proof.video.frames} frames, ${Math.round(proof.video.motion * 100)}% changing`);
}

// Films one item. Returns the proof; the reel is put on the item's head post.
async function film(item, { filming = true } = {}) {
	const failureShot = resolve(root, `node_modules/.cache/x-content/${item.id}-failure.png`);
	mkdirSync(dirname(failureShot), { recursive: true });
	const { proof, media } = await proveItem(item, { root, film: filming, failureShot });
	printProof(item.id, proof);
	if (!proof.passed) console.log(`  the page as it was when the step failed: ${relative(root, failureShot)}`);
	// The reel replaces whatever led the post. Anything else the head carried
	// goes with it, because X allows a video no company on its post.
	if (media) {
		item.posts[0].media = [media];
		console.log(`  recorded in ${proofPath(item.id)}`);
	}
	return proof;
}

const saveJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
const saveQueue = (queue) => saveJson(resolve(root, QUEUE_PATH), queue);

// Stories are queue items that live one to a file until they are finished, so
// several can be written and filmed at once without every author rewriting
// the same queue file.
const STORY_DIR = 'data/x-content/stories';

async function prove() {
	await requireBrowser();
	const filming = !has('no-film');
	const file = option('file');
	if (file) {
		const path = resolve(root, file);
		if (!existsSync(path)) fail(`${file} does not exist`);
		const item = JSON.parse(readFileSync(path, 'utf8'));
		if (!item.scenario) fail(`${file} carries no scenario`);
		const proof = await film(item, { filming });
		if (filming && proof.passed) saveJson(path, item);
		if (!proof.passed) process.exit(1);
		return;
	}
	const queue = loadQueue(root);
	const status = option('status');
	const id = positional[1];
	const items = queue.items.filter((item) => item.scenario && (id ? item.id === id : status ? item.status === status : false));
	if (!items.length) fail(id ? `${id} is not in the queue, or carries no scenario` : 'Usage: prove <slug> | prove --status draft | prove --file <story.json> [--no-film]');
	let failed = 0;
	for (const item of items) {
		const proof = await film(item, { filming });
		if (!proof.passed) failed++;
		else if (filming) saveQueue(queue);
	}
	if (failed) process.exit(1);
}

async function adopt() {
	const dir = resolve(root, STORY_DIR);
	const wanted = positional.slice(1);
	const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json') && (!wanted.length || wanted.includes(name.replace(/\.json$/, '')))) : [];
	if (!files.length) fail(`no stories to adopt in ${STORY_DIR}${wanted.length ? ` named ${wanted.join(', ')}` : ''}`);
	const queue = loadQueue(root);
	let refused = 0;
	for (const name of files) {
		const path = resolve(dir, name);
		const story = JSON.parse(readFileSync(path, 'utf8'));
		const existing = queue.items.findIndex((item) => item.id === story.id);
		if (existing >= 0 && ['approved', 'posted'].includes(queue.items[existing].status)) {
			refused++;
			console.log(`skip  ${story.id}: the queue already holds it as ${queue.items[existing].status}`);
			continue;
		}
		// A story arrives as a draft whatever it called itself: review and
		// approval are steps the queue takes, not claims a file makes.
		const item = { ...story, status: 'draft' };
		const problems = validateItem(item, root, { quality: queue.quality || {} });
		if (existing >= 0) queue.items[existing] = item;
		else queue.items.push(item);
		rmSync(path);
		console.log(`ok    ${story.id}: in the queue as a draft${problems.length ? `, with ${problems.length} problem(s) to fix: ${problems[0]}` : ''}`);
	}
	saveQueue(queue);
	if (refused) process.exit(1);
}

async function pause() {
	const id = positional[1];
	const queue = loadQueue(root);
	const item = queue.items.find((row) => row.id === id);
	if (!item) fail('Usage: pause <slug>');
	if (item.status === 'posted') fail(`${id} has already gone out`);
	item.status = 'paused';
	saveQueue(queue);
	console.log(`ok    ${id}: paused. It will not go out until it is approved again.`);
}

// One command for the whole line. Each item is taken as far as it can go and
// stops at the first thing that needs a person, with the reason.
async function advance() {
	await requireBrowser();
	const queue = loadQueue(root);
	const id = positional[1];
	const dryRun = has('dry-run');
	const policy = approvalPolicy(queue);
	const quality = queue.quality || {};
	const items = queue.items.filter((item) => (id ? item.id === id : ['draft', 'review'].includes(item.status)));
	if (!items.length) fail(id ? `${id} is not in the queue` : 'nothing to advance: no draft or review items');
	console.log(`approval: ${policy.mode === 'auto' ? `by policy for tier ${policy.tiers.join(', ')}${policy.articles ? ' and for articles' : ''}, embargoed ${policy.vetoHours} h` : 'by the owner'}`);
	if (!dryRun) hydrateReviewEnv();

	const rows = [];
	const released = [];
	for (const item of items) {
		const row = { id: item.id, from: item.status, reached: item.status, stopped: null };
		rows.push(row);
		try {
			if (item.scenario && proofProblems(item, root).length) {
				if (dryRun) {
					row.stopped = 'would film its scenario';
					continue;
				}
				const proof = await film(item);
				if (!proof.passed) {
					const failed = proof.steps.find((step) => !step.ok);
					row.stopped = `the feature did not pass its scenario at step ${failed.index} (${failed.kind} ${failed.target}): ${failed.detail}`;
					continue;
				}
				saveQueue(queue);
			}
			const problems = validateItem({ ...item, status: 'review' }, root, { quality });
			if (problems.length) {
				row.stopped = problems[0];
				continue;
			}
			if (dryRun) {
				row.stopped = 'would review it';
				continue;
			}
			item.status = 'review';
			row.reached = 'review';
			saveQueue(queue);
			const record = await reviewItem(item, { root, glossary: quality.glossary || [], quality });
			printReview(record);
			if (!record.passed) {
				row.stopped = record.blockers[0];
				continue;
			}
			const blockers = policyBlockers(item, record, policy, root);
			if (blockers.length) {
				row.stopped = `passed review; waits for the owner because ${blockers[0]}`;
				continue;
			}
			item.status = 'approved';
			item.notBefore = vetoUntil(item, policy);
			item.approvedBy = 'policy';
			row.reached = 'approved';
			saveQueue(queue);
			released.push({ id: item.id, tier: tierOf(item), notBefore: item.notBefore, head: item.posts?.[0]?.text || item.article?.title || '' });
		} catch (err) {
			row.stopped = String(err.message || err).split('\n')[0];
		}
	}

	console.log('\nitem                         from     reached   stopped at');
	for (const row of rows) console.log(`${row.id.padEnd(28)} ${row.from.padEnd(8)} ${row.reached.padEnd(9)} ${row.stopped || ''}`);
	if (released.length) {
		const digest = releaseDigest(released);
		console.log(`\n${digest.title}\n${digest.detail}`);
		const { sendOpsAlert } = await import('../api/_lib/alerts.js');
		await sendOpsAlert(digest.title, digest.detail, { severity: 'info' }).catch((err) => console.log(`(the ops alert was not recorded: ${err.message})`));
	}
	if (has('ship') && !dryRun) {
		// Everything approved and not yet sent, whoever approved it: the bundles
		// are what production reads, so they should always say what the queue says.
		const ship = spawnSync(process.execPath, [resolve(root, 'scripts/x-bundle.mjs'), 'publish', '--approved'], { cwd: root, stdio: 'inherit' });
		if (ship.status !== 0) process.exitCode = 1;
	}
}

// --- review ----------------------------------------------------------------

// Credentials the review needs, taken from the Cloud Run service when they are
// not in the local env files.
const REVIEW_ENV = ['X_API_KEY', 'X_API_SECRET', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'NVIDIA_API_KEY'];

function hydrateReviewEnv() {
	if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'aerial-vehicle-466722-p5';
	for (const name of REVIEW_ENV.filter((key) => !process.env[key])) {
		const read = spawnSync(process.execPath, [resolve(root, 'scripts/read-service-env.mjs'), `^${name}$`, '--raw'], { cwd: root, encoding: 'utf8' });
		const value = read.status === 0 ? read.stdout.trim() : '';
		if (value) process.env[name] = value;
	}
	if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
		const token = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
		if (token.status === 0 && token.stdout.trim()) process.env.GITHUB_TOKEN = token.stdout.trim();
	}
}

function printReview(record) {
	const mark = (ok) => (ok ? 'pass' : 'FAIL');
	console.log(`\n=== ${record.id}: ${record.passed ? 'PASSED' : 'NOT READY'} ===`);
	for (const text of record.texts) console.log(`  > ${text.replace(/\n/g, '\n    ')}`);
	console.log('\nFacts');
	for (const check of record.verification.checks) console.log(`  ${mark(check.ok)}  ${check.kind} ${check.target}${check.claim ? ` [${check.claim}]` : ''}: ${check.detail}`);
	if (record.lint.length) {
		console.log('\nEditorial lint');
		for (const row of record.lint) console.log(`  ${row.severity.padEnd(8)} ${row.where}: ${row.message}`);
	}
	if (record.editor) {
		const e = record.editor;
		console.log(`\nEditor (${e.model}): ${e.verdict}`);
		console.log(`  ${Object.entries(e.scores).map(([key, value]) => `${key} ${value}`).join(' | ')}`);
		console.log(`  ${e.summary || ''}`);
		for (const issue of e.issues) console.log(`  ${issue.severity.padEnd(8)} ${issue.area}: "${issue.quote}" ${issue.problem}\n           fix: ${issue.fix}`);
		if (e.rewrite?.posts?.length) {
			console.log('  suggested rewrite:');
			for (const text of e.rewrite.posts) console.log(`    > ${text}`);
			for (const finding of e.rewriteFindings || []) console.log(`    rewrite not usable as is: ${finding}`);
		}
		if (e.fallbacks?.length) console.log(`  (fell back past: ${e.fallbacks.map((f) => f.split(':')[0]).join(', ')})`);
	}
	if (record.blockers.length) {
		console.log('\nBlocking approval');
		for (const blocker of record.blockers) console.log(`  - ${blocker}`);
	}
	console.log(`\nRecorded in data/x-content/reviews/${record.id}.json`);
}

async function review() {
	await requireBrowser();
	const queue = loadQueue(root);
	const status = option('status');
	const id = positional[1];
	const items = queue.items.filter((item) => (id ? item.id === id : status ? item.status === status : false));
	if (!items.length) fail('Usage: review <slug> | review --status review [--no-editor]');
	hydrateReviewEnv();
	let failed = 0;
	for (const item of items) {
		const record = await reviewItem(item, { root, glossary: queue.quality?.glossary || [], quality: queue.quality || {}, skipEditor: has('no-editor') });
		printReview(record);
		if (!record.passed) failed++;
	}
	if (failed) process.exit(1);
}

// The owner's gate, as a command instead of a hand edit. It only ever moves an
// item to `approved`, and only while a passing review record covers the exact
// bytes that are in the queue right now, which is the same rule the publisher
// enforces at send time.
async function approve() {
	const queue = loadQueue(root);
	const status = option('status');
	const id = positional[1];
	const items = queue.items.filter((item) => (id ? item.id === id : status ? item.status === status : false));
	if (!items.length) fail('Usage: approve <slug> | approve --status review');

	let blocked = 0;
	for (const item of items) {
		const problems = approvalProblems({ ...item, status: 'approved' }, root);
		if (problems.length) {
			blocked++;
			console.log(`hold  ${item.id}: ${problems.join('; ')}`);
			continue;
		}
		item.status = 'approved';
		console.log(`ok    ${item.id}: approved; it goes out in priority order once ready (embargo ${item.notBefore.slice(0, 10)})`);
	}
	writeFileSync(resolve(root, QUEUE_PATH), `${JSON.stringify(queue, null, '\t')}\n`);
	if (blocked) process.exit(1);
}

const commands = { check, plan, run, review, approve, scout, prove, adopt, advance, pause, import: importSource, 'prepare-video': prepareVideo };
if (!commands[command]) fail(`Unknown command ${command}. Commands: ${Object.keys(commands).join(', ')}`);
await commands[command]();
