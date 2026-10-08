#!/usr/bin/env node
// evolve.mjs: keep three.ws improving without anyone prompting an agent.
//
// A long-running loop that drives headless Claude Code (`claude -p`, billed to
// the subscription this machine is signed in to) through three lanes:
//
//   queue    run the next runnable work order in prompts/finish/ to 100%
//   scout    measure the platform and write new work orders, so the queue
//            never runs dry (rotates through the masters in prompts/masters/)
//   triage   sweep production health and fix the code-side defects it finds
//
// Every session runs in its own worktree (../.evolve-wt on branch
// `evolve`), never in the shared tree other agents edit. Finished commits
// fast-forward into local `main` when that cannot touch anyone's uncommitted
// files. Nothing leaves the machine: pushes are blocked twice (a permission
// deny rule, and a git config that rewrites every push URL to a dead scheme),
// deploys, migrations, spends and external posts are denied, and the session
// is told it is unattended so every CLAUDE.md gate becomes "skip and record".
// Shipping stays the owner's one command.
//
//   node scripts/evolve.mjs start     daemonize the loop
//   node scripts/evolve.mjs stop      stop the loop and its running session
//   node scripts/evolve.mjs status    what ran, what is pending, what is next
//   node scripts/evolve.mjs once [--lane queue|scout|triage] [--dry-run]
//   node scripts/evolve.mjs land      fast-forward finished work into main
//   node scripts/evolve.mjs pause | resume
//   node scripts/evolve.mjs ensure    start the loop unless paused or running
//
// Docs: docs/ops/evolve.md

import { execFileSync, spawn } from 'node:child_process';
import {
	appendFileSync,
	closeSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);

const env = (name, fallback) => process.env[name] ?? fallback;
const CONFIG = {
	worktree: path.resolve(env('EVOLVE_WORKTREE', path.join(ROOT, '..', '.evolve-wt'))),
	branch: env('EVOLVE_BRANCH', 'evolve'),
	model: env('EVOLVE_MODEL', 'opus'),
	effort: env('EVOLVE_EFFORT', ''),
	cooldownMin: Number(env('EVOLVE_COOLDOWN_MIN', '5')),
	limitBackoffMin: Number(env('EVOLVE_LIMIT_BACKOFF_MIN', '20')),
	runTimeoutMin: Number(env('EVOLVE_RUN_TIMEOUT_MIN', '240')),
	triageEveryHours: Number(env('EVOLVE_TRIAGE_EVERY_HOURS', '8')),
	scoutEveryHours: Number(env('EVOLVE_SCOUT_EVERY_HOURS', '24')),
	queueFloor: Number(env('EVOLVE_QUEUE_FLOOR', '3')),
	maxAttempts: Number(env('EVOLVE_MAX_ATTEMPTS', '2')),
	autoland: env('EVOLVE_AUTOLAND', '1') !== '0',
	push: env('EVOLVE_PUSH', '0') === '1',
};

/** Work orders at 900 and up are blocked on an owner action by convention. */
export const BLOCKED_BAND = 900;
/** Scouted orders are numbered into this band so they never collide with a campaign. */
export const SCOUT_BAND = [400, 499];
/** An order touched this recently is probably open in someone's live session. */
export const BUSY_HOURS = 6;

/** The master prompts the scout lane rotates through, one lens per scout run. */
export const SCOUT_LENSES = [
	'09-the-frontier.md',
	'06-the-adversary.md',
	'04-the-designer.md',
	'08-the-operator.md',
	'05-the-integrator.md',
];

/**
 * Tool rules that hold even in bypassPermissions mode. Each one is an action
 * CLAUDE.md gates on an owner yes, which an unattended session can never get.
 */
export const DENY_RULES = [
	'Bash(git push:*)',
	'Bash(git fetch threeD:*)',
	'Bash(git pull threeD:*)',
	'Bash(git merge threeD:*)',
	'Bash(gcloud builds submit:*)',
	'Bash(gcloud run deploy:*)',
	'Bash(gcloud run services replace:*)',
	'Bash(gcloud run services delete:*)',
	'Bash(*--set-env-vars*)',
	'Bash(npm run deploy:*)',
	'Bash(npm run release:lib:*)',
	'Bash(npm run db:migrate:*)',
	'Bash(npm run db:restamp:*)',
	'Bash(npm run changelog:push:*)',
	'Bash(solana transfer:*)',
	'Bash(spl-token transfer:*)',
	'Skill(send-usdc)',
	'Skill(trade)',
	'Skill(fund)',
	'Skill(pay-for-service)',
	'Skill(metamask-agent-wallet)',
	'Skill(metamask-agent-workflows)',
	'Skill(okx-agentic-wallet)',
	'Skill(okx-dex-swap)',
	'Skill(okx-dex-bridge)',
	'Skill(okx-defi-invest)',
	'Skill(okx-dapp-discovery)',
	'Skill(okx-agent-payments-protocol)',
	'Skill(okx-onchain-gateway)',
	'Skill(schedule)',
	'RemoteTrigger',
];

// git reads GIT_CONFIG_* from the environment, so every git process the session
// spawns rewrites push URLs to a scheme no remote helper exists for.
const PUSH_BLOCK_ENV = (() => {
	const prefixes = ['https://', 'http://', 'git@', 'ssh://'];
	const out = { GIT_CONFIG_COUNT: String(prefixes.length) };
	prefixes.forEach((p, i) => {
		out[`GIT_CONFIG_KEY_${i}`] = 'url.evolve-push-blocked://.pushInsteadOf';
		out[`GIT_CONFIG_VALUE_${i}`] = p;
	});
	return out;
})();

// ---------------------------------------------------------------- state

const STATE_DIR = path.join(gitOut(['rev-parse', '--path-format=absolute', '--git-common-dir'], ROOT), 'evolve');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const RUNS_FILE = path.join(STATE_DIR, 'runs.jsonl');
const PID_FILE = path.join(STATE_DIR, 'daemon.pid');
const PAUSE_FILE = path.join(STATE_DIR, 'PAUSED');
const LOG_DIR = path.join(STATE_DIR, 'logs');
const DAEMON_LOG = path.join(STATE_DIR, 'daemon.log');

function loadState() {
	try {
		return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
	} catch {
		return { attempts: {}, last: {}, scoutLens: 0, current: null, lockHash: null, limitedUntil: 0 };
	}
}

function saveState(state) {
	mkdirSync(STATE_DIR, { recursive: true });
	writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function readRuns(limit = 20) {
	if (!existsSync(RUNS_FILE)) return [];
	const lines = readFileSync(RUNS_FILE, 'utf8').trim().split('\n').filter(Boolean);
	return lines.slice(-limit).map((l) => JSON.parse(l));
}

function log(msg) {
	console.log(`[evolve ${new Date().toISOString()}] ${msg}`);
}

// ---------------------------------------------------------------- git

function gitOut(args, cwd) {
	return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitOk(args, cwd) {
	try {
		execFileSync('git', args, { cwd, stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

/** Paths with uncommitted changes in a tree, from `git status --porcelain=v1 -z`. */
export function parsePorcelainZ(out) {
	const paths = [];
	const parts = out.split('\0').filter(Boolean);
	for (let i = 0; i < parts.length; i++) {
		const entry = parts[i];
		const code = entry.slice(0, 2);
		paths.push(entry.slice(3));
		if (code[0] === 'R' || code[0] === 'C') paths.push(parts[++i]);
	}
	return paths;
}

function dirtyPaths(cwd) {
	return parsePorcelainZ(execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd, encoding: 'utf8' }));
}

function lockHash(dir) {
	const file = path.join(dir, 'package-lock.json');
	return existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16) : null;
}

// ---------------------------------------------------------------- worktree

function stageWorktree(state) {
	const wt = CONFIG.worktree;
	const mainHash = lockHash(ROOT);
	if (existsSync(wt) && state.lockHash && state.lockHash !== mainHash) {
		if (dirtyPaths(wt).length === 0) {
			log('package-lock.json changed on main; restaging the worktree so its node_modules match');
			gitOut(['worktree', 'remove', '--force', wt], ROOT);
		}
	}
	if (!existsSync(wt)) {
		log(`staging worktree at ${wt}`);
		execFileSync(process.execPath, [path.join(ROOT, 'scripts/prepare-deploy-worktree.mjs'), '--apply', '--path', wt], {
			cwd: ROOT,
			stdio: 'inherit',
		});
		const hasBranch = gitOk(['rev-parse', '--verify', `refs/heads/${CONFIG.branch}`], ROOT);
		gitOut(hasBranch ? ['checkout', CONFIG.branch] : ['checkout', '-b', CONFIG.branch], wt);
		state.lockHash = mainHash;
	}
	for (const f of ['.env', '.env.local']) {
		if (existsSync(path.join(ROOT, f))) copyFileSync(path.join(ROOT, f), path.join(wt, f));
	}
}

/** Bring the evolve branch onto the current main without losing unlanded commits. */
function syncWorktree() {
	const wt = CONFIG.worktree;
	if (gitOk(['merge-base', '--is-ancestor', CONFIG.branch, 'main'], ROOT)) {
		gitOut(['reset', '--hard', 'main'], wt);
		return 'reset';
	}
	if (gitOk(['rebase', 'main'], wt)) return 'rebased';
	gitOk(['rebase', '--abort'], wt);
	return 'conflict';
}

/** Anything a session left uncommitted is kept as a named stash, never discarded. */
function holdLeftovers(label) {
	const wt = CONFIG.worktree;
	const dirty = dirtyPaths(wt);
	if (dirty.length === 0) return null;
	const message = `evolve held: ${label} ${new Date().toISOString()}`;
	gitOut(['stash', 'push', '--include-untracked', '-m', message], wt);
	return { message, files: dirty.length };
}

// ---------------------------------------------------------------- lanes

/** Runnable work orders: numbered, below the owner-blocked band, oldest number first. */
export function runnableOrders(files, attempts = {}, maxAttempts = 2, busy = new Set()) {
	return files
		.filter((f) => !busy.has(f))
		.map((f) => ({ file: f, n: Number((f.match(/^(\d{3})-.+\.md$/) || [])[1]) }))
		.filter((o) => Number.isFinite(o.n) && o.n < BLOCKED_BAND)
		.filter((o) => (attempts[o.file] || 0) < maxAttempts)
		.sort((a, b) => a.n - b.n || a.file.localeCompare(b.file))
		.map((o) => o.file);
}

/** The next free number in the scout band, given the files currently in finish/. */
export function nextScoutNumber(files) {
	const used = new Set(files.map((f) => Number((f.match(/^(\d{3})-/) || [])[1])).filter(Number.isFinite));
	for (let n = SCOUT_BAND[0]; n <= SCOUT_BAND[1]; n++) if (!used.has(n)) return n;
	return null;
}

/**
 * Which lane runs next. Triage when production has not been swept recently,
 * scout when the queue is thin or a scout is overdue, otherwise the queue.
 */
export function chooseLane({ now, last = {}, runnable, config }) {
	const hours = (t) => (t ? (now - t) / 3_600_000 : Infinity);
	if (hours(last.triage) >= config.triageEveryHours) return 'triage';
	if (runnable.length === 0) return 'scout';
	if (runnable.length < config.queueFloor && hours(last.scout) >= config.scoutEveryHours / 4) return 'scout';
	if (hours(last.scout) >= config.scoutEveryHours) return 'scout';
	return 'queue';
}

/** Orders committed or edited in the owner's tree within BUSY_HOURS, so evolve leaves them alone. */
function busyOrders() {
	const recent = gitOut(['log', `--since=${BUSY_HOURS}.hours`, '--name-only', '--format=', 'main', '--', 'prompts/finish'], ROOT);
	const names = [...recent.split('\n'), ...dirtyPaths(ROOT)]
		.filter((p) => p.startsWith('prompts/finish/'))
		.map((p) => path.basename(p));
	return new Set(names);
}

function finishFiles() {
	const dir = path.join(CONFIG.worktree, 'prompts/finish');
	return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
}

const UNATTENDED = (wt, branch) => `You are the three.ws evolve loop: an unattended Claude Code session started by scripts/evolve.mjs. No human is watching and nobody will ever answer a question, so never ask one and never stop to wait for approval. Finish the task.

Where you are: the worktree ${wt} on branch \`${branch}\`. Work only here. Never edit, stage, or commit anything under ${ROOT} (the owner's shared tree). The worktree is yours alone, but still stage explicit paths and write a commit message that describes the diff (CLAUDE.md "Commit messages"). Commit each finished unit of work as you go; the runner fast-forwards your commits into local main.

How the CLAUDE.md stop-and-ask gates apply unattended: every gated action is forbidden, not paused. Do not push, deploy, submit a Cloud Build, apply migrations to the production database, sign or send any transaction, spend, mint, pay an x402 endpoint, or post to any external channel. Several of these are hard-denied and will fail; do not look for a way around the denial. When a task needs one of them, finish every other part, then add a dated row to prompts/finish/_context/production-100-OWNER-ACTIONS.md naming the exact command the owner runs. A new migration file is fine to write and test locally; say in your report that it is pending. Config-only \`gcloud run services update --update-env-vars\` changes remain pre-approved by CLAUDE.md.

The coin commit gate: if your diff references any crypto project other than $THREE, do not commit that content. Leave it uncommitted; the runner preserves it as a named git stash for the owner to approve.

Port 3000 belongs to the owner's dev server. If you need one, run \`npx vite --port 3107\` (or another free port) from this worktree and stop it when you are done.

End your final message with exactly one line in this form:
EVOLVE_RESULT: <done|partial|blocked> | <one sentence on what shipped or what remains>`;

function queuePrompt(file) {
	return `Run the work order prompts/finish/${file}. Read it completely, then execute it to 100%: its operating clause, step 0 re-derivation, every task, and every line of its definition of done.

When every line of the definition of done is verified, retire the order exactly as prompts/README.md describes: append to its campaign's PROGRESS log in prompts/finish/_context/, delete the order file, and commit that as its own closing commit.

If step 0 shows the order already shipped, verify that, then retire it the same way.

If a line genuinely needs an owner action, finish everything else, add the owner row (see your instructions), and leave the order file in place with a dated "Evolve status" paragraph directly under its title naming exactly what remains. The runner retries an order at most ${CONFIG.maxAttempts} times.`;
}

function scoutPrompt(lens, number) {
	return `Scout lane: keep the work queue in prompts/finish/ full of the highest-value work available, so evolve always has something worth doing.

1. Read prompts/README.md (the work-order standard), prompts/RUN-ORDER.md, ISSUES.md, STRUCTURE.md, and every file name in prompts/finish/ so you never duplicate an open order.
2. Measure, do not trust documents: \`curl -s https://three.ws/api/version\`, \`curl -s https://three.ws/api/healthz\`, \`git log --oneline -40\`, production error logs from the last 24h (the gcloud logging command in CLAUDE.md), \`npm run test:core\`, \`npm run audit:docs\`, and \`npm run audit:web\` (the unauthenticated live-page sweep). Run what is useful; a failing check is a finding, not a blocker.
3. Read prompts/masters/${lens} and use its discipline as this run's lens for spotting what to build or fix.
4. Rank everything you found with the RUN-ORDER rule: a live production defect outranks an unshipped fix, an unshipped fix outranks a new feature, and work that unblocks many orders outranks work that unblocks one. Prefer things that make three.ws better for its users, and keep Solana first.
5. Write the top one to three as new work orders in prompts/finish/, each following the work-order standard to the letter (how-to-run line, binding clause, step 0 with exact commands, tasks with real paths, a mechanically checkable definition of done, a never-blocked table, a report format). Number them from ${number ?? 'the next free number'} upward within ${SCOUT_BAND[0]}-${SCOUT_BAND[1]}, named \`<number>-auto-<slug>.md\`. Every order you write must be runnable by an unattended agent: no step may require an owner action except the final ship. Each carries the measurements that justify it, with the date.
6. Commit the new orders (explicit paths) with a message naming what each one targets.

Do not build the work yourself in this lane. Writing excellent, specific, verifiable orders is the whole job.`;
}

function triagePrompt() {
	return `Triage lane: production health sweep and fix.

Use the gcp-triage skill and run its deep sweep against production (healthz, every service's error logs over the last 24h, version and deploy gap, live pages, crons, migration state). For every defect whose root cause is in this repository's code, fix it at the root here with a test that fails before the fix, run the relevant tests, and commit each fix separately. Config-only env changes the skill classes as pre-approved may be applied with \`--update-env-vars\`. Anything that needs an owner (funding, billing, a deploy, a decision) goes in the OWNER-ACTIONS file as described in your instructions; do not re-add a row that already exists, update its measurement instead.

Lead your report with the Solana position, then the deploy gap (how many commits on main are not in production), then what you fixed.`;
}

// ---------------------------------------------------------------- session

/** Pull the outcome line and the usage-limit signal out of a stream-json result event. */
export function interpretResult(result) {
	if (!result) return { outcome: 'crashed', summary: 'no result event', limited: false };
	const text = String(result.result || '');
	const limited =
		Boolean(result.is_error) &&
		(result.api_error_status === 429 || /usage limit|limit reached|rate limit|resets? (at|in)/i.test(text));
	const m = text.match(/EVOLVE_RESULT:\s*(done|partial|blocked)\s*\|\s*(.+)\s*$/im);
	if (m) return { outcome: m[1], summary: m[2].trim(), limited };
	if (limited) return { outcome: 'limited', summary: text.slice(0, 200), limited };
	if (result.is_error) return { outcome: 'error', summary: text.slice(0, 200) || result.subtype, limited };
	return { outcome: 'unreported', summary: text.split('\n').filter(Boolean).pop()?.slice(0, 200) || '', limited };
}

function runSession({ lane, target, prompt, state }) {
	mkdirSync(LOG_DIR, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const logFile = path.join(LOG_DIR, `${stamp}-${lane}.jsonl`);
	const args = [
		'-p',
		prompt,
		'--model',
		CONFIG.model,
		'--permission-mode',
		'bypassPermissions',
		'--append-system-prompt',
		UNATTENDED(CONFIG.worktree, CONFIG.branch),
		'--output-format',
		'stream-json',
		'--verbose',
		'--name',
		`evolve ${lane}${target ? ` ${target}` : ''}`,
		'--disallowedTools',
		...DENY_RULES,
	];
	if (CONFIG.effort) args.push('--effort', CONFIG.effort);

	return new Promise((resolve) => {
		const fd = openSync(logFile, 'a');
		const child = spawn('claude', args, {
			cwd: CONFIG.worktree,
			env: { ...process.env, ...PUSH_BLOCK_ENV, EVOLVE: '1' },
			stdio: ['ignore', 'pipe', fd],
			detached: true,
		});
		state.current = { lane, target, pid: child.pid, startedAt: Date.now(), log: logFile };
		saveState(state);

		let buffer = '';
		let result = null;
		let sessionId = null;
		child.stdout.on('data', (chunk) => {
			appendFileSync(logFile, chunk);
			buffer += chunk;
			let nl;
			while ((nl = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				try {
					const ev = JSON.parse(line);
					if (ev.session_id) sessionId = ev.session_id;
					if (ev.type === 'result') result = ev;
				} catch {
					// a partial or non-JSON line; the raw bytes are already in the log
				}
			}
		});
		const timer = setTimeout(() => {
			log(`${lane} exceeded ${CONFIG.runTimeoutMin} min; stopping it`);
			killGroup(child.pid);
		}, CONFIG.runTimeoutMin * 60_000);
		child.on('close', (code) => {
			clearTimeout(timer);
			closeSync(fd);
			resolve({ code, result, sessionId, logFile });
		});
	});
}

function killGroup(pid) {
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		// the group already exited
	}
}

// ---------------------------------------------------------------- landing

/**
 * Fast-forward local main to the evolve branch, from the owner's tree, only
 * when none of the incoming files has uncommitted changes there.
 */
function land({ quiet = false } = {}) {
	const ahead = gitOut(['rev-list', '--count', `main..${CONFIG.branch}`], ROOT);
	if (ahead === '0') return { landed: 0, reason: 'nothing to land' };
	if (!gitOk(['merge-base', '--is-ancestor', 'main', CONFIG.branch], ROOT)) {
		if (loadState().current) return { landed: 0, reason: 'main moved and a session is running in the worktree; the runner lands after it finishes' };
		if (syncWorktree() === 'conflict') return { landed: 0, reason: 'evolve branch conflicts with main; resolve with `git -C ' + CONFIG.worktree + ' rebase main`' };
	}
	const incoming = gitOut(['diff', '--name-only', `main...${CONFIG.branch}`], ROOT).split('\n').filter(Boolean);
	const dirty = new Set(dirtyPaths(ROOT));
	const overlap = incoming.filter((f) => dirty.has(f));
	if (overlap.length) return { landed: 0, reason: `would touch uncommitted files in the main tree: ${overlap.slice(0, 5).join(', ')}` };
	const current = gitOut(['rev-parse', '--abbrev-ref', 'HEAD'], ROOT);
	if (current !== 'main') return { landed: 0, reason: `main tree is on ${current}, not main` };
	const count = Number(gitOut(['rev-list', '--count', `main..${CONFIG.branch}`], ROOT));
	execFileSync('git', ['merge', '--ff-only', CONFIG.branch], { cwd: ROOT, stdio: quiet ? 'ignore' : 'inherit' });
	let pushed = false;
	if (CONFIG.push) {
		execFileSync('git', ['push', 'threews', 'main'], { cwd: ROOT, stdio: quiet ? 'ignore' : 'inherit' });
		pushed = true;
	}
	return { landed: count, pushed };
}

// ---------------------------------------------------------------- cycle

async function cycle({ forceLane, dryRun = false } = {}) {
	const state = loadState();
	stageWorktree(state);
	const held = holdLeftovers('found dirty before cycle');
	if (held) log(`stashed ${held.files} leftover file(s) as "${held.message}"`);
	const sync = syncWorktree();
	if (sync === 'conflict') log('evolve branch conflicts with main; working on its current base until it is resolved');

	const files = finishFiles();
	const runnable = runnableOrders(files, state.attempts, CONFIG.maxAttempts, busyOrders());
	const lane = forceLane || chooseLane({ now: Date.now(), last: state.last, runnable, config: CONFIG });

	let target = null;
	let prompt;
	if (lane === 'queue') {
		if (!runnable.length) {
			log('queue lane requested but no runnable order exists');
			return { lane, outcome: 'empty' };
		}
		target = runnable[0];
		prompt = queuePrompt(target);
	} else if (lane === 'scout') {
		target = SCOUT_LENSES[state.scoutLens % SCOUT_LENSES.length];
		prompt = scoutPrompt(target, nextScoutNumber(files));
	} else if (lane === 'triage') {
		prompt = triagePrompt();
	} else {
		throw new Error(`unknown lane ${lane}`);
	}

	if (dryRun) {
		console.log(`lane: ${lane}\ntarget: ${target ?? '-'}\nrunnable orders: ${runnable.join(', ') || 'none'}\n\n${prompt}`);
		return { lane, outcome: 'dry-run' };
	}

	const before = gitOut(['rev-parse', 'HEAD'], CONFIG.worktree);
	log(`starting ${lane}${target ? ` (${target})` : ''}`);
	const startedAt = Date.now();
	const run = await runSession({ lane, target, prompt, state });
	const verdict = interpretResult(run.result);

	const fresh = loadState();
	fresh.current = null;
	if (verdict.limited) {
		fresh.limitedUntil = Date.now() + CONFIG.limitBackoffMin * 60_000;
	} else {
		fresh.last[lane] = Date.now();
		if (lane === 'scout') fresh.scoutLens = (fresh.scoutLens || 0) + 1;
		if (lane === 'queue' && existsSync(path.join(CONFIG.worktree, 'prompts/finish', target))) {
			fresh.attempts[target] = (fresh.attempts[target] || 0) + 1;
		}
	}
	const leftover = holdLeftovers(`${lane}${target ? ` ${target}` : ''}`);
	const commits = Number(gitOut(['rev-list', '--count', `${before}..HEAD`], CONFIG.worktree));
	const landing = CONFIG.autoland && commits > 0 ? land({ quiet: true }) : null;
	saveState(fresh);

	const record = {
		at: new Date(startedAt).toISOString(),
		minutes: Math.round((Date.now() - startedAt) / 6000) / 10,
		lane,
		target,
		outcome: verdict.outcome,
		summary: verdict.summary,
		commits,
		landed: landing?.landed ?? 0,
		landNote: landing?.reason,
		held: leftover?.message,
		session: run.sessionId,
		log: run.logFile,
	};
	mkdirSync(STATE_DIR, { recursive: true });
	appendFileSync(RUNS_FILE, JSON.stringify(record) + '\n');
	log(`${lane} finished: ${verdict.outcome}, ${commits} commit(s), ${record.landed} landed. ${verdict.summary}`);
	return record;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loop() {
	writeFileSync(PID_FILE, String(process.pid));
	const stop = () => {
		const s = loadState();
		if (s.current?.pid) killGroup(s.current.pid);
		s.current = null;
		saveState(s);
		rmSync(PID_FILE, { force: true });
		process.exit(0);
	};
	process.on('SIGTERM', stop);
	process.on('SIGINT', stop);
	log(`loop started (pid ${process.pid}, model ${CONFIG.model}, worktree ${CONFIG.worktree})`);
	for (;;) {
		if (existsSync(PAUSE_FILE)) {
			await sleep(60_000);
			continue;
		}
		const wait = loadState().limitedUntil - Date.now();
		if (wait > 0) {
			await sleep(Math.min(wait, 60_000));
			continue;
		}
		try {
			const r = await cycle();
			await sleep((r.outcome === 'empty' ? 30 : CONFIG.cooldownMin) * 60_000);
		} catch (err) {
			log(`cycle failed: ${err.stack || err.message}`);
			await sleep(CONFIG.cooldownMin * 60_000);
		}
	}
}

// ---------------------------------------------------------------- commands

function daemonPid() {
	if (!existsSync(PID_FILE)) return null;
	const pid = Number(readFileSync(PID_FILE, 'utf8'));
	try {
		process.kill(pid, 0);
		return pid;
	} catch {
		return null;
	}
}

function start({ quiet = false } = {}) {
	const pid = daemonPid();
	if (pid) {
		if (!quiet) console.log(`evolve already running (pid ${pid})`);
		return;
	}
	mkdirSync(STATE_DIR, { recursive: true });
	const out = openSync(DAEMON_LOG, 'a');
	const child = spawn(process.execPath, [SELF, 'run'], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] });
	child.unref();
	if (!quiet) console.log(`evolve started (pid ${child.pid}). Log: ${DAEMON_LOG}`);
}

function stopDaemon() {
	const pid = daemonPid();
	if (!pid) {
		console.log('evolve is not running');
		return;
	}
	process.kill(pid, 'SIGTERM');
	console.log(`evolve stopped (pid ${pid})`);
}

function status() {
	const state = loadState();
	const pid = daemonPid();
	const files = existsSync(CONFIG.worktree) ? finishFiles() : readdirSync(path.join(ROOT, 'prompts/finish')).filter((f) => f.endsWith('.md'));
	const busy = busyOrders();
	const runnable = runnableOrders(files, state.attempts, CONFIG.maxAttempts, busy);
	const parked = Object.entries(state.attempts).filter(([f, n]) => n >= CONFIG.maxAttempts && files.includes(f));
	const pendingLand = gitOk(['rev-parse', '--verify', `refs/heads/${CONFIG.branch}`], ROOT)
		? gitOut(['log', '--oneline', `main..${CONFIG.branch}`], ROOT)
		: '';
	const stashes = gitOut(['stash', 'list'], ROOT).split('\n').filter((l) => l.includes('evolve held:'));
	let deployGap = 'unknown';
	try {
		const live = JSON.parse(execFileSync('curl', ['-s', '--max-time', '8', 'https://three.ws/api/version'], { encoding: 'utf8' }));
		const sha = live.commit || live.sha || live.git_sha;
		if (sha) deployGap = `${gitOut(['rev-list', '--count', `${sha}..main`], ROOT)} commit(s) on main not in production (live ${String(sha).slice(0, 9)})`;
	} catch {
		// offline or the live sha is not in this clone; reported as unknown
	}

	const lines = [];
	lines.push(`Daemon: ${pid ? `running (pid ${pid})` : 'stopped'}${existsSync(PAUSE_FILE) ? ', PAUSED' : ''}`);
	if (state.limitedUntil > Date.now()) lines.push(`Usage limit: backing off until ${new Date(state.limitedUntil).toISOString()}`);
	if (state.current) {
		const mins = Math.round((Date.now() - state.current.startedAt) / 60000);
		lines.push(`Now: ${state.current.lane}${state.current.target ? ` ${state.current.target}` : ''} for ${mins} min (log ${state.current.log})`);
	}
	lines.push(`Next lane: ${chooseLane({ now: Date.now(), last: state.last, runnable, config: CONFIG })}`);
	lines.push(`Runnable orders (${runnable.length}): ${runnable.join(', ') || 'none, the scout lane refills the queue'}`);
	const resting = files.filter((f) => busy.has(f));
	if (resting.length) lines.push(`Left alone (touched in the last ${BUSY_HOURS}h): ${resting.length} order(s)`);
	if (parked.length) lines.push(`Parked after ${CONFIG.maxAttempts} attempts: ${parked.map(([f]) => f).join(', ')}`);
	lines.push(`Production: ${deployGap}`);
	lines.push('', 'Recent runs:');
	for (const r of readRuns(12).reverse()) {
		lines.push(`  ${r.at.slice(0, 16)}  ${r.lane.padEnd(6)} ${(r.outcome || '').padEnd(10)} ${String(r.minutes).padStart(5)}m  ${r.commits}c/${r.landed}l  ${r.target ?? ''}`);
		if (r.summary) lines.push(`      ${r.summary}`);
		if (r.landNote) lines.push(`      not landed: ${r.landNote}`);
		if (r.held) lines.push(`      held for review: ${r.held}`);
	}
	if (pendingLand) lines.push('', 'Committed on the evolve branch, not yet in main (npm run evolve:land):', pendingLand);
	if (stashes.length) lines.push('', 'Held for owner review (git stash show -p <ref>):', ...stashes);
	lines.push('', 'Ship what landed: git push threews main, then the deploy runbook in CLAUDE.md.');
	console.log(lines.join('\n'));
}

async function main() {
	const [cmd = 'status', ...rest] = process.argv.slice(2);
	const flag = (name) => rest.includes(name);
	const opt = (name) => {
		const i = rest.indexOf(name);
		return i === -1 ? undefined : rest[i + 1];
	};
	mkdirSync(STATE_DIR, { recursive: true });
	switch (cmd) {
		case 'run':
			return loop();
		case 'start':
			rmSync(PAUSE_FILE, { force: true });
			return start();
		case 'ensure':
			if (!existsSync(PAUSE_FILE)) start({ quiet: true });
			return;
		case 'stop':
			return stopDaemon();
		case 'pause':
			writeFileSync(PAUSE_FILE, new Date().toISOString());
			console.log('evolve paused: the current session finishes, no new one starts. `resume` to continue.');
			return;
		case 'resume':
			rmSync(PAUSE_FILE, { force: true });
			start();
			return;
		case 'once': {
			const lane = opt('--lane');
			if (lane && !['queue', 'scout', 'triage'].includes(lane)) throw new Error(`--lane must be queue, scout or triage`);
			const r = await cycle({ forceLane: lane, dryRun: flag('--dry-run') });
			if (r.outcome !== 'dry-run') console.log(JSON.stringify(r, null, 2));
			return;
		}
		case 'land': {
			const r = land();
			console.log(r.landed ? `landed ${r.landed} commit(s) on main${r.pushed ? ' and pushed' : ''}` : `nothing landed: ${r.reason}`);
			return;
		}
		case 'status':
			return status();
		default:
			console.error(`unknown command ${cmd}. Commands: start, stop, status, once, land, pause, resume, ensure, run`);
			process.exit(2);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
	main().catch((err) => {
		console.error(err.stack || err.message);
		process.exit(1);
	});
}
