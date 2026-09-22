#!/usr/bin/env node
/**
 * Bake the chores clips listed in scripts/eidon-clips.config.json from the
 * Eidon Tracker POV IMU dataset (huggingface.co/datasets/eidon-ai/tracker-pov-imu,
 * CC-BY-4.0) into public/animations/clips/<name>.json.
 *
 * Each recording is fetched once, straight from the Hugging Face parquet
 * shards with HTTP range reads (the shard index maps a recording to its shard
 * and every recording is its own row group, so a 60 s recording is about a
 * megabyte of transfer, never the 9.5 GB set), and cached as aligned frames in
 * animation-sources/eidon/<recording>.json. Like every other source in that
 * directory the cache is gitignored; the baked clip is the committed artifact,
 * and a clean checkout without network access republishes it (PREBUILT), the
 * same contract scripts/build-animations.mjs keeps for Mixamo sources.
 *
 * Usage:
 *   node scripts/build-eidon-clips.mjs                 bake every configured clip
 *   node scripts/build-eidon-clips.mjs --only=<name>   one clip
 *   node scripts/build-eidon-clips.mjs --refetch       ignore the frame cache
 *
 * Finding recordings worth baking:
 *   node scripts/build-eidon-clips.mjs --scan --task=doing_the_dishes --limit=20 [--seconds=14]
 *     ranks candidate recordings by how trustworthy their calibration is and
 *     prints the liveliest window of the requested length in each.
 *   node scripts/build-eidon-clips.mjs --inspect=<recording> [--seconds=14]
 *     full calibration report for one recording.
 *
 * Wired into `npm run build:animations` ahead of the manifest build, which
 * merges these clips from the config the same way it merges the hand-authored
 * extras.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import {
	alignFrames,
	assessPose,
	buildClip,
	calibrate,
	describeCalibration,
	deserializeFrames,
	liveliestWindow,
	qualityScore,
	serializeFrames,
	SLOT,
} from './eidon-imu-clip.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'scripts/eidon-clips.config.json');
const CLIPS_DIR = resolve(ROOT, 'public/animations/clips');
const IDLE_PATH = resolve(CLIPS_DIR, 'idle.json');
const CACHE_DIR = resolve(ROOT, 'animation-sources/eidon');

const HF = 'https://huggingface.co/datasets/eidon-ai';
const IMU_BASE = `${HF}/tracker-pov-imu/resolve/main`;
const METADATA_URL = `${HF}/tracker-pov/resolve/main/recordings/metadata.parquet`;
const IMU_COLUMNS = ['recording_id', 'time_ms', 'slot', 'quat_x', 'quat_y', 'quat_z', 'quat_w'];
const META_COLUMNS = ['recording_id', 'contributor_id', 'task_type', 'duration_seconds', 'qc_status', 'n_slots', 'has_chest', 'good_frame_percent', 'hand_presence_ratio'];

const args = new Map(process.argv.slice(2).map((a) => {
	const m = a.match(/^--([^=]+)(?:=(.*))?$/);
	return m ? [m[1], m[2] ?? true] : [a, true];
}));
const flag = (k) => args.has(k);
const opt = (k, d) => (args.has(k) && args.get(k) !== true ? args.get(k) : d);

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, data) => writeFileSync(p, `${JSON.stringify(data)}\n`);
const cachePath = (name) => resolve(CACHE_DIR, name);

async function cachedJson(name, produce) {
	const path = cachePath(name);
	if (!flag('refetch') && existsSync(path)) return readJson(path);
	const data = await produce();
	mkdirSync(CACHE_DIR, { recursive: true });
	writeJson(path, data);
	return data;
}

async function shardIndex() {
	return cachedJson('shard_index.json', async () => {
		const res = await fetch(`${IMU_BASE}/shard_index.json`);
		if (!res.ok) throw new Error(`shard_index.json: HTTP ${res.status}`);
		return res.json();
	});
}

/** Recording metadata rows (the QC and task columns only), cached once. */
async function metadata() {
	return cachedJson('metadata.json', async () => {
		const file = await asyncBufferFromUrl({ url: METADATA_URL });
		const rows = await parquetReadObjects({ file, columns: META_COLUMNS, compressors });
		return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
	});
}

const shardMetadata = new Map();
async function openShard(shard) {
	if (!shardMetadata.has(shard)) {
		const file = await asyncBufferFromUrl({ url: `${IMU_BASE}/${shard}` });
		shardMetadata.set(shard, { file, meta: await parquetMetadataAsync(file) });
	}
	return shardMetadata.get(shard);
}

/** Fetch one recording's rows by locating its row group through the column statistics. */
async function fetchRecordingRows(recording) {
	const index = await shardIndex();
	const entry = index.find((s) => s.first_recording_id <= recording && recording <= s.last_recording_id);
	if (!entry) throw new Error(`recording ${recording} is in no shard of the index`);
	const { file, meta } = await openShard(entry.shard);
	let rowStart = 0;
	for (const rg of meta.row_groups) {
		const col = rg.columns.find((c) => c.meta_data.path_in_schema[0] === 'recording_id');
		const stats = col.meta_data.statistics;
		const min = Number(stats.min_value ?? stats.min);
		const max = Number(stats.max_value ?? stats.max);
		const rows = Number(rg.num_rows);
		if (min <= recording && recording <= max) {
			const all = await parquetReadObjects({ file, metadata: meta, columns: IMU_COLUMNS, rowStart, rowEnd: rowStart + rows, compressors });
			return all.filter((r) => Number(r.recording_id) === recording);
		}
		rowStart += rows;
	}
	throw new Error(`recording ${recording} not found in ${entry.shard}`);
}

async function loadFrames(recording) {
	const data = await cachedJson(`${recording}.json`, async () => {
		const rows = await fetchRecordingRows(recording);
		if (!rows.length) throw new Error(`recording ${recording} has no rows`);
		return serializeFrames(alignFrames(rows));
	});
	return deserializeFrames(data);
}

function analyse(frames, seconds) {
	const cal = calibrate(frames);
	const pose = assessPose(frames, cal);
	const score = qualityScore(cal, pose);
	const window = liveliestWindow(frames, seconds);
	return { cal, pose, score, window };
}

async function scan() {
	const meta = await metadata();
	const task = opt('task', null);
	const contributor = opt('contributor', null);
	const minSeconds = Number(opt('min-seconds', 10));
	const maxSeconds = Number(opt('max-seconds', 60));
	const limit = Number(opt('limit', 20));
	const seconds = Number(opt('seconds', 14));
	const candidates = meta
		.filter((r) => r.qc_status === 'valid' && r.n_slots === 7 && r.has_chest)
		.filter((r) => r.duration_seconds >= minSeconds && r.duration_seconds <= maxSeconds)
		.filter((r) => !task || r.task_type === task)
		.filter((r) => !contributor || String(r.contributor_id) === String(contributor))
		.sort((a, b) => b.hand_presence_ratio - a.hand_presence_ratio || b.good_frame_percent - a.good_frame_percent)
		.slice(0, limit);
	console.log(`[eidon] scanning ${candidates.length} recordings${task ? ` (${task})` : ''}, ${seconds}s windows`);
	const results = [];
	for (const r of candidates) {
		try {
			const frames = await loadFrames(r.recording_id);
			const { cal, pose, score, window } = analyse(frames, seconds);
			results.push({ recording: r.recording_id, contributor: r.contributor_id, task: r.task_type, seconds: r.duration_seconds, score, window, report: describeCalibration(cal, pose, score) });
		} catch (err) {
			console.warn(`[eidon] ${r.recording_id}: ${err.message}`);
		}
	}
	results.sort((a, b) => b.score - a.score);
	if (flag('json')) { console.log(JSON.stringify(results, null, '\t')); return; }
	for (const x of results) {
		console.log(`${String(x.recording).padStart(6)} c${String(x.contributor).padEnd(3)} ${x.task.padEnd(16)} ${String(x.seconds.toFixed(0)).padStart(3)}s window ${x.window.start.toFixed(1)}-${x.window.end.toFixed(1)}s (${x.window.energy.toFixed(0)}°/s) ${x.report}`);
	}
}

async function inspect(recording) {
	const frames = await loadFrames(recording);
	const seconds = Number(opt('seconds', 14));
	const { cal, pose, score, window } = analyse(frames, seconds);
	const f = (v) => v.toArray().map((n) => n.toFixed(2)).join(', ');
	console.log(`[eidon] recording ${recording}: ${cal.frames} frames, ${cal.seconds.toFixed(1)}s`);
	console.log(`  chest: up [${f(cal.up)}] forward [${f(cal.forward)}] left [${f(cal.left)}] tilt ${cal.quality.chestTiltDeg.toFixed(1)}° yaw±${cal.quality.yawStd.toFixed(1)}°`);
	for (const side of ['left', 'right']) {
		const s = cal.sides[side];
		const [armSlot, foreSlot] = side === 'left' ? [SLOT.leftArm, SLOT.leftForeArm] : [SLOT.rightArm, SLOT.rightForeArm];
		console.log(`  ${side}: distal arm [${f(s.distal[armSlot])}] fore [${f(s.distal[foreSlot])}] anterior [${f(s.anterior)}] dorsal [${f(s.dorsal)}]`);
		console.log(`    ${JSON.stringify(s.quality)}`);
	}
	console.log(`  pose: ${JSON.stringify(pose)}`);
	console.log(`  liveliest ${seconds}s window: ${window.start.toFixed(1)}-${window.end.toFixed(1)}s (${window.energy.toFixed(0)}°/s), score ${score.toFixed(2)}`);
}

async function build() {
	const config = readJson(CONFIG_PATH);
	const idle = readJson(IDLE_PATH);
	const only = opt('only', null);
	let ok = 0;
	let prebuilt = 0;
	let failed = 0;
	for (const def of config.clips) {
		if (only && def.name !== only) continue;
		const outPath = resolve(CLIPS_DIR, `${def.name}.json`);
		let frames;
		try {
			frames = await loadFrames(def.recording);
		} catch (err) {
			if (existsSync(outPath)) {
				console.log(`[eidon] PREBUILT ${def.name.padEnd(22)} recording ${def.recording} unavailable (${err.message})`);
				prebuilt++;
				continue;
			}
			console.error(`[eidon] FAIL ${def.name}: ${err.message}`);
			failed++;
			continue;
		}
		const { clip, calibration } = buildClip(frames, {
			name: def.name,
			idle,
			start: def.start,
			end: def.end,
			loop: def.loop !== false,
			userData: { task: def.task, contributor: def.contributor },
		});
		writeJson(outPath, clip);
		const pose = assessPose(frames, calibration);
		const score = qualityScore(calibration, pose);
		console.log(`[eidon] BAKED ${def.name.padEnd(22)} rec ${String(def.recording).padStart(5)} ${def.start}-${def.end}s ${describeCalibration(calibration, pose, score)}`);
		ok++;
	}
	console.log(`[eidon] ${ok} baked, ${prebuilt} prebuilt, ${failed} failed`);
	if (failed) process.exit(1);
}

if (flag('scan')) await scan();
else if (args.has('inspect')) await inspect(Number(opt('inspect')));
else await build();
