// track() in src/analytics.js drops any event that is not a value of
// ANALYTICS_EVENTS. In production that is silent; only dev builds warn. The
// create-agent wizard shipped two events that were never registered
// (create_agent_template_used, persona_interview_generate), so template use and
// persona-interview outcomes were never recorded. Every track() call made
// through analytics.js must name a registered event, by literal or by key.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ANALYTICS_EVENTS } from '../src/analytics.js';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const VALUES = new Set(Object.values(ANALYTICS_EVENTS));

function jsFiles(dir) {
	const out = [];
	for (const ent of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, ent.name);
		if (ent.isDirectory()) out.push(...jsFiles(p));
		else if (/\.(m?js|ts)$/.test(ent.name)) out.push(p);
	}
	return out;
}

// Files whose `track` is the analytics.js export (named import, possibly renamed).
function analyticsTrackName(code) {
	for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][./]*(?:[\w-]+\/)*analytics\.js['"]/g)) {
		for (const part of m[1].split(',')) {
			const [name, alias] = part.trim().split(/\s+as\s+/);
			if (name === 'track') return alias || 'track';
		}
	}
	return null;
}

function unregistered(code, fn) {
	const bad = [];
	const call = new RegExp(`(?<![\\w.$])${fn}\\(\\s*(?:'([^']+)'|"([^"]+)"|ANALYTICS_EVENTS\\.(\\w+))`, 'g');
	for (const m of code.matchAll(call)) {
		const literal = m[1] ?? m[2];
		if (literal !== undefined && !VALUES.has(literal)) bad.push(literal);
		if (m[3] !== undefined && !(m[3] in ANALYTICS_EVENTS)) bad.push(`ANALYTICS_EVENTS.${m[3]}`);
	}
	return bad;
}

describe('unregistered', () => {
	it('flags an unknown literal and an unknown key, and accepts registered ones', () => {
		const code = `track('nope_event'); track(ANALYTICS_EVENTS.NOPE); track('${ANALYTICS_EVENTS.CTA_CLICKED}'); track(ANALYTICS_EVENTS.CTA_CLICKED); other.track('x');`;
		expect(unregistered(code, 'track')).toEqual(['nope_event', 'ANALYTICS_EVENTS.NOPE']);
	});
});

describe('every analytics track() call in src names a registered event', () => {
	it('has no unregistered events', () => {
		const offenders = [];
		for (const file of jsFiles(SRC)) {
			const code = readFileSync(file, 'utf8');
			const fn = analyticsTrackName(code);
			if (!fn) continue;
			for (const ev of unregistered(code, fn)) offenders.push(`${relative(ROOT, file)}: ${ev}`);
		}
		expect(offenders).toEqual([]);
	});
});
