#!/usr/bin/env node
// Cut a three.ws Desktop version: bump apps/desktop/package.json, collect the
// release notes, and write the public changelog entry that announces it.
//
//   node apps/desktop/scripts/bump-version.mjs patch|minor|major|<x.y.z> [--dry-run] [--date YYYY-MM-DD]
//
// Release notes are every data/changelog.json entry tagged `desktop` dated on
// or after the previous release, minus the ones that release already carried
// and minus earlier release announcements. They are recorded in
// apps/desktop/releases.json (the history the release manifest reads), and
// one entry "three.ws Desktop <version>" is added to data/changelog.json so the
// community feed announces the release. Run it as the first step of a release
// (docs/ops/desktop-release.md), right before the builds, because the
// changelog entry goes out with the next deploy.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const REPO = resolve(APP, '../..');
export const PATHS = {
	pkg: join(APP, 'package.json'),
	lock: join(APP, 'package-lock.json'),
	history: join(APP, 'releases.json'),
	changelog: join(REPO, 'data/changelog.json'),
};

const RELEASE_TITLE = /^three\.ws Desktop \d+\.\d+\.\d+/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function nextVersion(current, bump) {
	const m = SEMVER.exec(String(current));
	if (!m) throw new Error(`Current version "${current}" is not x.y.z`);
	const [maj, min, pat] = m.slice(1).map(Number);
	if (bump === 'major') return `${maj + 1}.0.0`;
	if (bump === 'minor') return `${maj}.${min + 1}.0`;
	if (bump === 'patch') return `${maj}.${min}.${pat + 1}`;
	const t = SEMVER.exec(String(bump));
	if (!t) throw new Error(`Bump must be patch, minor, major or an explicit x.y.z (got "${bump}")`);
	const cmp = t.slice(1).map(Number);
	const cur = [maj, min, pat];
	const newer = cmp[0] !== cur[0] ? cmp[0] > cur[0] : cmp[1] !== cur[1] ? cmp[1] > cur[1] : cmp[2] > cur[2];
	if (!newer) throw new Error(`${bump} is not newer than ${current}`);
	return bump;
}

// The desktop-tagged entries a release should carry, oldest first so the notes
// read in the order the work landed.
export function collectNotes(entries, lastRelease) {
	const carried = new Set((lastRelease?.notes || []).map((n) => `${n.date}\u0000${n.title}`));
	return entries
		.filter((e) => Array.isArray(e.tags) && e.tags.includes('desktop'))
		.filter((e) => !RELEASE_TITLE.test(e.title))
		.filter((e) => !lastRelease || e.date >= lastRelease.date)
		.filter((e) => !carried.has(`${e.date}\u0000${e.title}`))
		.map((e) => ({ date: e.date, title: e.title, summary: e.summary, tags: e.tags.filter((t) => t !== 'desktop'), ...(e.link ? { link: e.link } : {}) }))
		.sort((a, b) => a.date.localeCompare(b.date));
}

export function releaseEntry(version, date, notes) {
	const tags = ['desktop'];
	if (notes.some((n) => n.tags.includes('feature'))) tags.unshift('feature');
	else if (notes.some((n) => n.tags.includes('improvement'))) tags.unshift('improvement');
	else if (notes.some((n) => n.tags.includes('fix'))) tags.unshift('fix');
	const list = notes.map((n) => n.title.replace(/[.\s]+$/, '')).join('; ');
	return {
		date,
		title: `three.ws Desktop ${version} is out`,
		summary: `A new version of the three.ws desktop app for macOS, Windows and Linux. Installed copies update themselves; new installs start at three.ws/desktop. In this release: ${list}.`,
		tags,
		link: '/desktop',
	};
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
}

function parseArgs(argv) {
	const out = { bump: null, dryRun: false, date: new Date().toISOString().slice(0, 10) };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--dry-run') out.dryRun = true;
		else if (a === '--date') out.date = argv[++i];
		else if (!out.bump) out.bump = a;
		else throw new Error(`Unexpected argument: ${a}`);
	}
	if (!out.bump) throw new Error('Usage: bump-version.mjs patch|minor|major|<x.y.z> [--dry-run] [--date YYYY-MM-DD]');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date)) throw new Error(`--date must be YYYY-MM-DD (got "${out.date}")`);
	return out;
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const pkg = readJson(PATHS.pkg);
	const history = readJson(PATHS.history);
	const changelog = readJson(PATHS.changelog);
	const version = nextVersion(pkg.version, args.bump);
	if (history.releases.some((r) => r.version === version)) throw new Error(`${version} is already in releases.json`);
	const notes = collectNotes(changelog.entries, history.releases[0]);
	if (!notes.length) {
		throw new Error('No data/changelog.json entries tagged "desktop" since the last release. Add one for each user-visible change first, so the release has notes.');
	}
	const entry = releaseEntry(version, args.date, notes);

	console.log(`three.ws Desktop ${pkg.version} -> ${version} (${args.date})`);
	console.log(`Release notes (${notes.length}):`);
	for (const n of notes) console.log(`  - ${n.date} ${n.title}`);
	console.log(`Changelog entry: "${entry.title}" [${entry.tags.join(', ')}]`);
	if (args.dryRun) {
		console.log('Dry run: nothing written.');
		return;
	}

	pkg.version = version;
	writeJson(PATHS.pkg, pkg);
	const lock = readJson(PATHS.lock);
	lock.version = version;
	if (lock.packages?.['']) lock.packages[''].version = version;
	writeJson(PATHS.lock, lock);
	history.releases.unshift({ version, date: args.date, notes });
	writeJson(PATHS.history, history);
	changelog.entries.unshift(entry);
	writeJson(PATHS.changelog, changelog);
	console.log('Wrote package.json, package-lock.json, releases.json and data/changelog.json.');
	console.log('Next: npm run build:pages, commit, then follow docs/ops/desktop-release.md from "Build".');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		main();
	} catch (err) {
		console.error(`[bump-version] ${err.message}`);
		process.exit(1);
	}
}
