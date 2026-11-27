/**
 * The quality retry must not cost twice or leave a second model behind.
 *
 * A retry runs the same lane a second time inside one request. The request was
 * paid for and counted once, so the second attempt must not add a second funnel
 * "start" or a second "done" to the rolling counters, and the attempt that loses
 * the better-of comparison (which no one has seen) must be removed so it does not
 * sit in the library or the public count beside the model that was delivered.
 *
 * Only the db/object-storage/funnel boundaries are stubbed, as in the other
 * forge-store tests.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		DATABASE_URL: 'postgres://test:test@localhost:5432/test',
		S3_ENDPOINT: 'https://s3.example.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: 'https://cdn.example.com',
		S3_ACCESS_KEY_ID: 'test-key',
		S3_SECRET_ACCESS_KEY: 'test-secret',
	});
});

let selectRows = [];
const sqlMock = vi.fn(async (strings) => {
	const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
	if (text.includes('select')) return selectRows;
	return [];
});
vi.mock('../api/_lib/db.js', () => ({
	sql: (...args) => sqlMock(...args),
	isDbUnavailableError: () => false,
}));

const deleteObjectMock = vi.fn(async () => {});
vi.mock('../api/_lib/r2.js', async (importActual) => ({
	isStorageInfrastructureError: (await importActual()).isStorageInfrastructureError,
	listObjectsPage: vi.fn(async () => ({ objects: [], nextToken: null })),
	putObject: vi.fn(async ({ key }) => ({ key })),
	objectStorageConfigured: () => true,
	publicUrl: (key) => `https://cdn.example.com/${key}`,
	cdnUrl: (key) => `https://app.example.com/cdn/${key}`,
	deleteObject: (...args) => deleteObjectMock(...args),
	keyFromPublicUrl: (url) =>
		typeof url === 'string' && url.startsWith('https://cdn.example.com/')
			? url.slice('https://cdn.example.com/'.length).split(/[?#]/)[0]
			: null,
}));

const recordEvent = vi.fn(async () => {});
vi.mock('../api/_lib/forge-events.js', () => ({
	recordGenerationEvent: (...args) => recordEvent(...args),
}));

vi.mock('../api/_lib/ssrf-guard.js', () => ({
	assertSafePublicUrl: async () => {},
	SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

const { createCreation, materializeCreation, retireAttempt } = await import('../api/_lib/forge-store.js');

const pendingRow = {
	id: 'creation-1',
	status: 'pending',
	glb_url: null,
	glb_key: null,
	prompt: 'a teapot',
	views_requested: 0,
	views_used: null,
	multiview: false,
	backend: 'nvidia',
	tier: 'draft',
	path: 'text',
	created_at: new Date().toISOString(),
};

afterEach(() => {
	sqlMock.mockClear();
	deleteObjectMock.mockClear();
	recordEvent.mockClear();
	selectRows = [];
	delete global.fetch;
});

function stubFetch(buf) {
	global.fetch = vi.fn(async () => ({
		ok: true,
		headers: { get: () => 'model/gltf-binary' },
		arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
	}));
}

const phases = () => recordEvent.mock.calls.map(([e]) => e.phase);
const create = (extra = {}) =>
	createCreation({ clientKey: 'client-1', prompt: 'a teapot', replicateJobId: 'job-a', backend: 'nvidia', tier: 'draft', path: 'text', ...extra });

describe('a retry attempt does not count a second generation', () => {
	it('createCreation records one funnel start by default', async () => {
		await create();
		expect(phases()).toEqual(['start']);
	});

	it('createCreation({ recordStart: false }) writes the row but records no start', async () => {
		const id = await create({ recordStart: false });
		expect(id).toBeTruthy();
		expect(phases()).toEqual([]);
		expect(sqlMock.mock.calls.some(([s]) => s.join(' ').includes('insert into forge_creations'))).toBe(true);
	});

	it('materializeCreation records one done by default', async () => {
		selectRows = [pendingRow];
		stubFetch(Buffer.from('not a glb'));
		await materializeCreation({ replicateJobId: 'job-a', clientKey: 'client-1', glbUrl: 'https://provider.example/a.glb', cleanup: false, derivePbr: false });
		expect(phases()).toEqual(['done']);
	});

	it('materializeCreation({ recordEvent: false }) delivers the model but adds nothing to the counters', async () => {
		selectRows = [pendingRow];
		stubFetch(Buffer.from('not a glb'));
		const out = await materializeCreation({
			replicateJobId: 'job-a',
			clientKey: 'client-1',
			glbUrl: 'https://provider.example/a.glb',
			cleanup: false,
			derivePbr: false,
			recordEvent: false,
		});
		expect(out?.glbUrl).toBeTruthy();
		expect(phases()).toEqual([]);
	});
});

describe('retireAttempt removes a never-delivered attempt', () => {
	it('deletes the stored model and the row', async () => {
		selectRows = [
			{
				id: 'loser-1',
				client_key: 'client-1',
				glb_key: 'forge/client-1/loser-1.glb',
				glb_url: 'https://cdn.example.com/forge/client-1/loser-1.glb',
				status: 'done',
			},
		];
		await expect(retireAttempt({ id: 'loser-1' })).resolves.toBe(true);
		expect(deleteObjectMock).toHaveBeenCalledWith('forge/client-1/loser-1.glb');
		expect(sqlMock.mock.calls.some(([s]) => s.join(' ').includes('delete from forge_creations'))).toBe(true);
	});

	it('is false for a missing id and for a row that is not there, and never throws', async () => {
		await expect(retireAttempt({ id: null })).resolves.toBe(false);
		selectRows = [];
		await expect(retireAttempt({ id: 'ghost' })).resolves.toBe(false);
		sqlMock.mockRejectedValueOnce(new Error('db down'));
		await expect(retireAttempt({ id: 'x' })).resolves.toBe(false);
	});
});
