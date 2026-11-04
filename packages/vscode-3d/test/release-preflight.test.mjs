import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	EXPECTED_FILES,
	checkFileList,
	compareVersions,
	galleryVersions,
	hasChangelogSection,
	highestVersion,
	isNewVersion,
	parseVsceLs,
} from '../scripts/release-lib.mjs';

test('the documented file list matches PUBLISHING.md', () => {
	const doc = readFileSync(new URL('../PUBLISHING.md', import.meta.url), 'utf8');
	for (const f of EXPECTED_FILES.filter((x) => !x.includes('/vendor/'))) {
		assert.ok(doc.includes(f), `${f} documented`);
	}
	assert.equal(EXPECTED_FILES.filter((x) => x.includes('/vendor/')).length, 4);
});

test('checkFileList passes on the exact list and flags drift both ways', () => {
	assert.equal(checkFileList([...EXPECTED_FILES].reverse()).ok, true);
	const drift = checkFileList([...EXPECTED_FILES.slice(1), 'src/extension.js', 'dist/extension.cjs.map']);
	assert.equal(drift.ok, false);
	assert.deepEqual(drift.missing, [EXPECTED_FILES[0]]);
	assert.deepEqual(drift.extra, ['dist/extension.cjs.map', 'src/extension.js']);
});

test('parseVsceLs reads a vsce listing and ignores noise', () => {
	const out = ' WARNING  something\nCHANGELOG.md\r\nmedia\\icon.png\n\nDONE  x\n';
	assert.deepEqual(parseVsceLs(out), ['CHANGELOG.md', 'media/icon.png']);
});

test('compareVersions orders numerically, not lexically', () => {
	assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
	assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
	assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
	assert.throws(() => compareVersions('1.0', '1.0.0'));
});

test('isNewVersion requires a version above everything published', () => {
	assert.equal(isNewVersion('0.2.0', []), true);
	assert.equal(isNewVersion('0.2.0', ['0.1.0', '0.1.9']), true);
	assert.equal(isNewVersion('0.2.0', ['0.1.0', '0.2.0']), false);
	assert.equal(isNewVersion('0.2.0', ['0.10.0']), false);
	assert.equal(highestVersion(['0.9.0', '0.10.0', '0.2.0']), '0.10.0');
});

test('galleryVersions reads the query response, and an empty result means unlisted', () => {
	const listed = { results: [{ extensions: [{ versions: [{ version: '0.1.0' }, { version: '0.2.0' }] }] }] };
	assert.deepEqual(galleryVersions(listed), ['0.1.0', '0.2.0']);
	assert.deepEqual(galleryVersions({ results: [{ extensions: [] }] }), []);
	assert.deepEqual(galleryVersions({}), []);
});

test('hasChangelogSection needs a non-empty section for the exact version', () => {
	const dir = mkdtempSync(join(tmpdir(), 'rel-'));
	const file = join(dir, 'CHANGELOG.md');
	writeFileSync(file, '# Changelog\n\n## 0.3.0\n\n## 0.2.0\n\n- Real change.\n\n## 0.1.0\n\n- First.\n');
	const text = readFileSync(file, 'utf8');
	assert.equal(hasChangelogSection(text, '0.2.0'), true);
	assert.equal(hasChangelogSection(text, '0.3.0'), false, 'empty section');
	assert.equal(hasChangelogSection(text, '0.4.0'), false, 'missing section');
	assert.equal(hasChangelogSection(text, '0.2'), false);
});
