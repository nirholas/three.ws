#!/usr/bin/env node
// Run the Vite dev server and the Colyseus multiplayer server side by side
// for /walk development. Both processes share this terminal and shut down
// together on Ctrl+C.
//
//   npm run dev:walk-all
//
// Vite picks the first free port from 3000 upward; Colyseus binds 2567 by
// default. The /walk client autodiscovers ws://localhost:2567 in dev (see
// src/walk-net.js), so no environment plumbing is required.

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const procs = [];

function start(name, cmd, args, color) {
	const child = spawn(cmd, args, {
		cwd: root,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: process.env,
	});
	const tag = `[${color}m[${name}][0m`;
	const pipe = (stream, target) => {
		let buf = '';
		stream.setEncoding('utf8');
		stream.on('data', (chunk) => {
			buf += chunk;
			const lines = buf.split('\n');
			buf = lines.pop();
			for (const line of lines) target.write(`${tag} ${line}\n`);
		});
		stream.on('end', () => {
			if (buf) target.write(`${tag} ${buf}\n`);
		});
	};
	pipe(child.stdout, process.stdout);
	pipe(child.stderr, process.stderr);
	child.on('exit', (code, signal) => {
		console.log(`${tag} exited code=${code} signal=${signal ?? ''}`);
		shutdown();
	});
	procs.push(child);
	return child;
}

function shutdown() {
	for (const p of procs) {
		if (!p.killed && p.exitCode === null) {
			try { p.kill('SIGTERM'); } catch {}
		}
	}
}

process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });

start('vite', 'npm', ['run', 'dev'], '36');
start('multi', 'npm', ['run', 'dev', '--prefix', 'multiplayer'], '35');
