#!/usr/bin/env node
// announce-kit.mjs - the announcement factory: a planned slot in, a finished
// pack, media recipe, and queue item out.
//
// The backlog is 300-plus shipped surfaces that have never been posted about.
// Writing each announcement by hand takes an afternoon, which is why fewer than
// 50 of 430 surfaces were ever announced. This does the parts that are
// mechanical and refuses to fake the parts that are not:
//
//   1. brief    every checkable fact about the surface, harvested from the live
//               page, the changelog, its docs, and its README
//               (api/_lib/announce/brief.js)
//   2. media    a capture recipe for the frame, added to data/announce-media.json
//               so `npm run announce:media` can shoot it from the live route
//   3. draft    a post written from that brief by the model chain, then held
//               against every gate the queue enforces (voice, editorial, claims,
//               evidence, repetition) and rewritten until it passes
//               (api/_lib/announce/draft.js)
//   4. pack     docs/announcements/<id>.md and <id>.post.txt, the format
//               `npm run check:announce` gates and a human approves from
//   5. queue    the item in data/x-content/queue.json, at status `draft`
//
// What it never does: approve anything, capture a frame it was not asked to,
// or post. Publishing stays where it was, behind a passing editorial review and
// the owner's approval.
//
//   npm run announce:kit -- --count 3            # the next three planned slots
//   npm run announce:kit -- --batch 1            # a whole week's batch
//   npm run announce:kit -- --id labor-market    # one surface by id
//   npm run announce:kit -- --brief-only         # briefs and recipes, no model
//   npm run announce:kit -- --capture            # also shoot the frames and record each page's clip
//   npm run announce:kit -- --include-gated      # include owner-gated media
//   npm run announce:kit -- --dry-run            # write nothing, print the plan
//   npm run announce:kit -- --all --concurrency 4  # every ungated planned slot, 4 drafts at a time
//
// A draft the model cannot be trusted to write (or that you want to write
// yourself) can be dropped at data/announce-plan/drafts/<id>.json in the same
// shape the model returns; this script prefers it and runs it through the same
// checks.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { briefPath, buildBrief } from '../api/_lib/announce/brief.js';
import { draftFindings, draftPost, itemFor } from '../api/_lib/announce/draft.js';
import { renderPack, renderPostFile } from '../api/_lib/announce/kit.js';
import { MissingLedgerError, ledgerEntryFor, loadLedger, loadOrBuildPlan } from '../api/_lib/announce/ledger.js';
import { slugFor } from '../api/_lib/announce/plan.js';
import { createPageReader } from '../api/_lib/x-content/verify.js';
import { validateItem } from '../api/_lib/x-content/queue.js';
import { parseFfmpegProbe } from '../api/_lib/x-content/media.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(path) {
	if (!existsSync(path)) return;
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
		if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
	}
}
loadEnvFile(join(root, '.env.local'));
loadEnvFile(join(root, '.env'));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback = null) => {
	const index = argv.indexOf(`--${name}`);
	return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback;
};

const dryRun = flag('dry-run');
const briefOnly = flag('brief-only');
const includeGated = flag('include-gated');
const redraft = flag('redraft');
const live = !flag('no-live');

const QUEUE_FILE = join(root, 'data/x-content/queue.json');
const MEDIA_SPEC = join(root, 'data/announce-media.json');
const PACK_DIR = join(root, 'docs/announcements');
const DRAFT_DIR = join(root, 'data/announce-plan/drafts');

let ledger;
try {
	ledger = loadLedger(root);
} catch (error) {
	if (error instanceof MissingLedgerError) {
		console.error(error.message);
		process.exit(1);
	}
	throw error;
}

const plan = loadOrBuildPlan(root, { start: option('start'), refresh: flag('refresh') });
const wanted = (() => {
	const id = option('id');
	if (id) {
		const slot = plan.slots.find((row) => row.id === id);
		if (slot) return [slot];
		// A packed surface leaves the plan (the plan is what is left to do), so
		// re-running one after an edit rebuilds its slot from the queue item it
		// already has. Its date, lane and shape are whatever was committed.
		const queued = JSON.parse(readFileSync(QUEUE_FILE, 'utf8')).items.find((item) => item.id === id);
		const entry = (ledger.entries || []).find((row) => slugFor(row.key) === id);
		if (!queued || !entry) {
			console.error(`no planned slot or queue item with id ${id}. See: npm run announce:plan`);
			process.exit(1);
		}
		return [{
			position: 0,
			id,
			key: entry.key,
			kind: entry.kind,
			section: entry.section,
			url: entry.url || null,
			lane: queued.lane,
			pattern: queued.pattern,
			notBefore: queued.notBefore,
			windowMinutes: queued.windowMinutes || plan.slots[0]?.windowMinutes || 90,
			batch: 0,
			score: entry.score,
			partner: entry.partner || null,
			shot: `${id}-hero`,
			motion: queued.pattern === 'clip',
			mediaGate: null,
			pack: `docs/announcements/${id}.md`,
		}];
	}
	const batch = option('batch');
	const pool = batch ? plan.slots.filter((row) => row.batch === Number(batch)) : plan.slots;
	const eligible = includeGated ? pool : pool.filter((row) => !row.mediaGate);
	return batch || flag('all') ? eligible : eligible.slice(0, Number(option('count', 3)));
})();

if (!wanted.length) {
	console.error('nothing to do: every planned slot in range is either gated (use --include-gated) or already packed.');
	process.exit(1);
}

const voice = existsSync(join(root, 'docs/announce-voice.md')) ? readFileSync(join(root, 'docs/announce-voice.md'), 'utf8') : null;
const queue = JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
// Every other live head in the queue, so a new draft is held against them for
// repetition. An item's own previous head is excluded: re-running the factory
// over a pack that already exists must not reject it for matching itself.
const queuedHeads = new Map(
	(queue.items || []).filter((item) => item.status !== 'posted').map((item) => [item.id, item.posts?.[0]?.text || '']),
);
const headsExcept = (id) => [...queuedHeads.entries()].filter(([key, text]) => key !== id && text).map(([, text]) => text);

function upsertShot(slot, alt, entry) {
	const spec = JSON.parse(readFileSync(MEDIA_SPEC, 'utf8'));
	// A surface with a route is photographed. A package, worker, or service has
	// no route, so its frame is a title card typeset from its own README and
	// package.json by the same capture engine.
	const shot = slot.url
		? {
			id: slot.shot,
			surface: slot.key,
			url: slot.url,
			alt,
			caption: `Captured from the live ${slot.url} route for the ${slot.id} announcement.`,
			...(slot.motion ? { settle: 9000, motion: { seconds: 5, fps: 12 } } : {}),
		}
		: {
			id: slot.shot,
			surface: slot.key,
			viewport: 'wide',
			alt,
			caption: `Title card for ${slot.key}, typeset from its README and package.json.`,
			card: { dir: entry.dir || null, title: entry.title || slot.key, description: entry.description || '' },
		};
	const index = (spec.shots || []).findIndex((row) => row.id === slot.shot);
	if (index >= 0) spec.shots[index] = { ...spec.shots[index], ...shot };
	else spec.shots.push(shot);
	if (!dryRun) writeFileSync(MEDIA_SPEC, `${JSON.stringify(spec, null, '\t')}\n`);

	// The manifest records the alt text that was captured with the frame, and a
	// draft can change it after the capture. Keep the two in step rather than
	// leaving the docs renderer quoting an alt nobody reviewed.
	const manifestPath = join(root, 'public/announce/media-manifest.json');
	if (!dryRun && existsSync(manifestPath)) {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		const shots = Array.isArray(manifest.shots) ? manifest.shots : Object.values(manifest.shots || {});
		const written = shots.find((row) => row.id === slot.shot);
		if (written && written.alt !== alt) {
			written.alt = alt;
			writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
		}
	}
	return shot;
}

function upsertItem(item) {
	const current = JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
	const index = (current.items || []).findIndex((row) => row.id === item.id);
	if (index >= 0) current.items[index] = item;
	else current.items.push(item);
	current.items.sort((left, right) => String(left.notBefore).localeCompare(String(right.notBefore)));
	if (!dryRun) writeFileSync(QUEUE_FILE, `${JSON.stringify(current, null, '\t')}\n`);
}

function capture(shotId) {
	const result = spawnSync(
		'node',
		['scripts/capture-doc-media.mjs', '--spec', 'data/announce-media.json', '--out', 'public/announce/img', '--manifest', 'public/announce/media-manifest.json', '--only', shotId],
		{ cwd: root, stdio: 'inherit' },
	);
	return result.status === 0;
}

// The recording spec a surface starts from: the plain tour of its live page.
// A spec that already exists is never overwritten, so a hand-scripted demo
// (type a prompt, click, orbit the result) survives a re-run.
const CLIP_DIR = join(root, 'data/x-content/clips');
function recordClip(slot) {
	const specPath = join(CLIP_DIR, `${slot.id}.json`);
	const out = `public/x-media/${slot.id}/clip.mp4`;
	if (!dryRun && !existsSync(specPath)) {
		mkdirSync(CLIP_DIR, { recursive: true });
		writeFileSync(specPath, `${JSON.stringify({ out, url: slot.url, viewport: 'desktop' }, null, '\t')}\n`);
	}
	if (flag('capture') && !dryRun) {
		process.stderr.write(`\n${slot.id}: recording ${slot.url}`);
		const run = spawnSync(process.execPath, ['scripts/record-x-clip.mjs', '--spec', relative(root, specPath)], { cwd: root, encoding: 'utf8' });
		if (run.status !== 0) process.stderr.write(` (recording failed: ${(run.stderr || '').trim().split('\n')[0]})`);
	}
	if (!existsSync(join(root, out))) return { path: out, probe: null };
	const ffmpeg = existsSync(join(root, 'node_modules/ffmpeg-static/ffmpeg')) ? join(root, 'node_modules/ffmpeg-static/ffmpeg') : 'ffmpeg';
	const probe = parseFfmpegProbe(spawnSync(ffmpeg, ['-hide_banner', '-i', join(root, out)], { encoding: 'utf8' }).stderr);
	return { path: out, probe };
}

const pages = live ? createPageReader() : null;
const results = [];

// Drafting is the slow part (one model call can take minutes), so surfaces are
// packed in parallel. Every file write below is synchronous and this is one
// process, so two surfaces can never interleave a write to the queue or the
// media spec.
async function packSlot(slot) {
	const entry = ledgerEntryFor(ledger, slot.key);
	const rank = (ledger.entries || []).filter((row) => row.coverage === 'no').findIndex((row) => row.key === slot.key) + 1;
	process.stderr.write(`\n${slot.id}: brief`);
	const brief = await buildBrief(slot, { root, ledgerEntry: entry, pages });
	if (!dryRun) {
		mkdirSync(dirname(join(root, briefPath(slot.id))), { recursive: true });
		writeFileSync(join(root, briefPath(slot.id)), `${JSON.stringify(brief, null, '\t')}\n`);
	}
	process.stderr.write(` (${brief.live.facts.length} live facts, ${brief.evidenceCandidates.length} evidence candidates, ${brief.changelog.length} changelog entries)`);

	if (briefOnly) {
		results.push({ id: slot.id, state: 'brief', detail: `${brief.evidenceCandidates.length} evidence candidates` });
		return;
	}

	const handWritten = join(DRAFT_DIR, `${slot.id}.json`);
	let draft = null;
	let model = 'hand-written draft';
	let findings = [];
	if (!redraft && existsSync(handWritten)) {
		draft = JSON.parse(readFileSync(handWritten, 'utf8'));
		findings = draftFindings(brief, draft, { root, otherHeads: headsExcept(slot.id) });
		process.stderr.write(`\n${slot.id}: using ${handWritten.replace(`${root}/`, '')}`);
	} else {
		process.stderr.write(`\n${slot.id}: drafting`);
		try {
			const attempt = await draftPost(brief, { root, voice, otherHeads: headsExcept(slot.id) });
			draft = attempt.draft;
			model = attempt.model;
			findings = attempt.ok ? [] : attempt.findings;
			process.stderr.write(` (${attempt.attempts.length} attempt(s) on ${attempt.model})`);
		} catch (error) {
			results.push({ id: slot.id, state: 'no model', detail: error.message.split('\n')[0] });
			process.stderr.write(` failed: ${error.message.split('\n')[0]}`);
			return;
		}
	}

	if (findings.length) {
		results.push({ id: slot.id, state: 'draft rejected', detail: findings[0] });
		if (!dryRun) {
			mkdirSync(DRAFT_DIR, { recursive: true });
			writeFileSync(join(DRAFT_DIR, `${slot.id}.rejected.json`), `${JSON.stringify({ draft, findings }, null, '\t')}\n`);
		}
		return;
	}

	upsertShot(slot, String(draft.alt || '').trim(), entry);
	if (flag('capture') && !dryRun) {
		process.stderr.write(`\n${slot.id}: capturing ${slot.shot}`);
		if (!capture(slot.shot)) process.stderr.write(' (capture failed)');
	}

	// A surface with a route leads with a screen recording of it, the product
	// itself moving, not a still: the still above stays as the pack's
	// illustration. A package, worker or service has no page to record, so it
	// keeps its typeset frame.
	const clip = slot.url ? recordClip(slot) : null;
	const mediaPath = clip?.path || `public/announce/img/${slot.shot}.webp`;
	// `review` means finished and waiting for the editorial bar; `draft`
	// means something is still missing (almost always the frame or the clip,
	// which are captured separately). The queue validator decides which, not
	// this script's optimism.
	const candidate = itemFor(brief, draft, { mediaPath, probe: clip?.probe || null });
	const problems = validateItem(candidate, root);
	const item = { ...candidate, status: problems.length ? 'draft' : 'review' };
	const pack = renderPack({ brief, draft, slot, ledgerEntry: entry, rank: rank || null, total: (ledger.totals?.never ?? null), model });
	if (!dryRun) {
		mkdirSync(PACK_DIR, { recursive: true });
		writeFileSync(join(PACK_DIR, `${slot.id}.md`), pack);
		writeFileSync(join(PACK_DIR, `${slot.id}.post.txt`), renderPostFile(draft));
		upsertItem(item);
	}
	queuedHeads.set(slot.id, item.posts[0].text);
	results.push({
		id: slot.id,
		state: problems.length ? 'packed, item incomplete' : 'packed, awaiting review',
		detail: problems.length ? problems[0] : `${slot.notBefore.slice(0, 16).replace('T', ' ')} UTC, ${brief.lane}/${brief.pattern}`,
	});
}

const concurrency = Math.max(1, Number(option('concurrency', 1)));
try {
	const pending = [...wanted];
	await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
		while (pending.length) {
			const slot = pending.shift();
			// One surface whose page or README cannot be read must not cost the rest of the run.
			await packSlot(slot).catch((error) => results.push({ id: slot.id, state: 'failed', detail: error.message.split('\n')[0] }));
		}
	}));
	const order = new Map(wanted.map((slot, index) => [slot.id, index]));
	results.sort((left, right) => order.get(left.id) - order.get(right.id));
} finally {
	if (pages) await pages.close();
}

console.log('\n');
console.log(`${'pack'.padEnd(28)} ${'state'.padEnd(24)} detail`);
for (const row of results) console.log(`${row.id.padEnd(28)} ${row.state.padEnd(24)} ${row.detail}`);
const packed = results.filter((row) => row.state.startsWith('packed'));
if (packed.length) {
	console.log(`\nNext:\n  npm run announce:media -- --only ${packed.map((row) => `${row.id}-hero`).join(',')}`);
	console.log('  npm run check:announce');
	console.log('  npm run x:content -- review --status review');
	console.log('  npm run x:content -- approve --status review     # owner: releases the batch to its slots');
}
if (dryRun) console.log('\n(dry run: nothing was written)');
