// Automatic, free content credentials (work order 079): every GLB
// materialized or paid-downloaded gets a signed credential without an
// explicit anchor_provenance call. r2 is mocked (no network, no bucket); the
// signing + verdict path is real, exercised against the same decideVerdict
// used by GET /api/provenance and verify_provenance.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const headObjectMock = vi.fn(async () => null);
const putObjectMock = vi.fn(async () => {});

vi.mock('../api/_lib/r2.js', () => ({
	headObject: (...args) => headObjectMock(...args),
	putObject: (...args) => putObjectMock(...args),
}));

const fetchSafePublicUrlMock = vi.fn();
vi.mock('../api/_lib/ssrf-guard.js', () => ({
	fetchSafePublicUrl: (...args) => fetchSafePublicUrlMock(...args),
}));

const { autoCredentialForBytes, ensureAutoCredential, autoProvenanceDisabled } = await import(
	'../api/_lib/auto-provenance.js'
);
const { sha256Hex, decideVerdict, verifyCredentialSignature } = await import('../api/_lib/provenance-3d.js');

// A 32-byte JSON-array seed, same decodeAttesterSecret form a Solana CLI
// keypair file carries; see api/_lib/attest-event.js.
const TEST_SEED = JSON.stringify(Array(32).fill(7));
const GLB = Buffer.from('a fake but stable GLB payload for auto-provenance tests');

beforeEach(() => {
	headObjectMock.mockReset().mockResolvedValue(null);
	putObjectMock.mockReset().mockResolvedValue(undefined);
	fetchSafePublicUrlMock.mockReset();
	process.env.ATTEST_AGENT_SECRET_KEY = TEST_SEED;
	delete process.env.PROVENANCE_AUTO_DISABLE;
});

afterEach(() => {
	delete process.env.ATTEST_AGENT_SECRET_KEY;
	delete process.env.PROVENANCE_AUTO_DISABLE;
});

describe('autoProvenanceDisabled', () => {
	it('is off unless the owner explicitly sets the flag to "true"', () => {
		expect(autoProvenanceDisabled()).toBe(false);
		process.env.PROVENANCE_AUTO_DISABLE = 'true';
		expect(autoProvenanceDisabled()).toBe(true);
		process.env.PROVENANCE_AUTO_DISABLE = 'yes'; // only the exact string "true" counts
		expect(autoProvenanceDisabled()).toBe(false);
	});
});

describe('autoCredentialForBytes', () => {
	it('signs and stores a credential that verifies as genuine', async () => {
		const envelope = await autoCredentialForBytes({
			buffer: GLB,
			assetId: 'creation-1',
			creator: 'client-abc',
			prompt: 'a brave knight',
			model: 'trellis_selfhost',
			provider: 'nvidia',
		});

		expect(envelope).toBeTruthy();
		expect(envelope.credential.glbSha256).toBe(sha256Hex(GLB));
		expect(envelope.credential.prompt).toBe('a brave knight');
		expect(verifyCredentialSignature(envelope.credential, envelope.signature, envelope.issuer)).toBe(true);

		const verdict = decideVerdict(sha256Hex(GLB), envelope);
		expect(verdict.status).toBe('verified');

		expect(putObjectMock).toHaveBeenCalledTimes(1);
		const [{ key, contentType }] = putObjectMock.mock.calls[0];
		expect(key).toBe(`provenance/${sha256Hex(GLB)}.json`);
		expect(contentType).toBe('application/json');
	});

	it('a single tampered byte fails verification against the stored credential', async () => {
		const envelope = await autoCredentialForBytes({ buffer: GLB, assetId: 'creation-1' });
		const tampered = Buffer.concat([GLB, Buffer.from('!')]);
		const verdict = decideVerdict(sha256Hex(tampered), envelope);
		expect(verdict.status).toBe('tampered');
	});

	it('skips (never throws) when the owner has disabled auto-credentialing', async () => {
		process.env.PROVENANCE_AUTO_DISABLE = 'true';
		const envelope = await autoCredentialForBytes({ buffer: GLB, assetId: 'creation-1' });
		expect(envelope).toBeNull();
		expect(putObjectMock).not.toHaveBeenCalled();
	});

	it('skips with an honest no-op when no issuer key is configured', async () => {
		delete process.env.ATTEST_AGENT_SECRET_KEY;
		const envelope = await autoCredentialForBytes({ buffer: GLB, assetId: 'creation-1' });
		expect(envelope).toBeNull();
		expect(putObjectMock).not.toHaveBeenCalled();
	});

	it('never re-issues a credential for bytes that already have one', async () => {
		headObjectMock.mockResolvedValue({ ContentLength: 1234 });
		const envelope = await autoCredentialForBytes({ buffer: GLB, assetId: 'creation-1' });
		expect(envelope).toBeNull();
		expect(putObjectMock).not.toHaveBeenCalled();
	});

	it('reports null, not a throw, when the store write fails', async () => {
		putObjectMock.mockRejectedValue(new Error('bucket unreachable'));
		await expect(autoCredentialForBytes({ buffer: GLB, assetId: 'creation-1' })).resolves.toBeNull();
	});

	it('no-ops on empty input', async () => {
		expect(await autoCredentialForBytes({})).toBeNull();
		expect(await autoCredentialForBytes({ buffer: Buffer.alloc(0) })).toBeNull();
	});
});

describe('ensureAutoCredential', () => {
	it('fetches the URL (SSRF-guarded) and credentials the bytes it gets back', async () => {
		fetchSafePublicUrlMock.mockResolvedValue({
			ok: true,
			arrayBuffer: async () => GLB.buffer.slice(GLB.byteOffset, GLB.byteOffset + GLB.byteLength),
		});

		const envelope = await ensureAutoCredential({ glbUrl: 'https://cdn.example.com/a.glb', assetId: 'x' });

		expect(fetchSafePublicUrlMock).toHaveBeenCalledWith(
			'https://cdn.example.com/a.glb',
			expect.objectContaining({ redirect: 'follow' }),
			expect.anything(),
		);
		expect(envelope.credential.glbSha256).toBe(sha256Hex(GLB));
	});

	it('rejects a non-https URL without fetching anything', async () => {
		const envelope = await ensureAutoCredential({ glbUrl: 'http://insecure.example.com/a.glb' });
		expect(envelope).toBeNull();
		expect(fetchSafePublicUrlMock).not.toHaveBeenCalled();
	});

	it('is an honest no-op when the fetch fails', async () => {
		fetchSafePublicUrlMock.mockResolvedValue({ ok: false });
		const envelope = await ensureAutoCredential({ glbUrl: 'https://cdn.example.com/missing.glb' });
		expect(envelope).toBeNull();
	});
});
