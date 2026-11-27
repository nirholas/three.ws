// @vitest-environment jsdom
// Forge error copy: every code the server can emit has copy, and nothing a
// provider says reaches the person.
//
// The guard below extracts the server's codes the same way
// `node scripts/forge-error-codes.mjs` does and fails on any code with no entry
// in src/forge-errors.js, so a new server error code cannot ship without copy.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractForgeErrorCodes, forgeSourceFiles } from '../scripts/forge-error-codes.mjs';
import {
	FORGE_ERROR_COPY,
	UNKNOWN_ERROR,
	describeForgeError,
	forgeErrorFromResponse,
	isSafeServerText,
	safeJobErrorText,
	announceForgeError,
} from '../src/forge-errors.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// What a provider has really been seen to answer, plus the leak shapes the
// screen exists for: a URL with a key, a stack, an internal host, markup.
const HOSTILE =
	'<img src=x onerror="window.__pwned=1">Replicate prediction 9f3c2a1b failed: CUDA out of memory at ' +
	'https://api.replicate.com/v1/predictions?token=r8_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 ' +
	'(model-trellis-abc123-uc.a.run.app) TypeError: x is undefined\n    at run (/srv/worker.js:12:7)';

const LEAK_MARKERS = [/replicate/i, /cuda/i, /https?:/i, /r8_/, /run\.app/, /TypeError/, /worker\.js/, /<img/i, /onerror/i];

function expectNoLeak(text) {
	for (const re of LEAK_MARKERS) expect(text).not.toMatch(re);
}

describe('server error inventory', () => {
	const codes = extractForgeErrorCodes(ROOT);

	it('finds the codes the page has always handled', () => {
		for (const c of ['rate_limited', 'daily_limit_reached', 'provider_busy', 'sign_in_required', 'storage_unavailable', 'generation_failed', 'invalid_job']) {
			expect(codes.has(c), c).toBe(true);
		}
		// A healthy extraction is well past a hundred codes; a sudden drop means
		// a pattern stopped matching, not that the server got simpler.
		expect(codes.size).toBeGreaterThan(100);
	});

	it('every code a Forge endpoint can return has copy', () => {
		const missing = [...codes.keys()].filter((c) => !Object.hasOwn(FORGE_ERROR_COPY, c));
		expect(missing, `add these to FORGE_ERROR_COPY in src/forge-errors.js: ${missing.join(', ')}`).toEqual([]);
	});

	it('scans the endpoint handlers and the helpers they answer through', () => {
		const files = forgeSourceFiles(ROOT).map((p) => p.slice(ROOT.length + 1));
		expect(files).toContain('api/forge.js');
		expect(files).toContain('api/forge-remesh.js');
		expect(files).toContain('api/_lib/forge-idempotency.js');
		expect(files.some((f) => f.startsWith('api/forge/webhook/'))).toBe(false);
	});
});

describe('copy entries', () => {
	const entries = Object.entries(FORGE_ERROR_COPY);

	it.each(entries)('%s says what happened and what to do', (code, e) => {
		expect(e.title, code).toMatch(/\S/);
		expect(e.what, code).toMatch(/[.!]$/);
		expect(e.todo, code).toMatch(/[.!]$/);
		expect(['now', 'wait', 'never']).toContain(e.retry);
		expect(['retry', 'sign_in', 'edit_input', 'switch_engine', 'add_key', 'pay', 'reload', 'contact']).toContain(e.action);
		// House style: no em or en dashes in anything a user reads.
		for (const s of [e.title, e.what, e.todo]) expect(s).not.toMatch(/[\u2013\u2014]/);
		// Copy never names a host, a key or a stack. Our own name and the engine
		// labels the picker already shows (pages/forge.html .eng-label) are fine.
		const prose = `${e.what} ${e.todo}`
			.replace(/\{wait\}|\{reset\}/g, 'soon')
			.replace(/\bthree\.ws\b/g, 'us')
			.replace(/\bNVIDIA\b/g, 'the engine');
		expect(isSafeServerText(prose) || /\$THREE/.test(prose), code).toBe(true);
	});

	it('every descriptor keeps the user input', () => {
		for (const code of Object.keys(FORGE_ERROR_COPY)) {
			expect(describeForgeError({ status: 400, body: { error: code } }).keepsInput).toBe(true);
		}
	});
});

describe('describeForgeError', () => {
	it('never shows the server message, even when it is hostile', () => {
		for (const code of [...Object.keys(FORGE_ERROR_COPY), 'never_seen_before_code']) {
			const d = describeForgeError({ status: 502, body: { error: code, message: HOSTILE, error_description: HOSTILE } });
			expectNoLeak(`${d.title} ${d.message}`);
		}
	});

	it('an unknown code is honest, actionable, and carries a reference', () => {
		const d = describeForgeError({ status: 418, body: { error: 'brand_new_code' }, now: Date.UTC(2026, 10, 26, 23, 41) });
		expect(d.known).toBe(false);
		expect(d.title).toBe(UNKNOWN_ERROR.title);
		expect(d.retry).toBe('now');
		expect(d.message).toContain('Reference: brand_new_code/418 at 23:41 UTC.');
	});

	it('quotes the server correlation ref when one came back', () => {
		const d = describeForgeError({ status: 500, body: { error: 'internal_error', ref: 'a1b2c3d4e5' } });
		expect(d.reference).toBe('a1b2c3d4e5');
		expect(d.message).toContain('Reference: a1b2c3d4e5.');
	});

	it('drops a ref that is not a plain id', () => {
		const d = describeForgeError({ status: 500, body: { error: 'internal_error', ref: HOSTILE } });
		expectNoLeak(d.message);
	});

	it('a missing body still lands on a status-appropriate answer', () => {
		expect(describeForgeError({ status: 503, body: {} }).code).toBe(null);
		expect(describeForgeError({ status: 503, body: {} }).title).toBe(FORGE_ERROR_COPY.service_unavailable.title);
		expect(describeForgeError({ status: 401, body: {} }).action).toBe('sign_in');
		expect(describeForgeError({ status: 0 }).code).toBe('network');
	});

	it('fills the wait from retry_after and the reset from reset_at', () => {
		const busy = describeForgeError({ status: 503, body: { error: 'provider_busy', retry_after: 30 } });
		expect(busy.retry).toBe('wait');
		expect(busy.retryAfter).toBe(30);
		expect(busy.todo).toContain('about 30 seconds');
		const daily = describeForgeError({
			status: 429,
			body: { error: 'daily_limit_reached', retry_after: 3 * 3600, reset_at: '2026-11-27T00:00:00.000Z' },
		});
		expect(daily.todo).toContain('at 00:00 UTC (in about 3 hours)');
	});

	it('tells a limiter outage and a queued throttle apart from a quota hit', () => {
		expect(describeForgeError({ status: 429, body: { error: 'rate_limited', reason: 'rate_limiter_unavailable' } }).title).toBe(
			FORGE_ERROR_COPY.rate_limiter_unavailable.title,
		);
		expect(describeForgeError({ status: 429, body: { error: 'rate_limited', queued: true, retry_after: 45 } }).title).toBe(
			FORGE_ERROR_COPY.rate_limited_queued.title,
		);
	});

	it('appends our own validation text only where allowed and only when safe', () => {
		const ok = describeForgeError({ status: 400, body: { error: 'invalid_prompt', message: 'Optional guidance prompt must be 1000 characters or fewer.' } });
		expect(ok.todo).toContain('1000 characters or fewer');
		const bad = describeForgeError({ status: 400, body: { error: 'invalid_prompt', message: HOSTILE } });
		expectNoLeak(bad.todo);
		const notAllowed = describeForgeError({ status: 422, body: { error: 'image_not_usable', message: 'The photo shows two cats.' } });
		expect(notAllowed.todo).not.toContain('two cats');
	});

	it('forgeErrorFromResponse carries the descriptor on the Error', () => {
		const e = forgeErrorFromResponse(502, { error: 'generation_failed', message: HOSTILE });
		expect(e).toBeInstanceOf(Error);
		expect(e.code).toBe('generation_failed');
		expect(e.title).toBe(FORGE_ERROR_COPY.generation_failed.title);
		expectNoLeak(e.message);
	});
});

describe('isSafeServerText / safeJobErrorText', () => {
	it('passes the masked job sentences the server produces', () => {
		for (const s of [
			'This was flagged by content safety. Try a different prompt or photo.',
			'The engine took too long, please try again.',
			'3D generation hit a snag, please try again.',
		]) {
			expect(safeJobErrorText(s)).toBe(s);
		}
	});

	it.each([
		['a url', 'failed at https://example.com/x'],
		['a host', 'connect to trellis-worker.internal failed'],
		['an ip', 'upstream 10.0.0.12 refused'],
		['a stack frame', 'boom\n    at run (/srv/w.js:1:2)'],
		['an exception', 'RuntimeError: CUDA error'],
		['a socket code', 'ECONNREFUSED'],
		['a key', 'auth failed for hf_abcdefghijklmnop'],
		['a vendor', 'Meshy account is out of credits.'],
		['markup', '<b>no</b>'],
		['json', '{"detail":"x"}'],
	])('rejects %s', (_label, text) => {
		expect(isSafeServerText(text)).toBe(false);
		expect(safeJobErrorText(text)).toBe(null);
	});
});

describe('announceForgeError', () => {
	it('puts the message in one assertive alert region', async () => {
		announceForgeError('Generation did not finish', 'Try again.');
		await new Promise((r) => requestAnimationFrame(r));
		const regions = document.querySelectorAll('[role="alert"].forge-sr-alert');
		expect(regions).toHaveLength(1);
		expect(regions[0].getAttribute('aria-live')).toBe('assertive');
		expect(regions[0].textContent).toBe('Generation did not finish. Try again.');
		announceForgeError('Second', 'Again.');
		await new Promise((r) => requestAnimationFrame(r));
		expect(document.querySelectorAll('.forge-sr-alert')).toHaveLength(1);
	});
});

// Page files must not build a user-facing Error straight from the server's
// `message`: that is how raw provider text reached the error panel.
describe('page wiring', () => {
	const PAGE_FILES = [
		'src/forge.js',
		'src/forge-studio/forge.js',
		'src/forge-rig.js',
		'src/forge-stylize.js',
		'src/forge-segment.js',
		'src/forge-optimize.js',
		'src/forge-gameready.js',
		'src/forge-studio/forge-optimize.js',
		'src/forge-studio/forge-gameready.js',
	];
	it.each(PAGE_FILES)('%s does not throw server text as the user message', (file) => {
		const src = readFileSync(join(ROOT, file), 'utf8');
		const hits = src.split('\n').filter((l) => /new Error\(\s*data\.(message|error)\b/.test(l));
		expect(hits, hits.join('\n')).toEqual([]);
	});

	// Bug reproduced 2026-11-26 in a real browser: the throttle and storage-down
	// states write their own title and message instead of going through
	// showError, and #state-error has no live role, so a screen reader heard
	// nothing when Forge said "high demand" or "storage is down".
	const body = (src, name) => {
		const start = src.search(new RegExp(`(async )?function ${name}\\(`));
		if (start === -1) return '';
		const next = src.slice(start + 1).search(/\n(async )?function /);
		return next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
	};
	it.each([
		['src/forge.js', 'showThrottle'],
		['src/forge.js', 'showStorageDown'],
		['src/forge-studio/forge.js', 'showThrottle'],
	])('%s %s announces the state to screen readers', (file, fn) => {
		const src = readFileSync(join(ROOT, file), 'utf8');
		const text = body(src, fn);
		expect(text, `${fn} not found in ${file}`).not.toBe('');
		expect(text).toMatch(/announceForgeError\(/);
	});
});

// Bug reproduced 2026-11-26: a failed auto-rig showed the server's message,
// which api/forge.js fills with the rigger's raw error, and wrote it into the
// panel with innerHTML, so provider text (and any markup in it) reached the page.
describe('auto-rig failure panel', () => {
	beforeEach(() => {
		vi.resetModules();
		document.body.innerHTML = `
			<div id="state-result"><div class="result-bar"><div class="actions"></div></div></div>
			<model-viewer id="viewer" src="https://cdn.three.ws/forge/model.glb"></model-viewer>`;
		window.__pwned = 0;
		globalThis.fetch = vi.fn(async () =>
			new Response(JSON.stringify({ error: 'rig_failed', message: HOSTILE }), {
				status: 502,
				headers: { 'content-type': 'application/json' },
			}),
		);
	});
	afterEach(() => {
		delete globalThis.fetch;
	});

	it('shows map copy as text, never the rigger output', async () => {
		await import('../src/forge-rig.js');
		document.getElementById('forge-rig-btn').click();
		const panel = document.getElementById('rig-panel');
		await vi.waitFor(() => expect(panel.textContent).toMatch(/did not finish/));
		expect(panel.querySelector('img')).toBe(null);
		expectNoLeak(panel.textContent);
		expect(panel.querySelector('#rig-retry')).not.toBe(null);
	});
});
