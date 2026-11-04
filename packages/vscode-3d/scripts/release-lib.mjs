// Pure helpers for scripts/release.mjs. No network, no child processes, so the
// preflight rules can be tested against fixtures.

export const EXPECTED_FILES = [
	'CHANGELOG.md',
	'LICENSE',
	'README.md',
	'package.json',
	'dist/extension.cjs',
	'media/cube.svg',
	'media/icon.png',
	'media/viewer.css',
	'media/viewer.js',
	'media/vendor/basis/basis_transcoder.js',
	'media/vendor/basis/basis_transcoder.wasm',
	'media/vendor/draco/draco_decoder.wasm',
	'media/vendor/draco/draco_wasm_wrapper.js',
];

/** Normalise `vsce ls` output into a sorted list of file paths. */
export function parseVsceLs(output) {
	return String(output)
		.split('\n')
		.map((l) => l.trim().replace(/\\/g, '/'))
		.filter((l) => l && !/^(npm |WARNING|ERROR|DONE|INFO)/i.test(l));
}

/** Compare the packaged file list to the documented one. */
export function checkFileList(actual, expected = EXPECTED_FILES) {
	const have = new Set(actual);
	const want = new Set(expected);
	const missing = [...want].filter((f) => !have.has(f)).sort();
	const extra = [...have].filter((f) => !want.has(f)).sort();
	return { ok: !missing.length && !extra.length, missing, extra };
}

/** Numeric semver compare (major.minor.patch). Returns -1, 0 or 1. */
export function compareVersions(a, b) {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	for (let i = 0; i < 3; i++) {
		if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
	}
	return 0;
}

function parseSemver(v) {
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
	if (!m) throw new Error(`not a plain major.minor.patch version: ${JSON.stringify(v)}`);
	return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Versions listed in a Marketplace gallery query response. */
export function galleryVersions(response) {
	const exts = response?.results?.[0]?.extensions || [];
	return exts.flatMap((e) => (e.versions || []).map((v) => v.version)).filter(Boolean);
}

/** Highest published version, or null when the extension is not listed. */
export function highestVersion(versions) {
	return versions.length ? versions.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b)) : null;
}

/** True when `version` is strictly greater than everything already published. */
export function isNewVersion(version, published) {
	const top = highestVersion(published);
	return top === null || compareVersions(version, top) > 0;
}

/** True when CHANGELOG.md has a non-empty `## <version>` section. */
export function hasChangelogSection(changelog, version) {
	const lines = String(changelog).split('\n');
	const head = new RegExp(`^##\\s+\\[?v?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`);
	const start = lines.findIndex((l) => head.test(l));
	if (start < 0) return false;
	for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
		if (lines[i].trim()) return true;
	}
	return false;
}
