/**
 * download-animations.mjs
 * Downloads Mixamo-compatible animation GLBs from public sources.
 * Run: node scripts/download-animations.mjs
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';

const ANIM_DIR = join(process.cwd(), 'public', 'animations');
mkdirSync(ANIM_DIR, { recursive: true });

// ── Known public GLB sources with animations ──────────────────────────────
// These are from the official three.js examples — guaranteed available.
const MODELS_WITH_ANIMATIONS = [
	{
		name: 'Soldier',
		url: 'https://three.ws/examples/models/gltf/Soldier.glb',
		desc: 'Soldier with Idle/Walk/Run (Mixamo skeleton)',
	},
	{
		name: 'RobotExpressive',
		url: 'https://three.ws/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
		desc: 'Robot with Dance/Death/Idle/Jump/No/Punch/Running/Sitting/Standing/ThumbsUp/Walking/Wave/Yes',
	},
];

// ── Download function ─────────────────────────────────────────────────────
async function download(url, dest) {
	console.log(`  ⬇  ${url}`);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	const buf = Buffer.from(await res.arrayBuffer());
	writeFileSync(dest, buf);
	const sizeKB = Math.round(buf.length / 1024);
	console.log(`  ✅ ${basename(dest)} (${sizeKB} KB)`);
	return buf;
}

// ── Parse GLB JSON chunk to extract animation names ───────────────────────
function parseGlbAnimations(buf) {
	// GLB header: magic(4) + version(4) + length(4)
	const magic = buf.readUInt32LE(0);
	if (magic !== 0x46546c67) return []; // 'glTF'

	const chunkLength = buf.readUInt32LE(12);
	const chunkType = buf.readUInt32LE(16);
	if (chunkType !== 0x4e4f534a) return []; // 'JSON'

	const jsonStr = buf.slice(20, 20 + chunkLength).toString('utf8');
	const gltf = JSON.parse(jsonStr);

	const anims = (gltf.animations || []).map((a) => a.name || 'unnamed');
	const skinCount = (gltf.skins || []).length;
	const jointCount = skinCount > 0 ? (gltf.skins[0].joints || []).length : 0;

	// Get first few bone names for skeleton identification
	const boneNames = [];
	if (skinCount > 0 && gltf.nodes) {
		const joints = gltf.skins[0].joints || [];
		for (let i = 0; i < Math.min(5, joints.length); i++) {
			const node = gltf.nodes[joints[i]];
			if (node) boneNames.push(node.name || `joint_${i}`);
		}
	}

	return { anims, skinCount, jointCount, boneNames };
}

// ── Extract individual animation clips from a multi-animation GLB ─────────
// We can't easily split a GLB into separate files without a full GLTF parser,
// but we CAN make our AnimationManager smart enough to load a single GLB
// and extract multiple clips from it. Let's update the approach.

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
	console.log('🎬 Downloading animation source GLBs...\n');

	const downloaded = [];

	for (const model of MODELS_WITH_ANIMATIONS) {
		const dest = join(ANIM_DIR, `${model.name.toLowerCase()}.glb`);
		try {
			const buf = await download(model.url, dest);
			const info = parseGlbAnimations(buf);
			console.log(`     ${info.anims.length} animations: ${info.anims.join(', ')}`);
			console.log(`     ${info.jointCount} joints, bones: ${info.boneNames.join(', ')}`);
			console.log('');
			downloaded.push({ ...model, file: dest, info });
		} catch (e) {
			console.log(`  ❌ Failed: ${e.message}\n`);
		}
	}

	// ── Build manifest from the RobotExpressive (most animations) ──────────
	// The RobotExpressive has 13 animations in a single GLB — we'll create a
	// manifest that references the same file but different clip names.
	const robot = downloaded.find((d) => d.name === 'RobotExpressive');
	const soldier = downloaded.find((d) => d.name === 'Soldier');

	const ICONS = {
		idle: '🧍',
		Idle: '🧍',
		Walking: '🚶',
		Walk: '🚶',
		walking: '🚶',
		Running: '🏃',
		Run: '🏃',
		running: '🏃',
		Wave: '👋',
		Waving: '👋',
		waving: '👋',
		Dance: '💃',
		Dancing: '💃',
		dancing: '💃',
		Sitting: '🪑',
		sitting: '🪑',
		Jump: '🦘',
		Jumping: '🦘',
		jumping: '🦘',
		Punch: '👊',
		punching: '👊',
		Standing: '🧍',
		ThumbsUp: '👍',
		Yes: '✅',
		No: '🚫',
		Death: '💀',
	};

	const LOOPS = new Set([
		'Idle',
		'Walking',
		'Running',
		'Dance',
		'Sitting',
		'Standing',
		'idle',
		'walking',
		'running',
	]);

	const manifest = [];

	if (robot && robot.info) {
		for (const animName of robot.info.anims) {
			manifest.push({
				name: animName.toLowerCase(),
				url: '/animations/robotexpressive.glb',
				clipName: animName,
				label: animName,
				icon: ICONS[animName] || '▶',
				loop: LOOPS.has(animName),
			});
		}
	}

	// Write manifest
	const manifestPath = join(ANIM_DIR, 'manifest.json');
	writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');
	console.log(`📋 manifest.json written with ${manifest.length} animations`);

	// ── Also check cz.glb skeleton for compatibility ──────────────────────
	const czPath = join(process.cwd(), 'public', 'avatars', 'cz.glb');
	if (existsSync(czPath)) {
		const { readFileSync } = await import('fs');
		const czBuf = readFileSync(czPath);
		const czInfo = parseGlbAnimations(czBuf);
		console.log(`\n🧬 cz.glb skeleton: ${czInfo.jointCount} joints`);
		console.log(`   Bones: ${czInfo.boneNames.join(', ')}`);
		console.log(
			`   Existing animations: ${czInfo.anims.length ? czInfo.anims.join(', ') : '(none)'}`,
		);
	}

	// ── Summary ──────────────────────────────────────────────────────────────
	console.log('\n═══════════════════════════════════════════════════════════');
	const files = readdirSync(ANIM_DIR).filter((f) => f.endsWith('.glb'));
	console.log(`📂 ${files.length} GLB file(s) in public/animations/`);
	for (const f of files) {
		const size = statSync(join(ANIM_DIR, f)).size;
		console.log(`   ${f} (${Math.round(size / 1024)} KB)`);
	}
	console.log(`📋 manifest.json: ${manifest.length} animations`);
	console.log('═══════════════════════════════════════════════════════════');
	console.log('\n✅ Done! Run "npm run dev" to test.');
}

main().catch((e) => {
	console.error('Fatal:', e);
	process.exit(1);
});
