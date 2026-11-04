// argv parsing, help for every command, exit codes, and the sessions command
// run end to end through main() against a real SQLite file in a temp home.

import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { HELP, main, parseCli, UsageError } from '../src/cli.js';
import { VERSION } from '../src/http.js';
import { openStore } from '../src/store.js';
import { databasePath } from '../src/paths.js';
import { listen, tempEnv } from './helpers.js';

function capture() {
	const s = new PassThrough();
	let text = '';
	s.on('data', (c) => {
		text += c.toString();
	});
	return { stream: s, get text() { return text; } };
}

async function run(argv, env) {
	const stdout = capture();
	const stderr = capture();
	const code = await main(argv, { stdout: stdout.stream, stderr: stderr.stream, env });
	return { code, out: stdout.text, err: stderr.text };
}

const temps = [];
afterEach(() => {
	while (temps.length) temps.pop().cleanup();
});
function home() {
	const t = tempEnv();
	temps.push(t);
	return t;
}

describe('parseCli', () => {
	it('opens the TUI by default with its options', () => {
		const r = parseCli(['--resume', 'ses_ab', '--model', 'm1', '--agent', 'a1', '--cwd', '/tmp']);
		expect(r.command).toBe('chat');
		expect(r.values).toMatchObject({ resume: 'ses_ab', model: 'm1', agent: 'a1', cwd: '/tmp' });
	});

	it('reads a bare --avatar as true and keeps an explicit source', () => {
		expect(parseCli(['--avatar']).values.avatar).toBe(true);
		expect(parseCli(['--avatar', '--model', 'x']).values.avatar).toBe(true);
		expect(parseCli(['--avatar', './me.glb']).values.avatar).toBe('./me.glb');
	});

	it('splits a subcommand from its arguments', () => {
		const r = parseCli(['cron', 'add', 'every day at 9am', 'say hi', '--server']);
		expect(r).toMatchObject({ command: 'cron', args: ['add', 'every day at 9am', 'say hi'] });
		expect(r.values.server).toBe(true);
		expect(parseCli(['gateway', '--allow', '1', '--allow', '2']).values.allow).toEqual(['1', '2']);
		expect(parseCli(['login', '--scope', 'wallet:write']).values.scope).toEqual(['wallet:write']);
	});

	it('rejects unknown commands, unknown flags and a non-numeric --limit', () => {
		expect(() => parseCli(['bogus'])).toThrow(UsageError);
		expect(() => parseCli(['bogus'])).toThrow(/Unknown command "bogus"/);
		expect(() => parseCli(['--nope'])).toThrow(UsageError);
		expect(() => parseCli(['sessions', '--limit', 'ten'])).toThrow(/whole number/);
	});
});

describe('help and version', () => {
	it('prints the version', async () => {
		const r = await run(['--version'], home().env);
		expect(r).toMatchObject({ code: 0, out: `${VERSION}\n` });
	});

	it('prints the main help, naming every command', async () => {
		const r = await run(['--help'], home().env);
		expect(r.code).toBe(0);
		for (const c of ['login', 'logout', 'whoami', 'sessions', 'cron', 'gateway', 'doctor']) expect(r.out).toContain(`  ${c}`);
		expect(r.out).toContain('--resume');
		expect(r.out).toContain('--avatar');
	});

	it.each(['login', 'logout', 'whoami', 'sessions', 'cron', 'gateway', 'doctor'])('has help for %s, by flag and by `help <command>`', async (cmd) => {
		const env = home().env;
		const byFlag = await run([cmd, '--help'], env);
		const byHelp = await run(['help', cmd], env);
		expect(byFlag.code).toBe(0);
		expect(byFlag.out.trim()).toBe(HELP[cmd]);
		expect(byHelp.out).toBe(byFlag.out);
		expect(HELP[cmd]).toMatch(/Usage/);
	});

	it('exits 2 with the usage problem on bad input', async () => {
		const r = await run(['bogus'], home().env);
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/Unknown command "bogus"/);
		const sub = await run(['sessions', 'frobnicate'], home().env);
		expect(sub.code).toBe(2);
		expect(sub.err).toMatch(/Use list, search or export/);
	});

	it('refuses to open the TUI without an interactive terminal', async () => {
		const stdout = capture();
		const stderr = capture();
		const stdin = new PassThrough();
		const code = await main([], { stdout: stdout.stream, stderr: stderr.stream, stdin, env: home().env });
		expect(code).toBe(2);
		expect(stderr.text).toMatch(/needs an interactive terminal/);
	});
});

describe('sessions command', () => {
	it('lists, searches and exports real sessions', async () => {
		const t = home();
		const store = openStore(databasePath(t.env));
		const a = store.createSession({ title: 'Tide tables', kind: 'chat', cwd: t.cwd });
		store.appendMessages(a.id, [
			{ role: 'user', content: 'When is high tide at the harbour tomorrow?' },
			{ role: 'assistant', content: 'High tide is at 06:42 and 19:05.' },
		]);
		const b = store.createSession({ title: 'Release notes', kind: 'chat', cwd: t.cwd });
		store.appendMessages(b.id, [{ role: 'user', content: 'Draft the release notes for version two.' }]);
		store.close();

		const list = await run(['sessions'], t.env);
		expect(list.code).toBe(0);
		expect(list.out).toContain(a.id);
		expect(list.out).toContain('Release notes');

		const search = await run(['sessions', 'search', 'harbour'], t.env);
		expect(search.code).toBe(0);
		expect(search.out).toContain(a.id);
		expect(search.out).not.toContain(b.id);
		expect(search.out).toContain('[harbour]');

		const exp = await run(['sessions', 'export', a.id, '--out', '-'], t.env);
		expect(exp.code).toBe(0);
		const data = JSON.parse(exp.out);
		expect(data.format).toBe('three-ws-agent-session');
		expect(data.version).toBe(1);
		expect(data.session.id).toBe(a.id);
		expect(data.messages.map((m) => m.content)).toContain('High tide is at 06:42 and 19:05.');

		const missing = await run(['sessions', 'export'], t.env);
		expect(missing.code).toBe(2);
	});
});

describe('a rejected key', () => {
	it('tells the person to sign in again instead of printing the raw 401', async () => {
		// What three.ws answers once a key is revoked.
		const srv = await listen((req, res) => {
			res.writeHead(401, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ error: 'unauthorized', error_description: 'Authenticate with a three.ws API key or sign in.' }));
		});
		try {
			const t = tempEnv({ THREE_WS_ORIGIN: srv.url, THREE_WS_API_KEY: 'sk_live_THREEsyntheticRevokedKey000' });
			temps.push(t);
			const r = await run(['whoami'], t.env);
			expect(r.code).toBe(1);
			expect(r.err).toContain('three.ws rejected the API key from env THREE_WS_API_KEY');
			expect(r.err).toContain('update THREE_WS_API_KEY');
			expect(r.err).not.toContain('sk_live_THREEsyntheticRevokedKey000');
			expect(r.err).not.toMatch(/^401 /);
		} finally {
			await srv.close();
		}
	});
});
