'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateManifest } = require('../scripts/package-ccx');

test('manifest v5 validates, targets Premiere Pro 25.6+, and keeps permissions narrow', () => {
	const { manifest, errors } = validateManifest();
	assert.deepEqual(errors, []);
	assert.equal(manifest.manifestVersion, 5);
	assert.equal(manifest.host.app, 'premierepro');
	assert.equal(manifest.host.minVersion, '25.6.0');
	const domains = manifest.requiredPermissions.network.domains;
	assert.ok(domains.every((d) => /three\.ws$|r2\.cloudflarestorage\.com$|r2\.dev$|storage\.googleapis\.com$/.test(d)), domains.join(','));
	assert.deepEqual(manifest.requiredPermissions.launchProcess, { schemes: ['https'], extensions: [] });
});
