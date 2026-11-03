// Every OpenRouter request the platform makes must carry the same app
// attribution, or that traffic never counts toward three.ws's app page and the
// openrouter.ai/rankings table. api/_lib/openrouter-attribution.js is the single
// source of truth; this suite fails the moment a call site sends nothing, sends
// only a title (OpenRouter keys the app on HTTP-Referer), or reports a drifted
// name of its own.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { OPENROUTER_ATTRIBUTION_HEADERS } from '../api/_lib/openrouter-attribution.js';
import { providerLanes } from '../workers/okx-chat-bot/config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The platform's own surfaces. apps/hq and robinhood/hood-traders are separate
// products that report their own app identity on purpose, so they are not here.
const SCANNED = ['api', 'workers', 'src', 'chat/src', 'scripts'];

// Call sites that import the endpoint URL instead of spelling it, so the scan
// below cannot see them on its own.
const INDIRECT = ['src/assistant-frame.js'];

function walk(dir, out) {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walk(p, out);
		else if (/\.(m?js|ts)$/.test(name) && !name.endsWith('.min.js')) out.push(p);
	}
	return out;
}

// A file is a call site when it names a generation endpoint (chat/completions
// or the Anthropic-wire gateway base) AND issues a request. Files that only hold
// the URL as data, or only list /models, are not.
function isCallSite(src) {
	const namesEndpoint = /openrouter\.ai\/api(\/v1\/chat\/completions|['"`])/.test(src);
	const requests = /\bfetch(WithTimeout)?\(|\bpostJson\(|\burl:\s*\(\)\s*=>/.test(src);
	return namesEndpoint && requests;
}

function carriesCanonicalAttribution(src) {
	if (src.includes('OPENROUTER_ATTRIBUTION_HEADERS')) return true;
	return Object.entries(OPENROUTER_ATTRIBUTION_HEADERS).every(([k, v]) =>
		new RegExp(`['"]${k}['"]\\s*:\\s*['"]${v.replace(/\./g, '\\.')}['"]`).test(src),
	);
}

describe('OpenRouter app attribution', () => {
	it('defines one canonical referer and title', () => {
		expect(OPENROUTER_ATTRIBUTION_HEADERS).toEqual({
			'HTTP-Referer': 'https://three.ws',
			'X-Title': 'three.ws',
			'X-OpenRouter-Title': 'three.ws',
		});
	});

	it('is sent, unchanged, by every platform OpenRouter call site', () => {
		const files = SCANNED.flatMap((d) => walk(join(ROOT, d), []));
		const callSites = files.filter((f) => isCallSite(readFileSync(f, 'utf8'))).concat(INDIRECT.map((f) => join(ROOT, f)));
		const missing = callSites
			.filter((f) => !carriesCanonicalAttribution(readFileSync(f, 'utf8')))
			.map((f) => relative(ROOT, f));
		expect(callSites.length).toBeGreaterThan(15);
		expect(missing).toEqual([]);
	});

	it('rides the OKX bot gateway lane as CLI custom headers when the gateway is OpenRouter', () => {
		const lanes = providerLanes(
			{
				OKX_BOT_ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
				OKX_BOT_ANTHROPIC_AUTH_TOKEN: 'sk-or-test',
				OKX_BOT_PROVIDER: 'claude',
			},
			'/nonexistent-home',
		);
		const gateway = lanes.find((l) => l.id === 'anthropic-gateway');
		expect(gateway).toBeTruthy();
		const lines = String(gateway.env.ANTHROPIC_CUSTOM_HEADERS || '').split('\n');
		for (const [k, v] of Object.entries(OPENROUTER_ATTRIBUTION_HEADERS)) {
			expect(lines).toContain(`${k}: ${v}`);
		}
	});

	it('does not leak OpenRouter attribution to a non-OpenRouter gateway', () => {
		const lanes = providerLanes(
			{
				OKX_BOT_ANTHROPIC_BASE_URL: 'https://three.ws/api/llm/anthropic',
				OKX_BOT_ANTHROPIC_AUTH_TOKEN: 'tok',
				OKX_BOT_PROVIDER: 'claude',
			},
			'/nonexistent-home',
		);
		const gateway = lanes.find((l) => l.id === 'anthropic-gateway');
		expect(gateway).toBeTruthy();
		expect(gateway.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined();
	});
});
