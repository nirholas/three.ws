// Filter a list of repo-relative paths down to the ones git does not ignore.
//
// Audits that walk the disk (scripts/audit-docs.mjs) otherwise pick up local,
// gitignored output such as the root-level three-ws-notebooklm*.md bundles and
// report findings that no commit can fix. One `git check-ignore --stdin` call
// classifies the whole list. Outside a git checkout (a tarball, a CI cache)
// nothing is treated as ignored, so the audit stays conservative.
import { spawnSync } from 'node:child_process';

/**
 * @param {string} root      repository root the paths are relative to
 * @param {string[]} relPaths
 * @returns {string[]} relPaths minus the gitignored ones, order preserved
 */
export function dropGitIgnored(root, relPaths) {
	if (!relPaths.length) return [];
	const r = spawnSync('git', ['check-ignore', '--stdin'], {
		cwd: root,
		input: relPaths.join('\n'),
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	// Exit 0: some paths ignored. Exit 1: none ignored. Anything else (128 for
	// "not a git repository", or git missing) means we cannot tell.
	if (r.error || (r.status !== 0 && r.status !== 1)) return relPaths;
	const ignored = new Set(r.stdout.split('\n').filter(Boolean));
	return relPaths.filter((p) => !ignored.has(p));
}
