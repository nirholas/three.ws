#!/usr/bin/env node
// The image proves itself at build time. Run as the last step of the
// Dockerfile, as the runtime user, after devDependencies are pruned, so a
// missing module, a pruned dependency, an unreadable file or a missing system
// codec fails `docker build` instead of the first message or voice note in
// production.
//
// It checks, in order:
//   1. the whole worker module graph resolves: the entry point (which only
//      boots when it is the process entry, so importing it opens nothing), the
//      health server, the drain loop, config, and the adapter registry, which
//      pulls in grammY, discord.js and the shared gateway core under api/;
//   2. the registry still knows every platform the receivers queue for;
//   3. ffmpeg runs, and the real voice path (api/_lib/gateway/audio.js
//      toOggOpus) turns a generated tone into Ogg Opus, which needs libopus.
//
// Usage: node workers/agent-gateway/scripts/image-selfcheck.mjs
// Exits non-zero with the failing check named. Prints one line per check.

import { spawnSync } from 'node:child_process';

const failures = [];
async function check(name, fn) {
	try {
		const detail = await fn();
		console.log(`ok   ${name}${detail ? `: ${detail}` : ''}`);
	} catch (e) {
		failures.push(name);
		console.error(`FAIL ${name}: ${e?.message || e}`);
	}
}

await check('worker module graph', async () => {
	const entry = await import('../src/index.js');
	if (typeof entry.main !== 'function') throw new Error('src/index.js does not export main()');
	await import('../src/health.js');
	await import('../src/drain.js');
	await import('../src/config.js');
	await import('../src/setup.js');
	await import('../../../api/_lib/gateway/core.js');
	return 'index, health, drain, config, setup, gateway core';
});

await check('adapter registry', async () => {
	const { FACTORIES } = await import('../src/adapters/index.js');
	const names = Object.keys(FACTORIES);
	for (const p of ['telegram', 'discord']) if (!names.includes(p)) throw new Error(`no adapter for ${p}`);
	return names.join(', ');
});

await check('ffmpeg binary', async () => {
	const bin = process.env.FFMPEG_PATH || 'ffmpeg';
	const out = spawnSync(bin, ['-hide_banner', '-version'], { encoding: 'utf8' });
	if (out.error) throw out.error;
	if (out.status !== 0) throw new Error(`${bin} -version exited ${out.status}`);
	return out.stdout.split('\n')[0];
});

await check('voice transcode to Ogg Opus', async () => {
	const bin = process.env.FFMPEG_PATH || 'ffmpeg';
	const tone = spawnSync(bin, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-f', 'wav', 'pipe:1'], { maxBuffer: 8 * 1024 * 1024 });
	if (tone.status !== 0 || !tone.stdout?.length) throw new Error(`could not generate a test tone: ${String(tone.stderr || '').trim()}`);
	const { toOggOpus } = await import('../../../api/_lib/gateway/audio.js');
	const ogg = await toOggOpus(tone.stdout, 'audio/wav');
	if (!Buffer.isBuffer(ogg) || ogg.subarray(0, 4).toString('latin1') !== 'OggS') throw new Error('output is not an Ogg stream');
	if (!ogg.includes(Buffer.from('OpusHead'))) throw new Error('Ogg stream carries no Opus header');
	return `${tone.stdout.length} bytes of WAV to ${ogg.length} bytes of Ogg Opus`;
});

if (failures.length) {
	console.error(`agent-gateway image self-check failed: ${failures.join(', ')}`);
	process.exit(1);
}
console.log('agent-gateway image self-check passed');
process.exit(0);
