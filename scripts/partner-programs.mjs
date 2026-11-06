#!/usr/bin/env node
/**
 * Big-tech partner programs tracker: every partner program, startup program, marketplace,
 * directory, grant, and recognition route at the largest technology companies, with our status,
 * the plan to get in, every submission we made, and every benefit we hold.
 *
 *   node scripts/partner-programs.mjs                     validate data/partner-programs.json (default)
 *   node scripts/partner-programs.mjs --build             regenerate docs/partners/big-tech-programs.md
 *   node scripts/partner-programs.mjs --check             fail if the generated doc is stale
 *   node scripts/partner-programs.mjs --due [--days 30] [--strict]   deadlines, expiring benefits, and submissions to chase
 *                                     (--strict exits 1 when anything is due, for cron use)
 *   node scripts/partner-programs.mjs --next [--limit 15] the ranked next actions across every program
 *   node scripts/partner-programs.mjs --log <id> --action "Submitted the form" [--status submitted] [--ref <url>] [--date YYYY-MM-DD]
 *   node scripts/partner-programs.mjs --benefit <id> --name "API credits" [--value "USD 1,000"] [--state received]
 *                                     [--received YYYY-MM-DD] [--expires YYYY-MM-DD] [--note "..."]
 *
 * --log and --benefit write the data file and rebuild the doc in one step, so recording a
 * submission or a benefit is a single command. Source of truth: data/partner-programs.json.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = join(ROOT, 'data/partner-programs.json');
export const DOC = join(ROOT, 'docs/partners/big-tech-programs.md');

export const STATUSES = {
	member: 'Member / live',
	submitted: 'Submitted, waiting',
	preparing: 'In progress',
	ready: 'Ready, one human step',
	eligible: 'Eligible, not started',
	research: 'Verify fit first',
	skip: 'Decided not to pursue',
	'not-eligible': 'Not eligible',
	declined: 'Declined',
	closed: 'Retired or closed',
};
const INACTIVE = new Set(['skip', 'not-eligible', 'declined', 'closed']);

export const KINDS = {
	credits: 'Startup credits',
	'partner-network': 'Partner network',
	marketplace: 'Marketplace',
	directory: 'Store or directory',
	accelerator: 'Accelerator',
	grant: 'Grant or fund',
	recognition: 'Recognition',
	'co-marketing': 'Co-marketing',
	event: 'Event or call',
	'developer-program': 'Developer program',
};

export const BENEFIT_STATES = {
	claimable: 'Entitled, not claimed',
	received: 'Received, in use',
	used: 'Used up',
	expired: 'Expired',
};

export const WAVES = {
	0: { title: 'Wave 0: activate what we already hold', why: 'Memberships we already have where a benefit sits unclaimed or a next step is open. Zero acquisition cost, so this always goes first.' },
	1: { title: 'Wave 1: finish what is built', why: 'The product, package, or application already exists. What is left is ours: a portal step, a credential, a signature, or pressing submit.' },
	2: { title: 'Wave 2: apply this month', why: 'Open, self-serve or near it, and a strong fit (score 11 or more). Each needs an application written, not a product built.' },
	3: { title: 'Wave 3: build, then apply', why: 'A real fit that needs an integration, package, or app shipped before the application is credible.' },
	4: { title: 'Wave 4: open, lower priority', why: 'Open to us today but a weaker fit, a smaller audience, or more paperwork (score under 11). Cheap ones are worth an afternoon once waves 0 to 2 are clear.' },
	5: { title: 'Wave 5: watch and verify', why: 'Invite-only, a window that is not open yet, or eligibility we have not confirmed. Re-check on the cadence listed.' },
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DASH = /[\u2013\u2014]/;

export function score(p) {
	return (p.fit || 0) + (p.reach || 0) + (p.access || 0);
}

/** Which wave of the plan a program belongs to; an explicit `wave` on the entry wins. */
export function waveOf(p) {
	if (Number.isInteger(p.wave)) return p.wave;
	if (INACTIVE.has(p.status) || p.status === 'submitted') return null;
	if (p.status === 'member') return p.next ? 0 : null;
	if (p.status === 'research') return 5;
	if (p.needs_build) return 3;
	if (p.status === 'ready' || p.status === 'preparing') return 1;
	if (score(p) >= 11 && p.access >= 3) return 2;
	return p.access >= 3 ? 4 : 5;
}

export function load(path = DATA) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

export function save(db, path = DATA) {
	writeFileSync(path, JSON.stringify(db, null, '\t') + '\n');
}

export function validate(db) {
	const errs = [];
	const companies = new Set((db.companies || []).map((c) => c.name));
	if (!companies.size) errs.push('companies: at least one company required');
	const ids = new Set();
	for (const p of db.programs || []) {
		const at = `program ${p.id || p.program || '?'}`;
		if (!/^[a-z0-9][a-z0-9-]*$/.test(p.id || '')) errs.push(`${at}: id must be kebab-case`);
		if (ids.has(p.id)) errs.push(`${at}: duplicate id`);
		ids.add(p.id);
		if (!companies.has(p.company)) errs.push(`${at}: company "${p.company}" is not in companies[]`);
		if (!p.program) errs.push(`${at}: program name required`);
		if (!KINDS[p.kind]) errs.push(`${at}: unknown kind "${p.kind}"`);
		if (!STATUSES[p.status]) errs.push(`${at}: unknown status "${p.status}"`);
		if (!/^https?:\/\//.test(p.url || '')) errs.push(`${at}: url must be http(s)`);
		for (const k of ['fit', 'reach', 'access']) {
			if (!Number.isInteger(p[k]) || p[k] < 1 || p[k] > 5) errs.push(`${at}: ${k} must be an integer 1-5`);
		}
		if (!DATE.test(p.checked || '')) errs.push(`${at}: checked must be YYYY-MM-DD`);
		if (p.deadline && !DATE.test(p.deadline)) errs.push(`${at}: deadline must be YYYY-MM-DD`);
		if (!INACTIVE.has(p.status) && p.status !== 'member' && !p.next) errs.push(`${at}: an active program needs a next action`);
		if (INACTIVE.has(p.status) && !p.why) errs.push(`${at}: a ${p.status} program needs a why`);
		for (const e of p.log || []) {
			if (!DATE.test(e.date || '')) errs.push(`${at}: log date must be YYYY-MM-DD`);
			if (!e.action) errs.push(`${at}: log entry needs an action`);
		}
		for (const b of p.received || []) {
			if (!b.benefit) errs.push(`${at}: benefit needs a name`);
			if (!BENEFIT_STATES[b.state]) errs.push(`${at}: unknown benefit state "${b.state}"`);
			for (const k of ['received', 'expires']) if (b[k] && !DATE.test(b[k])) errs.push(`${at}: benefit ${k} must be YYYY-MM-DD`);
		}
		const text = JSON.stringify(p);
		if (DASH.test(text)) errs.push(`${at}: contains an em-dash or en-dash`);
	}
	for (const c of db.companies || []) if (DASH.test(JSON.stringify(c))) errs.push(`company ${c.name}: contains an em-dash or en-dash`);
	return errs;
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const anchor = (s) => s.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-');
const link = (p) => `[${esc(p.program)}](${p.url})`;
const fra = (p) => `${p.fit}·${p.reach}·${p.access} = **${score(p)}**`;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const lastLog = (p) => (p.log || []).reduce((m, e) => (e.date > m ? e.date : m), '');

function byRank(a, b) {
	return score(b) - score(a) || a.company.localeCompare(b.company) || a.program.localeCompare(b.program);
}

/** Deadlines inside the window, benefits expiring inside it, and submissions with no movement. */
export function due(db, today, days = 30) {
	const out = { deadlines: [], expiring: [], chase: [] };
	for (const p of db.programs) {
		if (p.deadline && !INACTIVE.has(p.status)) {
			const d = daysBetween(today, p.deadline);
			if (d >= 0 && d <= days) out.deadlines.push({ p, days: d });
		}
		for (const b of p.received || []) {
			if (b.expires && (b.state === 'received' || b.state === 'claimable')) {
				const d = daysBetween(today, b.expires);
				if (d <= days) out.expiring.push({ p, b, days: d });
			}
		}
		if (p.status === 'submitted') {
			const since = lastLog(p) || p.checked;
			const d = daysBetween(since, today);
			if (d >= 21) out.chase.push({ p, days: d, since });
		}
	}
	out.deadlines.sort((a, b) => a.days - b.days);
	out.expiring.sort((a, b) => a.days - b.days);
	out.chase.sort((a, b) => b.days - a.days);
	return out;
}

export function render(db) {
	const P = db.programs;
	const active = P.filter((p) => !INACTIVE.has(p.status));
	const count = (s) => P.filter((p) => p.status === s).length;
	const companiesWithMember = new Set(P.filter((p) => p.status === 'member').map((p) => p.company));
	const out = [];
	out.push('# Big-tech partner programs');
	out.push('');
	out.push('<!-- Generated by scripts/partner-programs.mjs from data/partner-programs.json. Do not edit by hand. -->');
	out.push('');
	out.push(
		'Nearly every partnership three.ws has today started with one question: *does this company have a partner program?* This page asks that question of the largest technology companies, all at once, and keeps the answers. It lists every partner program, startup program, marketplace, directory, grant, and recognition route a company like ours can join, ranks them, says exactly what to do next, and records every submission we make and every benefit we hold.',
	);
	out.push('');
	out.push(
		'It is the wide net. The narrower docs stay authoritative for what they cover: [partners.md](../partners.md) is what each live partnership **is** and how to describe it, [opportunities.md](./opportunities.md) is the stuck-item pipeline, [prospects.md](./prospects.md) scores the 3D and avatar ecosystem (not big tech), and the [listings registry](../listings-registry.md) tracks directories and awesome-lists.',
	);
	out.push('');
	out.push(
		`**${P.length} programs across ${db.companies.length} companies.** ` +
			Object.keys(STATUSES)
				.filter((s) => count(s))
				.map((s) => `${count(s)} ${STATUSES[s].toLowerCase()}`)
				.join(', ') +
			`. We hold at least one membership at ${companiesWithMember.size} of the ${db.companies.length} companies. Last full research sweep: ${db.updated}.`,
	);
	out.push('');
	out.push('## Using this page');
	out.push('');
	out.push('```sh');
	out.push('npm run programs:next                     # the ranked next actions, top 15');
	out.push('npm run programs:due                      # deadlines and expiring benefits in the next 30 days, submissions to chase');
	out.push('npm run programs -- --log <id> --action "Submitted the application" --status submitted --ref <url>');
	out.push('npm run programs -- --benefit <id> --name "Cloud credits" --value "USD 25,000" --state received --received 2026-11-06 --expires 2027-11-06');
	out.push('npm run programs:build                    # regenerate this page after editing data/partner-programs.json by hand');
	out.push('```');
	out.push('');
	out.push(
		'`--log` and `--benefit` update [data/partner-programs.json](../../data/partner-programs.json) and rebuild this page in one step. Log every submission the day it happens, with the confirmation link or email subject as `--ref`; log every benefit the day it lands, with its expiry. That is the whole tracking discipline.',
	);
	out.push('');
	out.push(
		'**Scores** use the same F·R·A scale as [prospects.md](./prospects.md#how-a-prospect-is-scored): **F**it (5 = already in our code), **R**each (5 = millions of the right users or buyers), **A**ccess (5 = self-serve form, 1 = no public route), summed to 3-15.',
	);
	out.push('');

	const d = due(db, db.updated, 90);
	out.push('## Closing windows');
	out.push('');
	if (d.deadlines.length) {
		out.push('Dated within 90 days of the last sweep. Miss these and the opportunity is gone for a cycle.');
		out.push('');
		out.push('| Deadline | Program | Company | Status | Next action |', '|---|---|---|---|---|');
		for (const { p } of d.deadlines) out.push(`| **${p.deadline}** | ${link(p)} | ${esc(p.company)} | ${STATUSES[p.status]} | ${esc(p.next)} |`);
	} else {
		out.push('No dated deadline inside the next 90 days.');
	}
	out.push('');

	out.push('## The plan');
	out.push('');
	out.push(
		'Every active program sits in exactly one wave. Work the waves in order; inside a wave, work top to bottom (highest score first). A program moves waves only when its status changes, so updating status is how the plan stays current.',
	);
	out.push('');
	for (const [w, meta] of Object.entries(WAVES)) {
		const rows = active.filter((p) => waveOf(p) === Number(w)).sort(byRank);
		if (!rows.length) continue;
		out.push(`### ${meta.title}`);
		out.push('');
		out.push(`${meta.why} ${rows.length} program${rows.length === 1 ? '' : 's'}.`);
		out.push('');
		out.push('| # | Program | Company | Score | Next action |', '|---|---|---|---|---|');
		rows.forEach((p, i) => out.push(`| ${i + 1} | ${link(p)} | ${esc(p.company)} | ${score(p)} | ${esc(p.next)} |`));
		out.push('');
	}
	const waiting = active.filter((p) => p.status === 'submitted').sort((a, b) => (lastLog(a) || a.checked).localeCompare(lastLog(b) || b.checked));
	if (waiting.length) {
		out.push('### Waiting on them');
		out.push('');
		out.push('Submitted. Nothing to do but chase on schedule: a submission with no movement for 21 days gets a follow-up (`npm run programs:due` lists them).');
		out.push('');
		out.push('| Program | Company | Last movement | Follow-up |', '|---|---|---|---|');
		for (const p of waiting) out.push(`| ${link(p)} | ${esc(p.company)} | ${lastLog(p) || p.checked} | ${esc(p.next || 'Chase the reviewer')} |`);
		out.push('');
	}

	out.push('## Benefits ledger');
	out.push('');
	out.push(
		'What we hold, what we are entitled to and have not claimed, and when each expires. Credit amounts appear here because this is the internal record; never copy them onto a public page ([partner-benefits.md](../partner-benefits.md#editing-rules)). Organization, workspace, and account IDs never go in this file at all.',
	);
	out.push('');
	const ledger = [];
	for (const p of P) for (const b of p.received || []) ledger.push({ p, b });
	const stateOrder = Object.keys(BENEFIT_STATES);
	ledger.sort(
		(x, y) => stateOrder.indexOf(x.b.state) - stateOrder.indexOf(y.b.state) || (x.b.expires || '9999').localeCompare(y.b.expires || '9999'),
	);
	if (ledger.length) {
		out.push('| State | Benefit | Value | Program | Received | Expires | Note |', '|---|---|---|---|---|---|---|');
		for (const { p, b } of ledger) {
			out.push(
				`| ${BENEFIT_STATES[b.state]} | ${esc(b.benefit)} | ${esc(b.value || '')} | ${link(p)} | ${b.received || ''} | ${b.expires ? `**${b.expires}**` : ''} | ${esc(b.note || '')} |`,
			);
		}
	} else {
		out.push('No benefits recorded yet.');
	}
	out.push('');

	out.push('## Submissions log');
	out.push('');
	out.push('Every application, form, email, and portal action, newest first. Add one with `npm run programs -- --log <id> --action "..."`.');
	out.push('');
	const log = [];
	for (const p of P) for (const e of p.log || []) log.push({ p, e });
	log.sort((x, y) => y.e.date.localeCompare(x.e.date) || x.p.program.localeCompare(y.p.program));
	if (log.length) {
		out.push('| Date | Program | Company | What happened | Reference |', '|---|---|---|---|---|');
		for (const { p, e } of log) {
			const ref = e.ref ? (/^https?:\/\//.test(e.ref) ? `[link](${e.ref})` : esc(e.ref)) : '';
			out.push(`| ${e.date} | ${link(p)} | ${esc(p.company)} | ${esc(e.action)}${e.status ? ` (now: ${STATUSES[e.status]})` : ''} | ${ref} |`);
		}
	} else {
		out.push('No submissions logged yet.');
	}
	out.push('');

	out.push('## Company by company');
	out.push('');
	out.push(
		db.companies.map((c) => `[${c.name}](#${anchor(c.name)})`).join(' · '),
	);
	out.push('');
	for (const c of db.companies) {
		const rows = P.filter((p) => p.company === c.name && !INACTIVE.has(p.status)).sort(
			(a, b) => Object.keys(STATUSES).indexOf(a.status) - Object.keys(STATUSES).indexOf(b.status) || byRank(a, b),
		);
		const dead = P.filter((p) => p.company === c.name && INACTIVE.has(p.status));
		out.push(`### ${c.name}`);
		out.push('');
		if (c.angle) out.push(`**How we partner with ${c.name}:** ${c.angle}`, '');
		if (rows.length) {
			out.push('| Program | Type | What it gives | Who qualifies | Status | Next action | F·R·A |', '|---|---|---|---|---|---|---|');
			for (const p of rows) {
				const gives = [p.value, ...(p.benefits || [])].filter(Boolean).join('; ');
				const assets = (p.assets || []).map((a) => `[kit](../../${a})`).join(' ');
				const applyShown = p.apply && !String(p.next || '').includes(p.apply);
				const apply = applyShown ? ` Apply: ${/^https?:\/\//.test(p.apply) ? `[form](${p.apply})` : esc(p.apply)}.` : '';
				const cadence = p.cadence ? ` Cadence: ${esc(p.cadence)}.` : '';
				out.push(
					`| ${link(p)} | ${KINDS[p.kind]} | ${esc(gives)} | ${esc(p.eligibility || '')}${p.cost ? ` Cost: ${esc(p.cost)}.` : ''} | ${STATUSES[p.status]} | ${[esc(p.next || ''), apply.trim(), cadence.trim(), assets].filter(Boolean).join(' ')} | ${fra(p)} |`,
				);
			}
			out.push('');
			const notes = rows.filter((p) => p.why);
			if (notes.length) {
				for (const p of notes) out.push(`- **${esc(p.program)}.** ${esc(p.why)}`);
				out.push('');
			}
		}
		if (dead.length) {
			out.push('Closed doors (do not re-research):');
			out.push('');
			for (const p of dead) out.push(`- ${link(p)}: ${STATUSES[p.status]}. ${esc(p.why)} (checked ${p.checked})`);
			out.push('');
		}
	}

	out.push('## Keeping it true');
	out.push('');
	out.push('- **Never set `member` without proof**: an acceptance email, a portal that shows the membership, or a live listing. Record the proof as a `--log` entry with `--ref`.');
	out.push('- **Never upgrade a designation.** Program names and tiers are quoted exactly as the partner writes them; the framing rules in [partners.md](../partners.md#what-the-page-does-not-claim) apply here too.');
	out.push('- **Log the day it happens.** A submission that is not logged did not happen as far as the next person is concerned, and they will submit it again.');
	out.push('- **Re-sweep quarterly.** Programs get renamed, folded, and retired every few months. When a page 404s or redirects, set `closed` with the reason and the date so nobody re-researches it.');
	out.push('- **A new membership** also needs a card on `/partners` and `/partners/benefits` and a row in [partners.md](../partners.md) (see [partner-benefits.md](../partner-benefits.md#editing-rules)).');
	out.push('');
	return out.join('\n');
}

function arg(args, name, fallback) {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

/** Append a submission event; optionally move the program's status. Returns the updated program. */
export function logSubmission(db, id, { action, status, ref, date }) {
	const p = db.programs.find((x) => x.id === id);
	if (!p) throw new Error(`no program with id "${id}" (see data/partner-programs.json)`);
	if (!action) throw new Error('--action is required');
	if (status && !STATUSES[status]) throw new Error(`unknown status "${status}"; one of ${Object.keys(STATUSES).join(', ')}`);
	const entry = { date, action };
	if (status) entry.status = status;
	if (ref) entry.ref = ref;
	(p.log ||= []).push(entry);
	if (status) p.status = status;
	p.checked = date;
	return p;
}

/** Record a benefit; a benefit with the same name on the same program is updated in place. */
export function recordBenefit(db, id, { name, value, state, received, expires, note }) {
	const p = db.programs.find((x) => x.id === id);
	if (!p) throw new Error(`no program with id "${id}" (see data/partner-programs.json)`);
	if (!name) throw new Error('--name is required');
	if (!BENEFIT_STATES[state]) throw new Error(`unknown benefit state "${state}"; one of ${Object.keys(BENEFIT_STATES).join(', ')}`);
	p.received ||= [];
	let b = p.received.find((x) => x.benefit === name);
	if (!b) p.received.push((b = { benefit: name }));
	Object.assign(b, { state });
	if (value) b.value = value;
	if (received) b.received = received;
	if (expires) b.expires = expires;
	if (note) b.note = note;
	return p;
}

function fail(errs) {
	console.error(errs.join('\n'));
	process.exit(1);
}

async function main() {
	const args = process.argv.slice(2);
	const today = new Date().toISOString().slice(0, 10);
	const db = load();
	const errs = validate(db);
	if (errs.length) fail(errs);

	const write = () => {
		const after = validate(db);
		if (after.length) fail(after);
		save(db);
		writeFileSync(DOC, render(db) + '\n');
	};

	try {
		if (args.includes('--log')) {
			const p = logSubmission(db, arg(args, '--log'), {
				action: arg(args, '--action'),
				status: arg(args, '--status'),
				ref: arg(args, '--ref'),
				date: arg(args, '--date', today),
			});
			write();
			console.log(`logged on ${p.id}: status ${p.status}, ${p.log.length} log entr${p.log.length === 1 ? 'y' : 'ies'}`);
		} else if (args.includes('--benefit')) {
			const p = recordBenefit(db, arg(args, '--benefit'), {
				name: arg(args, '--name'),
				value: arg(args, '--value'),
				state: arg(args, '--state', 'received'),
				received: arg(args, '--received'),
				expires: arg(args, '--expires'),
				note: arg(args, '--note'),
			});
			write();
			console.log(`benefit recorded on ${p.id}: ${p.received.length} on file`);
		} else if (args.includes('--build')) {
			writeFileSync(DOC, render(db) + '\n');
			console.log(`wrote docs/partners/big-tech-programs.md (${db.programs.length} programs)`);
		} else if (args.includes('--check')) {
			const cur = existsSync(DOC) ? readFileSync(DOC, 'utf8') : '';
			if (cur !== render(db) + '\n') fail(['docs/partners/big-tech-programs.md is stale: run npm run programs:build']);
			console.log(`partner programs ok (${db.programs.length} programs)`);
		} else if (args.includes('--due')) {
			const days = Number(arg(args, '--days', 30));
			const r = due(db, today, days);
			const lines = [];
			for (const { p, days: n } of r.deadlines) lines.push(`DEADLINE  ${p.deadline} (${n}d)  ${p.company}: ${p.program}  -> ${p.next}`);
			for (const { p, b, days: n } of r.expiring) lines.push(`EXPIRES   ${b.expires} (${n}d)  ${p.company}: ${b.benefit} [${BENEFIT_STATES[b.state]}]`);
			for (const { p, days: n, since } of r.chase) lines.push(`CHASE     ${n}d since ${since}  ${p.company}: ${p.program}`);
			console.log(lines.length ? lines.join('\n') : `nothing due in the next ${days} days`);
			if (args.includes('--strict') && lines.length) process.exitCode = 1;
		} else if (args.includes('--next')) {
			const limit = Number(arg(args, '--limit', 15));
			const rows = db.programs
				.filter((p) => waveOf(p) !== null)
				.sort((a, b) => waveOf(a) - waveOf(b) || byRank(a, b))
				.slice(0, limit);
			for (const p of rows) console.log(`W${waveOf(p)}  ${String(score(p)).padStart(2)}  ${p.company}: ${p.program}\n          -> ${p.next}`);
		} else {
			console.log(`partner-programs.json valid (${db.programs.length} programs, ${db.companies.length} companies)`);
		}
	} catch (err) {
		fail([err.message]);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
