// Natural-language schedules and the local cron scheduler.
//
// parseSchedule turns "every weekday 9am" into a 5-field cron expression with
// a small deterministic phrase grammar, then validates it with cron-parser and
// describes it with cronstrue. Anything the grammar cannot read is refused
// with the list of accepted forms; a raw 5-field cron expression always works.
//
// A schedule runs in one of two modes:
//   local   this machine's scheduler loop (`three-ws-agent cron run`, or the
//           TUI while it is open) claims due jobs atomically in the shared
//           SQLite file, so two processes never fire the same job twice.
//   server  a three.ws automation (POST /api/v1/automations, trigger
//           `schedule`, action `agent_prompt`) runs it on the platform while
//           this machine is off. Server schedules are evaluated in UTC and may
//           fire at most once every 5 minutes, the same rules the API enforces.

import { CronExpressionParser } from 'cron-parser';
import cronstrue from 'cronstrue';

export const ACCEPTED_FORMS = Object.freeze([
	'every minute',
	'every 15 minutes',
	'every hour  |  hourly  |  every 2 hours',
	'every day at 9am  |  daily at 18:30  |  every day at noon',
	'every weekday 9am  |  every weekend at 10:00',
	'every monday at 8am  |  every mon, wed and fri at 7:30pm',
	'every month on the 1st at 9am  |  monthly',
	'at 9am and 5pm every weekday',
	'append "utc" to read the time in UTC, e.g. "every day at 13:00 utc"',
	'or a raw 5-field cron expression, e.g. "0 9 * * 1-5"',
]);

export class ScheduleError extends Error {
	constructor(message) {
		super(message);
		this.name = 'ScheduleError';
		this.code = 'invalid_schedule';
	}
}

const DAY_NAMES = {
	sun: 0, sunday: 0, sundays: 0,
	mon: 1, monday: 1, mondays: 1,
	tue: 2, tues: 2, tuesday: 2, tuesdays: 2,
	wed: 3, weds: 3, wednesday: 3, wednesdays: 3,
	thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4,
	fri: 5, friday: 5, fridays: 5,
	sat: 6, saturday: 6, saturdays: 6,
};

/** The machine's IANA zone, UTC when the runtime cannot tell. */
export function localTimeZone() {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}

function refuse(text, why) {
	return new ScheduleError(`Could not read the schedule "${text}"${why ? ` (${why})` : ''}. Accepted forms:\n  ${ACCEPTED_FORMS.join('\n  ')}`);
}

/** "9am", "9:30 pm", "21:00", "noon", "midnight" → { h, m } or null. */
export function parseTime(token) {
	const t = String(token).trim();
	if (t === 'noon') return { h: 12, m: 0 };
	if (t === 'midnight') return { h: 0, m: 0 };
	const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
	if (!m) return null;
	let h = Number(m[1]);
	const min = m[2] == null ? 0 : Number(m[2]);
	const suffix = m[3]?.replace(/\./g, '');
	if (min > 59) return null;
	if (suffix) {
		if (h < 1 || h > 12) return null;
		if (suffix === 'am') h = h === 12 ? 0 : h;
		else h = h === 12 ? 12 : h + 12;
	} else if (m[2] == null) {
		// A bare number is not a time ("9" alone could be a day or an hour).
		return null;
	}
	if (h > 23) return null;
	return { h, m: min };
}

const ONE_TIME = '(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?|noon|midnight)';
const TIME_LIST = `${ONE_TIME}(?:\\s*(?:,|and|&)\\s*${ONE_TIME})*`;
const TRAILING_TIME = new RegExp(`(?:^|\\s)(?:at\\s+)?(${TIME_LIST})$`);
const LEADING_TIME = new RegExp(`^at\\s+(${TIME_LIST})\\s+(.+)$`);

function readTimes(list) {
	const times = list.split(/\s*(?:,|\band\b|&)\s*/).filter(Boolean).map(parseTime);
	return times.every(Boolean) ? times : null;
}

/** Split a phrase into its day part and its time list. */
function extractTimes(phrase) {
	const lead = phrase.match(LEADING_TIME);
	if (lead) {
		const times = readTimes(lead[1]);
		if (times) return { rest: lead[2].trim(), times };
	}
	const tail = phrase.match(TRAILING_TIME);
	if (tail) {
		const times = readTimes(tail[1]);
		// "every 15 minutes" ends in a number too; only accept a real time.
		if (times) return { rest: phrase.slice(0, tail.index).trim(), times };
	}
	return { rest: phrase, times: [] };
}

function timeFields(times, text) {
	if (!times.length) return { minute: '0', hour: '0' };
	const minutes = new Set(times.map((t) => t.m));
	if (minutes.size > 1) throw refuse(text, 'several times in one schedule must share the same minute, e.g. "at 9am and 5pm"');
	const hours = [...new Set(times.map((t) => t.h))].sort((a, b) => a - b);
	return { minute: String(times[0].m), hour: hours.join(',') };
}

function dayList(words, text) {
	const days = [];
	for (const w of words.split(/\s*(?:,|\band\b|&|\s)\s*/).filter(Boolean)) {
		if (!(w in DAY_NAMES)) throw refuse(text, `"${w}" is not a day of the week`);
		days.push(DAY_NAMES[w]);
	}
	return [...new Set(days)].sort((a, b) => a - b).join(',');
}

function ordinalDay(token) {
	const m = String(token).match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
	if (!m) return null;
	const n = Number(m[1]);
	return n >= 1 && n <= 31 ? n : null;
}

/** The phrase grammar, with the time already removed. Returns the cron or null. */
function phraseToCron(rest, times, text) {
	const { minute, hour } = timeFields(times, text);
	const interval = (cron) => {
		if (times.length) throw refuse(text, 'an interval schedule cannot also take a time of day');
		return cron;
	};

	let m;
	if (/^every\s+minute$/.test(rest)) return interval('* * * * *');
	if ((m = rest.match(/^every\s+(\d{1,2})\s+min(?:ute)?s?$/))) {
		const n = Number(m[1]);
		if (n < 1 || n > 59) throw refuse(text, 'minutes must be between 1 and 59');
		return interval(n === 1 ? '* * * * *' : `*/${n} * * * *`);
	}
	if (/^(?:every\s+hour|hourly)$/.test(rest)) return interval('0 * * * *');
	if ((m = rest.match(/^every\s+(\d{1,2})\s+hours?$/))) {
		const n = Number(m[1]);
		if (n < 1 || n > 23) throw refuse(text, 'hours must be between 1 and 23');
		return interval(n === 1 ? '0 * * * *' : `0 */${n} * * *`);
	}
	if (/^(?:every\s+day|daily|each\s+day)$/.test(rest) || (rest === '' && times.length)) return `${minute} ${hour} * * *`;
	if (/^(?:every\s+|on\s+)?weekdays?$/.test(rest) || /^(?:every\s+)?mon(?:day)?\s*(?:-|to|through|thru)\s*fri(?:day)?$/.test(rest)) return `${minute} ${hour} * * 1-5`;
	if (/^(?:every\s+|on\s+)?weekends?$/.test(rest)) return `${minute} ${hour} * * 0,6`;
	if (/^(?:weekly|every\s+week)$/.test(rest)) return `${minute} ${hour} * * 0`;
	if (/^(?:monthly|every\s+month)$/.test(rest)) return `${minute} ${hour} 1 * *`;
	if ((m = rest.match(/^(?:every\s+month\s+)?on\s+the\s+(\w+)(?:\s+of\s+(?:every|each|the)\s+month)?$/))) {
		const d = ordinalDay(m[1]);
		if (!d) throw refuse(text, `"${m[1]}" is not a day of the month`);
		return `${minute} ${hour} ${d} * *`;
	}
	if ((m = rest.match(/^(?:every|on|each)\s+(.+)$/))) return `${minute} ${hour} * * ${dayList(m[1], text)}`;
	return null;
}

const CRON_FIELD = /^[\d*,/\-A-Za-z?LW#]+$/;

function looksLikeCron(text) {
	const f = text.trim().split(/\s+/);
	return f.length === 5 && f.every((x) => CRON_FIELD.test(x)) && f.some((x) => /[\d*]/.test(x));
}

/** Validate a cron expression in a zone; returns the next fire time. Throws ScheduleError. */
export function nextRun(cron, tz, from = new Date()) {
	try {
		return CronExpressionParser.parse(cron, { currentDate: from, tz }).next().toDate();
	} catch (err) {
		throw new ScheduleError(`"${cron}" is not a valid cron expression: ${err.message}`);
	}
}

export function describeCron(cron, tz) {
	let text;
	try {
		text = cronstrue.toString(cron, { use24HourTimeFormat: false });
	} catch {
		text = cron;
	}
	return tz ? `${text} (${tz})` : text;
}

/**
 * Parse a schedule phrase.
 * @param {string} input
 * @param {{ tz?: string, now?: Date }} [opts]
 * @returns {{ text: string, cron: string, tz: string, description: string, next: string }}
 */
export function parseSchedule(input, { tz = localTimeZone(), now = new Date() } = {}) {
	const text = String(input || '').trim();
	if (!text) throw refuse(text, 'it is empty');
	let phrase = text.replace(/\s+/g, ' ').replace(/[.!]+$/, '');
	let zone = tz;
	const utc = phrase.match(/\s+(?:in\s+)?(?:utc|gmt)$/i);
	if (utc) {
		zone = 'UTC';
		phrase = phrase.slice(0, utc.index).trim();
	}

	let cron;
	if (looksLikeCron(phrase)) {
		cron = phrase;
	} else {
		const { rest, times } = extractTimes(phrase.toLowerCase());
		cron = phraseToCron(rest.replace(/^run\s+/, '').trim(), times, text);
		if (!cron) throw refuse(text);
	}
	const next = nextRun(cron, zone, now);
	return { text, cron, tz: zone, description: describeCron(cron, zone), next: next.toISOString() };
}

/** Smallest gap between consecutive fires in ms, sampled over the next few fires. */
export function minGapMs(cron, tz = 'UTC', from = new Date()) {
	const it = CronExpressionParser.parse(cron, { currentDate: from, tz });
	let prev = it.next().toDate().getTime();
	let min = Infinity;
	for (let i = 0; i < 6; i++) {
		const t = it.next().toDate().getTime();
		min = Math.min(min, t - prev);
		prev = t;
	}
	return min;
}

/** Offset of `tz` from UTC in minutes at `at` (positive east of Greenwich). */
export function zoneOffsetMinutes(tz, at = new Date()) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
			.formatToParts(at)
			.map((p) => [p.type, p.value]),
	);
	const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
	return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

function shiftDow(field, delta) {
	if (field === '*' || delta === 0) return field;
	const shift = (d) => ((((Number(d) % 7) + delta) % 7) + 7) % 7;
	const out = [];
	for (const part of field.split(',')) {
		const range = part.match(/^(\d)-(\d)$/);
		if (range) for (let d = Number(range[1]); d <= Number(range[2]); d++) out.push(shift(d));
		else if (/^\d$/.test(part)) out.push(shift(part));
		else return null;
	}
	return [...new Set(out)].sort((a, b) => a - b).join(',');
}

/**
 * Re-express a cron written in `tz` as the equivalent UTC cron, which is how
 * server automations are evaluated. Fixed-time schedules shift their hours
 * (and weekdays across midnight); hourly and minute intervals survive any
 * whole-hour zone. Anything that cannot be moved exactly is refused with the
 * fix, rather than silently changing when it fires.
 */
export function toUtcCron(cron, tz, at = new Date()) {
	if (!tz || tz === 'UTC' || tz === 'Etc/UTC') return cron;
	const offset = zoneOffsetMinutes(tz, at);
	if (offset === 0) return cron;
	const [min, hour, dom, mon, dow] = cron.split(/\s+/);
	const fail = () =>
		new ScheduleError(`"${cron}" in ${tz} cannot be moved to UTC exactly for server mode. Write the schedule in UTC instead (add "utc", e.g. "every day at 13:00 utc").`);
	if (hour === '*') {
		if (offset % 60 !== 0) throw fail();
		return cron;
	}
	const step = hour.match(/^\*\/(\d+)$/);
	if (step) {
		const n = Number(step[1]);
		if (offset % 60 === 0 && 24 % n === 0 && (offset / 60) % n === 0) return cron;
		throw fail();
	}
	if (!/^\d+$/.test(min) || !/^\d+(,\d+)*$/.test(hour)) throw fail();
	const shifted = hour.split(',').map((h) => {
		const total = Number(h) * 60 + Number(min) - offset;
		return { day: Math.floor(total / 1440), h: Math.floor((((total % 1440) + 1440) % 1440) / 60), m: ((total % 60) + 60) % 60 };
	});
	if (new Set(shifted.map((s) => s.day)).size > 1 || new Set(shifted.map((s) => s.m)).size > 1) throw fail();
	const dayDelta = shifted[0].day;
	if (dayDelta !== 0 && dom !== '*') throw fail();
	const newDow = shiftDow(dow, dayDelta);
	if (newDow == null) throw fail();
	return [String(shifted[0].m), [...new Set(shifted.map((s) => s.h))].sort((a, b) => a - b).join(','), dom, mon, newDow].join(' ');
}

export const SERVER_MIN_GAP_MS = 5 * 60 * 1000;

function automationTitle(prompt) {
	return `three-ws-agent: ${String(prompt).replace(/\s+/g, ' ').slice(0, 60)}`;
}

async function createServerAutomation({ platform, agentId, cron, tz, prompt }) {
	if (!platform) throw new ScheduleError('Server mode needs a three.ws sign-in. Run `three-ws-agent login` first.');
	if (!agentId) throw new ScheduleError('Server mode runs the prompt as one of your three.ws agents. Pick one with `/agent <id>` (or pass --agent), then try again.');
	const utc = toUtcCron(cron, tz);
	if (minGapMs(utc) < SERVER_MIN_GAP_MS) {
		throw new ScheduleError('Server schedules may fire at most once every 5 minutes. Use "every 5 minutes" or slower, or keep this one in local mode.');
	}
	const automation = await platform.createScheduleAutomation({ agentId, title: automationTitle(prompt), cron: utc, prompt });
	return { automation, utc };
}

/**
 * Create a schedule.
 * @param {object} o
 * @param {ReturnType<import('./store.js').openStore>} o.store
 * @param {string} o.when      phrase or cron
 * @param {string} o.prompt
 * @param {'local'|'server'} [o.mode]
 * @param {object} [o.platform] createPlatform(...) for server mode
 */
export async function addSchedule({ store, when, prompt, mode = 'local', platform = null, agentId = null, cwd = null, tz, now = new Date() }) {
	const text = String(prompt || '').trim();
	if (!text) throw new ScheduleError('A schedule needs a prompt: /cron "every weekday 9am" "post the portfolio summary".');
	if (!['local', 'server'].includes(mode)) throw new ScheduleError(`mode must be local or server, not "${mode}"`);
	const parsed = parseSchedule(when, { tz, now });
	if (mode === 'server') {
		const { automation, utc } = await createServerAutomation({ platform, agentId, cron: parsed.cron, tz: parsed.tz, prompt: text });
		return store.addCron({
			scheduleText: parsed.text,
			cron: utc,
			tz: 'UTC',
			description: describeCron(utc, 'UTC'),
			prompt: text,
			mode: 'server',
			serverAutomationId: automation.id,
			agentId,
			cwd,
			nextRunAt: null,
		});
	}
	return store.addCron({
		scheduleText: parsed.text,
		cron: parsed.cron,
		tz: parsed.tz,
		description: parsed.description,
		prompt: text,
		mode: 'local',
		agentId,
		cwd,
		nextRunAt: parsed.next,
	});
}

/** Switch a schedule between local and server, creating or deleting the remote automation. */
export async function setScheduleMode({ store, id, mode, platform = null, agentId = null, tz, now = new Date() }) {
	const cron = store.getCron(id);
	if (!cron) throw new ScheduleError(`No schedule with id ${id}. List them with /cron.`);
	if (!['local', 'server'].includes(mode)) throw new ScheduleError(`mode must be local or server, not "${mode}"`);
	if (cron.mode === mode) return cron;
	if (mode === 'server') {
		const owner = cron.agent_id || agentId;
		const { automation, utc } = await createServerAutomation({ platform, agentId: owner, cron: cron.cron, tz: cron.tz, prompt: cron.prompt });
		store.setCronSchedule(id, { cron: utc, tz: 'UTC', description: describeCron(utc, 'UTC'), agentId: owner });
		store.setCronMode(id, 'server', automation.id, null);
		return store.getCron(id);
	}
	if (cron.server_automation_id) {
		if (!platform) throw new ScheduleError('Switching back to local deletes the server automation, which needs a three.ws sign-in.');
		await platform.deleteAutomation(cron.server_automation_id).catch((err) => {
			if (err?.status !== 404) throw err;
		});
	}
	// Re-read the original phrase in this machine's zone, so "every day at 9am" means 9am here again.
	let parsed;
	try {
		parsed = parseSchedule(cron.schedule_text, { tz, now });
	} catch {
		parsed = { cron: cron.cron, tz: cron.tz, description: cron.description, next: nextRun(cron.cron, cron.tz, now).toISOString() };
	}
	store.setCronSchedule(id, { cron: parsed.cron, tz: parsed.tz, description: parsed.description, agentId: cron.agent_id });
	store.setCronMode(id, 'local', null, parsed.next);
	return store.getCron(id);
}

/** Delete a schedule (and its server automation when it has one). */
export async function removeSchedule({ store, id, platform = null }) {
	const cron = store.getCron(id);
	if (!cron) throw new ScheduleError(`No schedule with id ${id}. List them with /cron.`);
	if (cron.server_automation_id) {
		if (!platform) throw new ScheduleError('This schedule runs on the server; deleting it needs a three.ws sign-in.');
		await platform.deleteAutomation(cron.server_automation_id).catch((err) => {
			if (err?.status !== 404) throw err;
		});
	}
	store.deleteCron(id);
	return cron;
}

/**
 * Fire every due local schedule once. Each job is claimed atomically and the
 * claim re-checks that it is still due, so any number of schedulers on one
 * database file fire it exactly once.
 *
 * @param {object} o
 * @param {object} o.store
 * @param {(cron: object) => Promise<{ runId?: string, status: string, error?: string }>} o.runPrompt
 * @param {boolean} [o.catchUp]   run a job missed while the machine was off (once), else skip to the next slot
 */
export async function runDue({ store, runPrompt, now = new Date(), catchUp = true, onEvent }) {
	const fired = [];
	for (const c of store.listCrons()) {
		if (c.mode !== 'local' || !c.enabled) continue;
		if (!c.next_run_at) {
			store.setCronNext(c.id, nextRun(c.cron, c.tz, now).toISOString());
			continue;
		}
		if (Date.parse(c.next_run_at) > now.getTime()) continue;
		if (!store.claimCron(c.id, undefined, now.toISOString())) continue;
		const missedBy = now.getTime() - Date.parse(c.next_run_at);
		const next = nextRun(c.cron, c.tz, now).toISOString();
		if (!catchUp && missedBy > 90_000) {
			store.finishCron(c.id, { lastRunAt: c.last_run_at, nextRunAt: next, status: 'skipped', runId: null });
			onEvent?.({ kind: 'cron_skipped', id: c.id, missedBy });
			continue;
		}
		onEvent?.({ kind: 'cron_start', id: c.id, prompt: c.prompt });
		let out;
		try {
			out = await runPrompt(c);
		} catch (err) {
			out = { status: 'error', error: String(err?.message || err) };
		}
		store.finishCron(c.id, { lastRunAt: now.toISOString(), nextRunAt: next, status: out?.status || 'done', runId: out?.runId || null });
		onEvent?.({ kind: 'cron_end', id: c.id, status: out?.status || 'done', runId: out?.runId || null, error: out?.error || null });
		fired.push({ id: c.id, ...out });
	}
	return fired;
}

/**
 * Poll the store and fire due schedules until stopped.
 * @returns {{ stop: () => Promise<void>, tick: () => Promise<object[]> }}
 */
export function startScheduler({ store, runPrompt, intervalMs = 15_000, catchUp = true, onEvent, clock = () => new Date() }) {
	let stopped = false;
	let running = null;
	let timer = null;
	const tick = () => {
		if (running) return running;
		running = runDue({ store, runPrompt, now: clock(), catchUp, onEvent })
			.catch((err) => {
				onEvent?.({ kind: 'cron_error', error: String(err?.message || err) });
				return [];
			})
			.finally(() => {
				running = null;
			});
		return running;
	};
	const loop = async () => {
		if (stopped) return;
		await tick();
		if (!stopped) timer = setTimeout(loop, intervalMs);
	};
	timer = setTimeout(loop, 0);
	return {
		tick,
		async stop() {
			stopped = true;
			clearTimeout(timer);
			if (running) await running;
		},
	};
}
