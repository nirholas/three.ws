import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentMemory, MEMORY_TYPES } from '../../src/agent-memory.js';

// ── Globals ───────────────────────────────────────────────────────────────

const localStorageMock = (() => {
	let store = {};
	return {
		getItem: vi.fn((key) => store[key] ?? null),
		setItem: vi.fn((key, val) => {
			store[key] = val;
		}),
		removeItem: vi.fn((key) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			store = {};
		}),
		_reset() {
			store = {};
		},
		_store() {
			return store;
		},
	};
})();

vi.stubGlobal('localStorage', localStorageMock);

const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
vi.stubGlobal('fetch', fetchMock);

// ── Reset ─────────────────────────────────────────────────────────────────

beforeEach(() => {
	localStorageMock._reset();
	localStorageMock.getItem.mockClear();
	localStorageMock.setItem.mockClear();
	fetchMock.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('AgentMemory.add()', () => {
	it('stores entry in memory and returns a string id', () => {
		const mem = new AgentMemory('agent-1');
		const id = mem.add({ type: MEMORY_TYPES.USER, content: 'hello' });

		expect(typeof id).toBe('string');
		expect(id.length).toBeGreaterThan(0);

		const results = mem.query();
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe(id);
		expect(results[0].content).toBe('hello');
	});

	it('persists entry to localStorage immediately', () => {
		const mem = new AgentMemory('agent-1');
		mem.add({ type: MEMORY_TYPES.USER, content: 'persist me' });

		expect(localStorageMock.setItem).toHaveBeenCalled();

		const lastCall = localStorageMock.setItem.mock.calls.at(-1);
		const key = lastCall[0];
		const stored = JSON.parse(lastCall[1]);

		expect(key).toBe('agent_memory_agent-1');
		expect(Array.isArray(stored)).toBe(true);
		expect(stored[0].content).toBe('persist me');
	});

	it('schedules a backend sync when backendSync is enabled', () => {
		const mem = new AgentMemory('agent-1', { backendSync: true });
		// Constructor also fires _hydrateFromBackend — clear before the assertion.
		fetchMock.mockClear();

		mem.add({ type: MEMORY_TYPES.USER, content: 'sync me' });

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, opts] = fetchMock.mock.calls[0];
		expect(url).toContain('agent-1');
		expect(opts.method).toBe('POST');
	});

	it('does NOT call fetch when backendSync is false (default)', () => {
		const mem = new AgentMemory('agent-1');
		mem.add({ type: MEMORY_TYPES.USER, content: 'no sync' });

		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('AgentMemory.query() — filtering', () => {
	it('query({ type }) returns only entries of that type', () => {
		const mem = new AgentMemory('agent-1');
		mem.add({ type: MEMORY_TYPES.USER, content: 'user note' });
		mem.add({ type: MEMORY_TYPES.PROJECT, content: 'project note' });
		mem.add({ type: MEMORY_TYPES.REFERENCE, content: 'ref note' });

		const results = mem.query({ type: MEMORY_TYPES.USER });
		expect(results).toHaveLength(1);
		expect(results[0].content).toBe('user note');
	});

	it('query({ tags }) returns only entries containing ALL specified tags', () => {
		const mem = new AgentMemory('agent-1');
		mem.add({ type: MEMORY_TYPES.USER, content: 'both tags', tags: ['foo', 'bar'] });
		mem.add({ type: MEMORY_TYPES.USER, content: 'one tag', tags: ['foo'] });
		mem.add({ type: MEMORY_TYPES.USER, content: 'no tags' });

		const fooBar = mem.query({ tags: ['foo', 'bar'] });
		expect(fooBar).toHaveLength(1);
		expect(fooBar[0].content).toBe('both tags');

		const fooOnly = mem.query({ tags: ['foo'] });
		expect(fooOnly).toHaveLength(2);
	});

	it('query({ limit }) returns at most limit results', () => {
		const mem = new AgentMemory('agent-1');
		for (let i = 0; i < 10; i++) {
			mem.add({ type: MEMORY_TYPES.PROJECT, content: `entry ${i}` });
		}

		expect(mem.query({ limit: 3 })).toHaveLength(3);
		expect(mem.query({ limit: 1 })).toHaveLength(1);
	});

	it('query({ since }) excludes entries created before the timestamp', () => {
		vi.useFakeTimers();
		const mem = new AgentMemory('agent-1');

		mem.add({ type: MEMORY_TYPES.PROJECT, content: 'old' });

		vi.advanceTimersByTime(5000);
		const cutoff = Date.now();

		vi.advanceTimersByTime(1000);
		mem.add({ type: MEMORY_TYPES.PROJECT, content: 'new' });

		const results = mem.query({ since: cutoff });
		expect(results).toHaveLength(1);
		expect(results[0].content).toBe('new');
	});

	it('excludes expired entries (expiresAt in the past)', () => {
		vi.useFakeTimers();
		const now = Date.now();
		const mem = new AgentMemory('agent-1');

		mem.add({ type: MEMORY_TYPES.PROJECT, content: 'active' });
		mem.add({
			type: MEMORY_TYPES.PROJECT,
			content: 'expired',
			expiresAt: now - 1000,
		});

		const results = mem.query();
		expect(results).toHaveLength(1);
		expect(results[0].content).toBe('active');
	});

	it('includes entries whose expiresAt is in the future', () => {
		vi.useFakeTimers();
		const now = Date.now();
		const mem = new AgentMemory('agent-1');

		mem.add({
			type: MEMORY_TYPES.PROJECT,
			content: 'not yet expired',
			expiresAt: now + 60_000,
		});

		expect(mem.query()).toHaveLength(1);
	});
});

describe('AgentMemory.query() — scoring', () => {
	it('sorts entries by salience × recency (highest score first)', () => {
		vi.useFakeTimers();
		const mem = new AgentMemory('agent-1');

		// All added at the same time so recency is identical —
		// sort order is determined purely by salience.
		// feedback base = 0.8, reference base = 0.5.
		mem.add({ type: MEMORY_TYPES.REFERENCE, content: 'low' });
		mem.add({ type: MEMORY_TYPES.FEEDBACK, content: 'high' });
		mem.add({ type: MEMORY_TYPES.USER, content: 'mid' });

		const results = mem.query();
		expect(results[0].content).toBe('high'); // feedback: 0.8
		expect(results[1].content).toBe('mid'); // user: 0.7
		expect(results[2].content).toBe('low'); // reference: 0.5
	});

	it('entry.important=true gives salience 1.0, appearing before all others', () => {
		vi.useFakeTimers();
		const mem = new AgentMemory('agent-1');

		mem.add({ type: MEMORY_TYPES.FEEDBACK, content: 'high' });
		mem.add({ type: MEMORY_TYPES.PROJECT, content: 'critical', important: true });

		const results = mem.query();
		expect(results[0].content).toBe('critical');
		expect(results[0].salience).toBe(1.0);
	});
});

describe('AgentMemory — localStorage hydration', () => {
	it('loads existing entries from localStorage on construction', () => {
		const existing = [
			{
				id: 'hydrated-1',
				type: MEMORY_TYPES.USER,
				content: 'remembered',
				tags: [],
				context: {},
				salience: 0.7,
				createdAt: Date.now(),
				expiresAt: null,
			},
		];
		localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(existing));

		const mem = new AgentMemory('agent-1');
		const results = mem.query();

		expect(results).toHaveLength(1);
		expect(results[0].id).toBe('hydrated-1');
		expect(results[0].content).toBe('remembered');
	});

	it('starts with empty entries when localStorage has nothing', () => {
		// default getItem mock returns null
		const mem = new AgentMemory('agent-1');
		expect(mem.query()).toHaveLength(0);
	});

	it('starts with empty entries when localStorage contains invalid JSON', () => {
		localStorageMock.getItem.mockReturnValueOnce('not-valid-json{{{');
		const mem = new AgentMemory('agent-1');
		expect(mem.query()).toHaveLength(0);
	});

	it('uses the agentId-scoped storage key', () => {
		new AgentMemory('my-special-agent');
		expect(localStorageMock.getItem).toHaveBeenCalledWith('agent_memory_my-special-agent');
	});
});

describe('AgentMemory.forget() / clear()', () => {
	it('forget(id) removes the entry from query results', () => {
		const mem = new AgentMemory('agent-1');
		const id = mem.add({ type: MEMORY_TYPES.PROJECT, content: 'delete me' });
		mem.add({ type: MEMORY_TYPES.PROJECT, content: 'keep me' });

		mem.forget(id);
		const results = mem.query();
		expect(results).toHaveLength(1);
		expect(results[0].content).toBe('keep me');
	});

	it('forget(id) persists the removal to localStorage', () => {
		const mem = new AgentMemory('agent-1');
		const id = mem.add({ type: MEMORY_TYPES.PROJECT, content: 'gone' });

		localStorageMock.setItem.mockClear();
		mem.forget(id);

		expect(localStorageMock.setItem).toHaveBeenCalled();
		const stored = JSON.parse(localStorageMock.setItem.mock.calls.at(-1)[1]);
		expect(stored.find((e) => e.id === id)).toBeUndefined();
	});

	it('clear(type) removes only entries of that type', () => {
		const mem = new AgentMemory('agent-1');
		mem.add({ type: MEMORY_TYPES.USER, content: 'user' });
		mem.add({ type: MEMORY_TYPES.PROJECT, content: 'project' });

		mem.clear(MEMORY_TYPES.USER);
		expect(mem.query()).toHaveLength(1);
		expect(mem.query()[0].content).toBe('project');
	});

	it('clear() with no argument removes all entries', () => {
		const mem = new AgentMemory('agent-1');
		mem.add({ type: MEMORY_TYPES.USER, content: 'a' });
		mem.add({ type: MEMORY_TYPES.PROJECT, content: 'b' });

		mem.clear();
		expect(mem.query()).toHaveLength(0);
	});
});
