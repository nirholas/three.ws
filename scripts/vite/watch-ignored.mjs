// Paths the dev server's file watcher must never descend into. Merged with
// Vite's own defaults (node_modules, .git, the build outDir), not a
// replacement for them.
//
// Agent worktrees are full checkouts nested at .claude/worktrees/ (a dozen of
// them is ordinary here, roughly 250,000 files). None of them is part of this
// app's module graph, but Vite's default watcher only skips node_modules and
// .git, so it tried to watch every one, spent the user's whole inotify budget,
// and died at boot with "ENOSPC: System limit for number of file watchers
// reached".
//
// Python virtualenvs and bytecode caches hit the same wall: on 2026-11-13 an
// eval venv at workers/avatar-reconstruction/.venv-eval (torch, matplotlib)
// made Vite fire a full page reload for every .html file inside site-packages,
// tearing down every open tab and every browser sweep against that server, and
// then ran the watcher out of inotify handles. Workers keep venvs beside their
// code under several names (.venv, .venv-eval, venv), so all of them are
// matched, plus any stray site-packages and __pycache__ tree.
//
// Two root-anchored trees are never app code either: Foundry's vendored
// Solidity dependencies under contracts/ (about 9,000 files) and dist-lib/,
// the <agent-3d> library build that a dev plugin serves by reading the file on
// request. Watching dist-lib also turned every peer's `npm run build:lib` into
// a reload of every open page. They are anchored to the repo root so a
// package's own src/lib or a worker's lib/ stays watched.
//
// Each entry matches the directory itself as well as everything under it
// (`{,/**}`): the watcher tests the directory path to decide whether to descend,
// and a bare `dir/**` does not match `dir`.
export function watchIgnored(root) {
	const r = root.replace(/\/+$/, '');
	return [
		'**/.claude/worktrees{,/**}',
		'**/.venv*{,/**}',
		'**/venv{,/**}',
		'**/site-packages{,/**}',
		'**/__pycache__{,/**}',
		`${r}/contracts/lib{,/**}`,
		`${r}/contracts/*/lib{,/**}`,
		`${r}/dist-lib{,/**}`,
	];
}
