// Both Forge pages (/forge and Forge Studio) must start exactly one generation
// per user intent, and must not drop a running one over a passing network blip.
//
// Measured in a browser on 2026-11-27 before the fix: on /forge a double Enter
// sent 2 generation POSTs, a held Enter 7, an Enter pressed again mid-run 3, a
// double click 2; Forge Studio did the same with Ctrl+Enter (2, 7, 3, 2). None
// carried an Idempotency-Key, so each one was a separate, separately charged
// job. Studio's poll also ended the run as failed on a single dropped status
// request, and gave up after 12 minutes on a job the server allows 45.
//
// The logic lives in shared modules with their own suites
// (tests/forge-inflight.test.js, tests/resilient-poll.test.js); this pins that
// both pages are wired to them.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const PAGES = [
	{ name: '/forge', js: 'src/forge.js', inflight: './forge-inflight.js', shared: './shared/', keyHandler: 'submitOnEnter' },
	{
		name: 'Forge Studio',
		js: 'src/forge-studio/forge.js',
		inflight: '../forge-inflight.js',
		shared: '../shared/',
		keyHandler: 'submitOnModifierEnter',
	},
];

function fnBody(src, name) {
	const start = src.search(new RegExp(`(async )?function ${name}\\(`));
	if (start < 0) throw new Error(`${name} not found`);
	// The body opens after the parameter list, which may hold `{ a = 1 } = {}`.
	const m = src.slice(start).match(/\)\s*\{\s*\n/);
	const open = start + m.index + m[0].indexOf('{');
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		if (src[i] === '{') depth++;
		else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
	}
	throw new Error(`${name} has no end`);
}

describe.each(PAGES)('$name starts one generation per intent', ({ js, inflight, shared, keyHandler }) => {
	const src = read(js);

	it('imports the shared run gate and idempotency key', () => {
		const imp = src.match(new RegExp(`import \\{([^}]+)\\} from '${inflight.replace(/[.]/g, '\\.')}'`));
		expect(imp, `${js} imports ${inflight}`).not.toBeNull();
		expect(imp[1]).toMatch(/\bcreateRunGate\b/);
		expect(src).toMatch(/const runGate = createRunGate\(\)/);
	});

	it('takes the gate before its first await, so a second click finds the tab busy', () => {
		const run = fnBody(src, 'run');
		const enter = run.indexOf('runGate.enter(');
		const firstAwait = run.indexOf('await ');
		expect(enter).toBeGreaterThan(-1);
		expect(enter).toBeLessThan(firstAwait);
		expect(run).toMatch(/if \(!gateToken\) return;/);
	});

	it('only the run holding the gate ends the busy state', () => {
		const run = fnBody(src, 'run');
		expect(run).toMatch(/finally \{[\s\S]*if \(runGate\.leave\(gateToken\)\) setBusy\(false\);/);
		expect(run).not.toMatch(/finally \{\s*setBusy\(false\);/);
	});

	it('hands the gate to the automatic lane hop instead of racing it', () => {
		expect(fnBody(src, 'run')).toMatch(/run\(lastJob, \{ handoff: true \}\)/);
	});

	it("ignores a held key's auto-repeat", () => {
		expect(fnBody(src, keyHandler)).toMatch(/if \(e\.repeat\) return;/);
	});

	it('sends every generation POST under an Idempotency-Key', () => {
		const start = fnBody(src, 'startJob');
		expect(start).toMatch(/postGenerationOnce\(|'idempotency-key'/);
	});

	it('Cancel frees the tab for the next run at once', () => {
		const at = src.indexOf("els.cancel.addEventListener('click'");
		expect(at).toBeGreaterThan(-1);
		expect(src.slice(at, at + 400)).toMatch(/runGate\.reset\(\)/);
	});

	// The loop may sit in pollUntilDone itself or in a runPollLoop it calls.
	const pollCode = () => fnBody(src, 'pollUntilDone') + (/function runPollLoop\(/.test(src) ? fnBody(src, 'runPollLoop') : '');

	it('polls through the shared transport-aware status fetch and outlasts the server deadline', () => {
		const poll = pollCode();
		expect(poll).toMatch(/fetchJobStatus\(/);
		expect(poll).not.toMatch(/await fetch\(`\/api\/forge\?job=/);
		expect(src).toMatch(new RegExp(`from '${shared.replace(/[.]/g, '\\.')}resilient-poll\\.js'`));
		expect(src).toMatch(/const MAX_POLL_MS = RESUME_WINDOW_MS;/);
	});

	it('stops polling a tab hidden for a long time and resumes on focus', () => {
		const poll = pollCode();
		expect(poll).toMatch(/hiddenStreakMs\(\) >= POLL_HIDDEN_PAUSE_MS/);
		expect(poll).toMatch(/await waitUntilVisible\(\)/);
	});
});
