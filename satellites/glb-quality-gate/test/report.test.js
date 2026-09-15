import assert from 'node:assert/strict';
import test from 'node:test';
import { Document, NodeIO } from '@gltf-transform/core';
import { diffModels } from '@three-ws/glb-diff';
import {
	COMMENT_MARKER,
	aggregateSeverity,
	buildReport,
	selectGlbChanges,
	severityForStatus,
	validateFailOn,
	validateMaxFiles,
} from '../src/report.js';

function model({ mesh = 'Body', x = 0 } = {}) {
	const document = new Document();
	const buffer = document.createBuffer();
	const position = document
		.createAccessor()
		.setType('VEC3')
		.setArray(new Float32Array([x, 0, 0, 1, 0, 0, 0, 1, 0]))
		.setBuffer(buffer);
	const primitive = document.createPrimitive().setAttribute('POSITION', position);
	const node = document.createNode('Root').setMesh(document.createMesh(mesh).addPrimitive(primitive));
	document.createScene('Scene').addChild(node);
	return new NodeIO().writeBinary(document);
}

test('validates user inputs', () => {
	assert.equal(validateFailOn('Major'), 'major');
	assert.equal(validateMaxFiles('20'), 20);
	assert.throws(() => validateFailOn('urgent'), /fail-on/);
	assert.throws(() => validateMaxFiles('0'), /max-files/);
});

test('selects GLB files and preserves rename paths', () => {
	const selected = selectGlbChanges(
		[
			{ filename: 'models/new.glb', status: 'renamed', previous_filename: 'models/old.glb' },
			{ filename: 'README.md', status: 'modified' },
			{ filename: 'models/second.GLB', status: 'added' },
		],
		1,
	);
	assert.deepEqual(selected.changes, [
		{ path: 'models/new.glb', basePath: 'models/old.glb', status: 'renamed' },
	]);
	assert.equal(selected.omitted, 1);
});

test('classifies lifecycle changes and aggregates severity', () => {
	assert.equal(severityForStatus('added'), 'minor');
	assert.equal(severityForStatus('removed'), 'breaking');
	assert.equal(
		aggregateSeverity([
			{ severity: 'minor' },
			{ severity: 'major' },
		]),
		'major',
	);
});

test('runs the real GLB engine and renders an idempotent report', async () => {
	const changes = await diffModels(await model(), await model({ x: 0.5 }), { nameA: 'before', nameB: 'after' });
	assert.equal(changes.severity, 'major');
	const report = buildReport({
		results: [{ path: 'avatar.glb', severity: changes.severity, outcome: '1 structural change', markdown: 'Changed.' }],
		omitted: 0,
		failOn: 'breaking',
	});
	assert.ok(report.startsWith(COMMENT_MARKER));
	assert.match(report, /avatar\.glb/);
	assert.match(report, /Highest severity: \*\*major\*\*/);
});
