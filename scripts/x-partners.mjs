#!/usr/bin/env node
// The daily partner spotlight for @trythreews (docs/x-partner-series.md).
//
//   npm run x:partners -- check                      validate the registry (data/x-content/partners/)
//   npm run x:partners -- plan [--days 7]            the rotation ahead, and how many days are in stock
//   npm run x:partners -- daily [--days 3] [--ship]  keep N days of spotlights in stock: for each missing
//                                                    day, film the next feature live, draft the thread,
//                                                    build its head from the reel, and send it through
//                                                    the queue's own review and approval
//   npm run x:partners -- one [--partner id] [--feature id] [--head card|gif|reel|art] [--pattern p] [--ship]
//                                                    the same for one spotlight, chosen by hand
//
// Options for daily and one:
//   --overlay <dir>   also read the spotlights in a materialized overlay (x-bundle pull), so a
//                     machine whose queue.json is the image's copy still rotates correctly
//   --dry-run         film and draft, print the thread, write nothing to the queue
//
// A spotlight is tier 1 and carries `series: "partners"`. The queue's series
// slot (cadence) gives it one prime-time post a day, and `approval.series`
// releases it behind the veto window once it is filmed, reviewed, and passes
// the series lint in api/_lib/x-content/partners.js.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadHistory, loadQueue, validateItem } from '../api/_lib/x-content/queue.js';
import { proveItem } from '../api/_lib/x-content/reel.js';
import { browserProblem } from '../api/_lib/x-content/verify.js';
import { callModelChain } from '../api/_lib/x-content/llm.js';
import { HEAD_ROTATION, PATTERN_ROTATION, SERIES, buildBrief, draftSpotlight, itemFor, loadPartners, maximumLength, nextDay, partnerProblems, pickNext, spotlightId, spotlights } from '../api/_lib/x-content/partners.js';
import { rebuildHead } from './lib/x-heads.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const STORY_DIR = 'data/x-content/stories';
const DAY = 86_400_000;

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
const VALUE_FLAGS = new Set(['--days', '--partner', '--feature', '--head', '--pattern', '--overlay']);
const positional = args.filter((arg, index) => !arg.startsWith('--') && !VALUE_FLAGS.has(args[index - 1]));
const has = (flag) => args.includes(`--${flag}`);
const option = (name, fallback = null) => {
	const inline = args.find((arg) => arg.startsWith(`--${name}=`));
	if (inline) return inline.slice(name.length + 3);
	const index = args.indexOf(`--${name}`);
	return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};
const command = positional[0] || 'plan';

function fail(message) {
	console.error(message);
	process.exit(1);
}

// The model chain and the art lane read their keys from the env. On a machine
// with gcloud they come from the Cloud Run service, the same values production
// uses; in the Cloud Run job they are already set on the job.
const MODEL_ENV = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'NVIDIA_API_KEY', 'GROQ_API_KEY'];
function hydrateModelEnv() {
	if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'aerial-vehicle-466722-p5';
	for (const name of MODEL_ENV.filter((key) => !String(process.env[key] ?? '').trim())) {
		const read = spawnSync(process.execPath, [resolve(root, 'scripts/read-service-env.mjs'), `^${name}$`, '--raw'], { cwd: root, encoding: 'utf8' });
		const value = read.status === 0 ? read.stdout.trim() : '';
		if (value) process.env[name] = value;
	}
}

const readText = (path, limit) => {
	const full = resolve(root, path);
	if (!existsSync(full)) return null;
	const text = readFileSync(full, 'utf8');
	return text.length > limit ? `${text.slice(0, limit)}\n[...]` : text;
};

function registry() {
	const partners = loadPartners(root);
	if (!partners.length) fail('x-partners: data/x-content/partners/ holds no partners yet');
	const problems = partners.flatMap(partnerProblems);
	return { partners, problems };
}

// Every spotlight on record: this checkout's queue, plus a materialized
// overlay's when one is given (the job runs from the image's queue.json, and
// the bundles hold what earlier runs released).
function history(queue) {
	const items = [...queue.items];
	const overlay = option('overlay');
	if (overlay) {
		const path = resolve(overlay, 'data/x-content/queue.json');
		if (!existsSync(path)) fail(`x-partners: ${path} does not exist; run \`npm run x:bundle -- pull --dir ${overlay}\` first`);
		const seen = new Set(items.map((item) => item.id));
		for (const item of JSON.parse(readFileSync(path, 'utf8')).items || []) if (!seen.has(item.id)) items.push(item);
	}
	return spotlights(items);
}

const today = () => new Date().toISOString().slice(0, 10);

// The first moment a new spotlight can still make its day: once today's series
// slot has closed, the next one is tomorrow's.
function seriesStart(queue, now = Date.now()) {
	const slot = (queue.cadence?.slots || []).find((row) => row.series === SERIES);
	if (!slot) return now;
	const [hours, minutes] = String(slot.at).split(':').map(Number);
	const closes = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`) + (hours * 60 + minutes + Number(queue.cadence.windowMinutes || 30)) * 60_000;
	return now > closes ? now + DAY : now;
}
const inStock = (rows) => rows.filter((row) => row.day >= today() && ['draft', 'review', 'approved'].includes(row.status));

// --- commands --------------------------------------------------------------

function check() {
	const { partners, problems } = registry();
	for (const partner of partners) console.log(`${String(partner.order).padStart(2)}  ${partner.id.padEnd(14)} ${partner.designation.padEnd(44)} ${partner.features.length} feature(s): ${partner.features.map((feature) => feature.id).join(', ')}`);
	for (const problem of problems) console.error(`error ${problem}`);
	if (problems.length) fail(`x-partners: ${problems.length} problem(s) in the registry`);
	console.log(`x-partners: ${partners.length} partner(s), ${partners.reduce((sum, partner) => sum + partner.features.length, 0)} feature(s), every one filmable`);
}

function plan() {
	const { partners, problems } = registry();
	if (problems.length) console.log(`(${problems.length} registry problem(s); run \`npm run x:partners -- check\`)`);
	const queue = loadQueue(root);
	const rows = history(queue);
	const stock = inStock(rows);
	console.log(`In stock: ${stock.length} day(s)${stock.length ? `, through ${stock.at(-1).day}` : ''}`);
	for (const row of stock) console.log(`  ${row.day}  ${row.partner}/${row.feature}  ${row.head} ${row.pattern}  ${row.status}`);
	const days = Number(option('days', 7));
	const simulated = [...rows];
	console.log(`\nThe next ${days} the rotation would write:`);
	for (let index = 0; index < days; index++) {
		const pick = pickNext(partners, simulated);
		const day = nextDay(simulated, seriesStart(queue));
		console.log(`  ${day}  ${pick.partner.name.padEnd(14)} ${pick.feature.id.padEnd(26)} ${pick.head.padEnd(5)} ${pick.pattern}`);
		simulated.push({ partner: pick.partner.id, feature: pick.feature.id, head: pick.head, pattern: pick.pattern, day, status: 'draft' });
	}
}

// Films, drafts, and queues one spotlight. Returns what happened, never throws
// for something the next partner might not share.
async function spotlight({ partners, queue, rows, pick, dryRun, ship }) {
	const { partner, feature, head, pattern } = pick;
	const day = nextDay(rows, seriesStart(queue));
	const id = spotlightId(partner, feature, day);
	console.log(`\n=== ${day}: ${partner.name} / ${feature.title} (${head}, ${pattern}) as ${id} ===`);

	// 1. Film the feature working on production. The run's own reads become
	//    facts the copy may quote.
	const skeleton = { id, status: 'draft', kind: 'post', tier: 1, lane: feature.lane, pattern, notBefore: `${day}T00:00:00.000Z`, scenario: feature.scenario, probes: [{ type: 'scenario' }], posts: [{ text: '' }], claims: [], mentions: {} };
	const failureShot = resolve(root, `node_modules/.cache/x-content/${id}-failure.png`);
	mkdirSync(dirname(failureShot), { recursive: true });
	const { proof, media } = await proveItem(skeleton, { root, film: true, failureShot });
	if (!proof.passed || !media) {
		const failed = proof.steps.find((step) => !step.ok);
		return { id, ok: false, reason: `the scenario did not pass${failed ? ` at step ${failed.index} (${failed.kind} ${failed.target}): ${failed.detail}` : ''}; the page as it was: ${relative(root, failureShot)}` };
	}
	console.log(`  filmed: ${media.path}, ${proof.video?.durationSec} s${Object.keys(proof.facts || {}).length ? `; read ${Object.entries(proof.facts).map(([name, value]) => `${name} = "${value}"`).join(', ')}` : ''}`);

	// 2. Draft from the registry and the run, until the machine checks pass.
	const docs = Object.fromEntries([...(feature.docs || []), ...(partner.docs || [])].slice(0, 4).map((path) => [path, readText(path, 3500)]).filter(([, text]) => text));
	const brief = buildBrief({ partner, feature, head, pattern, day, proof, docs, otherPartners: partners.filter((row) => row.id !== partner.id) });
	const rivals = [...loadHistory(root), ...queue.items.filter((item) => item.status !== 'posted' && item.id !== id).map((item) => item.posts?.[0]?.text || '')].filter(Boolean);
	const result = await draftSpotlight(brief, { partner, feature, proof, partners, rivals }, {
		call: (request, { parse }) => callModelChain(request, { parse }),
		voice: readText('docs/announce-voice.md', 12000),
		exemplar: readText('data/x-content/articles/keeper-article.md', 5000),
		maximum: maximumLength(queue.quality),
	});
	for (const attempt of result.attempts) console.log(`  draft ${attempt.attempt} on ${attempt.model}: ${attempt.findings.length ? `${attempt.findings.length} finding(s): ${attempt.findings[0]}` : 'passes'}`);
	if (!result.ok) return { id, ok: false, reason: `no draft passed in ${result.attempts.length} attempts: ${result.findings.join('; ')}` };
	for (const [index, text] of [result.draft.post, ...result.draft.thread].entries()) console.log(`  ${index === 0 ? 'head' : `   ${index}`} > ${text.replace(/\n/g, '\n         ')}`);

	// 3. The item, with its head built from the reel it was filmed with.
	const item = itemFor({ ...pick, day, draft: result.draft, proof });
	item.posts[0].media = [media];
	if (head !== 'reel') {
		if (head === 'art') hydrateModelEnv();
		const { head: built } = await rebuildHead(item, { root, log: (line) => console.log(`  ${line}`) });
		console.log(`  head: ${built?.path || media.path}`);
	}
	const problems = validateItem(item, root, { quality: queue.quality || {} });
	if (problems.length) return { id, ok: false, reason: `the item does not validate: ${problems.join('; ')}` };
	if (dryRun) return { id, ok: true, reason: 'dry run: filmed and drafted, nothing queued' };

	// 4. Into the queue, then the queue's own line: review, and release by policy.
	const story = resolve(root, STORY_DIR, `${id}.json`);
	mkdirSync(dirname(story), { recursive: true });
	writeFileSync(story, `${JSON.stringify(item, null, '\t')}\n`);
	const cli = (...rest) => spawnSync(process.execPath, [resolve(root, 'scripts/x-content.mjs'), ...rest], { cwd: root, stdio: 'inherit' });
	if (cli('adopt', id).status !== 0) return { id, ok: false, reason: 'the queue refused the story' };
	cli('advance', id, ...(ship ? ['--ship'] : []));
	const status = loadQueue(root).items.find((row) => row.id === id)?.status || 'missing';
	return { id, ok: true, status };
}

async function generate({ count, picks = null }) {
	const problem = await browserProblem();
	if (problem) fail(`x-partners: ${problem}. Nothing was filmed.`);
	hydrateModelEnv();
	const { partners, problems } = registry();
	if (problems.length) fail(`x-partners: fix the registry first:\n  ${problems.join('\n  ')}`);
	const dryRun = has('dry-run');
	const ship = has('ship') && !dryRun;
	const results = [];
	const exclude = [];
	// A partner whose feature fails today steps aside for the next one, so one
	// broken page never costs the series its day.
	for (let attempt = 0; results.filter((row) => row.ok).length < count && attempt < count + partners.length; attempt++) {
		const queue = loadQueue(root);
		const rows = history(queue);
		const pick = picks ? picks(partners, rows) : pickNext(partners, rows, { exclude });
		if (!pick) break;
		let outcome;
		try {
			outcome = await spotlight({ partners, queue, rows, pick, dryRun, ship });
		} catch (err) {
			outcome = { id: spotlightId(pick.partner, pick.feature, nextDay(rows, seriesStart(queue))), ok: false, reason: String(err.message || err).split('\n')[0] };
		}
		results.push(outcome);
		if (!outcome.ok) {
			console.log(`  stopped: ${outcome.reason}`);
			exclude.push(pick.partner.id);
			if (picks) break;
		}
		if (dryRun && outcome.ok) break;
	}
	console.log('\nspotlight                                      result');
	for (const row of results) console.log(`${row.id.padEnd(46)} ${row.ok ? row.status || 'ok' : 'FAILED'}${row.ok && row.reason ? ` (${row.reason})` : ''}${row.ok ? '' : `: ${row.reason}`}`);
	if (!results.some((row) => row.ok) && count > 0) process.exitCode = 1;
}

async function daily() {
	const want = Number(option('days', 3));
	if (!(want >= 1 && want <= 14)) fail('--days takes 1 to 14');
	const stock = inStock(history(loadQueue(root)));
	const count = has('dry-run') ? 1 : Math.max(0, want - stock.length);
	console.log(`x-partners: ${stock.length} day(s) in stock, keeping ${want}; ${count ? `writing ${count}` : 'nothing to write'}`);
	if (count) await generate({ count });
	if (has('ship') && !has('dry-run') && !count) {
		const ship = spawnSync(process.execPath, [resolve(root, 'scripts/x-bundle.mjs'), 'publish', '--approved'], { cwd: root, stdio: 'inherit' });
		if (ship.status !== 0) process.exitCode = 1;
	}
}

async function one() {
	const partnerId = option('partner');
	const featureId = option('feature');
	const head = option('head');
	const pattern = option('pattern');
	if (head && !HEAD_ROTATION.includes(head)) fail(`--head takes ${HEAD_ROTATION.join(', ')}`);
	if (pattern && !PATTERN_ROTATION.includes(pattern)) fail(`--pattern takes ${PATTERN_ROTATION.join(', ')}`);
	await generate({
		count: 1,
		picks: (partners, rows) => {
			const chosen = partnerId ? partners.filter((row) => row.id === partnerId) : partners;
			if (!chosen.length) fail(`x-partners: no partner ${partnerId} in the registry`);
			const pick = pickNext(chosen, rows);
			if (featureId) {
				pick.feature = pick.partner.features.find((row) => row.id === featureId) || fail(`x-partners: ${pick.partner.id} has no feature ${featureId}`);
			}
			return { ...pick, head: head || pick.head, pattern: pattern || pick.pattern };
		},
	});
}

const commands = { check, plan, daily, one };
if (!commands[command]) fail(`x-partners: unknown command ${command}. Commands: ${Object.keys(commands).join(', ')}`);
try {
	await commands[command]();
} catch (err) {
	fail(`x-partners: ${err.message}`);
}
