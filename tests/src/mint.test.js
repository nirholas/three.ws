import { describe, it, expect, vi, beforeEach } from 'vitest';

const embedAgentExtrasMock = vi.fn();
const uploadToArweaveMock = vi.fn();
const pinBlobMock = vi.fn();
const registerAgentMock = vi.fn();

vi.mock('../../src/erc8004/gltf-extras.js', () => ({
	embedAgentExtras: embedAgentExtrasMock,
}));

vi.mock('../../src/arweave/upload.js', () => ({
	uploadToArweave: uploadToArweaveMock,
}));

vi.mock('../../src/pinning/index.js', () => ({
	getPinner: () => ({ pinBlob: pinBlobMock }),
}));

vi.mock('../../src/erc8004/agent-registry.js', () => ({
	buildRegistrationJSON: vi.fn(),
	registerAgent: registerAgentMock,
}));

const { mintAgent } = await import('../../src/mint/index.js');

const MANIFEST = { spec: 'agent-manifest/0.1', name: 'TestBot', description: 'desc' };

function makeBlob() {
	return new Blob([new Uint8Array([1, 2, 3])], { type: 'model/gltf-binary' });
}

describe('mintAgent', () => {
	beforeEach(() => {
		embedAgentExtrasMock.mockReset();
		uploadToArweaveMock.mockReset();
		pinBlobMock.mockReset();
		registerAgentMock.mockReset();

		embedAgentExtrasMock.mockResolvedValue(new Uint8Array([9, 9, 9]));
		pinBlobMock.mockResolvedValue({ cid: 'bafytest', size: 3 });
		uploadToArweaveMock.mockResolvedValue('ar://txABC');
		registerAgentMock.mockResolvedValue({
			agentId: '42',
			registrationUrl: 'ipfs://bafyreg',
			txHash: '0xdead',
			chainId: 1,
		});
	});

	it('runs the full pipeline and returns combined result', async () => {
		const result = await mintAgent({
			glbBlob: makeBlob(),
			manifest: MANIFEST,
			signer: { privateKey: '0xabc' },
			chainId: 1,
		});

		expect(result).toEqual({
			agentId: '42',
			ipfsUri: 'ipfs://bafytest',
			arUri: 'ar://txABC',
			registrationUrl: 'ipfs://bafyreg',
			txHash: '0xdead',
			chainId: 1,
		});

		expect(embedAgentExtrasMock).toHaveBeenCalledOnce();
		expect(pinBlobMock).toHaveBeenCalledOnce();
		expect(uploadToArweaveMock).toHaveBeenCalledOnce();
		expect(registerAgentMock).toHaveBeenCalledOnce();
	});

	it('passes the Arweave URI to registerAgent as a service entry', async () => {
		await mintAgent({
			glbBlob: makeBlob(),
			manifest: MANIFEST,
			signer: { privateKey: '0xabc' },
			chainId: 1,
		});
		const call = registerAgentMock.mock.calls[0][0];
		expect(call.services).toEqual([
			{ name: 'avatar-arweave', endpoint: 'ar://txABC', version: 'gltf-2.0' },
		]);
		expect(call.glbUrl).toBe('ipfs://bafytest');
	});

	it('skipArweave: true bypasses Arweave upload', async () => {
		const result = await mintAgent({
			glbBlob: makeBlob(),
			manifest: MANIFEST,
			signer: { privateKey: '0xabc' },
			chainId: 1,
			skipArweave: true,
		});
		expect(uploadToArweaveMock).not.toHaveBeenCalled();
		expect(result.arUri).toBeNull();
		const call = registerAgentMock.mock.calls[0][0];
		expect(call.services).toEqual([]);
	});

	it('Arweave failure is non-fatal — IPFS + onchain still succeed', async () => {
		uploadToArweaveMock.mockRejectedValue(new Error('turbo down'));
		const logs = [];
		const result = await mintAgent({
			glbBlob: makeBlob(),
			manifest: MANIFEST,
			signer: { privateKey: '0xabc' },
			chainId: 1,
			onLog: (m) => logs.push(m),
		});
		expect(result.arUri).toBeNull();
		expect(result.agentId).toBe('42');
		expect(logs.some((l) => /Arweave upload failed/.test(l))).toBe(true);
	});

	it('emits progress logs through onLog', async () => {
		const logs = [];
		await mintAgent({
			glbBlob: makeBlob(),
			manifest: MANIFEST,
			signer: { privateKey: '0xabc' },
			chainId: 1,
			onLog: (m) => logs.push(m),
		});
		expect(logs.some((l) => /Embedding agent manifest/.test(l))).toBe(true);
		expect(logs.some((l) => /Pinning GLB to IPFS/.test(l))).toBe(true);
		expect(logs.some((l) => /Registering agent onchain/.test(l))).toBe(true);
	});
});
