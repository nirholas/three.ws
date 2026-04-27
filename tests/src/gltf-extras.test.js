import { describe, it, expect } from 'vitest';
import { WebIO, Document } from '@gltf-transform/core';
import { embedAgentExtras, readAgentExtras, hasAgentExtras } from '../../src/erc8004/gltf-extras.js';

async function minimalGlb() {
	const io = new WebIO();
	const doc = new Document();
	doc.createBuffer();
	return io.writeBinary(doc);
}

const MANIFEST = {
	spec: 'agent-manifest/0.1',
	name: 'Test Agent',
	description: 'Unit test fixture',
};

describe('gltf-extras', () => {
	it('round-trips a manifest through GLB extras', async () => {
		const glb = await minimalGlb();
		const modified = await embedAgentExtras(glb, MANIFEST);
		const result = await readAgentExtras(modified);
		expect(result).toEqual(MANIFEST);
	});

	it('returns null when no manifest is present', async () => {
		const glb = await minimalGlb();
		expect(await readAgentExtras(glb)).toBeNull();
	});

	it('hasAgentExtras returns false before embed, true after', async () => {
		const glb = await minimalGlb();
		expect(await hasAgentExtras(glb)).toBe(false);
		const modified = await embedAgentExtras(glb, MANIFEST);
		expect(await hasAgentExtras(modified)).toBe(true);
	});

	it('preserves existing extras fields when embedding', async () => {
		const io = new WebIO();
		const doc = new Document();
		doc.createBuffer();
		doc.getRoot().setExtras({ customField: 'keep me' });
		const glb = await io.writeBinary(doc);

		const modified = await embedAgentExtras(glb, MANIFEST);
		const result = await readAgentExtras(modified);
		expect(result).toEqual(MANIFEST);

		const doc2 = await io.readBinary(modified);
		expect(doc2.getRoot().getExtras().customField).toBe('keep me');
	});

	it('accepts ArrayBuffer input', async () => {
		const glb = await minimalGlb();
		const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
		const modified = await embedAgentExtras(ab, MANIFEST);
		expect(await readAgentExtras(modified)).toEqual(MANIFEST);
	});
});
