import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyPrimitivePatch } from '../src/three.js';

/** A patch payload holding the float32 values, back to back, at offset 0. */
function floatChunk(values) {
	const array = Float32Array.from(values);
	return { bytes: new Uint8Array(array.buffer), length: array.byteLength };
}

/**
 * GLTFLoader hands back an InterleavedBufferAttribute whenever the base layer's
 * accessors share one strided bufferView, and the packer's output does exactly
 * that. `attribute.array` is then the WHOLE shared buffer, not this attribute.
 */
function interleavedPositionGeometry(positions, junk) {
	// stride 5 floats: x y z then two other attributes' floats that must not leak.
	const count = positions.length / 3;
	const buffer = new Float32Array(count * 5);
	for (let i = 0; i < count; i++) {
		buffer.set(positions.slice(i * 3, i * 3 + 3), i * 5);
		buffer[i * 5 + 3] = junk;
		buffer[i * 5 + 4] = junk;
	}
	const geometry = new THREE.BufferGeometry();
	const data = new THREE.InterleavedBuffer(buffer, 5);
	geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(data, 3, 0));
	geometry.setIndex([0, 1, 1]);
	return geometry;
}

test('growing an interleaved base attribute keeps its own components, not the shared buffer', () => {
	const base = [1, 2, 3, 4, 5, 6];
	const geometry = interleavedPositionGeometry(base, 999);
	const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
	const added = floatChunk([7, 8, 9]);
	const index = new Uint16Array([0, 1, 2]);
	const payload = new Uint8Array(added.length + index.byteLength);
	payload.set(added.bytes, 0);
	payload.set(new Uint8Array(index.buffer), added.length);
	const entry = {
		newVertexStart: 2,
		newVertexCount: 1,
		attributes: {
			POSITION: { offset: 0, length: added.length, componentType: 5126, elementSize: 3, normalized: false, start: 2, count: 1 },
		},
		indices: { offset: added.length, length: index.byteLength, componentType: 5123, count: 3 },
	};
	applyPrimitivePatch(THREE, mesh, entry, payload);
	assert.deepEqual(Array.from(geometry.getAttribute('position').array), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('a refined skinned mesh drops its cached bounds so culling sees the new vertices', () => {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from([0, 0, 0, 1, 0, 0]), 3));
	geometry.setAttribute('skinIndex', new THREE.BufferAttribute(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0]), 4));
	geometry.setAttribute('skinWeight', new THREE.BufferAttribute(Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0]), 4));
	geometry.setIndex([0, 1, 1]);
	const bone = new THREE.Bone();
	const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
	mesh.add(bone);
	mesh.bind(new THREE.Skeleton([bone]));
	mesh.updateMatrixWorld(true);
	mesh.computeBoundingSphere();
	const before = mesh.boundingSphere.radius;

	const added = Float32Array.from([100, 0, 0]);
	const joints = Uint8Array.from([0, 0, 0, 0]);
	const weights = Float32Array.from([1, 0, 0, 0]);
	const index = Uint16Array.from([0, 1, 2]);
	const chunks = [joints, weights, added, index].map((a) => new Uint8Array(a.buffer));
	const payload = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	const entry = { newVertexStart: 2, newVertexCount: 1, attributes: {}, indices: null };
	let cursor = 0;
	const place = (bytes, componentType, elementSize, key) => {
		payload.set(bytes, cursor);
		const meta = { offset: cursor, length: bytes.length, componentType, elementSize, normalized: false, start: 2, count: 1 };
		cursor += bytes.length;
		return meta;
	};
	entry.attributes.JOINTS_0 = place(chunks[0], 5121, 4);
	entry.attributes.WEIGHTS_0 = place(chunks[1], 5126, 4);
	entry.attributes.POSITION = place(chunks[2], 5126, 3);
	const idx = place(chunks[3], 5123, 1);
	entry.indices = { offset: idx.offset, length: idx.length, componentType: 5123, count: 3 };

	applyPrimitivePatch(THREE, mesh, entry, payload);
	// The renderer only recomputes a SkinnedMesh sphere when the cache is null.
	assert.equal(mesh.boundingSphere, null, 'stale skinned bounds survived the patch');
	assert.equal(mesh.boundingBox, null, 'stale skinned box survived the patch');
	mesh.updateMatrixWorld(true);
	mesh.computeBoundingSphere();
	assert.ok(mesh.boundingSphere.radius > before * 10);
});
