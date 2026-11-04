// Workspace path rules for the agent sandbox (api/_lib/sandbox/paths.js) and
// the places a path crosses a trust boundary: writing a workspace to disk
// before a run (materialize), reading what the program left behind after it
// (collectFiles, snapshot), and the per-run store (workspace.js). A program is
// hostile by assumption, so every one of these must refuse to reach outside
// its workspace by `..`, by an absolute path, or by a symlink it planted.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
	SandboxPathError,
	normalizeWorkspacePath,
	isStatePath,
	globToRegExp,
	matchAny,
	contentTypeFor,
} from '../api/_lib/sandbox/paths.js';
import { collectFiles, materialize, snapshot, changed } from '../api/_lib/sandbox/exec-core.js';
import { workspaceStore, _setWorkspaceStore } from '../api/_lib/sandbox/workspace.js';

describe('normalizeWorkspacePath', () => {
	it('keeps a plain relative path', () => {
		expect(normalizeWorkspacePath('out/chart.png')).toBe('out/chart.png');
	});

	it('strips the /workspace prefix the program sees and leading ./', () => {
		expect(normalizeWorkspacePath('/workspace/out/chart.png')).toBe('out/chart.png');
		expect(normalizeWorkspacePath('./data.csv')).toBe('data.csv');
		expect(normalizeWorkspacePath('././a/b.txt')).toBe('a/b.txt');
	});

	it('turns Windows separators into POSIX ones before checking them', () => {
		expect(normalizeWorkspacePath('out\\a.txt')).toBe('out/a.txt');
		expect(() => normalizeWorkspacePath('..\\..\\etc\\passwd')).toThrow(SandboxPathError);
	});

	it.each([
		['../secret', 'parent escape'],
		['a/../../secret', 'nested parent escape'],
		['a/./b', 'dot segment'],
		['/etc/passwd', 'absolute path outside the workspace'],
		['/workspace/../etc/passwd', 'escape after the workspace prefix'],
		['a//b', 'empty segment'],
		['a/b/', 'trailing slash'],
		['a\0b', 'NUL byte'],
		['/workspace', 'the workspace itself'],
		['/workspace/', 'the workspace itself with a slash'],
		['', 'empty'],
		['   ', 'blank'],
	])('refuses %j (%s)', (input) => {
		expect(() => normalizeWorkspacePath(input)).toThrow(SandboxPathError);
	});

	it('refuses non-strings', () => {
		for (const v of [null, undefined, 42, {}, ['a']]) expect(() => normalizeWorkspacePath(v)).toThrow(SandboxPathError);
	});

	it('refuses paths longer than 256 characters', () => {
		expect(() => normalizeWorkspacePath('a/'.repeat(128) + 'b')).toThrow(/longer than 256/);
	});

	it('reports a refusal as a client error the API can show', () => {
		try {
			normalizeWorkspacePath('../x');
			throw new Error('expected a refusal');
		} catch (err) {
			expect(err).toBeInstanceOf(SandboxPathError);
			expect(err.status).toBe(400);
			expect(err.code).toBe('bad_path');
			expect(err.expose).toBe(true);
		}
	});
});

describe('state paths, globs and content types', () => {
	it('recognizes the terminal session directory', () => {
		expect(isStatePath('.three_ws/terminal.env')).toBe(true);
		expect(isStatePath('.three_ws')).toBe(true);
		expect(isStatePath('.three_wsx/a')).toBe(false);
		expect(isStatePath('out/.three_ws')).toBe(false);
	});

	it('matches globs within and across segments', () => {
		expect(globToRegExp('*.csv').test('a.csv')).toBe(true);
		expect(globToRegExp('*.csv').test('out/a.csv')).toBe(false);
		expect(globToRegExp('**/*.csv').test('out/deep/a.csv')).toBe(true);
		expect(globToRegExp('**/*.csv').test('a.csv')).toBe(true);
		expect(globToRegExp('/workspace/out/?.png').test('out/a.png')).toBe(true);
		expect(globToRegExp('a.(b)').test('a.(b)')).toBe(true);
		expect(matchAny(['a.csv', 'b.png'], ['*.png'])).toEqual(['b.png']);
		expect(matchAny(['a.csv'], [])).toEqual(['a.csv']);
	});

	it('names content types by extension', () => {
		expect(contentTypeFor('out/chart.PNG')).toBe('image/png');
		expect(contentTypeFor('noext')).toBe('application/octet-stream');
	});
});

describe('materialize, snapshot and collectFiles on a real directory', () => {
	let root;
	let ws;
	let outside;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'sbx-paths-'));
		ws = path.join(root, 'workspace');
		outside = path.join(root, 'host-secret.txt');
		await fs.writeFile(outside, 'host credentials');
	});
	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it('writes nested files', async () => {
		await materialize(ws, [{ path: 'a/b/c.txt', data: Buffer.from('hi') }]);
		expect(await fs.readFile(path.join(ws, 'a/b/c.txt'), 'utf8')).toBe('hi');
	});

	it('refuses to write through `..`', async () => {
		await expect(materialize(ws, [{ path: '../escaped.txt', data: Buffer.from('x') }])).rejects.toThrow();
		await expect(fs.stat(path.join(root, 'escaped.txt'))).rejects.toThrow();
	});

	it('refuses an absolute path instead of quietly rehoming it', async () => {
		await expect(materialize(ws, [{ path: '/etc/cron.d/evil', data: Buffer.from('x') }])).rejects.toThrow(SandboxPathError);
	});

	it('accepts the /workspace prefix the model writes', async () => {
		await materialize(ws, [{ path: '/workspace/in/data.csv', data: Buffer.from('1,2') }]);
		expect(await fs.readFile(path.join(ws, 'in/data.csv'), 'utf8')).toBe('1,2');
	});

	it('snapshot skips symlinks a program planted, file or directory', async () => {
		await materialize(ws, [{ path: 'real.txt', data: Buffer.from('ok') }]);
		await fs.symlink(outside, path.join(ws, 'link.txt'));
		await fs.symlink(root, path.join(ws, 'linkdir'));
		const snap = await snapshot(ws);
		expect([...snap.keys()]).toEqual(['real.txt']);
	});

	it('collectFiles reads regular files and refuses symlinks, including a swapped parent directory', async () => {
		await materialize(ws, [{ path: 'out/a.txt', data: Buffer.from('data') }]);
		await fs.symlink(outside, path.join(ws, 'leak.txt'));
		await fs.mkdir(path.join(root, 'elsewhere'));
		await fs.writeFile(path.join(root, 'elsewhere', 'b.txt'), 'outside');
		await fs.symlink(path.join(root, 'elsewhere'), path.join(ws, 'via'));

		const got = await collectFiles(ws, ['out/a.txt', 'leak.txt', 'via/b.txt', '../host-secret.txt', 'missing.txt']);
		expect(got.files.map((f) => f.path)).toEqual(['out/a.txt']);
		expect(got.files[0].data.toString()).toBe('data');
		const refused = Object.fromEntries(got.skipped.map((s) => [s.path, s.reason]));
		expect(refused['leak.txt']).toBe('not_a_regular_file');
		expect(refused['via/b.txt']).toBe('outside_workspace');
		expect(refused['../host-secret.txt']).toBe('bad_path');
		expect(refused['missing.txt']).toBe('missing');
	});

	it('collectFiles stops at a per-file size cap', async () => {
		await materialize(ws, [{ path: 'big.bin', data: Buffer.alloc(2048) }]);
		const got = await collectFiles(ws, ['big.bin'], { maxFileBytes: 1024 });
		expect(got.files).toEqual([]);
		expect(got.skipped).toEqual([{ path: 'big.bin', reason: 'too_large', size: 2048 }]);
	});

	it('changed() reports new, modified and deleted files', async () => {
		await materialize(ws, [
			{ path: 'keep.txt', data: Buffer.from('same') },
			{ path: 'edit.txt', data: Buffer.from('v1') },
			{ path: 'gone.txt', data: Buffer.from('bye') },
		]);
		const before = await snapshot(ws);
		await fs.writeFile(path.join(ws, 'edit.txt'), 'v2');
		await fs.rm(path.join(ws, 'gone.txt'));
		await fs.writeFile(path.join(ws, 'new.txt'), 'n');
		const diff = changed(before, await snapshot(ws));
		expect(diff.modified.map((m) => m.path).sort()).toEqual(['edit.txt', 'new.txt']);
		expect(diff.deleted).toEqual(['gone.txt']);
	});
});

describe('the fs workspace store keeps every run inside its own prefix', () => {
	let dataDir;
	const saved = {};

	beforeEach(async () => {
		dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sbx-store-'));
		for (const k of ['SANDBOX_STORE', 'SANDBOX_DATA_DIR']) saved[k] = process.env[k];
		process.env.SANDBOX_STORE = 'fs';
		process.env.SANDBOX_DATA_DIR = dataDir;
		_setWorkspaceStore(null);
	});
	afterEach(async () => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
		_setWorkspaceStore(null);
		await fs.rm(dataDir, { recursive: true, force: true });
	});

	it('round-trips a file and lists it', async () => {
		const store = workspaceStore();
		expect(store.kind).toBe('fs');
		await store.write('run-abc123', 'out/a.txt', Buffer.from('hello'));
		expect((await store.read('run-abc123', '/workspace/out/a.txt')).toString()).toBe('hello');
		const list = await store.list('run-abc123');
		expect(list.map((f) => [f.path, f.size, f.contentType])).toEqual([['out/a.txt', 5, 'text/plain']]);
		expect(await store.read('run-abc123', 'nope.txt')).toBeNull();
	});

	it('refuses traversal in file paths', async () => {
		const store = workspaceStore();
		await expect(store.write('run-abc123', '../run-other/x.txt', Buffer.from('x'))).rejects.toThrow(SandboxPathError);
		await expect(store.read('run-abc123', '../../../etc/passwd')).rejects.toThrow(SandboxPathError);
		await expect(store.remove('run-abc123', '/etc/passwd')).rejects.toThrow(SandboxPathError);
	});

	it('refuses run ids that could name another directory', async () => {
		const store = workspaceStore();
		for (const bad of ['../x', 'a/b', '', 'short', 'x'.repeat(81)]) {
			await expect(store.list(bad)).rejects.toThrow(/invalid run id/);
		}
	});

	it('one run never sees another run\'s files', async () => {
		const store = workspaceStore();
		await store.write('run-aaaaaa', 'a.txt', Buffer.from('a'));
		await store.write('run-bbbbbb', 'b.txt', Buffer.from('b'));
		expect((await store.list('run-aaaaaa')).map((f) => f.path)).toEqual(['a.txt']);
		await store.removeAll('run-aaaaaa');
		expect(await store.list('run-aaaaaa')).toEqual([]);
		expect((await store.list('run-bbbbbb')).map((f) => f.path)).toEqual(['b.txt']);
	});
});
