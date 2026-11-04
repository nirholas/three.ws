// @vitest-environment jsdom
// /settings/memory renders against the real page markup. Only the network is
// faked (apiFetch); the module under test is the shipped src/settings-memory.js.
//
// Regression: Element.replaceChildren() stringifies a null argument, so the
// "learning is off" note and the "nothing saved yet" banner, passed as
// `cond ? el(...) : null`, rendered a literal "null" when learning was on or
// the profile had lines.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HTML = readFileSync(resolve(process.cwd(), 'pages/settings-memory.html'), 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/g, '');

const SECTIONS = [
	{ id: 'identity', label: 'Who they are', hint: 'Name, role, what they work on.' },
	{ id: 'preferences', label: 'Preferences', hint: 'How they like things done.' },
];

let responses;
vi.mock('../src/api.js', () => ({
	apiFetch: vi.fn(async (path) => {
		const key = Object.keys(responses).find((p) => String(path).startsWith(p));
		const body = key ? responses[key] : { error: 'not_found' };
		return new Response(JSON.stringify(body), { status: key ? 200 : 404, headers: { 'content-type': 'application/json' } });
	}),
}));

function setResponses({ enabled = true, entries = [] } = {}) {
	responses = {
		'/api/memory/settings': { settings: { enabled, skill_drafts_enabled: true, nudge_every_turns: 6, updated_at: null } },
		'/api/memory/user-model': {
			count: entries.length,
			sections: SECTIONS.map((s) => ({ ...s, entries: entries.filter((e) => e.section === s.id) })),
		},
		'/api/memory/items': { memories: [], has_more: false, next_before: null, counts: { fact: 0, preference: 0, procedure: 0 } },
		'/api/agents': { agents: [] },
	};
}

async function boot() {
	document.body.innerHTML = BODY;
	vi.resetModules();
	await import('../src/settings-memory.js');
	await vi.waitFor(() => {
		expect(document.getElementById('settings-body').textContent).toContain('Review cadence');
		expect(document.getElementById('model-body').querySelector('.mm-group')).not.toBeNull();
	});
}

const strayNullText = (host) =>
	[...host.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim() === 'null').length;

describe('/settings/memory rendering', () => {
	beforeEach(() => setResponses());
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('shows no stray "null" in the learning card while learning is on', async () => {
		setResponses({ enabled: true });
		await boot();
		const host = document.getElementById('settings-body');
		expect(strayNullText(host)).toBe(0);
		expect(host.querySelector('.mm-off')).toBeNull();
	});

	it('shows the off note, and nothing else extra, while learning is off', async () => {
		setResponses({ enabled: false });
		await boot();
		const host = document.getElementById('settings-body');
		expect(strayNullText(host)).toBe(0);
		expect(host.querySelector('.mm-off')?.textContent).toContain('Learning is off');
	});

	it('shows no stray "null" above the profile once it has lines', async () => {
		setResponses({ entries: [{ id: 'e1', section: 'preferences', content: 'Keep answers short', source: 'owner', updated_at: '2026-11-04T00:00:00Z' }] });
		await boot();
		const host = document.getElementById('model-body');
		expect(strayNullText(host)).toBe(0);
		expect(host.querySelector('.mm-empty')).toBeNull();
		expect(host.textContent).toContain('Keep answers short');
	});

	it('shows the empty-profile banner when nothing is saved', async () => {
		setResponses({ entries: [] });
		await boot();
		const host = document.getElementById('model-body');
		expect(strayNullText(host)).toBe(0);
		expect(host.querySelector('.mm-empty')?.textContent).toContain('has not saved anything about you yet');
	});
});
