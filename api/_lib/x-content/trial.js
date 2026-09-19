// Trials: proof that the feature a post promotes actually works, end to end,
// shortly before the post goes out.
//
// Review proves the copy is true to the page. A page can say anything, so that
// is not enough: on 2026-09-19 a Materialize post passed review with "We print
// it and ship it to you" because the page said so, and nothing does. A trial
// closes that gap. Every post declares one in data/x-content/trials/<id>.json:
//
//   {
//     "journey": "What a reader does after reading the post, and what they get.",
//     "steps": [ probe, ... ],        // api | browser | command | job (see verify.js)
//     "attestations": [               // promises no machine can check, confirmed
//       { "promise": "...", "by": "owner", "at": "2026-09-19", "note": "..." }   // by a person
//     ]
//   }
//
// `npm run x:content -- trial <id>` runs every step against production, then
// has the model chain list every promise the copy makes to a reader and name the
// step or attestation that proves it. A promise nothing proves blocks the post.
// The record lands in data/x-content/trial-runs/<id>.json, bound to the exact
// post and trial spec, and it expires after TRIAL_MAX_AGE_DAYS: a feature that
// worked last week is not a feature that works today. Approval, and the
// production cron at send time, both refuse an item without a fresh passing run.
//
// Attestations are the owner's word, never an agent's. An agent drafting a trial
// leaves a promise it cannot prove uncovered, so the gate asks the owner.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { callModelChain } from './llm.js';
import { contentHash } from './review.js';
import { itemTexts, probeLabel, runProbe } from './verify.js';

export const TRIAL_MAX_AGE_DAYS = 3;
export const ATTESTATION_MAX_AGE_DAYS = 30;
export const trialSpecPath = (id) => `data/x-content/trials/${id}.json`;
export const trialRunPath = (id) => `data/x-content/trial-runs/${id}.json`;

const readJson = (root, path) => {
	const absolute = resolve(root, path);
	return existsSync(absolute) ? JSON.parse(readFileSync(absolute, 'utf8')) : null;
};

export const loadTrialSpec = (root, id) => readJson(root, trialSpecPath(id));
export const loadTrialRun = (root, id) => readJson(root, trialRunPath(id));

// The run is bound to the post as written AND to the trial as written, so
// editing either one voids the run.
export function trialHash(item, spec, root) {
	return createHash('sha256').update(JSON.stringify({ post: contentHash(item, root), spec: spec || null })).digest('hex');
}

export function specProblems(spec, now = Date.now()) {
	if (!spec) return ['no trial declared'];
	const problems = [];
	if (!String(spec.journey || '').trim()) problems.push('the trial has no journey: say what a reader does after the post and what they get');
	if (!spec.steps?.length) problems.push('the trial has no steps; at least one must exercise the feature itself, not just load its page');
	for (const [index, row] of (spec.attestations || []).entries()) {
		if (!String(row.promise || '').trim() || !String(row.by || '').trim() || !row.at) {
			problems.push(`attestation ${index + 1} needs promise, by, and at`);
			continue;
		}
		const age = (now - Date.parse(row.at)) / 86_400_000;
		if (!(age <= ATTESTATION_MAX_AGE_DAYS)) problems.push(`attestation "${row.promise}" by ${row.by} is ${Math.floor(age)} days old; ask them to confirm it again`);
	}
	return problems;
}

// Why an item may not go out on its trial, or [] when it may.
export function trialProblems(item, root, now = Date.now()) {
	const spec = loadTrialSpec(root, item.id);
	if (!spec) return [`no trial declared; write ${trialSpecPath(item.id)} and run \`npm run x:content -- trial ${item.id}\``];
	const run = loadTrialRun(root, item.id);
	if (!run) return [`the feature has not been trialed; run \`npm run x:content -- trial ${item.id}\``];
	const problems = [];
	if (run.trialHash !== trialHash(item, spec, root)) problems.push('the post or its trial changed after the last trial run; trial it again');
	const age = (now - Date.parse(run.ranAt)) / 86_400_000;
	if (age > TRIAL_MAX_AGE_DAYS) problems.push(`the feature was last trialed ${Math.floor(age)} days ago; trial it again before it posts`);
	if (!run.passed) problems.push(`the last trial failed: ${run.blockers.slice(0, 3).join('; ')}`);
	return problems;
}

const COVERAGE_SYSTEM = `You audit a social post from a software company before it is published. Your only job is to stop the company from promising something it does not deliver.

List every promise the post makes to a reader: anything the reader would expect to be true, to happen, or to be possible if they act on the post (what they can do, what they will get, how fast, what it costs, who does what for them, what happens after they pay). Quote each promise from the post text.

For each promise, name the ONE trial step or attestation that proves it holds end to end in production today, using the ids you are given (step:N or attestation:N). A step proves a promise only if its recorded result shows the promised outcome actually happened (a job finished and returned the thing, a price came back, an order was fulfilled). A page that describes the feature, an endpoint that accepts a request, or a step that failed proves nothing. When nothing proves a promise, set provenBy to null. Be strict: an unproven promise is cheap to fix before posting and expensive after.

Answer with JSON only: {"promises":[{"promise":"<quoted>","provenBy":"step:N"|"attestation:N"|null,"why":"<one sentence>"}]}`;

function coverageRequest(item, spec, steps) {
	const lines = [
		'POST TEXT (every part of the thread):',
		...itemTexts(item).map((text, index) => `--- part ${index + 1} ---\n${text}`),
		'',
		`JOURNEY THE TRIAL COVERS: ${spec.journey}`,
		'',
		'TRIAL STEPS (run against production just now):',
		...steps.map((step, index) => `step:${index + 1} [${step.ok ? 'PASSED' : 'FAILED'}] ${step.target}: ${step.detail}`),
		'',
		'ATTESTATIONS (a named person confirmed these; no machine can):',
		...((spec.attestations || []).length ? spec.attestations.map((row, index) => `attestation:${index + 1} "${row.promise}" confirmed by ${row.by} on ${row.at}${row.note ? ` (${row.note})` : ''}`) : ['none']),
	];
	return { system: COVERAGE_SYSTEM, parts: [{ type: 'text', text: lines.join('\n') }] };
}

export function parseCoverage(raw) {
	const match = String(raw).match(/\{[\s\S]*\}/);
	if (!match) throw new Error('coverage answer is not JSON');
	const parsed = JSON.parse(match[0]);
	if (!Array.isArray(parsed.promises) || !parsed.promises.length) throw new Error('coverage answer lists no promises');
	return parsed.promises.map((row) => ({
		promise: String(row.promise || '').trim(),
		provenBy: typeof row.provenBy === 'string' && /^(step|attestation):\d+$/.test(row.provenBy) ? row.provenBy : null,
		why: String(row.why || '').trim(),
	}));
}

// A model can name a step that failed or an id that does not exist; neither
// proves anything, so both count as unproven.
export function coverageBlockers(promises, steps, spec) {
	const blockers = [];
	for (const row of promises) {
		const [kind, number] = (row.provenBy || ':').split(':');
		const index = Number(number) - 1;
		const valid = kind === 'step' ? steps[index]?.ok === true : kind === 'attestation' ? Boolean(spec.attestations?.[index]) : false;
		if (!valid) blockers.push(`unproven promise "${row.promise}": ${row.why || 'no step or attestation shows it holds'}`);
	}
	return blockers;
}

export async function trialItem(item, { root, env = process.env, now = Date.now(), coverage = callModelChain }) {
	const spec = loadTrialSpec(root, item.id);
	const blockers = specProblems(spec, now);
	const steps = [];
	for (const probe of spec?.steps || []) {
		try {
			steps.push({ kind: `step:${probe.type}`, target: probeLabel(probe), ...(await runProbe(probe, root)) });
		} catch (err) {
			steps.push({ kind: `step:${probe.type}`, target: probeLabel(probe), ok: false, detail: err.message });
		}
	}
	for (const step of steps.filter((row) => !row.ok)) blockers.push(`${step.kind} ${step.target}: ${step.detail}`);

	let promises = [];
	let auditor = null;
	if (spec) {
		try {
			const answer = await coverage(coverageRequest(item, spec, steps), { env, parse: parseCoverage });
			promises = answer.value;
			auditor = answer.model;
			blockers.push(...coverageBlockers(promises, steps, spec));
		} catch (err) {
			blockers.push(`the promise audit did not run: ${err.message.split('\n')[0]}`);
		}
	}

	const record = {
		id: item.id,
		trialHash: trialHash(item, spec, root),
		ranAt: new Date(now).toISOString(),
		passed: blockers.length === 0,
		blockers,
		journey: spec?.journey || null,
		steps,
		promises,
		auditor,
	};
	const path = resolve(root, trialRunPath(item.id));
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(record, null, '\t')}\n`);
	return record;
}
