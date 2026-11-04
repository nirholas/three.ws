// browse-runner.js: claims browse jobs from /api/agent-screen-browse and runs
// each one on its own Chromium page through the observe/decide/act loop
// (tasks/agent-browse.js) under the safety policy (tasks/browse-policy.js).
//
// The page registers in `active` so the pool's control drain treats it like any
// casting agent: when the owner takes the wheel the lease flips `manualUntil`,
// the loop yields within one step, and the page stays open for the owner to
// drive until they let go.

import { runBrowseLoop, brainDecider } from './tasks/agent-browse.js';
import { createBrowsePolicy } from './tasks/browse-policy.js';
import { drainBrainStream } from './task-runner.js';

const OBSERVE_JS = () => {
	document.querySelectorAll('[data-aw-id]').forEach((e) => e.removeAttribute('data-aw-id'));
	const out = [];
	for (const e of document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link]')) {
		const r = e.getBoundingClientRect();
		if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight * 2) continue;
		const st = getComputedStyle(e);
		if (st.visibility === 'hidden' || st.display === 'none') continue;
		const id = out.length;
		e.setAttribute('data-aw-id', String(id));
		const label = (e.getAttribute('aria-label') || e.innerText || e.value || e.getAttribute('placeholder') || e.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
		out.push({
			id, tag: e.tagName.toLowerCase(), type: e.getAttribute('type') || '', name: label,
			field: `${e.getAttribute('name') || ''} ${e.id || ''}`.trim(),
			autocomplete: e.getAttribute('autocomplete') || '', placeholder: e.getAttribute('placeholder') || '',
		});
		if (out.length >= 40) break;
	}
	return out;
};

export function createBrowseRunner({ baseUrl, browseUrl, secret, newPage, egress, pushTaskFrame, log, sleep, maxConcurrent = 2 }) {
	const active = new Map(); // agentId -> entry (also read by the control drain)

	async function api(body) {
		const res = await fetch(browseUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) throw new Error(`browse api ${res.status}`);
		return res.json();
	}

	const isManual = (entry) => !!(entry.manualUntil && entry.manualUntil > Date.now());

	async function observe(page) {
		const elements = await page.evaluate(OBSERVE_JS).catch(() => []);
		let text = await page.locator('body').ariaSnapshot({ timeout: 4000 }).catch(() => '');
		if (!text) text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
		return { url: page.url(), text: text.slice(0, 3000), elements };
	}

	async function act(entry, action, obs) {
		const { page } = entry;
		const target = () => page.locator(`[data-aw-id="${action.id}"]`).first();
		const label = obs.elements.find((e) => e.id === action.id)?.name || '';
		let activity = action.note || '';
		let extracted;
		switch (action.action) {
			case 'click':
				await target().click({ timeout: 5000 });
				await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
				activity ||= `Click: ${label}`;
				break;
			case 'type':
				await target().fill(action.text, { timeout: 5000 });
				if (action.submit) {
					await target().press('Enter');
					await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
				}
				activity ||= `Type into ${label}`;
				break;
			case 'scroll':
				await page.mouse.wheel(0, action.direction === 'up' ? -600 : 600);
				activity ||= `Scroll ${action.direction}`;
				break;
			case 'goto': {
				const v = await egress.checkUrl(action.url);
				if (!v.ok) throw new Error(`egress refused: ${v.reason}`);
				await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
				activity ||= `Open ${new URL(action.url).hostname}`;
				break;
			}
			case 'extract':
				extracted = action.id === null
					? await page.evaluate(() => document.body?.innerText || '')
					: await target().innerText({ timeout: 5000 });
				extracted = extracted.replace(/\s+/g, ' ').trim().slice(0, 600);
				activity ||= 'Read the page';
				break;
			default:
				throw new Error('unsupported action');
		}
		await pushTaskFrame(entry, { activity, type: 'screenshot' });
		return { extracted };
	}

	async function run(job) {
		const entry = { agentId: job.agentId, page: null, name: 'Browse run', timer: null, pushing: false, lastErrorAt: 0, controller: new AbortController() };
		active.set(job.agentId, entry);
		let reportChain = Promise.resolve();
		const report = (payload) => {
			reportChain = reportChain.then(() => api({ op: 'report', jobId: job.id, ...payload })).catch((err) => log('browse report', job.id, err?.message || err));
			return reportChain;
		};
		let outcome = { status: 'error', steps: [], result: null };
		try {
			entry.page = await newPage();
			const policy = createBrowsePolicy({ allowedDomains: job.allowedDomains, maxSteps: job.maxSteps });
			const decide = brainDecider({ baseUrl, drain: drainBrainStream });
			await pushTaskFrame(entry, { activity: `Goal: ${job.goal}`, type: 'activity', shoot: false });
			const v = await egress.checkUrl(job.startUrl);
			if (v.ok) await entry.page.goto(job.startUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch((e) => log('browse start goto', job.id, e?.message || e));
			const stepsSoFar = [];
			outcome = await runBrowseLoop({
				goal: job.goal, startUrl: job.startUrl, policy,
				observe: () => observe(entry.page),
				decide,
				act: (action, obs) => act(entry, action, obs),
				currentUrl: () => entry.page.url(),
				goBack: async () => { await entry.page.goBack({ timeout: 5000 }).catch(() => {}); },
				isManual: () => isManual(entry),
				signal: entry.controller.signal,
				log: (s) => {
					stepsSoFar.push(s);
					log('browse step', job.id, s.n, s.type, s.action || s.reason || '');
					report({ status: 'running', steps: stepsSoFar });
					if (s.type === 'denied') pushTaskFrame(entry, { activity: `Blocked: ${s.reason}`, type: 'activity', shoot: false });
				},
			});
			await pushTaskFrame(entry, { activity: outcome.status === 'done' ? `Done: ${outcome.result}` : `Stopped: ${outcome.reason || outcome.status}`, type: 'analysis' });
		} catch (err) {
			log('browse run failed', job.id, err?.message || err);
			outcome = { ...outcome, status: 'error', reason: String(err?.message || err).slice(0, 160) };
		}
		await report({ status: outcome.status, steps: outcome.steps, result: outcome.result });
		// After a take-over the page stays live for the owner until they release.
		if (outcome.status === 'yielded' && entry.page && !entry.page.isClosed()) {
			const deadline = Date.now() + 10 * 60_000;
			while (Date.now() < deadline && isManual(entry) && !entry.controller.signal.aborted) await sleep(1000);
		}
		active.delete(job.agentId);
		try { await entry.page?.close(); } catch { /* already closed */ }
	}

	async function poll() {
		if (active.size >= maxConcurrent) return;
		try {
			const { job } = await api({ op: 'claim' });
			if (job && !active.has(job.agentId)) run(job).catch((err) => log('browse run crashed', err?.message || err));
		} catch (err) {
			log('browse claim', err?.message || err);
		}
	}

	return { poll, active, isManual };
}
