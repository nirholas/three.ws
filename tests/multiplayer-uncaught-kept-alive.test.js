// The multiplayer server runs as a single Cloud Run instance (min=max=1), so a
// throw in any one room message handler must not end the process. index.js
// installs an uncaughtException handler that logs and keeps serving, but
// Colyseus's default gracefullyShutdown hook also listens for uncaught
// exceptions, disposes every room and calls process.exit(1). That is how one
// player opening the spin wheel dropped every connected player in production
// (Cloud Run log 2026-11-04T06:28:13Z: "uncaughtException (kept alive)" followed
// by "Container called exit(1)"). This boots the real entry point and throws.
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('../multiplayer/src/index.js', import.meta.url));
const CWD = fileURLToPath(new URL('../multiplayer/', import.meta.url));

function bootAndThrow() {
	const env = { ...process.env, NODE_ENV: 'test', PORT: '0' };
	for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_URI', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete env[k];
	const script = `
		await import(${JSON.stringify(ENTRY)});
		setTimeout(() => { throw new Error('boom from a room handler'); }, 500);
		setTimeout(() => { console.log('STILL_ALIVE'); process.exit(0); }, 2500);
	`;
	return new Promise((resolve) => {
		const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: CWD, env });
		let out = '';
		child.stdout.on('data', (d) => { out += d; });
		child.stderr.on('data', (d) => { out += d; });
		child.on('exit', (code) => resolve({ code, out }));
	});
}

describe('multiplayer server under an uncaught exception', () => {
	it('logs the fault and keeps the process serving', async () => {
		const { code, out } = await bootAndThrow();
		expect(out).toContain('listening on ws://');
		expect(out).toContain('uncaughtException (kept alive): Error: boom from a room handler');
		expect(out).toContain('STILL_ALIVE');
		expect(code).toBe(0);
	}, 60_000);
});
