#!/usr/bin/env node
// Feature-trial driver for /genesis: a sentence or a selfie becomes a rigged 3D
// agent with its own custodial Solana wallet, a persona, and a voice.
//
// Genesis claims the agent to an account, so every call behind it needs a
// session, which a trial `job` step cannot carry. This drives the real page in a
// real browser as the production QA account (AUDIT_EMAIL / AUDIT_PASSWORD in
// .env), exactly the way a visitor does it: type a description (or upload a
// portrait), name the agent, give it a persona and a voice, press Begin, wait
// for the reveal. It never registers the optional on-chain identity, because
// that signs a transaction.
//
//   node scripts/x-content-genesis-trial.mjs --mode text   --facet body
//   node scripts/x-content-genesis-trial.mjs --mode selfie --facet body
//   node scripts/x-content-genesis-trial.mjs --mode any    --facet wallet
//
// `--mode any` reads whichever journey (text first, then selfie) reached the
// reveal in the last 45 minutes, for the facets that do not depend on the input:
// the wallet, persona, voice and arrival animation are the same flow either way.
//
// Facets, each a separate trial step so one broken part never hides another:
//   body      the reveal hands back a skinned GLB whose skeleton maps to the
//             humanoid bone set the clip library drives
//   wallet    the agent holds a Solana address (and an EVM one), shown on the reveal
//   persona   the persona the visitor typed became the agent's system prompt
//   voice     the chosen voice is saved on the agent and speaks through /api/tts/speak
//   animates  the model on the reveal is playing a clip, not standing in its bind pose
//
// The journey runs once per mode; later facets of the same mode read its record
// (scripts/.genesis-trial/<mode>.json) while it is under 45 minutes old, so a
// five-step trial costs one generation, not five. The last stdout line is the
// facet's evidence, which the trial's promise audit reads.
//
// Exit 0 when the facet holds, 1 when it does not, 2 when the run could not start.

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { canonicalizeBoneName } from '../src/glb-canonicalize.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT, '.env'), quiet: true });

const args = new Map(
	process.argv.slice(2).reduce((pairs, raw, index, all) => {
		if (raw.startsWith('--')) pairs.push([raw.slice(2), all[index + 1] && !all[index + 1].startsWith('--') ? all[index + 1] : 'true']);
		return pairs;
	}, []),
);
const ORIGIN = (args.get('origin') || 'https://three.ws').replace(/\/$/, '');
const MODE = args.get('mode') || 'text';
const FACET = args.get('facet') || 'body';
const REUSE_MS = 45 * 60 * 1000;
const recordPath = (mode) => join(ROOT, 'scripts', '.genesis-trial', `${mode}.json`);
const RUN_MODE = MODE === 'any' ? 'text' : MODE;
const RECORD = recordPath(RUN_MODE);
const PROMPT = 'A silver-haired explorer in a teal flight jacket and brown boots';
const PERSONA = 'Warm, curious, explains navigation and maps like a patient mentor';
const PORTRAIT_PROMPT =
	'a photorealistic passport-style portrait photograph of a smiling adult person facing the camera directly, ' +
	'neutral grey background, even soft studio lighting, sharp focus, head and shoulders';
// Humanoid bones the pre-baked idle/walk/emote clips need to drive a body.
const REQUIRED_BONES = ['Hips', 'Spine', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'];

const fail = (code, message) => {
	console.log(message);
	process.exit(code);
};

if (!['text', 'selfie', 'any'].includes(MODE)) fail(2, `unknown --mode ${MODE}; use text, selfie or any`);
if (!['body', 'wallet', 'persona', 'voice', 'animates'].includes(FACET)) fail(2, `unknown --facet ${FACET}`);

async function portraitFile() {
	const res = await fetch(`${ORIGIN}/api/v1/ai/image`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ prompt: PORTRAIT_PROMPT, aspect_ratio: '1:1' }),
	});
	const payload = await res.json().catch(() => ({}));
	if (!res.ok || !payload.url) fail(2, `the portrait could not be made: /api/v1/ai/image answered ${res.status} ${JSON.stringify(payload).slice(0, 200)}`);
	const image = await fetch(payload.url);
	if (!image.ok) fail(2, `the portrait could not be downloaded: HTTP ${image.status}`);
	const file = join(dirname(RECORD), 'portrait.jpg');
	writeFileSync(file, Buffer.from(await image.arrayBuffer()));
	return file;
}

function glbJson(buffer) {
	const bytes = new Uint8Array(buffer);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== 0x46546c67) throw new Error('the model is not a GLB');
	const length = view.getUint32(12, true);
	return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
}

function skeletonReport(json) {
	const joints = new Set((json.skins || []).flatMap((skin) => skin.joints || []));
	const canonical = new Set([...joints].map((index) => canonicalizeBoneName(json.nodes?.[index]?.name)).filter(Boolean));
	return {
		skins: (json.skins || []).length,
		joints: joints.size,
		missing: REQUIRED_BONES.filter((bone) => !canonical.has(bone)),
		animations: (json.animations || []).map((clip) => clip.name || '(unnamed)'),
	};
}

async function runJourney() {
	const email = process.env.AUDIT_EMAIL;
	const password = process.env.AUDIT_PASSWORD;
	if (!email || !password) fail(2, 'AUDIT_EMAIL and AUDIT_PASSWORD are needed; run npm run audit:web:provision');
	mkdirSync(dirname(RECORD), { recursive: true });
	const photo = RUN_MODE === 'selfie' ? await portraitFile() : null;

	const started = Date.now();
	const browser = await chromium.launch();
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const record = { mode: RUN_MODE, ranAt: new Date(started).toISOString(), origin: ORIGIN, errors: [] };
	try {
		const login = await context.request.post(`${ORIGIN}/api/auth/login`, { data: { email, password }, timeout: 20_000 });
		if (!login.ok()) fail(2, `QA login failed: HTTP ${login.status()}`);

		const page = await context.newPage();
		page.on('pageerror', (err) => record.errors.push(err.message.slice(0, 200)));
		await page.goto(`${ORIGIN}/genesis`, { waitUntil: 'networkidle', timeout: 60_000 });
		if (RUN_MODE === 'selfie') {
			await page.click('#gx-tab-photo');
			await page.setInputFiles('#gx-photo-input', photo);
			await page.waitForSelector('#gx-photo-img[src^="data:"]', { timeout: 15_000 });
		} else {
			await page.fill('#gx-prompt', PROMPT);
		}
		await page.fill('#gx-name', `Trial ${RUN_MODE} ${new Date(started).toISOString().slice(0, 16)}`);
		await page.fill('#gx-persona', PERSONA);
		await page.waitForFunction(() => document.querySelectorAll('#gx-voice option').length > 1, null, { timeout: 20_000 });
		record.voice = await page.$eval('#gx-voice', (select) => {
			select.value = select.options[1].value;
			select.dispatchEvent(new Event('change', { bubbles: true }));
			return select.value;
		});
		await page.click('#gx-begin');

		// The page either reveals the agent or shows its own designed error; both
		// are the visitor's real outcome, and the error text is the evidence.
		const outcome = await page
			.waitForFunction(
				() => {
					const reveal = document.querySelector('[data-stage="reveal"]');
					if (reveal && !reveal.hidden) return 'reveal';
					for (const id of ['gx-forge-error', 'gx-input-error']) {
						const box = document.getElementById(id);
						if (box && !box.hidden && box.textContent.trim()) return `error: ${box.textContent.trim()}`;
					}
					return false;
				},
				null,
				{ timeout: 12 * 60 * 1000, polling: 2000 },
			)
			.then((handle) => handle.jsonValue())
			.catch(async () => `no reveal after 12 minutes; last step: ${await page.$eval('.gx-step[data-state="active"]', (el) => el.textContent.trim().replace(/\s+/g, ' ')).catch(() => 'unknown')}`);
		record.seconds = Math.round((Date.now() - started) / 1000);
		record.outcome = outcome;
		if (outcome !== 'reveal') {
			record.failedStep = await page.$eval('.gx-step[data-state="failed"]', (el) => el.dataset.step).catch(() => null);
			return record;
		}

		record.solana = await page.$eval('#gx-wallets .gx-addr:nth-child(1) code', (el) => el.getAttribute('title') || '').catch(() => '');
		record.evm = await page.$eval('#gx-wallets .gx-addr:nth-child(2) code', (el) => el.getAttribute('title') || '').catch(() => '');
		record.agentUrl = await page.$eval('#gx-cta-open', (el) => el.href).catch(() => null);
		const agentId = await page.$eval('#gx-cta-fund', (el) => (el.getAttribute('href') || '').split('/')[2]).catch(() => null);
		record.agentId = agentId;

		// Give the viewer time to load the model, then read what it is doing.
		record.viewer = await page
			.waitForFunction(
				() => {
					const mv = document.querySelector('#gx-reveal-viewer model-viewer');
					if (!mv) return { src: null };
					if (!mv.loaded) return false;
					return { src: mv.getAttribute('src'), clips: [...(mv.availableAnimations || [])], playing: !mv.paused, autoplay: mv.hasAttribute('autoplay') };
				},
				null,
				{ timeout: 90_000, polling: 1000 },
			)
			.then((handle) => handle.jsonValue())
			.catch(() => ({ src: null, loadError: 'the reveal viewer never finished loading the model' }));

		if (record.viewer.src) {
			const glb = await context.request.get(new URL(record.viewer.src, ORIGIN).href, { timeout: 60_000 });
			record.glbStatus = glb.status();
			if (glb.ok()) record.skeleton = skeletonReport(glbJson(await glb.body()));
		}

		if (agentId) {
			const agent = await context.request.get(`${ORIGIN}/api/agents/${encodeURIComponent(agentId)}`, { timeout: 20_000 });
			const body = await agent.json().catch(() => ({}));
			const row = body.agent || {};
			record.agent = {
				name: row.name || null,
				solana: row.solana_address || null,
				evm: row.wallet_address || null,
				personaPrompt: row.persona_prompt || row.meta?.persona_prompt || null,
				voice: row.meta?.voice_id || row.meta?.voice_preference || null,
			};
		}
		if (record.voice) {
			const speech = await context.request.post(`${ORIGIN}/api/tts/speak`, {
				data: { text: 'Hello, I just arrived.', voice: record.voice },
				timeout: 60_000,
			});
			const audio = speech.ok() ? await speech.body() : Buffer.alloc(0);
			record.speech = { status: speech.status(), type: speech.headers()['content-type'] || null, bytes: audio.length };
		}
		return record;
	} finally {
		writeFileSync(RECORD, `${JSON.stringify(record, null, '\t')}\n`);
		await browser.close();
	}
}

function loadRecent(mode) {
	const path = recordPath(mode);
	if (!existsSync(path)) return null;
	const record = JSON.parse(readFileSync(path, 'utf8'));
	return Date.now() - Date.parse(record.ranAt) < REUSE_MS ? record : null;
}

function anyRecent() {
	const recent = ['text', 'selfie'].map(loadRecent).filter(Boolean);
	return recent.find((row) => row.outcome === 'reveal') || recent[0] || null;
}

const record = (MODE === 'any' ? anyRecent() : loadRecent(MODE)) || (await runJourney());
const input = record.mode === 'selfie' ? 'a selfie' : 'a sentence';
if (record.outcome !== 'reveal') fail(1, `genesis from ${input} did not finish (${record.seconds}s${record.failedStep ? `, failed at the ${record.failedStep} step` : ''}): ${record.outcome}`);

const isSolana = (value) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value || '');
switch (FACET) {
	case 'body': {
		const s = record.skeleton;
		if (!s) fail(1, `genesis from ${input} revealed an agent but its model could not be read (viewer ${JSON.stringify(record.viewer)}, GLB HTTP ${record.glbStatus ?? 'none'})`);
		if (!s.skins || s.missing.length) fail(1, `genesis from ${input} returned a model that is not rigged for the clip library: ${s.skins} skin(s), ${s.joints} joints, missing ${s.missing.join(', ') || 'nothing'}`);
		console.log(`genesis from ${input} returned a rigged GLB in ${record.seconds}s: ${s.joints} joints, every humanoid bone the clip library drives is present (${record.viewer.src})`);
		break;
	}
	case 'wallet': {
		const solana = record.agent?.solana || record.solana;
		if (!isSolana(solana)) fail(1, `the genesis agent has no Solana address (reveal showed "${record.solana || ''}", agent record ${JSON.stringify(record.agent)})`);
		if (record.solana && record.agent?.solana && record.solana !== record.agent.solana) fail(1, `the reveal shows ${record.solana} but the agent record holds ${record.agent.solana}`);
		console.log(`the genesis agent ${record.agentId} holds custodial Solana wallet ${solana}${record.agent?.evm ? ` and EVM wallet ${record.agent.evm}` : ''}, shown on the reveal`);
		break;
	}
	case 'persona': {
		const prompt = record.agent?.personaPrompt;
		if (!prompt) fail(1, `the persona typed into genesis was not saved on agent ${record.agentId}: ${JSON.stringify(record.agent)}`);
		console.log(`the persona became agent ${record.agentId}'s system prompt: "${prompt.slice(0, 180)}"`);
		break;
	}
	case 'voice': {
		if (!record.voice || record.agent?.voice !== record.voice) fail(1, `the chosen voice "${record.voice}" was not saved on agent ${record.agentId} (it holds ${JSON.stringify(record.agent?.voice)})`);
		if (!record.speech || record.speech.status !== 200 || record.speech.bytes < 1000) fail(1, `voice "${record.voice}" is saved but /api/tts/speak did not speak with it: ${JSON.stringify(record.speech)}`);
		console.log(`agent ${record.agentId} carries voice "${record.voice}", and /api/tts/speak answered ${record.speech.bytes} bytes of ${record.speech.type} in that voice`);
		break;
	}
	case 'animates': {
		const viewer = record.viewer || {};
		if (!viewer.src) fail(1, `the reveal never showed the model: ${viewer.loadError || 'no viewer'}`);
		if (!viewer.clips?.length || !viewer.playing) {
			fail(1, `the reveal shows the model in its bind pose: the viewer has ${viewer.clips?.length || 0} clip(s) (${(viewer.clips || []).join(', ') || 'none'}), autoplay ${viewer.autoplay ? 'on' : 'off'}, ${viewer.playing ? 'playing' : 'paused'}; the GLB carries ${record.skeleton?.animations?.length ?? 'unknown'} animation(s)`);
		}
		console.log(`the reveal plays "${viewer.clips.join(', ')}" on arrival`);
		break;
	}
}
