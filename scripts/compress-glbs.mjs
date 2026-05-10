#!/usr/bin/env node
/**
 * GLB asset compression pipeline.
 *
 * Applies meshopt compression + geometry optimization to all GLBs under
 * public/ and rider/assets/. The main viewer already has MeshoptDecoder wired,
 * so compressed files decompress transparently on load.
 *
 * Run via: npm run compress:glbs [file1.glb file2.glb ...]
 */
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
	dedup,
	prune,
	resample,
	quantize,
	meshopt,
	textureCompress,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';


const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

async function findGlbs(dir, results = []) {
	if (!existsSync(dir)) return results;
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'dist' || entry.name === 'node_modules') continue;
			await findGlbs(full, results);
		} else if (entry.isFile() && extname(entry.name).toLowerCase() === '.glb') {
			results.push(full);
		}
	}
	return results;
}

async function getSize(path) {
	return (await stat(path)).size;
}

function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function compressGlb(io, path) {
	const sizeBefore = await getSize(path);
	let doc;
	try {
		doc = await io.read(path);
	} catch (err) {
		console.warn(`  SKIP ${relative(ROOT, path)}: read failed — ${err.message}`);
		return null;
	}

	await doc.transform(
		dedup(),
		prune(),
		resample(),
		quantize(),
		textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85 }),
		meshopt({ encoder: MeshoptEncoder }),
	);

	const glb = await io.writeBinary(doc);
	const sizeAfter = glb.byteLength;

	if (sizeAfter >= sizeBefore) {
		console.warn(
			`  WARN ${relative(ROOT, path)}: compressed (${formatBytes(sizeAfter)}) ` +
			`>= original (${formatBytes(sizeBefore)}) — skipping write`,
		);
		return { path, sizeBefore, sizeAfter, skipped: true };
	}

	await writeFile(path, glb);

	const pct = (((sizeBefore - sizeAfter) / sizeBefore) * 100).toFixed(1);
	console.log(
		`  OK  ${relative(ROOT, path)}: ${formatBytes(sizeBefore)} → ${formatBytes(sizeAfter)} (-${pct}%)`,
	);
	return { path, sizeBefore, sizeAfter, skipped: false };
}

async function main() {
	await MeshoptEncoder.ready;
	await MeshoptDecoder.ready;

	const io = new NodeIO()
		.registerExtensions(ALL_EXTENSIONS)
		.registerDependencies({
			'meshopt.encoder': MeshoptEncoder,
			'meshopt.decoder': MeshoptDecoder,
		});

	// Resolve target paths from CLI args or default search dirs
	let paths;
	const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
	if (args.length > 0) {
		paths = args.map((a) => resolve(process.cwd(), a));
	} else {
		const searchDirs = [
			resolve(ROOT, 'public'),
			resolve(ROOT, 'rider', 'assets'),
		];
		paths = [];
		for (const dir of searchDirs) {
			await findGlbs(dir, paths);
		}
	}

	if (paths.length === 0) {
		console.log('No GLB files found.');
		process.exit(0);
	}

	console.log(`\nCompressing ${paths.length} GLB file(s)...\n`);

	const results = [];
	for (const p of paths) {
		const result = await compressGlb(io, p);
		if (result) results.push(result);
	}

	// Summary table
	const processed = results.filter((r) => !r.skipped);
	const skipped = results.filter((r) => r.skipped);
	const totalBefore = results.reduce((s, r) => s + r.sizeBefore, 0);
	const totalAfter = results.reduce((s, r) => s + (r.skipped ? r.sizeBefore : r.sizeAfter), 0);
	const totalPct = totalBefore > 0
		? (((totalBefore - totalAfter) / totalBefore) * 100).toFixed(1)
		: '0.0';

	console.log('\n─────────────────────────────────────────────────────────');
	console.log(`Processed: ${processed.length}  Skipped: ${skipped.length}`);
	console.log(`Total: ${formatBytes(totalBefore)} → ${formatBytes(totalAfter)} (-${totalPct}%)`);
	console.log('─────────────────────────────────────────────────────────\n');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
