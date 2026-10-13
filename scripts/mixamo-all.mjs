#!/usr/bin/env node
/**
 * mixamo-all.mjs — Complete Mixamo animation pipeline
 *
 * Phases (each is resumable — re-run anytime to continue from where it left off):
 *
 *   Phase 1 — Catalog   (no auth needed)
 *     Fetches all 2,400+ Mixamo Motions AND MotionPacks (names, IDs,
 *     categories) from the public Mixamo API and saves them to
 *     scripts/mixamo-catalog.json.
 *
 *   Phase 2 — Download  (needs MIXAMO_TOKEN)
 *     For each catalog entry, triggers a retarget export on Mixamo, polls
 *     the character monitor until the file is ready, and saves it to
 *     animation-sources/ (MotionPacks arrive as zips and are extracted to
 *     one mx-*.fbx per clip). Skips entries already downloaded. Respects
 *     rate limits with exponential backoff. Saves progress to
 *     scripts/mixamo-progress.json after each file.
 *     Exports are serial by default: Mixamo's status endpoint is the
 *     per-character monitor, so concurrent exports on one character
 *     interleave. gms_hash params are flattened to the comma-joined value
 *     string the export API requires (raw arrays get HTTP 400).
 *
 *   Phase 3 — Integrate
 *     Reads the saved mx-*.fbx files, cross-references the catalog for
 *     human-readable names, and regenerates scripts/mixamo-library.config.json
 *     (icon + loop flag inferred per clip). The curated set in
 *     scripts/animations.config.json stays hand-managed and untouched —
 *     the bulk library never ships in public/.
 *
 *   Phase 4 — Build
 *     Retargets every library clip to the canonical skeleton via
 *     scripts/build-animations.mjs with staging overrides, writing baked
 *     clip JSONs to animation-sources/.library-clips/ (gitignored, ~3 GB
 *     for the full catalog).
 *
 *   Phase 5 (Upload): DISABLED PERMANENTLY, see uploadLibrary() below.
 *     Adobe's Mixamo terms permit in-project playback but not redistributing
 *     raw clip files, which is exactly what publishing to the public bulk
 *     library and its mirror script did. The bulk library now builds and
 *     publishes from CC0 sources via scripts/cc0-animation-library.mjs.
 *
 * Usage:
 *   node scripts/mixamo-all.mjs --catalog    # phase 1 only (no auth)
 *   node scripts/mixamo-all.mjs --download   # phases 1+2 (needs MIXAMO_TOKEN)
 *   node scripts/mixamo-all.mjs --integrate  # phases 1+3 (use saved sources)
 *   node scripts/mixamo-all.mjs --build      # phase 4 only (local retarget research)
 *   node scripts/mixamo-all.mjs --concurrency=5 --limit=50  # tuning flags
 *
 * Required for download phase:
 *   MIXAMO_TOKEN in .env.local — either run node scripts/get-mixamo-token.mjs
 *   (needs ADOBE_EMAIL/ADOBE_PASSWORD in .env.local), or copy it by hand:
 *   log in at mixamo.com → DevTools → Network → any api/v1 request →
 *   Request Headers → "Authorization: Bearer eyJ…" (token only, no "Bearer ").
 *   Tokens expire after ~24h; on 401 refresh the token and re-run.
 *
 * Optional:
 *   MIXAMO_CHARACTER_ID — export character override. Defaults to the
 *   account's primary character (/characters/primary), falling back to Y-Bot.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, mkdtempSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Config ─────────────────────────────────────────────────────────────────
const Y_BOT_ID = '4f5d21e1-4ccc-41f1-b35b-fb2547bd8493';
const MIXAMO_API = 'https://www.mixamo.com/api/v1';
const PAGE_LIMIT = 96;
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 40;
const RATE_LIMIT_BASE_MS = 30_000;
const RATE_LIMIT_MAX_MS = 300_000;

// ── Parse CLI flags ────────────────────────────────────────────────────────
const flags = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const m = a.match(/^--([^=]+)(?:=(.*))?$/);
		return m ? [m[1], m[2] ?? true] : [a, true];
	}),
);

const RUN_CATALOG   = flags.catalog   || flags.download || flags.integrate || flags.all || (!Object.keys(flags).length);
const RUN_DOWNLOAD  = flags.download  || flags.all       || (!Object.keys(flags).length);
const RUN_INTEGRATE = flags.integrate || flags.all       || (!Object.keys(flags).length);
const RUN_BUILD     = flags.build     || flags.all       || (!Object.keys(flags).length);
const RUN_UPLOAD    = flags.upload    || flags.all       || (!Object.keys(flags).length);
// Serial by default — export status comes from the per-character monitor, so
// parallel exports on the same character clobber each other's results.
const CONCURRENCY   = Number(flags.concurrency) || 1;
const MAX_DOWNLOADS = flags.limit ? Number(flags.limit) : Infinity;

// ── Sharding ─────────────────────────────────────────────────────────────────
// --shard=I/N splits the catalog across N cooperating downloaders (one per
// Mixamo account/token, ideally one per egress IP). Shard I (1-indexed) claims
// every clip whose catalog index ≡ (I-1) mod N — an interleave, so each shard
// gets an even mix of fast/slow clips. Shards write disjoint slices but share
// animation-sources/, and the on-disk mx-*.fbx existence check is the final
// dedup guard, so overlapping or restarted shards never re-export a clip.
function parseShard(v) {
	if (!v || v === true) return { index: 1, count: 1 };
	const m = String(v).match(/^(\d+)\s*\/\s*(\d+)$/);
	if (!m) throw new Error(`--shard must look like I/N (e.g. 2/6), got "${v}"`);
	const index = Number(m[1]);
	const count = Number(m[2]);
	if (index < 1 || index > count) throw new Error(`--shard index ${index} out of range for ${count} shards`);
	return { index, count };
}
const SHARD = parseShard(flags.shard);

// ── Paths ──────────────────────────────────────────────────────────────────
const CATALOG_PATH  = join(__dirname, 'mixamo-catalog.json');
// Each shard keeps its own progress file so parallel processes never clobber
// one another's writes (the shared FBX-on-disk check still dedups across them).
const PROGRESS_PATH = SHARD.count > 1
	? join(__dirname, `mixamo-progress.shard-${SHARD.index}-of-${SHARD.count}.json`)
	: join(__dirname, 'mixamo-progress.json');
const SOURCES_DIR   = join(ROOT, 'animation-sources');

// Bulk library outputs: all gitignored, the library ships via R2, not git.
// (Upload is disabled, see uploadLibrary() below, so only the config/stage
// paths phases 1-4 still use are kept here.)
const LIBRARY_CONFIG_PATH   = join(__dirname, 'mixamo-library.config.json');

mkdirSync(SOURCES_DIR, { recursive: true });

// ── Env / token ────────────────────────────────────────────────────────────
function loadEnv(key) {
	if (process.env[key]) return process.env[key].trim();
	const p = join(ROOT, '.env.local');
	if (existsSync(p)) {
		const line = readFileSync(p, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
		if (line) return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
	}
	return null;
}

// ── Rate-limit helpers ─────────────────────────────────────────────────────
let cooldownUntil = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitCooldown() {
	while (Date.now() < cooldownUntil) await sleep(Math.min(2000, cooldownUntil - Date.now()));
}

function setCooldown(retryAfterSec, attempt) {
	const backoff = Math.min(RATE_LIMIT_BASE_MS * 2 ** attempt, RATE_LIMIT_MAX_MS);
	const explicit = retryAfterSec ? Number(retryAfterSec) * 1000 : 0;
	const wait = Math.max(explicit, backoff);
	const until = Date.now() + wait;
	if (until > cooldownUntil) {
		cooldownUntil = until;
		console.log(`  ⏸  Rate limited — pausing ${(wait / 1000).toFixed(0)}s`);
	}
}

async function rlFetch(url, init = {}, attempt = 0) {
	await waitCooldown();
	const res = await fetch(url, init);
	if (res.status === 429) {
		setCooldown(res.headers.get('retry-after'), attempt);
		if (attempt >= 6) throw new Error('429 (max retries)');
		return rlFetch(url, init, attempt + 1);
	}
	return res;
}

// ── Slug / icon helpers ────────────────────────────────────────────────────
const slugify = (s) =>
	s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);

// Filename base for a catalog entry: `mx-<slug>-<id12>`. The slug alone
// collides badly — 553 of 2,484 Mixamo clips share a slug (names differing
// only by punctuation, or truncated past 72 chars), which silently overwrote
// each other on disk and capped the library at ~1,931. Appending 12 hex chars
// of the Mixamo product UUID makes every clip a distinct file with zero risk
// of loss. Used everywhere a clip maps to a filename (download + integrate).
const idFrag = (id) => String(id).replace(/[^a-f0-9]/gi, '').slice(0, 12);
const sourceBase = (a) => `mx-${slugify(a.name)}-${idFrag(a.id)}`;

// Drop duplicate catalog rows (same product id), keeping first occurrence.
function dedupeById(list) {
	const seen = new Set();
	const out = [];
	for (const a of list) {
		if (seen.has(a.id)) continue;
		seen.add(a.id);
		out.push(a);
	}
	return out;
}

const ICON_MAP = [
	[/dance|shuffle|twerk|hip.?hop|disco|breakdance|floss|gangnam|dab/i, '💃'],
	[/walk|stride|stroll|march|sneak|creep|crawl/i, '🚶'],
	[/run|sprint|jog|dash|chase/i, '🏃'],
	[/jump|leap|hop|vault|flip|aerial/i, '🦘'],
	[/fight|punch|kick|combat|attack|hit|strike|block|dodge|parry/i, '🥊'],
	[/zombie|monster|creature|undead/i, '🧟'],
	[/wave|greet|hello|bye/i, '👋'],
	[/taunt|insult|mock|point/i, '😤'],
	[/idle|stand|wait|breath/i, '🧍'],
	[/sit|crouch|kneel|squat/i, '🪑'],
	[/cheer|celebrate|victory|happy|joy|clap/i, '🎉'],
	[/angry|rage|frustrated|defeat/i, '😠'],
	[/sad|cry|mourn|defeated/i, '😔'],
	[/pray|bow|worship/i, '🙏'],
	[/climb|scale/i, '🧗'],
	[/swim|dive/i, '🏊'],
	[/shoot|aim|rifle|pistol|gun/i, '🔫'],
	[/sword|blade|slash|stab/i, '⚔️'],
	[/magic|cast|spell/i, '✨'],
	[/work|dig|build|carry|lift/i, '⚒️'],
	[/sport|soccer|football|basketball|tennis/i, '⚽'],
	[/yoga|stretch|workout|exercise/i, '🧘'],
];

function iconFor(label) {
	for (const [re, icon] of ICON_MAP) if (re.test(label)) return icon;
	return '🎬';
}

function loopFor(label) {
	const lbl = label.toLowerCase();
	if (/idle|walk|run|stand|wait|breath|loop|cycle|patrol|sneak|creep|crouch|smoke|lean|vtubing|swim|jog|march/i.test(lbl)) return true;
	return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 — CATALOG
// ═══════════════════════════════════════════════════════════════════════════
async function fetchCatalog() {
	console.log('\n── Phase 1: Fetch Mixamo catalog ─────────────────────────');

	if (existsSync(CATALOG_PATH)) {
		const existing = dedupeById(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')));
		// Older caches predate MotionPack support and carry no `type` field.
		if (existing.length && existing.every((e) => e.type)) {
			console.log(`  Catalog exists (${existing.length} unique products) — using cached version.`);
			console.log(`  Delete scripts/mixamo-catalog.json to re-fetch.`);
			return existing;
		}
		console.log('  Cached catalog predates MotionPack support — re-fetching.');
	}

	const animations = [];
	let page = 1;

	while (true) {
		process.stdout.write(`\r  Fetching page ${page} (${animations.length} so far)…   `);
		const res = await rlFetch(
			`${MIXAMO_API}/products?page=${page}&limit=${PAGE_LIMIT}&type=Motion%2CMotionPack&order=relevance`,
			{ headers: { 'X-Api-Key': 'mixamo2', Accept: 'application/json' } },
		);
		if (!res.ok) throw new Error(`Catalog fetch failed: HTTP ${res.status}`);
		const data = await res.json();
		const results = data.results ?? [];
		animations.push(
			...results.map((r) => ({
				id: r.id,
				type: r.type || 'Motion',
				name: r.description || r.name || r.id,
				category: r.category || '',
				tags: r.tags ?? [],
			})),
		);
		const totalPages = data.pagination?.num_pages ?? 1;
		if (page >= totalPages || results.length === 0) break;
		page++;
		await sleep(120);
	}

	process.stdout.write('\n');
	// Mixamo's paginated feed returns some products on more than one page, so the
	// raw crawl carries duplicates (≈426 of 2,484). Dedupe by product id — the
	// true unique library is ≈2,058 — so counts, progress, and export calls are
	// all against distinct clips.
	const unique = dedupeById(animations);
	writeFileSync(CATALOG_PATH, JSON.stringify(unique, null, 2));
	console.log(`  ✅ Saved ${unique.length} unique animations (${animations.length - unique.length} dupes dropped) to scripts/mixamo-catalog.json`);
	return unique;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — DOWNLOAD
// ═══════════════════════════════════════════════════════════════════════════
// Export API rejects gms_hash whose `params` is the raw [[name, value], …]
// array with HTTP 400 — it wants the values flattened to "0,0,0,0".
function flattenGmsHash(g) {
	if (!g) return null;
	const params = Array.isArray(g.params) ? g.params.map((p) => p[1]).join(',') : (g.params ?? '0');
	return { ...g, params };
}

// A single clip inside a MotionPack export. Mirrors what mixamo.com's bundle
// builds (getSlidersForGmsHash → gmsifySequence): the full clip object with
// `name`, hardcoded `trim`/`overdrive`/`inplace`, and `params` flattened to a
// comma-joined value string. Sending the bare motion gms_hash instead yields a
// server-side "Error while generating the animation".
function packClipHash(motion) {
	const g = motion.gms_hash ?? motion.details?.gms_hash;
	if (!g) return null;
	return {
		name: motion.name,
		'model-id': g['model-id'],
		mirror: false,
		trim: [0, 100],
		overdrive: 0,
		params: Array.isArray(g.params) ? g.params.map((p) => p[1]).join(',') : (g.params ?? '0'),
		'arm-space': 0,
		inplace: false,
	};
}

// The status endpoint Mixamo's own UI polls is the per-character monitor.
// Some deployments also expose a per-product export status — fall back to it
// once if the monitor 404s.
let pollViaMonitor = true;

async function pollForDownloadUrl(animId, characterId, authHeaders) {
	for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
		await sleep(POLL_INTERVAL_MS);
		const url = pollViaMonitor
			? `${MIXAMO_API}/characters/${characterId}/monitor`
			: `${MIXAMO_API}/animations/export/${animId}?character_id=${characterId}`;
		const res = await rlFetch(url, { headers: authHeaders });
		if (res.status === 404 && pollViaMonitor) {
			pollViaMonitor = false;
			continue;
		}
		if (res.status === 401 || res.status === 403) throw new Error(`poll HTTP ${res.status}`);
		if (!res.ok) continue;
		const status = await res.json();
		if (status.status === 'completed') {
			const dl = typeof status.job_result === 'string'
				? status.job_result
				: status.job_result?.url || status.result?.url;
			if (dl) return dl;
			throw new Error(`completed without URL: ${JSON.stringify(status).slice(0, 200)}`);
		}
		if (status.status === 'failed') {
			throw new Error(`retarget failed: ${JSON.stringify(status.job_result ?? status.message ?? '').slice(0, 120)}`);
		}
	}
	throw new Error('poll timeout');
}

// A pack zip exported with mesh_motionpack:'t-pose' bundles the character mesh
// FBX (tens of MB, textured) alongside the per-motion animation FBX. That mesh
// is not an animation — it fails to retarget and would waste ~65 MB each — so
// skip any FBX above this size. Real animation FBX are well under 2 MB.
const PACK_CLIP_MAX_BYTES = 5 * 1024 * 1024;

// MotionPack exports arrive as a zip of FBX files — extract each clip into
// animation-sources/ under the mx-<slug>-<packId12>-<i> convention. The pack id
// + index suffix guarantees uniqueness across packs and against single motions
// (same anti-collision rule as sourceBase).
function extractPack(zipBuf, packId) {
	const tmp = mkdtempSync(join(tmpdir(), 'mixamo-pack-'));
	const files = [];
	try {
		const zipPath = join(tmp, 'pack.zip');
		writeFileSync(zipPath, zipBuf);
		execFileSync('unzip', ['-o', '-q', zipPath, '-d', tmp]);
		let i = 0;
		for (const rel of readdirSync(tmp, { recursive: true })) {
			if (!String(rel).toLowerCase().endsWith('.fbx')) continue;
			const src = join(tmp, rel);
			if (statSync(src).size > PACK_CLIP_MAX_BYTES) continue; // bundled character mesh, not a clip
			const base = String(rel).split('/').pop().replace(/\.fbx$/i, '');
			const out = `mx-${slugify(base)}-${idFrag(packId)}-${i++}.fbx`;
			const dest = join(SOURCES_DIR, out);
			if (!existsSync(dest)) copyFileSync(src, dest);
			files.push(out);
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
	return files;
}

async function resolveCharacterId(authHeaders) {
	if (process.env.MIXAMO_CHARACTER_ID) return process.env.MIXAMO_CHARACTER_ID.trim();
	try {
		const res = await rlFetch(`${MIXAMO_API}/characters/primary`, { headers: authHeaders });
		if (res.ok) {
			const d = await res.json();
			const id = d.primary_character_id || d.uuid || d.id;
			if (id) return id;
		}
	} catch { /* fall through to Y-Bot */ }
	return Y_BOT_ID;
}

async function downloadAll(catalog, token) {
	console.log('\n── Phase 2: Download FBX files ───────────────────────────');
	if (!token) {
		console.log('  ⚠️  MIXAMO_TOKEN not set — skipping download phase.');
		console.log('  To get a token: node scripts/get-mixamo-token.mjs');
		return;
	}

	const authHeaders = {
		Accept: 'application/json',
		'Content-Type': 'application/json',
		Authorization: `Bearer ${token}`,
		'X-Api-Key': 'mixamo2',
	};

	const characterId = await resolveCharacterId(authHeaders);
	console.log(`  Export character: ${characterId}`);

	// Restrict to this shard's slice of the catalog (interleaved by index).
	const shardCatalog = SHARD.count > 1
		? catalog.filter((_, i) => i % SHARD.count === SHARD.index - 1)
		: catalog;
	if (SHARD.count > 1) {
		console.log(`  Shard ${SHARD.index}/${SHARD.count}: ${shardCatalog.length} of ${catalog.length} clips`);
	}

	const progress = existsSync(PROGRESS_PATH)
		? JSON.parse(readFileSync(PROGRESS_PATH, 'utf8'))
		: {};

	const saveProgress = () => {
		writeFileSync(PROGRESS_PATH + '.tmp', JSON.stringify(progress, null, 2));
		renameSync(PROGRESS_PATH + '.tmp', PROGRESS_PATH);
	};

	const toDownload = shardCatalog.filter((a) => {
		if (progress[a.id]?.status === 'done') {
			// Pack clips are recorded in progress; single motions re-check disk.
			if (a.type === 'MotionPack') return false;
			const outPath = join(SOURCES_DIR, `${sourceBase(a)}.fbx`);
			return !existsSync(outPath);
		}
		if (progress[a.id]?.status === 'perm_fail') return false;
		return true;
	});

	const alreadyDone = shardCatalog.length - toDownload.length;
	console.log(`  Catalog: ${shardCatalog.length} | Already done: ${alreadyDone} | To download: ${Math.min(toDownload.length, MAX_DOWNLOADS)}`);

	let ok = 0, fail = 0;
	let cursor = 0;

	async function downloadOne(anim, idx) {
		const label = `  [${idx + 1 + alreadyDone}/${shardCatalog.length}]`;
		const base = sourceBase(anim);
		const isPack = anim.type === 'MotionPack';
		const outPath = join(SOURCES_DIR, `${base}.fbx`);

		try {
			// Get gms_hash export params
			const detailRes = await rlFetch(
				`${MIXAMO_API}/products/${anim.id}?character_id=${characterId}`,
				{ headers: authHeaders },
			);
			if (!detailRes.ok) {
				const code = detailRes.status;
				if (code === 400 || code === 404) {
					progress[anim.id] = { status: 'perm_fail', http: code };
					saveProgress();
				}
				throw new Error(`detail HTTP ${code}`);
			}
			const detail = await detailRes.json();
			// Motions and MotionPacks need different export shapes (mirrors what
			// mixamo.com's own bundle sends — see gmsifySequence + the Motion vs
			// MotionPack preference sets). Packs: full per-clip objects with the
			// pose in `mesh_motionpack`, no `skin`. Motions: the single flattened
			// gms_hash with `skin`.
			const gmsHashes = isPack
				? (detail?.details?.motions ?? []).map((m) => packClipHash(m)).filter(Boolean)
				: [flattenGmsHash(detail?.details?.gms_hash)].filter(Boolean);
			if (!gmsHashes.length) {
				progress[anim.id] = { status: 'perm_fail', reason: 'no_gms_hash' };
				saveProgress();
				throw new Error('no gms_hash');
			}

			const preferences = isPack
				? { format: 'fbx7_2019', mesh_motionpack: 't-pose', fps: '30', reducekf: '0' }
				: { format: 'fbx7', skin: 'false', fps: '30', reducekf: '0' };

			// Request export
			const exportRes = await rlFetch(`${MIXAMO_API}/animations/export`, {
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({
					character_id: characterId,
					product_id: anim.id,
					product_name: anim.name,
					type: anim.type || 'Motion',
					gms_hash: gmsHashes,
					preferences,
				}),
			});
			if (!exportRes.ok) {
				const code = exportRes.status;
				if (code === 400 || code === 404) {
					progress[anim.id] = { status: 'perm_fail', http: code };
					saveProgress();
				}
				throw new Error(`export HTTP ${code}`);
			}

			const dlUrl = await pollForDownloadUrl(anim.id, characterId, authHeaders);

			// Download file
			const fileRes = await rlFetch(dlUrl);
			if (!fileRes.ok) throw new Error(`file download HTTP ${fileRes.status}`);
			const buf = Buffer.from(await fileRes.arrayBuffer());

			if (isPack) {
				const files = extractPack(buf, anim.id);
				progress[anim.id] = { status: 'done', files, bytes: buf.length };
				saveProgress();
				ok++;
				console.log(`${label} ✅ 📦 ${anim.name} (${files.length} clips, ${(buf.length / 1024).toFixed(0)} KB)`);
			} else {
				writeFileSync(outPath, buf);
				progress[anim.id] = { status: 'done', file: `${base}.fbx`, bytes: buf.length };
				saveProgress();
				ok++;
				console.log(`${label} ✅ ${anim.name} (${(buf.length / 1024).toFixed(0)} KB)`);
			}
			await sleep(400);
		} catch (err) {
			fail++;
			console.warn(`${label} ❌ ${anim.name}: ${err.message}`);
			if (/HTTP 401|HTTP 403/.test(err.message)) {
				console.error('\n  🛑 Auth error — token expired. Refresh MIXAMO_TOKEN (or re-run: node scripts/get-mixamo-token.mjs) and re-run; progress is saved.');
				process.exit(2);
			}
		}
	}

	async function worker() {
		while (cursor < toDownload.length && ok + fail < MAX_DOWNLOADS) {
			const i = cursor++;
			await downloadOne(toDownload[i], i);
		}
	}

	const t0 = Date.now();
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	const mins = ((Date.now() - t0) / 60_000).toFixed(1);

	console.log(`\n  Downloaded: ${ok} | Failed: ${fail} | Time: ${mins} min`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — INTEGRATE
// ═══════════════════════════════════════════════════════════════════════════
async function integrate(catalog) {
	console.log('\n── Phase 3: Generate library config ──────────────────────');

	// Build a lookup: filename → catalog entry (keyed by the same collision-free
	// base the download phase writes). Pack clips carry an extra index suffix and
	// won't match here — they fall back to a humanized filename label.
	const byFile = new Map(catalog.map((a) => [`${sourceBase(a)}.fbx`, a]));

	// Turn an unmatched filename into a readable label: drop the mx- prefix, the
	// trailing -<hex id>(-<index>) suffix, and the extension, then de-hyphenate.
	const labelFromFile = (f) => f
		.replace(/^mx-/, '')
		.replace(/\.fbx$/, '')
		.replace(/-[0-9a-f]{12}(-\d+)?$/i, '')
		.replace(/-/g, ' ')
		.trim();

	// Scan animation-sources/ for mx-*.fbx files. The library config is fully
	// regenerated each run — it is derived data, never hand-edited. The curated
	// scripts/animations.config.json is deliberately not touched.
	const files = readdirSync(SOURCES_DIR).filter((f) => f.startsWith('mx-') && f.endsWith('.fbx'));

	const entries = files
		.map((file) => {
			const anim = byFile.get(file);
			const label = anim?.name ?? labelFromFile(file);
			const entry = {
				name: file.replace(/\.fbx$/, ''), // mx-<slug>, unique by construction
				source: file,
				label,
				icon: iconFor(label),
				loop: loopFor(label),
			};
			if (anim?.category) entry.category = anim.category;
			return entry;
		})
		.sort((a, b) => a.name.localeCompare(b.name));

	writeFileSync(LIBRARY_CONFIG_PATH, JSON.stringify(entries, null, 2));
	console.log(`  ✅ ${entries.length} clips → scripts/mixamo-library.config.json`);
	return entries.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 — BUILD (library staging, not the curated public set)
// ═══════════════════════════════════════════════════════════════════════════
async function build() {
	console.log('\n── Phase 4: Bake library clips (staging) ──────────────────');
	if (!existsSync(LIBRARY_CONFIG_PATH)) {
		console.log('  ⚠️  No library config — run the integrate phase first.');
		return;
	}
	console.log('  Retargeting library FBX → animation-sources/.library-clips/\n');

	const result = spawnSync(process.execPath, [
		join(__dirname, 'build-animations.mjs'),
		'--config=scripts/mixamo-library.config.json',
		'--out=animation-sources/.library-clips',
		'--manifest=animation-sources/.library-clips/manifest.json',
		// Staged urls are library-root-relative; the upload phase writes the
		// final absolute CDN urls into the published manifest.
		'--url-prefix=clips/',
	], { cwd: ROOT, stdio: 'inherit' });

	if (result.status !== 0) {
		console.error(`\n  ❌ Build failed (exit ${result.status})`);
		process.exit(result.status ?? 1);
	}
	console.log('\n  ✅ Library staging build complete.');
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5 — UPLOAD (R2)
// ═══════════════════════════════════════════════════════════════════════════
async function uploadLibrary() {
	console.log('\n── Phase 5: Upload library to R2 ──────────────────────────');

	// Disabled for good (prompts/finish/085-partners-02-animation-library-license.md).
	// Adobe's Mixamo terms permit in-project playback but not redistributing the
	// raw character/animation files, which is exactly what this phase did:
	// publish clips/*.json + manifest.json behind a public GET endpoint
	// (api/animations/library.js) with a dedicated third-party mirror script
	// (scripts/mirror-animation-library.mjs). That risk is retired, not worked
	// around, so this phase refuses to run rather than gating on a flag someone
	// could flip back on. The bulk library is now built and published from CC0
	// sources by scripts/cc0-animation-library.mjs --upload instead. Phases 1-4
	// above are untouched and still useful for research/offline retargeting.
	console.error(
		"  ⛔ Upload disabled permanently: redistributing raw Mixamo clip files is not covered by Adobe's license.",
	);
	console.error('  Use `node scripts/cc0-animation-library.mjs --upload` to publish the CC0 replacement library.');
	process.exitCode = 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
(async () => {
	console.log('🎬 Mixamo full pipeline\n');

	const token = loadEnv('MIXAMO_TOKEN');

	if (RUN_DOWNLOAD && !token) {
		console.log('ℹ️  No MIXAMO_TOKEN found. Running catalog + integrate only.');
		console.log('   To download FBX files, add MIXAMO_TOKEN to .env.local');
		console.log('   (get it: node scripts/get-mixamo-token.mjs)\n');
	}

	let catalog = [];

	if (RUN_CATALOG) {
		catalog = await fetchCatalog();
	}

	if (RUN_DOWNLOAD) {
		await downloadAll(catalog, token);
	}

	if (RUN_INTEGRATE) {
		await integrate(catalog);
	}

	if (RUN_BUILD) {
		await build();
	}

	if (RUN_UPLOAD) {
		await uploadLibrary();
	}

	console.log('\n✅ Pipeline complete.');
})().catch((err) => {
	console.error('\n💥', err.message);
	process.exit(1);
});
