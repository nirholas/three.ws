// `three-ws-agent doctor`: check every dependency a turn needs and say how to
// fix whatever is missing. Each check is { name, ok, detail, fix? }; a
// failing check never stops the others from running.

import { configPath, databasePath } from '../paths.js';
import { loadConfig } from '../config.js';
import { resolveCredential, mask } from '../credentials.js';
import { createModel } from '../model.js';
import { connectMcp } from '../mcp.js';
import { runCommand } from '../tools/sandbox.js';
import { errorMessage } from './format.js';

async function check(name, fn) {
	try {
		return { name, ...(await fn()) };
	} catch (err) {
		return { name, ok: false, detail: errorMessage(err) };
	}
}

export async function doctor({ env, fetchImpl, mcp = true }) {
	const checks = [];
	const [major, minor] = process.versions.node.split('.').map(Number);
	checks.push({
		name: 'node',
		ok: major > 22 || (major === 22 && minor >= 13),
		detail: `node ${process.versions.node}`,
		fix: 'Install Node.js 22.13 or newer (node:sqlite ships unflagged from there).',
	});

	let config = null;
	checks.push(
		await check('config', async () => {
			config = loadConfig(env);
			return { ok: true, detail: `${configPath(env)} (origin ${config.origin}, model ${config.model.provider}${config.model.model ? ` ${config.model.model}` : ''})` };
		}),
	);

	const credential = resolveCredential(env);
	checks.push(
		credential
			? { name: 'credential', ok: true, detail: `${mask(credential.token)} from ${credential.source}` }
			: { name: 'credential', ok: false, detail: 'not signed in', fix: 'Run `three-ws-agent login`, or set THREE_WS_API_KEY. A local model (`/model openai ...`) works without it, minus the three.ws tools.' },
	);

	if (config) {
		checks.push(
			await check('model', async () => {
				const model = createModel(config, credential, { fetchImpl, vars: env.vars });
				const models = await model.listModels();
				const wanted = model.target.model;
				const listed = models.some((m) => m.id === wanted);
				return {
					ok: listed || models.length > 0,
					detail: `${model.label}: ${models.length} model${models.length === 1 ? '' : 's'} listed${listed ? '' : `, "${wanted}" not among them`}`,
					fix: listed ? undefined : 'Pick one the endpoint lists with `/model <id>`.',
				};
			}),
		);
	}

	if (config && mcp) {
		if (!credential) {
			checks.push({ name: 'mcp', ok: false, detail: 'skipped: needs a three.ws credential', fix: 'Sign in to mount the three.ws tools.' });
		} else {
			checks.push(
				await check('mcp', async () => {
					const remote = await connectMcp({ origin: config.origin, servers: config.mcp.servers, token: credential.token });
					try {
						const parts = remote.servers.map((s) => (s.error ? `${s.server}: ${s.error}` : `${s.server}: ${s.toolCount} tools`));
						return { ok: remote.servers.every((s) => !s.error), detail: parts.join(', ') };
					} finally {
						await remote.close();
					}
				}),
			);
		}
	}

	checks.push(
		await check('sqlite', async () => {
			const { DatabaseSync } = await import('node:sqlite');
			const db = new DatabaseSync(':memory:');
			db.exec("CREATE VIRTUAL TABLE t USING fts5(body); INSERT INTO t VALUES ('hello world');");
			const n = db.prepare("SELECT count(*) AS n FROM t WHERE t MATCH 'hello'").get().n;
			db.close();
			return { ok: n === 1, detail: `node:sqlite with FTS5, sessions in ${databasePath(env)}` };
		}),
	);

	checks.push(
		await check('sandbox', async () => {
			if (process.platform === 'win32') return { ok: true, detail: 'Windows: timeout and output caps only (no ulimit)' };
			const r = await runCommand('ulimit -t 5; ulimit -f 1024; ulimit -t; ulimit -f', { cwd: env.cwd, timeoutMs: 10_000 });
			const out = r.stdout.trim().split(/\s+/);
			return { ok: r.exitCode === 0 && out[0] === '5' && out[1] === '1024', detail: `ulimit -t ${out[0] || '?'}, -f ${out[1] || '?'} applied in the shell sandbox`, fix: 'The shell tool needs a POSIX sh with ulimit.' };
		}),
	);

	return { ok: checks.every((c) => c.ok), checks };
}

export function printDoctor({ ok, checks }) {
	const lines = checks.map((c) => `${c.ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(11)} ${c.detail}${!c.ok && c.fix ? `\n      fix: ${c.fix}` : ''}`);
	lines.push('', ok ? 'Everything the agent needs is in place.' : 'Fix the FAIL lines above, then run `three-ws-agent doctor` again.');
	return lines.join('\n');
}
