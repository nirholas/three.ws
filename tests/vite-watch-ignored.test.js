// The dev server's watcher must skip trees that are never app code. On
// 2026-11-13 a Python eval venv at workers/avatar-reconstruction/.venv-eval
// (torch, matplotlib: tens of thousands of files) made Vite fire a full
// "page reload" for every .html inside site-packages and exhaust the inotify
// budget with "ENOSPC: System limit for number of file watchers reached",
// which also breaks every browser sweep running against that server.
import { describe, it, expect } from 'vitest';
import picomatch from 'picomatch';
import { watchIgnored } from '../scripts/vite/watch-ignored.mjs';

const ROOT = '/home/user/three.ws';
// Default picomatch options: the strictest reading (no implicit dot matching),
// so a pattern that passes here also passes under chokidar's matcher.
const ignored = picomatch(watchIgnored(ROOT));

describe('vite watch ignore list', () => {
	it.each([
		'workers/avatar-reconstruction/.venv-eval',
		'workers/avatar-reconstruction/.venv-eval/lib/python3.12/site-packages/torch/utils/model_dump/skeleton.html',
		'workers/avatar-reconstruction/.venv-eval/lib64/python3.12/site-packages/matplotlib/backends/web_backend/single_figure.html',
		'workers/model-trellis/.venv/bin/python',
		'workers/foo/venv/lib/python3.11/site-packages/x/index.html',
		'scripts/__pycache__',
		'scripts/__pycache__/build.cpython-312.pyc',
		'.claude/worktrees',
		'.claude/worktrees/agent-a1/src/main.js',
		'contracts/lib',
		'contracts/lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol',
		'contracts/v4-hooks/lib/v4-core/src/types/Currency.sol',
		'dist-lib',
		'dist-lib/agent-3d/latest/agent-3d.js',
	])('ignores %s', (rel) => {
		expect(ignored(`${ROOT}/${rel}`)).toBe(true);
	});

	it.each([
		'index.html',
		'pages/three-live.html',
		'src/glb-canonicalize.js',
		'src/lib/format.js',
		'packages/sdk/lib/index.js',
		'workers/avatar-reconstruction/server.py',
		'scripts/build-ict-expression-targets.py',
		'public/sitemap/index.html',
		'contracts/v4-hooks/src/Hook.sol',
	])('still watches %s', (rel) => {
		expect(ignored(`${ROOT}/${rel}`)).toBe(false);
	});

	it('anchors root-only entries to the given root, with or without a trailing slash', () => {
		expect(watchIgnored(`${ROOT}/`)).toEqual(watchIgnored(ROOT));
		expect(picomatch(watchIgnored('/elsewhere'))(`${ROOT}/dist-lib/x.js`)).toBe(false);
	});
});
