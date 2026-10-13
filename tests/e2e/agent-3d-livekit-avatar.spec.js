import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';

// Work order 087: proves the LiveKit avatar plugin end to end, browser side.
// A real voice agent (integrations/livekit/livekit-plugins-threews/examples/
// avatar_agent.py) joins a real local open-source livekit-server (started by
// this repo's `npm run dev:livekit` docker helper, or already running from a
// prior manual `docker run livekit/livekit-server --dev`) and speaks three
// lines through a real espeak-ng TTS. The three.ws `threews.AvatarSession`
// plugin republishes the agent's turns as `transcript`/`gesture` data-channel
// messages, and a real Chromium loads `<agent-3d voice="livekit">` (via
// public/agent-3d-livekit-harness.html) to prove those messages actually
// drive the browser's existing gesture/lipsync protocol.
//
// Fidelity: only the agent's own livekit-token mint
// (`/api/agents/:id/livekit-token`, real production DB + auth state this
// test box doesn't have) is route-intercepted, with a token built the same
// way the real handler signs one (same claim shape, same devkey/devsecret
// dev-server credentials the local livekit-server was started with). Every
// other hop (the LiveKit room, the agent process, the plugin's data channel,
// the browser's `LiveKitVoice` client, the avatar protocol) is real.

const ROOM = `e2e-livekit-${Date.now()}`;
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'devsecret';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = path.join(
	HERE,
	'..',
	'..',
	'integrations',
	'livekit',
	'livekit-plugins-threews',
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

function spawnAgent(room) {
	const child = spawn('python3', ['-u', 'avatar_agent.py', 'connect', '--room', room], {
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

test.describe('agent-3d LiveKit avatar plugin (real local livekit-server)', () => {
	test.setTimeout(120_000);

	test('a real agent speaking in the room drives the browser avatar lipsync + gesture', async ({
		page,
	}) => {
		const agent = spawnAgent(ROOM);
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

			// Wait for the element to actually open the LiveKit room before
			// subscribing to its protocol (the protocol object itself is created
			// synchronously on connect, independent of the room join finishing).
			await expect
				.poll(() => page.evaluate(() => !!document.getElementById('a3d')?._avatar?.protocol), {
					timeout: 60_000,
				})
				.toBe(true);

			const eventsPromise = page.evaluate(() => {
				return new Promise((resolve) => {
					const protocol = document.getElementById('a3d')._avatar.protocol;
					const seen = [];
					const onSpeak = (action) => seen.push({ type: 'speak', text: action.payload?.text });
					const onGesture = (action) => seen.push({ type: 'gesture', name: action.payload?.name });
					protocol.on('speak', onSpeak);
					protocol.on('gesture', onGesture);
					// The agent speaks exactly 3 lines (2 carry a gesture cue, the
					// farewell line does not by design); stop once all 3 "speak"
					// events have landed, or after a generous ceiling so a real
					// failure still resolves with whatever partial evidence it
					// gathered.
					const finish = () => {
						protocol.off('speak', onSpeak);
						protocol.off('gesture', onGesture);
						resolve(seen);
					};
					const ceiling = setTimeout(finish, 45_000);
					const checkDone = () => {
						if (seen.filter((e) => e.type === 'speak').length >= 3) {
							clearTimeout(ceiling);
							finish();
						}
					};
					protocol.on('speak', checkDone);
				});
			});

			const events = await eventsPromise;

			await page.screenshot({
				path: 'test-results/agent-3d-livekit-avatar-final.png',
				fullPage: false,
			});

			const speaks = events.filter((e) => e.type === 'speak').map((e) => e.text);
			const gestures = events.filter((e) => e.type === 'gesture').map((e) => e.name);

			expect(speaks, `agent log:\n${agent.getLog()}`).toEqual([
				"Hello! I'm the three.ws avatar, speaking through LiveKit.",
				'Yes, this plugin publishes a gesture cue with that line.',
				'Goodbye, and thanks for watching the demo!',
			]);
			expect(gestures).toEqual(['wave', 'nod']);
			expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
		} finally {
			agent.child.kill('SIGTERM');
		}
	});
});
