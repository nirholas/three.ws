#!/usr/bin/env node
/**
 * Partner programs tracker: every partner program, startup program, marketplace, directory,
 * grant, and recognition route we could join, split into sectors (big tech, AI companies, the
 * companies that hold motion, crypto ecosystems), with our status, the plan to get in, the
 * promotion each program offers (co-marketing, social, blog, case study, ...), every submission
 * we made, and every benefit we hold.
 *
 *   node scripts/partner-programs.mjs                     validate every sector data file (default)
 *   node scripts/partner-programs.mjs --build             regenerate every sector doc and the promotion index
 *   node scripts/partner-programs.mjs --check             fail if any generated doc is stale
 *   node scripts/partner-programs.mjs --due [--days 30] [--strict] [--sector ai]   deadlines, expiring benefits, and submissions to chase
 *                                     (--strict exits 1 when anything is due, for cron use)
 *   node scripts/partner-programs.mjs --next [--limit 15] [--sector ai]   the ranked next actions
 *   node scripts/partner-programs.mjs --promo [blog] [--sector ai] [--limit 25]   programs that will promote us, best first
 *   node scripts/partner-programs.mjs --log <id> --action "Submitted the form" [--status submitted] [--ref <url>] [--date YYYY-MM-DD]
 *   node scripts/partner-programs.mjs --benefit <id> --name "API credits" [--value "USD 1,000"] [--state received]
 *                                     [--received YYYY-MM-DD] [--expires YYYY-MM-DD] [--note "..."]
 *
 * --log and --benefit find the program in whichever sector holds it, write that data file, and
 * rebuild the docs in one step, so recording a submission or a benefit is a single command.
 * Program ids are unique across sectors. A sector whose data file is absent is skipped.
 * Sources of truth: the data files listed in SECTORS below.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = join(ROOT, 'data/partner-programs.json');
export const DOC = join(ROOT, 'docs/partners/big-tech-programs.md');
export const PROMO_DOC = join(ROOT, 'docs/partners/promotion-programs.md');
export const MOONSHOT_DOC = join(ROOT, 'docs/partners/moonshots.md');

/** One data file and one generated doc per sector. DATA and DOC above are the big-tech pair. */
export const SECTORS = {
	'big-tech': {
		data: DATA,
		doc: DOC,
		label: 'Big tech',
		title: 'Big-tech partner programs',
		scope: 'the largest technology companies',
		intro:
			'Nearly every partnership three.ws has today started with one question: *does this company have a partner program?* This page asks that question of the largest technology companies, all at once, and keeps the answers. It lists every partner program, startup program, marketplace, directory, grant, and recognition route a company like ours can join, ranks them, says exactly what to do next, and records every submission we make and every benefit we hold.',
	},
	ai: {
		data: join(ROOT, 'data/partner-programs-ai.json'),
		doc: join(ROOT, 'docs/partners/ai-programs.md'),
		label: 'AI',
		title: 'AI company partner programs',
		scope: 'AI companies outside big tech',
		intro:
			'The same question, *does this company have a partner program?*, asked of the AI companies that are not big tech: model labs, inference and GPU clouds, AI developer tools, generative media (3D, image, video, voice, avatars), and agent platforms and frameworks. OpenAI, Anthropic, Google, Microsoft, Meta, NVIDIA, Amazon, IBM, and xAI live on the [big-tech page](./big-tech-programs.md).',
	},
	motion: {
		data: join(ROOT, 'data/partner-programs-motion.json'),
		doc: join(ROOT, 'docs/partners/motion-programs.md'),
		label: 'Motion',
		title: 'Motion partner programs',
		scope: 'the companies that hold motion',
		intro:
			'The companies that hold motion: capture hardware, markerless AI capture, animation libraries and motion marketplaces, rigging and retargeting tools, and avatar SDKs. Motion is what turns a rigged three.ws avatar into a living agent, so these are the partners closest to the product. Adobe, Autodesk, Unity, Epic Games, and Meta programs live on the [big-tech page](./big-tech-programs.md).',
	},
	brands: {
		data: join(ROOT, 'data/partner-programs-brands.json'),
		doc: join(ROOT, 'docs/partners/brand-programs.md'),
		label: 'Brands',
		title: 'Global brand partner programs',
		scope: 'household-name companies outside technology',
		intro:
			'The household names outside technology: carmakers, robotics and space, entertainment, music and sports, games publishers, toys, consumer and luxury brands, retail, telecoms, and the consultancies. They look out of reach the way IBM and OpenAI did, until someone opens the partner page. The doors here are mostly innovation programs, accelerators, corporate venture arms, open calls, and developer platforms rather than partner networks, and access is honestly scored: most are competitive, some are invite-only, and a few are open today.',
	},
	crypto: {
		data: join(ROOT, 'data/partner-programs-crypto.json'),
		doc: join(ROOT, 'docs/partners/crypto-programs.md'),
		label: 'Crypto',
		title: 'Crypto ecosystem partner programs',
		scope: 'crypto ecosystems',
		intro:
			'Ecosystem grants, accelerators, hackathons, wallet and app directories, infrastructure startup programs, and co-marketing routes across crypto, Solana first. Solana is the home chain and leads every wave; EVM chains are secondary surfaces. $THREE is the only coin three.ws promotes: joining an ecosystem program is working with that ecosystem, never promoting its token.',
	},
};

/** The promotion a program offers its partners, members, or listees. */
export const PROMO_TYPES = {
	'co-marketing': 'Co-marketing',
	social: 'Social posts',
	blog: 'Blog post',
	'case-study': 'Case study',
	newsletter: 'Newsletter',
	showcase: 'Featured placement',
	event: 'Event or speaking slot',
	media: 'Podcast or video',
	press: 'Press release',
	badge: 'Partner badge',
};

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
		if (p.promo !== undefined) {
			if (!Array.isArray(p.promo)) errs.push(`${at}: promo must be an array`);
			else {
				for (const t of p.promo) if (!PROMO_TYPES[t]) errs.push(`${at}: unknown promo type "${t}"`);
				if (new Set(p.promo).size !== p.promo.length) errs.push(`${at}: duplicate promo type`);
				if (p.promo.length && !p.promo_note) errs.push(`${at}: promo needs a promo_note saying how to get it`);
			}
		}
		const text = JSON.stringify(p);
		if (DASH.test(text)) errs.push(`${at}: contains an em-dash or en-dash`);
	}
	for (const c of db.companies || []) if (DASH.test(JSON.stringify(c))) errs.push(`company ${c.name}: contains an em-dash or en-dash`);
	for (const c of db.companies || []) if (c.moonshot !== undefined && c.moonshot !== true) errs.push(`company ${c.name}: moonshot must be true or absent`);
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

/** Promotion value of one ask: the program score plus two points per kind of promotion it offers. */
export function promoValue(p) {
	return score(p) + 2 * (p.promo || []).length;
}

function byPromo(a, b) {
	return promoValue(b) - promoValue(a) || byRank(a, b);
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

const rel = (abs) => abs.slice(ROOT.length + 1);
const docName = (abs) => abs.slice(abs.lastIndexOf('/') + 1);
const promoTags = (p) => (p.promo || []).map((t) => PROMO_TYPES[t]).join(', ');

/** The other sector pages and the promotion index, as one line of links. */
function siblings(sector) {
	const links = Object.entries(SECTORS)
		.filter(([k, m]) => k !== sector && existsSync(m.data))
		.map(([, m]) => `[${m.title.toLowerCase()}](./${docName(m.doc)})`);
	return `Sibling pages: ${links.join(', ')}, plus [who promotes partners](./${docName(PROMO_DOC)}) and [moonshots](./${docName(MOONSHOT_DOC)}) across every sector.`;
}

export function render(db, sector = 'big-tech') {
	const meta = SECTORS[sector];
	if (!meta) throw new Error(`unknown sector "${sector}"; one of ${Object.keys(SECTORS).join(', ')}`);
	const dataRel = rel(meta.data);
	const P = db.programs;
	const active = P.filter((p) => !INACTIVE.has(p.status));
	const count = (s) => P.filter((p) => p.status === s).length;
	const companiesWithMember = new Set(P.filter((p) => p.status === 'member').map((p) => p.company));
	const promoting = active.filter((p) => (p.promo || []).length);
	const out = [];
	out.push(`# ${meta.title}`);
	out.push('');
	out.push(`<!-- Generated by scripts/partner-programs.mjs from ${dataRel}. Do not edit by hand. -->`);
	out.push('');
	out.push(meta.intro);
	out.push('');
	out.push(
		'It is the wide net. The narrower docs stay authoritative for what they cover: [partners.md](../partners.md) is what each live partnership **is** and how to describe it, [opportunities.md](./opportunities.md) is the stuck-item pipeline, [prospects.md](./prospects.md) scores the 3D and avatar ecosystem, and the [listings registry](../listings-registry.md) tracks directories and awesome-lists.',
	);
	out.push('');
	out.push(siblings(sector));
	out.push('');
	out.push(
		`**${P.length} programs across ${db.companies.length} companies.** ` +
			Object.keys(STATUSES)
				.filter((s) => count(s))
				.map((s) => `${count(s)} ${STATUSES[s].toLowerCase()}`)
				.join(', ') +
			`. We hold at least one membership at ${companiesWithMember.size} of the ${db.companies.length} companies, and ${promoting.length} of the open programs offer some form of promotion. Last full research sweep: ${db.updated}.`,
	);
	out.push('');
	out.push('## Using this page');
	out.push('');
	out.push('```sh');
	out.push(`npm run programs:next -- --sector ${sector}   # the ranked next actions, top 15`);
	out.push(`npm run programs:due -- --sector ${sector}    # deadlines and expiring benefits in the next 30 days, submissions to chase`);
	out.push(`npm run programs:promo -- blog --sector ${sector}   # programs that will promote us, by type`);
	out.push('npm run programs -- --log <id> --action "Submitted the application" --status submitted --ref <url>');
	out.push('npm run programs -- --benefit <id> --name "Cloud credits" --value "USD 25,000" --state received --received 2026-11-06 --expires 2027-11-06');
	out.push(`npm run programs:build                    # regenerate this page after editing ${dataRel} by hand`);
	out.push('```');
	out.push('');
	out.push(
		`\`--log\` and \`--benefit\` update [${dataRel}](../../${dataRel}) and rebuild this page in one step. Log every submission the day it happens, with the confirmation link or email subject as \`--ref\`; log every benefit the day it lands, with its expiry. That is the whole tracking discipline.`,
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

	out.push('## Who promotes partners');
	out.push('');
	if (promoting.length) {
		out.push(
			`The open programs on this page that will put three.ws in front of their audience: co-marketing, social posts, blog posts, case studies, newsletters, featured placement, events, podcasts, press, or a partner badge. Ranked by promotion value: the program score plus two points for each kind of promotion one ask earns. Ask for the promotion in the same message as the application; it is far easier to get on the way in than after. The cross-sector view is [promotion-programs.md](./${docName(PROMO_DOC)}).`,
		);
		out.push('');
		out.push('| Program | Company | Promotion offered | How to get it | Status |', '|---|---|---|---|---|');
		for (const p of [...promoting].sort(byPromo)) out.push(`| ${link(p)} | ${esc(p.company)} | ${promoTags(p)} | ${esc(p.promo_note)} | ${STATUSES[p.status]} |`);
	} else {
		out.push('No program on this page records a promotion benefit yet.');
	}
	out.push('');

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
			out.push('| Program | Type | What it gives | Promotion | Who qualifies | Status | Next action | F·R·A |', '|---|---|---|---|---|---|---|---|');
			for (const p of rows) {
				const gives = [p.value, ...(p.benefits || [])].filter(Boolean).join('; ');
				const assets = (p.assets || []).map((a) => `[kit](../../${a})`).join(' ');
				const applyShown = p.apply && !String(p.next || '').toLowerCase().includes(p.apply.toLowerCase());
				const apply = applyShown ? ` Apply: ${/^https?:\/\//.test(p.apply) ? `[form](${p.apply})` : esc(p.apply)}.` : '';
				const cadence = p.cadence ? ` Cadence: ${esc(p.cadence)}.` : '';
				out.push(
					`| ${link(p)} | ${KINDS[p.kind]} | ${esc(gives)} | ${promoTags(p)} | ${esc(p.eligibility || '')}${p.cost ? ` Cost: ${esc(p.cost)}.` : ''} | ${STATUSES[p.status]} | ${[esc(p.next || ''), apply.trim(), cadence.trim(), assets].filter(Boolean).join(' ')} | ${fra(p)} |`,
				);
			}
			out.push('');
			const notes = rows.filter((p) => p.why);
			if (notes.length) {
				for (const p of notes) out.push(`- **${esc(p.program)}.** ${esc(p.why)}`);
				out.push('');
			}
		}
		if (!rows.length && !dead.length) {
			out.push(`No partner, startup, listing, or grant program found in the ${db.updated} sweep. Re-check on the next quarterly sweep.`, '');
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

/** Every sector whose data file exists, in SECTORS order. */
export function loadAll() {
	return Object.entries(SECTORS)
		.filter(([, m]) => existsSync(m.data))
		.map(([sector, m]) => ({ sector, db: load(m.data) }));
}

/** Per-sector validation plus ids unique across sectors, so --log <id> is never ambiguous. */
export function validateAll(all) {
	const errs = [];
	const seen = new Map();
	for (const { sector, db } of all) {
		for (const e of validate(db)) errs.push(`${sector}: ${e}`);
		for (const p of db.programs || []) {
			if (seen.has(p.id) && seen.get(p.id) !== sector) errs.push(`${sector}: program ${p.id}: id also used in ${seen.get(p.id)}`);
			seen.set(p.id, sector);
		}
	}
	return errs;
}

/** The cross-sector index of every open program that promotes its partners. */
export function renderPromo(all) {
	const rows = [];
	for (const { sector, db } of all) {
		for (const p of db.programs) if (!INACTIVE.has(p.status) && (p.promo || []).length) rows.push({ sector, p });
	}
	const label = (sector) => SECTORS[sector].label;
	const page = (sector) => `./${docName(SECTORS[sector].doc)}`;
	const out = [];
	out.push('# Who promotes partners');
	out.push('');
	out.push(`<!-- Generated by scripts/partner-programs.mjs from ${all.map(({ sector }) => rel(SECTORS[sector].data)).join(', ')}. Do not edit by hand. -->`);
	out.push('');
	out.push(
		'Most partner programs list you. Some also **promote** you: a co-marketing campaign, a post on their social accounts, a feature on their blog, a case study, a newsletter slot, a featured placement, a speaking slot, a podcast, a joint press release, or a partner badge. This page pulls those programs out of every sector tracker so an application can be chosen for the audience it buys, not just the listing.',
	);
	out.push('');
	out.push(
		`**${rows.length} open programs offer promotion** across ${all.map(({ sector }) => `[${label(sector)}](${page(sector)})`).join(', ')}. A tag is set only where the program states the benefit or has a documented record of doing it for partners; the note says which, and how to ask.`,
	);
	out.push('');
	out.push('```sh');
	out.push('npm run programs:promo                    # the best single asks, across sectors');
	out.push('npm run programs:promo -- blog            # every program that will publish a blog post about us');
	out.push('npm run programs -- --benefit <id> --name "Blog post" --state received --note "<url>"   # record a promotion we won');
	out.push('```');
	out.push('');
	out.push('## At a glance');
	out.push('');
	out.push(`| Promotion | ${all.map(({ sector }) => label(sector)).join(' | ')} | Total |`, `|---|${all.map(() => '---|').join('')}---|`);
	for (const [t, name] of Object.entries(PROMO_TYPES)) {
		const per = all.map(({ sector }) => rows.filter((r) => r.sector === sector && r.p.promo.includes(t)).length);
		const total = per.reduce((a, b) => a + b, 0);
		out.push(`| [${name}](#${anchor(name)}) | ${per.join(' | ')} | **${total}** |`);
	}
	out.push('');
	out.push('## Best single asks');
	out.push('');
	out.push('Ranked by promotion value: the program score (fit, reach, access) plus two points for each kind of promotion the program offers. For a program we already belong to, the ask is the promotion itself; for the rest it rides on the application. Work these first when the goal is reach.');
	out.push('');
	out.push('| # | Program | Company | Sector | Promotion | Value | Cost | Next action |', '|---|---|---|---|---|---|---|---|');
	[...rows]
		.sort((x, y) => byPromo(x.p, y.p))
		.slice(0, 30)
		.forEach(({ sector, p }, i) => out.push(`| ${i + 1} | ${link(p)} | ${esc(p.company)} | ${label(sector)} | ${promoTags(p)} | ${promoValue(p)} | ${esc(p.cost || '')} | ${esc(p.next || STATUSES[p.status])} |`));
	out.push('');
	out.push('## By kind of promotion');
	out.push('');
	for (const [t, name] of Object.entries(PROMO_TYPES)) {
		const of = rows.filter((r) => r.p.promo.includes(t)).sort((x, y) => byRank(x.p, y.p));
		out.push(`### ${name}`);
		out.push('');
		if (!of.length) {
			out.push('No tracked program offers this yet.', '');
			continue;
		}
		out.push('| Program | Company | Sector | How to get it | Status | Score |', '|---|---|---|---|---|---|');
		for (const { sector, p } of of) out.push(`| ${link(p)} | ${esc(p.company)} | ${label(sector)} | ${esc(p.promo_note)} | ${STATUSES[p.status]} | ${score(p)} |`);
		out.push('');
	}
	out.push('## Keeping it true');
	out.push('');
	out.push('- **Tag only what is stated or documented.** A company having a social account is not a promotion benefit. Mark a track-record-only tag as such in `promo_note`.');
	out.push('- **Ask on the way in.** Put the promotion ask in the application or acceptance reply; most programs grant it at onboarding and rarely later.');
	out.push('- **Record what we win.** A published post, case study, or spotlight is a benefit: record it with `--benefit` and the live URL in `--note`, then add it to [press-kit.md](../press-kit.md) coverage where it belongs.');
	out.push('- **$THREE is the only coin we promote.** A crypto ecosystem promoting three.ws is welcome; three.ws promoting another token in return is not part of any deal without owner approval.');
	out.push('');
	return out.join('\n');
}

/** The easiest open door into every household-name company (companies flagged `moonshot`), and the ones we already walked through. */
export function renderMoonshots(all) {
	const label = (sector) => SECTORS[sector].label;
	const won = [];
	const doors = [];
	for (const { sector, db } of all) {
		for (const c of db.companies.filter((x) => x.moonshot)) {
			const mine = db.programs.filter((p) => p.company === c.name);
			for (const p of mine.filter((x) => x.status === 'member')) won.push({ sector, p });
			const open = mine.filter((p) => !INACTIVE.has(p.status) && p.status !== 'member').sort((x, y) => y.access - x.access || byRank(x, y));
			doors.push({ sector, company: c.name, best: open[0], more: open.length - 1, held: mine.some((p) => p.status === 'member') });
		}
	}
	const withDoor = doors.filter((d) => d.best);
	const noDoor = doors.filter((d) => !d.best && !d.held);
	const out = [];
	out.push('# Moonshots');
	out.push('');
	out.push(`<!-- Generated by scripts/partner-programs.mjs from ${all.map(({ sector }) => rel(SECTORS[sector].data)).join(', ')}. Do not edit by hand. -->`);
	out.push('');
	out.push(
		'The partnerships that look impossible. A partnership with IBM or OpenAI sounded out of reach for a small open-source 3D agent startup, and both started the same way: someone checked whether the company had a partner program, and it did. This page takes every household-name company in the sector trackers and names the single most open door into each one, so the next impossible partner is a form away instead of a daydream.',
	);
	out.push('');
	out.push(
		`**${doors.length} household names tracked.** We already hold ${won.length} programs at ${new Set(won.map(({ p }) => p.company)).size} of them, ${withDoor.length} have a door open or watchable today, and ${noDoor.length} have no public route yet. Access is scored honestly: 5 is self-serve, 3 is a competitive application, 1 is invite-only or needs a size we do not have yet.`,
	);
	out.push('');
	out.push('## Doors we already walked through');
	out.push('');
	out.push('Proof that the method works. Each of these looked out of reach before the application went in; name them in every new application.');
	out.push('');
	out.push('| Program | Company | Sector | What is left to claim |', '|---|---|---|---|');
	for (const { sector, p } of [...won].sort((x, y) => byRank(x.p, y.p))) out.push(`| ${link(p)} | ${esc(p.company)} | ${label(sector)} | ${esc(p.next || 'Nothing open; keep it current')} |`);
	out.push('');
	out.push('## The easiest door into each household name');
	out.push('');
	out.push('One row per company: the most open door, then the best scored among equals. The sector page lists every other door.');
	out.push('');
	out.push('| # | Company | Sector | Easiest door | Access | Score | More doors | Next action |', '|---|---|---|---|---|---|---|---|');
	[...withDoor]
		.sort((x, y) => y.best.access - x.best.access || byRank(x.best, y.best))
		.forEach((d, i) => out.push(`| ${i + 1} | ${esc(d.company)}${d.held ? ' (already a member elsewhere)' : ''} | [${label(d.sector)}](./${docName(SECTORS[d.sector].doc)}) | ${link(d.best)} | ${d.best.access} | ${score(d.best)} | ${d.more || ''} | ${esc(d.best.next)} |`));
	out.push('');
	if (noDoor.length) {
		out.push('## No public door yet');
		out.push('');
		out.push('Checked, and no partner, startup, developer, or open-call route a company like ours can use today. Re-check on the quarterly sweep; doors open.');
		out.push('');
		for (const d of noDoor.sort((x, y) => x.company.localeCompare(y.company))) out.push(`- **${esc(d.company)}** (${label(d.sector)})`);
		out.push('');
	}
	out.push('## How to work a moonshot');
	out.push('');
	out.push('- **Take the open door, not the front door.** A startup program, an app store, a developer platform, or an open call gets a small company inside a giant; the strategic partnership comes later, from inside.');
	out.push('- **Lead with what already holds.** Acceptance by one household name is the strongest signal to the next.');
	out.push('- **Ask for the promotion on the way in.** The [promotion index](./promotion-programs.md) says which of these doors also come with a blog post, a showcase, or a demo day.');
	out.push('- **Record every attempt.** `npm run programs -- --log <id> --action "..." --status submitted` keeps the chase list honest; a no is data, and most of these reopen on a cadence.');
	out.push('');
	return out.join('\n');
}

/** Every generated file and its content, for --build and --check. */
export function outputs(all) {
	const files = all.map(({ sector, db }) => [SECTORS[sector].doc, render(db, sector) + '\n']);
	files.push([PROMO_DOC, renderPromo(all) + '\n']);
	files.push([MOONSHOT_DOC, renderMoonshots(all) + '\n']);
	return files;
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
	const all = loadAll();
	const errs = validateAll(all);
	if (errs.length) fail(errs);
	const onlySector = arg(args, '--sector');
	if (onlySector && !SECTORS[onlySector]) fail([`unknown sector "${onlySector}"; one of ${Object.keys(SECTORS).join(', ')}`]);
	const scoped = all.filter(({ sector }) => !onlySector || sector === onlySector);
	const programs = scoped.flatMap(({ sector, db }) => db.programs.map((p) => ({ sector, p })));
	const total = all.reduce((n, { db }) => n + db.programs.length, 0);

	const holder = (id) => {
		const hit = all.find(({ db }) => db.programs.some((p) => p.id === id));
		if (!hit) throw new Error(`no program with id "${id}" in any sector (see data/partner-programs*.json)`);
		return hit;
	};
	const buildAll = () => {
		for (const [path, content] of outputs(all)) writeFileSync(path, content);
	};
	const write = ({ sector, db }) => {
		const after = validateAll(all);
		if (after.length) fail(after);
		save(db, SECTORS[sector].data);
		buildAll();
	};

	try {
		if (args.includes('--log')) {
			const h = holder(arg(args, '--log'));
			const p = logSubmission(h.db, arg(args, '--log'), {
				action: arg(args, '--action'),
				status: arg(args, '--status'),
				ref: arg(args, '--ref'),
				date: arg(args, '--date', today),
			});
			write(h);
			console.log(`logged on ${p.id} (${h.sector}): status ${p.status}, ${p.log.length} log entr${p.log.length === 1 ? 'y' : 'ies'}`);
		} else if (args.includes('--benefit')) {
			const h = holder(arg(args, '--benefit'));
			const p = recordBenefit(h.db, arg(args, '--benefit'), {
				name: arg(args, '--name'),
				value: arg(args, '--value'),
				state: arg(args, '--state', 'received'),
				received: arg(args, '--received'),
				expires: arg(args, '--expires'),
				note: arg(args, '--note'),
			});
			write(h);
			console.log(`benefit recorded on ${p.id} (${h.sector}): ${p.received.length} on file`);
		} else if (args.includes('--build')) {
			buildAll();
			for (const { sector, db } of all) console.log(`wrote ${rel(SECTORS[sector].doc)} (${db.programs.length} programs)`);
			console.log(`wrote ${rel(PROMO_DOC)}`);
			console.log(`wrote ${rel(MOONSHOT_DOC)}`);
		} else if (args.includes('--check')) {
			const stale = outputs(all)
				.filter(([path, content]) => (existsSync(path) ? readFileSync(path, 'utf8') : '') !== content)
				.map(([path]) => `${rel(path)} is stale: run npm run programs:build`);
			if (stale.length) fail(stale);
			console.log(`partner programs ok (${total} programs across ${all.length} sectors)`);
		} else if (args.includes('--due')) {
			const days = Number(arg(args, '--days', 30));
			const r = { deadlines: [], expiring: [], chase: [] };
			for (const { sector, db } of scoped) {
				const one = due(db, today, days);
				for (const k of Object.keys(r)) r[k].push(...one[k].map((x) => ({ ...x, sector })));
			}
			r.deadlines.sort((a, b) => a.days - b.days);
			r.expiring.sort((a, b) => a.days - b.days);
			r.chase.sort((a, b) => b.days - a.days);
			const lines = [
				...r.deadlines.map(({ p, days: n, sector }) => `DEADLINE  ${p.deadline} (${n}d)  [${sector}] ${p.company}: ${p.program}  -> ${p.next}`),
				...r.expiring.map(({ p, b, days: n, sector }) => `EXPIRES   ${b.expires} (${n}d)  [${sector}] ${p.company}: ${b.benefit} [${BENEFIT_STATES[b.state]}]`),
				...r.chase.map(({ p, days: n, since, sector }) => `CHASE     ${n}d since ${since}  [${sector}] ${p.company}: ${p.program}`),
			];
			console.log(lines.length ? lines.join('\n') : `nothing due in the next ${days} days`);
			if (args.includes('--strict') && lines.length) process.exitCode = 1;
		} else if (args.includes('--next')) {
			const limit = Number(arg(args, '--limit', 15));
			const rows = programs
				.filter(({ p }) => waveOf(p) !== null)
				.sort((a, b) => waveOf(a.p) - waveOf(b.p) || byRank(a.p, b.p))
				.slice(0, limit);
			for (const { sector, p } of rows) console.log(`W${waveOf(p)}  ${String(score(p)).padStart(2)}  [${sector}] ${p.company}: ${p.program}\n          -> ${p.next}`);
		} else if (args.includes('--promo')) {
			const type = arg(args, '--promo');
			const want = type && !type.startsWith('--') ? type : null;
			if (want && !PROMO_TYPES[want]) fail([`unknown promo type "${want}"; one of ${Object.keys(PROMO_TYPES).join(', ')}`]);
			const limit = Number(arg(args, '--limit', 25));
			const rows = programs
				.filter(({ p }) => !INACTIVE.has(p.status) && (p.promo || []).length && (!want || p.promo.includes(want)))
				.sort((a, b) => (want ? byRank(a.p, b.p) : byPromo(a.p, b.p)))
				.slice(0, limit);
			for (const { sector, p } of rows) console.log(`${String(want ? score(p) : promoValue(p)).padStart(2)}  [${sector}] ${p.company}: ${p.program}  {${p.promo.join(', ')}}\n          -> ${p.promo_note}`);
			if (!rows.length) console.log('no open program offers that promotion');
		} else {
			console.log(`partner programs valid (${total} programs across ${all.length} sectors: ${all.map(({ sector, db }) => `${sector} ${db.programs.length}`).join(', ')})`);
		}
	} catch (err) {
		fail([err.message]);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
