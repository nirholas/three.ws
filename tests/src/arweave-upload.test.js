import { describe, it, expect, vi, beforeEach } from 'vitest';

const uploadFileMock = vi.fn();
const authenticatedMock = vi.fn(() => ({ uploadFile: uploadFileMock }));

vi.mock('@ardrive/turbo-sdk/web', () => ({
	TurboFactory: { authenticated: authenticatedMock, unauthenticated: () => ({}) },
	EthereumSigner: class {
		constructor(pk) {
			this.pk = pk;
		}
	},
}));

const { uploadToArweave } = await import('../../src/arweave/upload.js');

describe('uploadToArweave', () => {
	beforeEach(() => {
		uploadFileMock.mockReset();
		authenticatedMock.mockClear();
	});

	it('returns ar:// URI on success', async () => {
		uploadFileMock.mockResolvedValue({ id: 'tx123' });
		const signer = { privateKey: '0xabc' };
		const result = await uploadToArweave(new Uint8Array([1, 2, 3]), signer, { name: 'a.glb' });
		expect(result).toBe('ar://tx123');
	});

	it('passes content-type and filename tags', async () => {
		uploadFileMock.mockResolvedValue({ id: 'tx456' });
		await uploadToArweave(new Uint8Array([1]), { privateKey: '0xabc' }, {
			name: 'agent.glb',
			contentType: 'model/gltf-binary',
		});
		const call = uploadFileMock.mock.calls[0][0];
		const tags = call.dataItemOpts.tags;
		expect(tags).toContainEqual({ name: 'Content-Type', value: 'model/gltf-binary' });
		expect(tags).toContainEqual({ name: 'File-Name', value: 'agent.glb' });
	});

	it('throws when signer has no extractable private key', async () => {
		await expect(
			uploadToArweave(new Uint8Array([1]), { getAddress: () => '0x0' }),
		).rejects.toThrow(/cannot extract private key/);
	});

	it('reports correct file size', async () => {
		uploadFileMock.mockResolvedValue({ id: 'tx789' });
		const bytes = new Uint8Array(42);
		await uploadToArweave(bytes, { privateKey: '0xabc' });
		const call = uploadFileMock.mock.calls[0][0];
		expect(call.fileSizeFactory()).toBe(42);
	});
});
