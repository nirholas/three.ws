#!/usr/bin/env node
// Publishes the three.ws Gemini CLI extension (integrations/gemini/three-ws) to
// its own public GitHub repository, in the shape the Gemini CLI extension
// gallery (geminicli.com/extensions) crawls and `gemini extensions install`
// downloads:
//
//   1. exports the extension with scripts/export-plugin-repo.mjs (validated,
//      gemini-extension.json at the root);
//   2. creates the repository if it is missing, and keeps its description,
//      homepage and topics (including `gemini-cli-extension`) in sync;
//   3. commits the exported tree on top of the repository's main branch (a
//      fast-forward, never a force push; nothing is pushed when the tree is
//      unchanged);
//   4. tags the commit v<version> and creates a GitHub release for the tag,
//      marked Latest, with NO assets. Gemini CLI 0.71.1 (findReleaseAsset)
//      downloads a release's only asset as the extension archive, so an
//      attached gemini-extension.json would break every install; without assets
//      it downloads the tag's source tarball, which holds the manifest at the
//      root;
//   5. checks the result the way the gallery and Gemini CLI read it.
//
//   npm run gemini:extension-publish -- --dry-run   # read-only plan
//   npm run gemini:extension-publish                # publish (owner-approved)
//   npm run gemini:extension-publish -- --check     # read-only verification
//
// A new version is a version bump in gemini-extension.json: the script refuses
// to move an existing tag to a different commit.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHOR, exportPluginRepo } from './export-plugin-repo.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULTS = Object.freeze({
	src: 'integrations/gemini/three-ws',
	repo: 'nirholas/three-ws-gemini-extension',
	homepage: 'https://three.ws/docs/mcp',
	description: 'three.ws for Gemini CLI: free text-to-3D. Generate textured GLB models and rigged avatars, auto-rig a GLB, render it to check, search CC0 3D assets.',
	topics: ['gemini-cli-extension', 'gemini-cli', 'mcp', 'mcp-server', 'text-to-3d', '3d', 'glb', 'avatar', 'threejs'],
});

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const tryRun = (cmd, args, opts) => {
	try {
		return run(cmd, args, opts);
	} catch {
		return null;
	}
};
const gh = (args) => run('gh', args);
const ghJson = (args) => {
	const out = tryRun('gh', args);
	return out ? JSON.parse(out) : null;
};

/** The commit a remote ref points at (peeled for annotated tags), or null. */
function remoteRef(url, ref) {
	const out = tryRun('git', ['ls-remote', url, ref, `${ref}^{}`]) || '';
	const lines = out.split('\n').filter(Boolean).map((l) => l.split('\t'));
	return (lines.find(([, r]) => r.endsWith('^{}')) || lines[0] || [])[0] || null;
}

/**
 * Decides what to push so the remote only ever fast-forwards. With no remote
 * main the export commit goes up as is; when remote main already holds the
 * exported tree nothing is pushed; otherwise a new commit with the exported
 * tree is made on top of remote main. Throws when the version tag already
 * points at a different commit, because a published tag is never moved.
 * @param {{ dir: string, exportSha: string, url: string|null, tag: string, label: string, date?: string }} o
 */
export function planPush({ dir, exportSha, url, tag, label, date = new Date().toISOString() }) {
	const git = (args, env) => run('git', args, { cwd: dir, env: env ? { ...process.env, ...env } : process.env });
	const tree = git(['rev-parse', `${exportSha}^{tree}`]);
	const remoteMain = url ? remoteRef(url, 'refs/heads/main') : null;
	let commit = exportSha;
	let pushMain = true;
	if (remoteMain) {
		git(['fetch', '--quiet', url, 'main']);
		if (git(['rev-parse', 'FETCH_HEAD^{tree}']) === tree) {
			commit = remoteMain;
			pushMain = false;
		} else {
			commit = git(['commit-tree', tree, '-p', 'FETCH_HEAD', '-m', label, '-m', `Exported from three.ws (export commit ${exportSha.slice(0, 12)}).`], {
				GIT_AUTHOR_NAME: AUTHOR.name,
				GIT_AUTHOR_EMAIL: AUTHOR.email,
				GIT_COMMITTER_NAME: AUTHOR.name,
				GIT_COMMITTER_EMAIL: AUTHOR.email,
				GIT_AUTHOR_DATE: date,
				GIT_COMMITTER_DATE: date,
			});
		}
	}
	const remoteTag = url ? remoteRef(url, `refs/tags/${tag}`) : null;
	if (remoteTag && remoteTag !== commit) {
		throw new Error(`${tag} already points at ${remoteTag.slice(0, 12)}, not ${commit.slice(0, 12)}. Bump "version" in gemini-extension.json to publish a change.`);
	}
	return { commit, pushMain, remoteMain, remoteTag, refspecs: [...(pushMain ? [`${commit}:refs/heads/main`] : []), ...(remoteTag ? [] : [`${commit}:refs/tags/${tag}`])] };
}

/** Read-only checks of a published repository; returns a list of problems. */
export function checkPublished({ repo, version, name, log = console.log }) {
	const problems = [];
	const meta = ghJson(['api', `repos/${repo}`]);
	if (!meta) return [`${repo}: repository not found`];
	if (meta.private) problems.push(`${repo}: repository is private; the gallery only lists public repositories`);
	if (!(meta.topics || []).includes('gemini-cli-extension')) problems.push(`${repo}: missing the gemini-cli-extension topic`);
	const tag = `v${version}`;
	const latest = ghJson(['api', `repos/${repo}/releases/latest`]);
	if (!latest) problems.push(`${repo}: no published release`);
	else {
		if (latest.tag_name !== tag) problems.push(`${repo}: Latest release is ${latest.tag_name}, expected ${tag}`);
		if ((latest.assets || []).length) problems.push(`${repo}: Latest release has assets (${latest.assets.map((a) => a.name).join(', ')}); Gemini CLI would download one instead of the source tarball`);
	}
	const file = ghJson(['api', `repos/${repo}/contents/gemini-extension.json?ref=${tag}`]);
	if (!file) problems.push(`${repo}: gemini-extension.json is not at the root of ${tag}`);
	else {
		const m = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
		if (m.name !== name || m.version !== version) problems.push(`${repo}@${tag}: manifest says ${m.name} ${m.version}, expected ${name} ${version}`);
	}
	const indexed = tryRun('gh', ['api', `search/code?q=repo:${repo}+filename:gemini-extension.json`, '--jq', '.total_count']);
	log(`code search: ${indexed === null ? 'unavailable' : `${indexed} hit(s)`} for gemini-extension.json in ${repo}${indexed === '0' ? ' (GitHub indexes new repositories within a day; the gallery crawler runs daily after that)' : ''}`);
	return problems;
}

export function publishGeminiExtension({ src = DEFAULTS.src, repo = DEFAULTS.repo, dryRun = false, log = console.log } = {}) {
	if (!tryRun('gh', ['auth', 'status'])) throw new Error('gh is not signed in; run `gh auth login`');
	const url = `https://github.com/${repo}.git`;
	const work = mkdtempSync(join(tmpdir(), 'three-ws-gemini-extension-'));
	try {
		const exp = exportPluginRepo({ src, out: join(work, 'export'), log });
		const { name, version } = exp.manifest;
		const tag = `v${version}`;
		const git = (args) => run('git', args, { cwd: exp.out });

		const exists = ghJson(['repo', 'view', repo, '--json', 'name,visibility']);
		log(exists ? `repository: ${repo} (${exists.visibility.toLowerCase()})` : `repository: ${repo} does not exist; will create it public`);

		const plan = planPush({ dir: exp.out, exportSha: exp.sha, url: exists ? url : null, tag, label: `${name} ${version}` });
		const { commit, pushMain, remoteMain, remoteTag } = plan;
		log(pushMain ? `main: will push ${commit.slice(0, 12)}${remoteMain ? ` on top of ${remoteMain.slice(0, 12)}` : ' as the first commit'}` : `main: already holds this tree at ${commit.slice(0, 12)}`);
		log(remoteTag ? `tag: ${tag} already at ${commit.slice(0, 12)}` : `tag: will create ${tag} at ${commit.slice(0, 12)}`);

		const release = exists ? ghJson(['release', 'view', tag, '--repo', repo, '--json', 'tagName,isDraft,isPrerelease,assets']) : null;
		if (release?.assets?.length) throw new Error(`release ${tag} has assets (${release.assets.map((a) => a.name).join(', ')}); delete them, Gemini CLI would download one as the extension`);
		log(release ? `release: ${tag} exists` : `release: will create ${tag}, marked Latest, no assets`);
		log(`topics: ${DEFAULTS.topics.join(', ')}`);

		if (dryRun) {
			log('dry run: nothing was created or pushed');
			return { dryRun: true, commit, tag, export: exp };
		}

		if (!exists) gh(['repo', 'create', repo, '--public', '--description', DEFAULTS.description, '--homepage', DEFAULTS.homepage]);
		gh(['repo', 'edit', repo, '--description', DEFAULTS.description, '--homepage', DEFAULTS.homepage, ...DEFAULTS.topics.flatMap((t) => ['--add-topic', t])]);
		if (plan.refspecs.length) git(['push', '--quiet', url, ...plan.refspecs]);
		if (!exists) gh(['repo', 'edit', repo, '--default-branch', 'main']);
		if (!release) {
			const notes = join(work, 'notes.md');
			writeFileSync(
				notes,
				[
					`${exp.manifest.description}`,
					'',
					'Install:',
					'',
					'```bash',
					`gemini extensions install https://github.com/${repo}`,
					'```',
					'',
					'Then run `/mcp auth three-ws` once in Gemini CLI to sign in to your free three.ws account.',
					'',
					`Changes: [CHANGELOG.md](https://github.com/${repo}/blob/${tag}/CHANGELOG.md).`,
					'',
				].join('\n'),
			);
			gh(['release', 'create', tag, '--repo', repo, '--verify-tag', '--latest', '--title', `${name} ${version}`, '--notes-file', notes]);
		} else if (release.isDraft || release.isPrerelease) {
			gh(['release', 'edit', tag, '--repo', repo, '--draft=false', '--prerelease=false', '--latest']);
		}
		log(`published https://github.com/${repo} at ${tag} (${commit.slice(0, 12)})`);

		const problems = checkPublished({ repo, version, name, log });
		if (problems.length) throw new Error(`published, but the checks found:\n  ${problems.join('\n  ')}`);
		log(`check: PASS. Try it: gemini extensions install https://github.com/${repo}`);
		return { dryRun: false, commit, tag, export: exp };
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const argv = process.argv.slice(2);
	const unknown = argv.filter((a) => !['--dry-run', '--check', '--help', '-h'].includes(a));
	if (unknown.length || argv.includes('--help') || argv.includes('-h')) {
		console.log('usage: node scripts/publish-gemini-extension.mjs [--dry-run | --check]');
		process.exit(unknown.length ? 2 : 0);
	}
	try {
		if (argv.includes('--check')) {
			const m = JSON.parse(readFileSync(join(REPO_ROOT, DEFAULTS.src, 'gemini-extension.json'), 'utf8'));
			const problems = checkPublished({ repo: DEFAULTS.repo, version: m.version, name: m.name });
			if (problems.length) {
				for (const p of problems) console.error(`problem: ${p}`);
				process.exit(1);
			}
			console.log(`check: PASS (${DEFAULTS.repo} ${m.name} ${m.version})`);
		} else {
			publishGeminiExtension({ dryRun: argv.includes('--dry-run') });
		}
	} catch (err) {
		console.error(`publish-gemini-extension: ${err.message}`);
		process.exit(1);
	}
}
