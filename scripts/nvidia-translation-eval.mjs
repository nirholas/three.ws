#!/usr/bin/env node
// nvidia-translation-eval: pick the NVIDIA model that translates each
// configured locale best, on a measured bar.
//
// For every locale in .i18nrc.json and every model in
// NVIDIA_TRANSLATION_CANDIDATES this scores:
//
//   chrF        corpus chrF2 on an evenly spaced FLORES-200 devtest sample,
//               translated through the exact request the pipeline makes
//               (JSON for Nemotron, numbered tagged segments for Riva)
//   integrity   share of real catalog strings (ones carrying placeholders,
//               HTML, or glossary terms) whose [[Tn]] tokens and markup
//               survive the round trip, with the product reference in the
//               prompt as in production
//   parse       share of requests whose reply parsed in the shape asked for
//   latency     median seconds per request
//
// Then it routes each locale to the best model that clears the bar and writes:
//   scripts/lib/i18n-nvidia-routes.json          read by i18n-translate.mjs
//   docs/nvidia/evals/translation-<date>.json    every raw score
//
// Resumable: each (locale, model) cell is cached under
// ~/.cache/three-ws/nvidia-translation-eval/<date>/ as it finishes, so a run
// stopped by a free-tier rate limit picks up where it left off.
//
// FLORES-200 (CC BY-SA 4.0) is downloaded on first use, never committed.
//
// Usage:
//   node scripts/nvidia-translation-eval.mjs                 # every locale
//   node scripts/nvidia-translation-eval.mjs --locales=sv,bg  # a subset
//   node scripts/nvidia-translation-eval.mjs --sentences=40 --concurrency=4
//   node scripts/nvidia-translation-eval.mjs --report-only     # rebuild outputs from the cache

import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { config as dotenv } from 'dotenv';
import { ROOT, loadConfig, readJSON, flatten, buildMasker } from './lib/i18n-shared.mjs';
import { corpusChrF, tokensIntact, backoffDelay } from './lib/i18n-quality.mjs';
import {
	NVIDIA_TRANSLATION_CANDIDATES,
	ROUTES_PATH,
	nvidiaMaxKeysPerChunk,
	nvidiaTranslate,
	promptLanguageName,
} from './lib/i18n-nvidia.mjs';
import { markupDrift } from './lib/i18n-shared.mjs';

dotenv({ path: resolve(ROOT, '.env'), quiet: true });
dotenv({ path: resolve(ROOT, '.env.local'), quiet: true });

const args = process.argv.slice(2);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const flag = (n) => args.includes(`--${n}`);

// three.ws locale code -> FLORES-200 language code.
export const FLORES_CODES = {
	es: 'spa_Latn', 'zh-CN': 'zho_Hans', ja: 'jpn_Jpan', ko: 'kor_Hang', fr: 'fra_Latn', de: 'deu_Latn',
	'pt-BR': 'por_Latn', ar: 'arb_Arab', hi: 'hin_Deva', ru: 'rus_Cyrl', tr: 'tur_Latn', vi: 'vie_Latn',
	id: 'ind_Latn', th: 'tha_Thai', fil: 'tgl_Latn', 'zh-TW': 'zho_Hant', it: 'ita_Latn', pl: 'pol_Latn',
	nl: 'nld_Latn', uk: 'ukr_Cyrl', fa: 'pes_Arab', bn: 'ben_Beng', ur: 'urd_Arab', ta: 'tam_Taml',
	te: 'tel_Telu', mr: 'mar_Deva', ms: 'zsm_Latn', sv: 'swe_Latn', da: 'dan_Latn', no: 'nob_Latn',
	fi: 'fin_Latn', el: 'ell_Grek', cs: 'ces_Latn', ro: 'ron_Latn', hu: 'hun_Latn', he: 'heb_Hebr',
	bg: 'bul_Cyrl', sw: 'swh_Latn', hr: 'hrv_Latn', sk: 'slk_Latn', gu: 'guj_Gujr', kn: 'kan_Knda',
	ml: 'mal_Mlym', as: 'asm_Beng', ne: 'npi_Deva', kk: 'kaz_Cyrl', uz: 'uzn_Latn', az: 'azj_Latn',
	pa: 'pan_Guru', or: 'ory_Orya', si: 'sin_Sinh', ka: 'kat_Geor', hy: 'hye_Armn', mn: 'khk_Cyrl',
	ky: 'kir_Cyrl', tg: 'tgk_Cyrl', km: 'khm_Khmr', lo: 'lao_Laoo', my: 'mya_Mymr', sr: 'srp_Cyrl',
	sl: 'slv_Latn', lt: 'lit_Latn', lv: 'lvs_Latn', et: 'est_Latn', mk: 'mkd_Cyrl', sq: 'als_Latn',
	bs: 'bos_Latn', is: 'isl_Latn', mt: 'mlt_Latn', ga: 'gle_Latn', cy: 'cym_Latn', ca: 'cat_Latn',
	gl: 'glg_Latn', eu: 'eus_Latn', be: 'bel_Cyrl', am: 'amh_Ethi', ha: 'hau_Latn', yo: 'yor_Latn',
	ig: 'ibo_Latn', zu: 'zul_Latn', af: 'afr_Latn', so: 'som_Latn', rw: 'kin_Latn', ps: 'pbt_Arab',
};

// chrF on scripts written without spaces between words runs structurally lower
// (every character n-gram spans what would be a word boundary elsewhere), so
// those get a lower floor. Integrity is the same bar everywhere: a dropped
// placeholder breaks a page in any language.
const UNSEGMENTED = new Set(['zh-CN', 'zh-TW', 'ja', 'th', 'lo', 'km', 'my']);
export const BAR = { chrF: 30, chrFUnsegmented: 20, integrity: 0.95, parse: 0.9, tieChrF: 0.5 };

const date = opt('date') || new Date().toISOString().slice(0, 10);
const cacheDir = join(homedir(), '.cache', 'three-ws', 'nvidia-translation-eval', date);
const floresDir = process.env.FLORES_DIR || join(homedir(), '.cache', 'three-ws', 'flores200');
const nSentences = Number(opt('sentences') || 40);
const nStrings = Number(opt('strings') || 30);
const concurrency = Number(opt('concurrency') || 4);
const batchSize = Number(opt('batch') || 20);

function ensureFlores() {
	const marker = join(floresDir, 'flores200_dataset', 'devtest', 'eng_Latn.devtest');
	if (existsSync(marker)) return join(floresDir, 'flores200_dataset', 'devtest');
	mkdirSync(floresDir, { recursive: true });
	console.log('Downloading FLORES-200 (25 MB, CC BY-SA 4.0)...');
	const tar = join(floresDir, 'flores200.tar.gz');
	const dl = spawnSync('curl', ['-sSfL', '-m', '600', '-o', tar, 'https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz'], { stdio: 'inherit' });
	if (dl.status !== 0) throw new Error('FLORES-200 download failed; set FLORES_DIR to an extracted copy');
	const x = spawnSync('tar', ['xzf', tar, '-C', floresDir], { stdio: 'inherit' });
	if (x.status !== 0 || !existsSync(marker)) throw new Error('FLORES-200 extraction failed');
	return join(floresDir, 'flores200_dataset', 'devtest');
}

function readLines(path) {
	return readFileSync(path, 'utf8').split('\n').filter((l) => l.length);
}

/** Evenly spaced line indices, so the sample spans every article in devtest. */
export function sampleIndices(total, n) {
	const step = total / n;
	return Array.from({ length: Math.min(n, total) }, (_, i) => Math.floor(i * step));
}

/** Real catalog strings that carry protected tokens: the hard cases. */
export function integritySample(sourceFlat, masker, n) {
	const pool = Object.keys(sourceFlat)
		.sort()
		.filter((k) => {
			const v = sourceFlat[k];
			if (typeof v !== 'string' || v.length < 30 || v.length > 240) return false;
			return masker.mask(v).tokens.length > 0;
		});
	return sampleIndices(pool.length, n).map((i) => pool[i]);
}

function chunk(list, size) {
	const out = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

// One request with backoff on rate limits and gateway errors. A reply that
// never parses is a scored failure (it counts against `parse` and leaves its
// sentences empty), not something to retry until it happens to pass.
async function translateWithBackoff({ model, langName, payload, reference, key }) {
	for (let attempt = 0; ; attempt++) {
		const t0 = Date.now();
		try {
			const out = await nvidiaTranslate({ model, langName, payload, reference, key, temperature: 0, timeoutMs: 120_000 });
			return { out, seconds: (Date.now() - t0) / 1000 };
		} catch (err) {
			const transient = err.status === 429 || err.status >= 500;
			if (!transient || attempt >= 6) return { out: null, seconds: (Date.now() - t0) / 1000, error: err.message };
			await new Promise((r) => setTimeout(r, backoffDelay(attempt, { retryAfterSec: err.retryAfter })));
		}
	}
}

async function pool(items, limit, worker) {
	let i = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (i < items.length) {
				const idx = i++;
				await worker(items[idx], idx);
			}
		}),
	);
}

function median(xs) {
	if (!xs.length) return null;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
}

async function evalCell({ code, model, key, cfg, eng, devtest, sentenceIdx, stringKeys, sourceFlat, masker }) {
	const langName = promptLanguageName(code, cfg.localeNames?.[code]);
	const ref = readLines(join(devtest, `${FLORES_CODES[code]}.devtest`));
	const requests = [];
	const latencies = [];
	let parsed = 0;
	const size = Math.min(batchSize, nvidiaMaxKeysPerChunk(model));

	// FLORES: news sentences, no product reference (it would bias the register).
	const hyps = [];
	const refs = [];
	for (const group of chunk(sentenceIdx, size)) {
		const payload = Object.fromEntries(group.map((i) => [`s${i}`, eng[i]]));
		requests.push(async () => {
			const r = await translateWithBackoff({ model, langName, payload, key });
			latencies.push(r.seconds);
			const out = r.out;
			if (out) parsed++;
			for (const i of group) {
				hyps[i] = typeof out?.[`s${i}`] === 'string' ? out[`s${i}`] : '';
				refs[i] = ref[i];
			}
		});
	}

	// Integrity: real catalog strings, masked exactly as the pipeline masks them.
	let intact = 0;
	const failures = [];
	for (const group of chunk(stringKeys, size)) {
		const payload = {};
		const tokens = {};
		for (const k of group) {
			const m = masker.mask(sourceFlat[k]);
			payload[k] = m.masked;
			tokens[k] = m.tokens;
		}
		requests.push(async () => {
			const r = await translateWithBackoff({ model, langName, payload, reference: cfg.reference, key });
			latencies.push(r.seconds);
			const out = r.out;
			if (out) parsed++;
			for (const k of group) {
				const v = out?.[k];
				const ok =
					typeof v === 'string' &&
					tokensIntact(payload[k], v) &&
					!markupDrift(sourceFlat[k], masker.unmask(v, tokens[k]));
				if (ok) intact++;
				else if (failures.length < 3) failures.push({ key: k, got: typeof v === 'string' ? v.slice(0, 160) : null });
			}
		});
	}

	for (const run of requests) await run();
	const order = sentenceIdx.filter((i) => hyps[i] !== undefined);
	return {
		code,
		model,
		chrF: Number(corpusChrF(order.map((i) => hyps[i]), order.map((i) => refs[i])).toFixed(2)),
		integrity: Number((intact / stringKeys.length).toFixed(3)),
		parse: Number((parsed / requests.length).toFixed(3)),
		latencyMedianSec: Number((median(latencies) ?? 0).toFixed(2)),
		requests: requests.length,
		integrityFailures: failures,
		sample: order.slice(0, 2).map((i) => ({ src: eng[i], hyp: hyps[i], ref: refs[i] })),
	};
}

/** Pick the model for one locale from its scored cells. */
export function chooseRoute(code, cells, bar = BAR) {
	const floor = UNSEGMENTED.has(code) ? bar.chrFUnsegmented : bar.chrF;
	const qualified = cells.filter((c) => c.integrity >= bar.integrity && c.parse >= bar.parse && c.chrF >= floor);
	if (!qualified.length) {
		const best = [...cells].sort((a, b) => b.chrF - a.chrF)[0];
		return { model: null, eligible: false, floor, best: best ? { model: best.model, chrF: best.chrF, integrity: best.integrity } : null };
	}
	const top = Math.max(...qualified.map((c) => c.chrF));
	// Within the tie band, the earlier candidate (smaller and faster) wins.
	const pick = NVIDIA_TRANSLATION_CANDIDATES.map((m) => qualified.find((c) => c.model === m)).find(
		(c) => c && c.chrF >= top - bar.tieChrF,
	);
	return { model: pick.model, eligible: true, floor, chrF: pick.chrF, integrity: pick.integrity };
}

function cellPath(code, model) {
	return join(cacheDir, `${code}__${model.replace(/\//g, '_')}.json`);
}

function writeOutputs(cfg, locales) {
	const cells = readdirSync(cacheDir)
		.filter((f) => f.endsWith('.json'))
		.map((f) => JSON.parse(readFileSync(join(cacheDir, f), 'utf8')));
	const byLocale = {};
	for (const c of cells) (byLocale[c.code] ||= []).push(c);
	const routes = { generatedAt: date, bar: BAR, candidates: NVIDIA_TRANSLATION_CANDIDATES, locales: {} };
	// Route a locale only once every candidate has been scored on it, so a
	// --report-only taken while an eval is still running never picks a model
	// just because its rivals have not finished yet.
	for (const code of cfg.outputLocales) {
		const scored = byLocale[code] || [];
		if (!NVIDIA_TRANSLATION_CANDIDATES.every((m) => scored.some((c) => c.model === m))) continue;
		routes.locales[code] = chooseRoute(code, scored);
	}
	// Merge into an existing table so a subset run only refreshes its locales.
	const prior = existsSync(ROUTES_PATH) ? JSON.parse(readFileSync(ROUTES_PATH, 'utf8')) : { locales: {} };
	const merged = { ...routes, locales: { ...prior.locales, ...routes.locales } };
	writeFileSync(ROUTES_PATH, JSON.stringify(merged, null, '\t') + '\n');
	const rawDir = resolve(ROOT, 'docs/nvidia/evals');
	mkdirSync(rawDir, { recursive: true });
	const rawPath = join(rawDir, `translation-${date}.json`);
	const compact = cells
		.map(({ sample, integrityFailures, ...rest }) => ({ ...rest, integrityFailures }))
		.sort((a, b) => a.code.localeCompare(b.code) || a.model.localeCompare(b.model));
	writeFileSync(
		rawPath,
		JSON.stringify(
			{
				date,
				dataset: `FLORES-200 devtest, ${nSentences} evenly spaced sentences per language`,
				integritySet: `${nStrings} public/locales/en.json strings carrying placeholders, HTML or glossary terms`,
				bar: BAR,
				cells: compact,
			},
			null,
			'\t',
		) + '\n',
	);
	console.log(`\nwrote ${ROUTES_PATH}\nwrote ${rawPath}`);
	const eligible = Object.values(merged.locales).filter((r) => r.eligible).length;
	console.log(`${eligible}/${Object.keys(merged.locales).length} locales routed; ${locales.length} evaluated this run`);
}

async function main() {
	const cfg = loadConfig();
	const locales = (opt('locales') ? opt('locales').split(',') : cfg.outputLocales).filter((c) => FLORES_CODES[c]);
	mkdirSync(cacheDir, { recursive: true });
	if (flag('report-only')) return writeOutputs(cfg, locales);

	const key = process.env.NVIDIA_API_KEY?.trim();
	if (!key) throw new Error('NVIDIA_API_KEY not set (read it with: node scripts/read-service-env.mjs \'^NVIDIA_API_KEY$\' --raw)');
	const devtest = ensureFlores();
	const eng = readLines(join(devtest, 'eng_Latn.devtest'));
	const sentenceIdx = sampleIndices(eng.length, nSentences);
	const sourceFlat = flatten(readJSON(resolve(ROOT, cfg.entry)));
	const masker = buildMasker(cfg.doNotTranslate);
	const stringKeys = integritySample(sourceFlat, masker, nStrings);
	const models = opt('models') ? opt('models').split(',') : NVIDIA_TRANSLATION_CANDIDATES;

	const jobs = locales.flatMap((code) => models.map((model) => ({ code, model })));
	const todo = jobs.filter((j) => !existsSync(cellPath(j.code, j.model)));
	console.log(`${jobs.length} cells, ${todo.length} to run, ${jobs.length - todo.length} cached in ${cacheDir}`);
	let done = 0;
	await pool(todo, concurrency, async ({ code, model }) => {
		const cell = await evalCell({ code, model, key, cfg, eng, devtest, sentenceIdx, stringKeys, sourceFlat, masker });
		writeFileSync(cellPath(code, model), JSON.stringify(cell, null, '\t'));
		done++;
		console.log(
			`[${done}/${todo.length}] ${code.padEnd(6)} ${model.padEnd(40)} chrF ${String(cell.chrF).padStart(6)}  integrity ${cell.integrity}  parse ${cell.parse}  ${cell.latencyMedianSec}s`,
		);
	});
	writeOutputs(cfg, locales);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(err.message || err);
		process.exit(1);
	});
}
