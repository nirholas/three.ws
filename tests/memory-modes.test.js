import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// localStorage shim — the file-based Memory persists synchronously to
// localStorage for `local` mode, so the Node test env needs a stand-in.
class LocalStorageStub {
	constructor() { this.store = new Map(); }
	getItem(k) { return this.store.has(k) ? this.store.get(k) : null; }
	setItem(k, v) { this.store.set(k, String(v)); }
	removeItem(k) { this.store.delete(k); }
	clear() { this.store.clear(); }
}

// crypto.subtle.decrypt is not used here, but importing crypto.js pulls in
// the global; node's webcrypto is fine for what these tests touch.
beforeEach(() => {
	globalThis.localStorage = new LocalStorageStub();
});

afterEach(() => {
	vi.restoreAllMocks();
	delete globalThis.localStorage;
});

const { Memory } = await import('../src/memory/index.js');

// ── none ────────────────────────────────────────────────────────────────────

describe('Memory.load — none', () => {
	it('returns an empty memory and never touches storage', async () => {
		const mem = await Memory.load({ mode: 'none', namespace: 'test' });
		expect(mem.mode).toBe('none');
		expect(mem.files.size).toBe(0);
		mem.write('user_role', { name: 'r', description: 'd', type: 'user', body: 'hi' });
		// `_persist` is a no-op for non-local modes — localStorage stays empty.
		expect(globalThis.localStorage.store.size).toBe(0);
	});
});

// ── local ───────────────────────────────────────────────────────────────────

describe('Memory.load — local', () => {
	it('round-trips a write through localStorage', async () => {
		const mem1 = await Memory.load({ mode: 'local', namespace: 'agent-1' });
		mem1.write('user_role', { name: 'role', description: 'who', type: 'user', body: 'hello' });
		expect(globalThis.localStorage.getItem('agent:agent-1:memory')).toBeTruthy();

		const mem2 = await Memory.load({ mode: 'local', namespace: 'agent-1' });
		expect(mem2.mode).toBe('local');
		expect(mem2.read('user_role')?.body.trim()).toBe('hello');
	});

	it('survives malformed localStorage by starting fresh', async () => {
		globalThis.localStorage.setItem('agent:agent-1:memory', '{not-json');
		const mem = await Memory.load({ mode: 'local', namespace: 'agent-1' });
		expect(mem.mode).toBe('local');
		expect(mem.files.size).toBe(0);
	});
});

// ── remote ──────────────────────────────────────────────────────────────────

describe('Memory.load — remote', () => {
	it('hydrates files from /api/agent-memory', async () => {
		const fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				entries: [
					{
						id: 'remote-id-1',
						type: 'user',
						content: '---\nname: role\ntype: user\n---\n\nremote body',
						context: { filename: 'user_role.md' },
					},
				],
			}),
		});

		const mem = await Memory.load({ mode: 'remote', namespace: 'agent-uuid', fetchFn });
		expect(mem.mode).toBe('remote');
		expect(fetchFn).toHaveBeenCalledOnce();
		const url = fetchFn.mock.calls[0][0];
		expect(url).toContain('/api/agent-memory?agentId=agent-uuid');
		expect(mem.read('user_role')?.body.trim()).toBe('remote body');
		expect(mem._remoteIds.get('user_role.md')).toBe('remote-id-1');
		// Index gets rebuilt so MEMORY.md reflects the hydrated files.
		expect(mem.indexText).toContain('user_role.md');
	});

	it('falls back to an empty store when the endpoint is unreachable', async () => {
		const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));
		const mem = await Memory.load({ mode: 'remote', namespace: 'agent-uuid', fetchFn });
		expect(mem.mode).toBe('remote');
		expect(mem.files.size).toBe(0);
	});

	it('upserts on write — sends agentId + entry, captures returned id', async () => {
		// Initial load: empty backend
		const fetchFn = vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ entries: [] }) });
		const mem = await Memory.load({ mode: 'remote', namespace: 'agent-uuid', fetchFn });

		// Subsequent write hits the global fetch (the upsert path is hard-wired
		// to it). Stub it for the assertion.
		const upsert = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ entry: { id: 'srv-id-1' } }),
		});
		globalThis.fetch = upsert;

		mem.write('feedback_testing', {
			name: 'testing',
			description: 'how to test',
			type: 'feedback',
			body: 'hit a real DB',
		});

		// _remoteUpsert is fire-and-forget — flush it.
		await new Promise((r) => setTimeout(r, 0));

		expect(upsert).toHaveBeenCalledOnce();
		const [url, init] = upsert.mock.calls[0];
		expect(url).toBe('/api/agent-memory');
		expect(init.method).toBe('POST');
		const sent = JSON.parse(init.body);
		expect(sent.agentId).toBe('agent-uuid');
		expect(sent.entry.type).toBe('feedback');
		expect(sent.entry.context.filename).toBe('feedback_testing.md');
		// First write has no prior id — backend returns one we cache.
		expect(sent.entry.id).toBeUndefined();
		expect(mem._remoteIds.get('feedback_testing.md')).toBe('srv-id-1');
	});
});

// ── unknown mode → fallback ─────────────────────────────────────────────────

describe('Memory.load — unknown mode fallback', () => {
	it('warns once and returns a usable local-mode memory', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mem = await Memory.load({ mode: 'who-knows', namespace: 'agent-uuid' });
		expect(mem.mode).toBe('local');
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0][0]).toMatch(/unknown mode "who-knows"/);
		// Critically: the returned instance is fully functional. This is the
		// `_boot` resilience guarantee — a typo in the manifest can never break
		// the embed.
		mem.write('x', { name: 'x', description: '', type: 'user', body: 'ok' });
		expect(mem.read('x')?.body.trim()).toBe('ok');
	});
});
