import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';

// Work order 087: proves the Pipecat `pipecat-threews` package end to end,
// browser side, the same way agent-3d-livekit-avatar.spec.js proves the
// LiveKit plugin. A real Pipecat pipeline (integrations/pipecat/
// pipecat-threews/examples/avatar_bot.py) joins the same kind of real local
// open-source livekit-server, speaks three lines through a real espeak-ng
// TTS service, and `ThreeWsAvatarProcessor` republishes them as
// `transcript`/`gesture` data-channel messages that a real Chromium loading
// `<agent-3d voice="livekit">` renders through the exact same browser code
// path (LiveKitVoice never knows which backend published the message).
//
// `video: 'on'` is set for this spec only so the run also produces the demo
// video pipecat-ai/pipecat's COMMUNITY_INTEGRATIONS.md asks every community
// integration PR to link (saved under the gitignored test-results/, not
// committed; the submission doc records the local path for the owner to
// attach when the PR is actually opened).

const ROOM = `e2e-pipecat-${Date.now()}`;
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'devsecret';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = path.join(
	HERE,
	'..',
	'..',
	'integrations',
	'pipecat',
	'pipecat-threews',
	'examples',
);

async function mintBrowserToken(room) {
	const secret = new TextEncoder().encode(LIVEKIT_API_SECRET);
	const now = Math.floor(Date.now() / 1000);
	return new SignJWT({
		video: { roomJoin: true, room, canPublish: true, canSubscribe: true },
		sub: 'e2e-browser',
		iss: LIVEKIT_API_KEY,
		nbf: now,
		exp: now + 3600,
	})
		.setProtectedHeader({ alg: 'HS256' })
		.sign(secret);
}

function spawnBot(room) {
	const child = spawn('python3', ['-u', 'avatar_bot.py', '--room', room], {
		cwd: EXAMPLES_DIR,
		env: {
			...process.env,
			LIVEKIT_URL,
			LIVEKIT_API_KEY,
			LIVEKIT_API_SECRET,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let log = '';
	child.stdout.on('data', (d) => (log += d.toString()));
	child.stderr.on('data', (d) => (log += d.toString()));
	return { child, getLog: () => log };
}

test.use({ video: 'on' });

test.describe('agent-3d Pipecat avatar processor (real local livekit-server)', () => {
	test.setTimeout(120_000);

	test('a real Pipecat bot speaking in the room drives the browser avatar lipsync + gesture', async ({
		page,
	}) => {
		// The bot speaks its scripted lines immediately on connecting, with no
		// wait for a participant to join (unlike the LiveKit AgentSession demo,
		// whose session startup latency happens to give the browser time to
		// join first). So the browser must be fully joined to the room, not
		// just past protocol-object creation, before the bot is spawned at all,
		// or its first lines race the browser's own room.connect() and are lost.
		let bot;
		try {
			const token = await mintBrowserToken(ROOM);
			await page.route('**/api/agents/*/livekit-token', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ token, serverUrl: LIVEKIT_URL }),
				}),
			);

			const errors = [];
			page.on('pageerror', (err) => errors.push(String(err?.message || err)));

			await page.goto('/agent-3d-livekit-harness.html', { waitUntil: 'domcontentloaded' });

			await expect
				.poll(() => page.evaluate(() => document.getElementById('a3d')?._livekitVoice?.connected === true), {
					timeout: 60_000,
				})
				.toBe(true);

			// Attach the collectors with an awaited evaluate (not a long-lived
			// in-page Promise) so this call only resolves once the listeners are
			// actually registered, guaranteeing they're in place before the bot
			// (spawned right after) can publish anything.
			await page.evaluate(() => {
				window.__threewsEvents = [];
				const protocol = document.getElementById('a3d')._avatar.protocol;
				protocol.on('speak', (action) =>
					window.__threewsEvents.push({ type: 'speak', text: action.payload?.text }),
				);
				protocol.on('gesture', (action) =>
					window.__threewsEvents.push({ type: 'gesture', name: action.payload?.name }),
				);
			});

			bot = spawnBot(ROOM);

			await expect
				.poll(
					() =>
						page.evaluate(
							() => window.__threewsEvents.filter((e) => e.type === 'speak').length,
						),
					{ timeout: 60_000 },
				)
				.toBeGreaterThanOrEqual(3);

			// Hold on the final frame for a moment so the saved video has a
			// visible tail after the last gesture instead of cutting off mid-clip.
			await page.waitForTimeout(2000);

			const events = await page.evaluate(() => window.__threewsEvents);
			const speaks = events.filter((e) => e.type === 'speak').map((e) => e.text);
			const gestures = events.filter((e) => e.type === 'gesture').map((e) => e.name);

			expect(speaks, `bot log:\n${bot.getLog()}`).toEqual([
				"Hello! I'm the three.ws avatar, speaking through Pipecat.",
				'Yes, this processor publishes a gesture cue with that line.',
				'Goodbye, and thanks for watching the demo!',
			]);
			expect(gestures).toEqual(['wave', 'nod']);
			expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
		} finally {
			bot?.child.kill('SIGTERM');
		}
	});
});
