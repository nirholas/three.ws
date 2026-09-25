#!/usr/bin/env node
// Mirror a published three.ws Desktop release to GitHub Releases on
// nirholas/three.ws, with every artifact checked against the SHA-256 in the
// published release.json.
//
//   node apps/desktop/scripts/github-release.mjs            # plan: print what would run
//   node apps/desktop/scripts/github-release.mjs --apply    # download, verify, gh release create
//
// Creating a GitHub release is publishing, so it is owner-gated: the default
// changes nothing. The CDN feed stays the source of truth for the app's
// auto-updater; GitHub is where developers look for a changelog and assets.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'nirholas/three.ws';
const FEED = process.env.THREE_WS_RELEASE_FEED || 'https://three.ws/releases/desktop';

export function releaseNotesMarkdown(manifest) {
	const lines = [`three.ws Desktop ${manifest.version} for macOS, Windows and Linux.`, '', `Download for your system at https://three.ws/desktop. Installed copies update themselves.`, ''];
	if (manifest.notes?.length) {
		lines.push('## What changed', '');
		for (const n of manifest.notes) lines.push(`- **${n.title}.** ${n.summary}`);
		lines.push('');
	}
	lines.push('## Downloads', '', '| File | Size | SHA-256 |', '| --- | --- | --- |');
	for (const f of manifest.files) lines.push(`| ${f.name} | ${(f.size / 1048576).toFixed(1)} MB | \`${f.sha256}\` |`);
	const unsigned = [...new Set(manifest.files.filter((f) => !f.signed).map((f) => f.platform))];
	if (unsigned.length) {
		lines.push('', `Unsigned in this release: ${unsigned.join(', ')}. See https://three.ws/desktop#unsigned for how to open it.`);
	}
	lines.push('', '## Minimum system', '');
	for (const [k, v] of Object.entries(manifest.minimumOS || {})) lines.push(`- ${k}: ${v}`);
	return `${lines.join('\n')}\n`;
}

export function ghArgs(manifest, files, notesFile) {
	return ['release', 'create', `desktop-v${manifest.version}`, ...files, '--repo', REPO, '--title', `three.ws Desktop ${manifest.version}`, '--notes-file', notesFile];
}

async function main() {
	const apply = process.argv.includes('--apply');
	const res = await fetch(`${FEED}/release.json`, { signal: AbortSignal.timeout(20_000) });
	if (!res.ok) throw new Error(`${FEED}/release.json answered ${res.status}. Publish the release first (docs/ops/desktop-release.md).`);
	const manifest = await res.json();
	const dir = mkdtempSync(join(tmpdir(), `three-ws-desktop-${manifest.version}-`));
	const notesFile = join(dir, 'NOTES.md');
	writeFileSync(notesFile, releaseNotesMarkdown(manifest));
	const local = manifest.files.map((f) => join(dir, f.name));
	if (!apply) {
		console.log(`Plan for three.ws Desktop ${manifest.version} (nothing changed; rerun with --apply):\n`);
		for (const f of manifest.files) console.log(`  download ${f.url}\n    verify sha256 ${f.sha256}`);
		console.log(`\n  gh ${ghArgs(manifest, local, notesFile).map((a) => (/\s/.test(a) ? `'${a}'` : a)).join(' ')}\n`);
		console.log(`Release notes preview (${notesFile}):\n`);
		console.log(readFileSync(notesFile, 'utf8'));
		return;
	}
	for (const [i, f] of manifest.files.entries()) {
		const r = await fetch(f.url, { signal: AbortSignal.timeout(600_000) });
		if (!r.ok) throw new Error(`${f.url} answered ${r.status}`);
		const buf = Buffer.from(await r.arrayBuffer());
		const got = createHash('sha256').update(buf).digest('hex');
		if (got !== f.sha256) throw new Error(`${f.name}: sha256 ${got} does not match the manifest's ${f.sha256}`);
		writeFileSync(local[i], buf);
		console.log(`verified ${f.name}`);
	}
	execFileSync('gh', ghArgs(manifest, local, notesFile), { stdio: 'inherit' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().catch((err) => {
		console.error(`[github-release] ${err.message}`);
		process.exit(1);
	});
}
