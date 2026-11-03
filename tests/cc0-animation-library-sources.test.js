import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The CC0 library pipeline must fetch its upstream packs from a fixed commit.
// Mesh2Motion restructured its repo on 2026-10-31 (one GLB per clip), which
// turned the branch-relative `main/static/animations/*.glb` URLs into 404s and
// left `scripts/cc0-library.config.json` (the committed provenance record,
// keyed on clip names inside those bundled GLBs) unbuildable.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'scripts/cc0-animation-library.mjs'), 'utf8');

describe('cc0-animation-library pack sources', () => {
	const githubUrls = [...source.matchAll(/'(https:\/\/(?:raw\.githubusercontent\.com|github\.com)\/[^']+)'/g)].map(
		(m) => m[1],
	);

	it('references the Mesh2Motion packs', () => {
		expect(githubUrls.filter((u) => u.includes('mesh2motion-app')).length).toBeGreaterThanOrEqual(6);
	});

	it('pins every GitHub pack and license URL to a full commit SHA', () => {
		for (const url of githubUrls) {
			const ref = url.includes('raw.githubusercontent.com')
				? url.split('/')[5]
				: url.match(/\/blob\/([^/]+)\//)?.[1];
			expect(ref, url).toMatch(/^[0-9a-f]{40}$/);
		}
	});
});

describe('findZipMember', () => {
	// The real UAL2 [Standard] zip layout as of 2026-11-03. The extract dir is
	// named after the target file, so every path contains its basename; the old
	// substring match copied the animation-less Female Mannequin GLB instead.
	const extractDir = '/w/animation-sources/cc0/quaternius/UAL2_Standard.glb.extract';
	const paths = [
		`${extractDir}/Universal Animation Library 2 [Standard]/Female Mannequin/Unreal-Godot/Mannequin_F.glb`,
		`${extractDir}/Universal Animation Library 2 [Standard]/Unreal-Godot/UAL2_Standard.glb`,
	];

	it('picks the member whose path inside the zip ends with zipGlbPath', async () => {
		const { findZipMember } = await import('../scripts/lib/zip-member.mjs');
		expect(findZipMember(paths, extractDir, 'Unreal-Godot/UAL2_Standard.glb')).toBe(paths[1]);
	});

	it('does not match on a path segment that only resembles the target', async () => {
		const { findZipMember } = await import('../scripts/lib/zip-member.mjs');
		expect(findZipMember([paths[0]], extractDir, 'Unreal-Godot/UAL2_Standard.glb')).toBeNull();
		expect(findZipMember([`${extractDir}/x/NotUnreal-Godot/UAL2_Standard.glb`], extractDir, 'Unreal-Godot/UAL2_Standard.glb')).toBeNull();
	});
});
