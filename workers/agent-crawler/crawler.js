// One agent out reading: a browser context of its own, a frontier of leads, and
// a loop that reads a page, chooses a link, walks to it on screen, and leaps.
//
// Every phase is pushed to the API as a live step (api/crawl/[action].js
// action=push) so /crawl can draw the agent's avatar walking across the real
// screenshot to the link it really chose. The page it finished reading rides
// along with the "reading" step and lands in the open corpus.

import { readPage, revealLink, visibleLinks, CONSENT_CSS } from './extract.js';
import {
	Frontier, canonical, gistOf, hostOf, relevance, scoreLink, thoughtFor, topicTerms,
} from './frontier.js';
import { USER_AGENT, claimDomain, domainReadyIn, guardHost, robotsCheck } from './net.js';
import { searchSeeds } from './seeds.js';

export const VIEWPORT = { width: 1200, height: 750 };
const STEP_LINKS = 48;
const MIN_TEXT_FOR_CORPUS = 200;
const FRAME_B64_MAX = 690_000;
const RECYCLE_PAGE_EVERY = 40;

export class NotEnrolledError extends Error {}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export class Crawler {
	constructor({ mission, browser, api, log, opts }) {
		this.agentId = mission.agentId;
		this.name = mission.name;
		this.topic = mission.topic;
		this.seeds = mission.seeds || [];
		this.terms = topicTerms(mission.topic);
		this.browser = browser;
		this.api = api;
		this.opts = opts;
		this.log = (msg) => log(`[${this.name}] ${msg}`);
		this.frontier = new Frontier();
		this.visited = new Set();
		this.domainCounts = new Map();
		this.seq = 0;
		this.stopped = false;
		this.startedAt = Date.now();
		this.pagesRead = mission.pagesRead || 0;
		this.navigations = 0;
		this.currentUrl = null;
		this.status = 'starting';
		this.lastReseedAt = 0;
		this.done = null;
	}

	summary() {
		return {
			agentId: this.agentId, name: this.name, topic: this.topic, status: this.status,
			url: this.currentUrl, frontier: this.frontier.size, visited: this.visited.size,
			pagesRead: this.pagesRead, upMs: Date.now() - this.startedAt,
		};
	}

	updateMission(mission) {
		if (mission.topic !== this.topic) {
			this.topic = mission.topic;
			this.terms = topicTerms(mission.topic);
			this.frontier = new Frontier();
			this.log(`topic changed to "${mission.topic}", starting fresh`);
		}
		this.seeds = mission.seeds || [];
	}

	start() {
		this.done = this.run().catch((err) => {
			if (!(err instanceof NotEnrolledError)) this.log(`stopped on error: ${err?.message || err}`);
		}).finally(() => this.close());
		return this.done;
	}

	async stop() {
		this.stopped = true;
		await this.close();
		await this.done?.catch(() => {});
	}

	async close() {
		const ctx = this.context;
		this.context = null;
		this.page = null;
		if (ctx) await ctx.close().catch(() => {});
	}

	async openContext() {
		this.context = await this.browser.newContext({
			viewport: VIEWPORT,
			deviceScaleFactor: 1,
			userAgent: USER_AGENT,
			locale: 'en-US',
			acceptDownloads: false,
			javaScriptEnabled: true,
			serviceWorkers: 'block',
		});
		await this.context.addInitScript((css) => {
			const add = () => {
				if (document.getElementById('tws-crawl-consent')) return;
				const s = document.createElement('style');
				s.id = 'tws-crawl-consent';
				s.textContent = css;
				(document.head || document.documentElement).appendChild(s);
			};
			if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add, { once: true });
			else add();
		}, CONSENT_CSS);
		// Every request is fenced: private hosts are refused and media streams
		// (which never show in a still frame) are skipped.
		await this.context.route('**/*', async (route) => {
			const req = route.request();
			if (req.resourceType() === 'media') return route.abort('blockedbyclient');
			let host = '';
			try { host = new URL(req.url()).hostname; } catch { return route.abort('blockedbyclient'); }
			if (req.url().startsWith('data:') || req.url().startsWith('blob:')) return route.continue();
			if (!(await guardHost(host))) return route.abort('blockedbyclient');
			return route.continue();
		});
		this.context.on('page', (p) => {
			if (this.page && p !== this.page) p.close().catch(() => {});
		});
		await this.newPage();
	}

	async newPage() {
		if (this.page) await this.page.close().catch(() => {});
		this.page = await this.context.newPage();
		this.page.on('dialog', (d) => d.dismiss().catch(() => {}));
		this.navigations = 0;
	}

	async run() {
		await this.openContext();
		await this.loadHistory();
		await this.seed();

		// A walked-to link is visited straight away (the avatar is standing on
		// it); otherwise the frontier picks the next lead.
		let following = null;
		while (!this.stopped) {
			const next = following || this.pickNext();
			following = null;
			if (!next) {
				await this.reseedOrRest();
				continue;
			}
			following = await this.visit(next);
		}
	}

	// Pages this agent already read survive restarts: the corpus is the memory.
	async loadHistory() {
		try {
			const pages = await this.api.recentPages(this.agentId, 500);
			for (const p of pages) {
				const key = canonical(p.url);
				if (key) this.visited.add(key);
				const h = hostOf(p.url);
				this.domainCounts.set(h, Math.min(10, (this.domainCounts.get(h) || 0) + 1));
			}
		} catch (err) {
			this.log(`history unavailable (${err?.message || err}); starting with a clean slate`);
		}
	}

	async seed() {
		for (const url of this.seeds) this.frontier.add(url, 50, null, 'start page');
		if (!this.frontier.size) await this.searchForLeads();
	}

	async searchForLeads() {
		this.lastReseedAt = Date.now();
		const { urls, source } = await searchSeeds(this.topic, this.log);
		urls.forEach((u, i) => this.frontier.add(u, 20 - i * 0.5, null, ''));
		if (urls.length) this.log(`${urls.length} leads from ${source}`);
		return urls.length;
	}

	async reseedOrRest() {
		const sinceReseed = Date.now() - this.lastReseedAt;
		if (sinceReseed > 120_000) {
			for (const url of this.seeds) if (!this.visited.has(canonical(url))) this.frontier.add(url, 50);
			if (this.frontier.size || (await this.searchForLeads())) return;
		}
		this.status = 'resting';
		await this.pushStep({
			url: this.currentUrl, title: '', status: 'resting', links: [], target: null,
			thought: thoughtFor('resting', { reason: `Out of fresh leads on ${this.topic}. Searching again shortly.` }),
		});
		await this.idle(60_000);
	}

	async idle(ms) {
		const until = Date.now() + ms;
		while (!this.stopped && Date.now() < until) await sleep(Math.min(1000, until - Date.now()));
	}

	pickNext() {
		const accept = (item) => {
			if (this.visited.has(item.url)) return false;
			return domainReadyIn(hostOf(item.url)) <= 2500;
		};
		let item = this.frontier.pop(accept);
		if (!item && this.frontier.size) {
			// Everything left is on a cooling domain: take the best one; visit()
			// waits out its politeness gap before navigating.
			item = this.frontier.pop((i) => !this.visited.has(i.url));
		}
		return item;
	}

	async pushStep(step, extra = {}) {
		this.seq += 1;
		return this.api.push({ agentId: this.agentId, step: { ...step, seq: this.seq }, ...extra });
	}

	async screenshot() {
		let quality = this.opts.jpegQuality;
		for (let attempt = 0; attempt < 3; attempt++) {
			const buf = await this.page.screenshot({ type: 'jpeg', quality, timeout: 8000, animations: 'disabled', caret: 'hide' });
			const b64 = buf.toString('base64');
			if (b64.length <= FRAME_B64_MAX) return b64;
			quality = Math.max(25, quality - 15);
		}
		return null;
	}

	async blocked(host, reason) {
		this.status = 'blocked';
		await this.pushStep({
			url: this.currentUrl, title: '', status: 'blocked', links: [], target: null,
			thought: thoughtFor('blocked', { host, reason }),
		}).catch((err) => { if (err instanceof NotEnrolledError) throw err; });
	}

	// Read one page, then decide where to go. Returns the frontier entry to visit
	// next when the agent chose an on-screen link (it already walked there), or
	// null to let the frontier decide.
	async visit(target) {
		const url = canonical(target.url);
		if (!url) return null;
		const host = hostOf(url);
		this.visited.add(url);

		const robots = await robotsCheck(url).catch(() => ({ allowed: false, delayMs: 0 }));
		if (!robots.allowed) {
			await this.blocked(host, 'asks crawlers to stay out of that page');
			return null;
		}
		const wait = domainReadyIn(host);
		if (wait > 0) await sleep(wait);
		claimDomain(host, Math.max(this.opts.domainGapMs, robots.delayMs));

		if (this.navigations >= RECYCLE_PAGE_EVERY) await this.newPage();
		this.navigations += 1;

		let resp;
		try {
			resp = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.opts.navTimeoutMs });
		} catch (err) {
			const msg = String(err?.message || err);
			await this.blocked(host, /ERR_BLOCKED_BY_CLIENT/.test(msg) ? 'is not a public address' : 'did not answer in time');
			if (/Target closed|crashed/i.test(msg)) await this.newPage();
			return null;
		}
		if (!resp || resp.status() >= 400) {
			await this.blocked(host, `answered ${resp ? resp.status() : 'nothing'}`);
			return null;
		}
		const ctype = resp.headers()['content-type'] || '';
		if (ctype && !/html|xhtml/i.test(ctype)) {
			await this.blocked(host, 'sent a file, not a page');
			return null;
		}
		// Let the page paint its above-the-fold content before the frame is taken.
		await this.page.waitForLoadState('load', { timeout: 6000 }).catch(() => {});

		const finalUrl = canonical(this.page.url()) || url;
		this.visited.add(finalUrl);
		const finalHost = hostOf(finalUrl);
		this.domainCounts.set(finalHost, (this.domainCounts.get(finalHost) || 0) + 1);
		this.currentUrl = finalUrl;

		const data = await this.page.evaluate(readPage, 600);
		const rel = relevance(this.terms, data.title, data.text);
		const gist = gistOf(data.text, this.terms);

		// Score every link on the page into the frontier. Links found on a
		// relevant page inherit some of its relevance (topical locality).
		const ctx = { terms: this.terms, fromHost: finalHost, domainCounts: this.domainCounts, visited: this.visited, rand: Math.random };
		let best = null;
		for (const link of data.links) {
			const s = scoreLink(link, ctx);
			if (!Number.isFinite(s)) continue;
			const score = s + rel * 1.5;
			this.frontier.add(link.href, score, finalUrl, link.text);
			if (!best || score > best.score) best = { ...link, score };
		}
		this.frontier.decay();

		const frame = await this.screenshot();
		const shown = data.links.filter((l) => l.visible).slice(0, STEP_LINKS).map(({ x, y, w, h, text }) => ({ x, y, w, h, t: text }));
		const page = data.text.length >= MIN_TEXT_FOR_CORPUS ? {
			url: finalUrl, title: data.title, text: data.text, gist, linksOut: data.links.length, relevance: rel, fromUrl: target.from,
		} : null;

		this.status = 'reading';
		const res = await this.pushStep({
			url: finalUrl, title: data.title, status: 'reading', links: shown, target: null, scrollY: data.scrollY,
			thought: thoughtFor('reading', { title: data.title || finalHost, domain: finalHost, topic: this.topic, relevance: rel }),
		}, { frame, page });
		if (res?.recorded) this.pagesRead = res.pagesRead || this.pagesRead + 1;

		// Read: dwell on the page roughly in proportion to how much there is.
		await this.idle(this.opts.readMs + Math.min(3000, data.text.length / 20));
		if (this.stopped) return null;

		const frontierBest = [...this.frontier.items.values()]
			.filter((i) => !this.visited.has(i.url) && i.url !== canonical(best?.href))
			.reduce((m, i) => (!m || i.score > m.score ? i : m), null);
		if (best && (!frontierBest || best.score >= frontierBest.score - 0.5)) {
			const walked = await this.walkTo(best, finalUrl, finalHost);
			if (walked) return walked;
		}

		// Leap: the best lead is not on this screen.
		const lead = frontierBest;
		if (lead) {
			this.status = 'leaping';
			await this.pushStep({
				url: finalUrl, title: data.title, status: 'leaping', links: [], target: null,
				thought: thoughtFor('leaping', { text: lead.text, host: hostOf(lead.url) }),
			});
			await this.idle(this.opts.leapMs);
		}
		return null;
	}

	// Bring the chosen link on screen, push the walking step with its rect as the
	// target, give the avatar time to walk there, then hop.
	async walkTo(link, pageUrl, pageHost) {
		const ok = await this.page.evaluate(revealLink, link.i).catch(() => false);
		if (!ok) return null;
		const measured = await this.page.evaluate(visibleLinks, 400).catch(() => null);
		if (!measured) return null;
		let list = measured.links;
		let idx = list.findIndex((l) => l.i === link.i);
		if (idx < 0) return null;
		if (list.length > STEP_LINKS) {
			const tgt = list[idx];
			list = [tgt, ...list.filter((l) => l !== tgt).slice(0, STEP_LINKS - 1)];
			idx = 0;
		}
		const frame = link.visible ? null : await this.screenshot();
		const host = hostOf(link.href);
		this.status = 'walking';
		await this.pushStep({
			url: pageUrl, title: '', status: 'walking', scrollY: measured.scrollY,
			links: list.map(({ x, y, w, h, t }) => ({ x, y, w, h, t })), target: idx, nextUrl: link.href,
			thought: thoughtFor('walking', { text: link.text, host, offsite: host !== pageHost }),
		}, frame ? { frame } : {});
		await this.idle(this.opts.walkMs);
		if (this.stopped) return null;
		await this.pushStep({
			url: pageUrl, title: '', status: 'leaping', scrollY: measured.scrollY,
			links: list.map(({ x, y, w, h, t }) => ({ x, y, w, h, t })), target: idx, nextUrl: link.href,
			thought: thoughtFor('walking', { text: link.text, host, offsite: host !== pageHost }),
		});
		await this.idle(this.opts.leapMs);
		this.frontier.drop(link.href);
		return { url: link.href, score: link.score, from: pageUrl, text: link.text };
	}
}
