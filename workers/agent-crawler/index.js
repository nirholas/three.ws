// agent-crawler: three.ws agents reading the open web in real browsers.
//
// The worker behind /crawl. It polls the roster of agents whose owners sent them
// out (GET /api/crawl/roster), keeps up to CRAWLERS of them walking at once (one
// shared Chromium, one isolated context per agent), and pushes every step and
// every finished page back through POST /api/crawl/push. The API fans steps out
// to viewers live and files pages into the open corpus. Doc: docs/crawl.md.
//
// When more agents are enrolled than there are slots, each walks a shift of
// SHIFT_MS and then yields to the agent that has waited longest (the roster is
// ordered by last read, oldest first), so every enrolled agent gets its turn.
//
// Required env:
//   CRAWL_WORKER_SECRET   shared secret; must match the API's value.
// Optional env:
//   BASE_URL=https://three.ws   CRAWLERS=8   SHIFT_MS=1200000   ROSTER_MS=30000
//   READ_MS=3500  WALK_MS=3200  LEAP_MS=900  DOMAIN_GAP_MS=4000  NAV_TIMEOUT_MS=20000
//   JPEG_QUALITY=55
//   PORT   when set, bind the liveness endpoint (Cloud Run sets it).

import http from 'node:http';
import { chromium } from 'playwright';
import { Crawler, NotEnrolledError } from './crawler.js';

const BASE_URL = (process.env.BASE_URL || 'https://three.ws').replace(/\/$/, '');
const SECRET = process.env.CRAWL_WORKER_SECRET || '';
const CRAWLERS = Math.max(1, Number(process.env.CRAWLERS || 8));
const SHIFT_MS = Number(process.env.SHIFT_MS || 20 * 60_000);
const ROSTER_MS = Number(process.env.ROSTER_MS || 30_000);
const OPTS = {
	readMs: Number(process.env.READ_MS || 3500),
	walkMs: Number(process.env.WALK_MS || 3200),
	leapMs: Number(process.env.LEAP_MS || 900),
	domainGapMs: Number(process.env.DOMAIN_GAP_MS || 4000),
	navTimeoutMs: Number(process.env.NAV_TIMEOUT_MS || 20_000),
	jpegQuality: Number(process.env.JPEG_QUALITY || 55),
};

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

if (SECRET.length < 16) {
	console.error('CRAWL_WORKER_SECRET is missing or shorter than 16 characters; the API would refuse every call.');
	process.exit(1);
}

// ── API client ──────────────────────────────────────────────────────────────
const api = {
	async roster(limit) {
		const res = await fetch(`${BASE_URL}/api/crawl/roster?limit=${limit}`, {
			headers: { authorization: `Bearer ${SECRET}` },
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) throw new Error(`roster ${res.status}`);
		return (await res.json()).crawlers || [];
	},

	async recentPages(agentId, limit) {
		const res = await fetch(`${BASE_URL}/api/crawl/pages?agent=${agentId}&limit=${limit}`, {
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) throw new Error(`pages ${res.status}`);
		return (await res.json()).pages || [];
	},

	// One retry on a network blip or 5xx; a 410 means the owner called the agent
	// home, which ends that crawler. Anything else is logged and the walk goes on.
	async push(body) {
		const payload = JSON.stringify(body);
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const res = await fetch(`${BASE_URL}/api/crawl/push`, {
					method: 'POST',
					headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
					body: payload,
					signal: AbortSignal.timeout(20_000),
				});
				if (res.status === 410) throw new NotEnrolledError('mission ended');
				if (res.ok) return await res.json();
				if (res.status < 500) {
					log(`push rejected ${res.status}: ${(await res.text()).slice(0, 200)}`);
					return null;
				}
			} catch (err) {
				if (err instanceof NotEnrolledError) throw err;
				if (attempt) log(`push failed: ${err?.message || err}`);
			}
			await new Promise((r) => { setTimeout(r, 1500); });
		}
		return null;
	},
};

// ── browser ─────────────────────────────────────────────────────────────────
let browser = null;

async function ensureBrowser() {
	if (browser?.isConnected()) return browser;
	browser = await chromium.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--mute-audio'],
	});
	browser.on('disconnected', () => {
		log('chromium disconnected; crawlers will restart on the next roster tick');
		for (const c of running.values()) c.stopped = true;
		running.clear();
	});
	log('chromium launched');
	return browser;
}

// ── orchestration ───────────────────────────────────────────────────────────
const running = new Map(); // agentId -> Crawler
let lastRosterError = null;
let lastRosterAt = 0;

function startCrawler(mission) {
	const crawler = new Crawler({ mission, browser, api, log, opts: OPTS });
	running.set(mission.agentId, crawler);
	log(`out reading: ${mission.name} on "${mission.topic}"`);
	crawler.start().finally(() => {
		if (running.get(mission.agentId) === crawler) running.delete(mission.agentId);
	});
}

async function tick() {
	let roster;
	try {
		roster = await api.roster(Math.max(CRAWLERS * 3, 24));
		lastRosterError = null;
		lastRosterAt = Date.now();
	} catch (err) {
		lastRosterError = err?.message || String(err);
		log(`roster unavailable: ${lastRosterError}`);
		return;
	}
	const enrolled = new Map(roster.map((m) => [m.agentId, m]));

	// Called home, or the topic changed.
	for (const [id, c] of running) {
		const m = enrolled.get(id);
		if (!m) {
			log(`called home: ${c.name}`);
			running.delete(id);
			c.stop();
		} else {
			c.updateMission(m);
		}
	}

	const waiting = roster.filter((m) => !running.has(m.agentId));
	// Shift change: if someone is waiting, the longest-running crawler past its
	// shift steps aside.
	if (waiting.length && running.size >= CRAWLERS) {
		const overdue = [...running.values()]
			.filter((c) => Date.now() - c.startedAt > SHIFT_MS)
			.sort((a, b) => a.startedAt - b.startedAt);
		for (const c of overdue.slice(0, waiting.length)) {
			log(`shift over: ${c.name}`);
			running.delete(c.agentId);
			c.stop();
		}
	}

	if (!waiting.length || running.size >= CRAWLERS) return;
	await ensureBrowser();
	for (const m of waiting) {
		if (running.size >= CRAWLERS) break;
		startCrawler(m);
	}
}

async function loop() {
	for (;;) {
		await tick().catch((err) => log(`tick failed: ${err?.stack || err}`));
		await new Promise((r) => { setTimeout(r, ROSTER_MS); });
	}
}

// ── liveness ────────────────────────────────────────────────────────────────
if (process.env.PORT) {
	http.createServer((req, res) => {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({
			ok: true,
			crawlers: [...running.values()].map((c) => c.summary()),
			slots: CRAWLERS,
			browser: Boolean(browser?.isConnected()),
			lastRosterAt,
			lastRosterError,
		}));
	}).listen(Number(process.env.PORT), () => log(`liveness on :${process.env.PORT}`));
}

async function shutdown(signal) {
	log(`${signal}: calling every crawler home`);
	await Promise.allSettled([...running.values()].map((c) => c.stop()));
	await browser?.close().catch(() => {});
	process.exit(0);
}
process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });

log(`agent-crawler: ${CRAWLERS} slots against ${BASE_URL}`);
loop();
