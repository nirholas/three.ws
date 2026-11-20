import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitDistance, glbSource } from './fit.js';

test('a taller model needs the camera further back', () => {
	const short = fitDistance({ x: 1, y: 1, z: 1 }, 40, 1);
	const tall = fitDistance({ x: 1, y: 4, z: 1 }, 40, 1);
	assert.ok(tall > short * 2);
});

test('a narrow viewport backs the camera off for a wide model', () => {
	const wide = { x: 6, y: 1, z: 1 };
	assert.ok(fitDistance(wide, 40, 0.5) > fitDistance(wide, 40, 2));
});

test('the distance scales with the model, so any unit works', () => {
	const a = fitDistance({ x: 1, y: 2, z: 1 }, 40, 1.5);
	const b = fitDistance({ x: 100, y: 200, z: 100 }, 40, 1.5);
	assert.ok(Math.abs(b / a - 100) < 1e-9);
});

test('only https GLB URLs load (http too, on localhost)', () => {
	const fallback = 'https://example.test/default.glb';
	assert.equal(glbSource('', fallback), fallback);
	assert.equal(glbSource(null, fallback), fallback);
	assert.equal(glbSource(' https://three.ws/cdn/forge/a.glb ', fallback), 'https://three.ws/cdn/forge/a.glb');
	assert.equal(glbSource('http://localhost:3277/a.glb', fallback), 'http://localhost:3277/a.glb');
	assert.equal(glbSource('http://example.com/a.glb', fallback), null);
	assert.equal(glbSource('javascript:alert(1)', fallback), null);
	assert.equal(glbSource('not a url', fallback), null);
});
