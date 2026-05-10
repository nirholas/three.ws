// Generates api/_lib/demo-avatars.js seed entries from verified public GLB sources.
// Sources: KhronosGroup/glTF-Sample-Assets (CC-BY 4.0), three.js examples (MIT),
// and on-disk shipped assets.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const KHRONOS_BASE = 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets/Models';
const THREEJS_BASE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js/examples/models/gltf';

// Khronos models verified to have glTF-Binary/{name}.glb
const KHRONOS = fs.readFileSync(path.join(HERE, 'khronos-glbs.txt'), 'utf8').trim().split('\n').filter(Boolean);
// three.js model basenames (without .glb)
const THREEJS = fs.readFileSync(path.join(HERE, 'threejs-glbs.txt'), 'utf8').trim().split('\n')
	.map((s) => s.replace(/\.glb$/, '')).filter(Boolean);

// On-disk GLBs we ship with the app
const ON_DISK = [
	{ name: 'CZ', slug: 'cz', path: '/avatars/cz.glb', tags: ['humanoid', 'character'], desc: 'Stylized humanoid avatar with idle pose. Ready for chat overlays.' },
	{ name: 'Default Avatar', slug: 'default-avatar', path: '/avatars/default.glb', tags: ['humanoid', 'starter'], desc: 'Neutral starter humanoid — a clean base for skinning, retargeting, and accessories.' },
	{ name: 'Robot Expressive', slug: 'robot-expressive', path: '/animations/robotexpressive.glb', tags: ['robot', 'animated', 'rigged'], desc: 'Expressive robot character with multiple animation clips: idle, walk, run, jump, dance.' },
	{ name: 'Soldier', slug: 'soldier', path: '/animations/soldier.glb', tags: ['humanoid', 'animated', 'rigged'], desc: 'Rigged soldier character with locomotion animations baked in.' },
];

// Curated metadata for well-known Khronos models. Anything not listed here gets
// auto-classified by name keywords.
const KHRONOS_META = {
	Avocado: { tags: ['food', 'pbr', 'classic'], desc: 'A photorealistic avocado — a Khronos classic for testing physically-based rendering.' },
	BarramundiFish: { tags: ['animal', 'fish', 'pbr'], desc: 'Detailed barramundi fish with realistic scales and PBR materials.' },
	BoomBox: { tags: ['object', 'audio', 'pbr', 'classic'], desc: 'Retro boombox with intricate textures — a benchmark PBR asset.' },
	Box: { tags: ['primitive', 'test'], desc: 'The simplest possible glTF: a single textured cube.' },
	BoxAnimated: { tags: ['primitive', 'animated', 'test'], desc: 'A simple box with a baked transform animation.' },
	BoxInterleaved: { tags: ['primitive', 'test'], desc: 'A box with interleaved vertex attributes — a glTF format test.' },
	BoxTextured: { tags: ['primitive', 'textured'], desc: 'A box with a texture map applied.' },
	BoxTexturedNonPowerOfTwo: { tags: ['primitive', 'textured', 'test'], desc: 'A textured box demonstrating non-power-of-two textures.' },
	BoxVertexColors: { tags: ['primitive', 'colors'], desc: 'A box with per-vertex colors instead of textures.' },
	BrainStem: { tags: ['humanoid', 'rigged', 'animated'], desc: 'Walking humanoid figure with skinned mesh and animations.' },
	CarConcept: { tags: ['vehicle', 'concept', 'pbr'], desc: 'Concept car with sculpted bodywork and clear-coat materials.' },
	CarbonFibre: { tags: ['material', 'pbr', 'test'], desc: 'Carbon-fibre weave material test — anisotropy and clear-coat.' },
	CesiumMan: { tags: ['humanoid', 'rigged', 'animated', 'classic'], desc: 'The iconic Cesium Man — walking animation, fully rigged.' },
	CesiumMilkTruck: { tags: ['vehicle', 'animated', 'classic'], desc: 'Cesium Milk Truck rolling along — wheel rotation animation.' },
	ChairDamaskPurplegold: { tags: ['furniture', 'pbr', 'fabric'], desc: 'Ornate damask chair with gold leaf and patterned upholstery.' },
	ChronographWatch: { tags: ['object', 'pbr', 'metal'], desc: 'Detailed chronograph wristwatch with metallic finish and glass face.' },
	ClearCoatCarPaint: { tags: ['material', 'pbr', 'test'], desc: 'Clear-coat car paint material test under varied lighting.' },
	ClearCoatTest: { tags: ['material', 'test'], desc: 'Clear-coat extension reference test.' },
	ClearcoatWicker: { tags: ['material', 'pbr', 'fabric'], desc: 'Wicker pattern with clear-coat layer.' },
	CommercialRefrigerator: { tags: ['object', 'commercial', 'glass'], desc: 'Commercial glass-door refrigerator with transmission.' },
	DamagedHelmet: { tags: ['object', 'armor', 'pbr', 'iconic'], desc: 'Battle-worn sci-fi helmet — possibly the most-rendered glTF in history.' },
	DiffuseTransmissionPlant: { tags: ['plant', 'transmission', 'pbr'], desc: 'Botanical leaves demonstrating diffuse transmission for thin foliage.' },
	DiffuseTransmissionTeacup: { tags: ['object', 'transmission', 'pbr'], desc: 'Bone china teacup with translucent walls.' },
	DragonAttenuation: { tags: ['creature', 'glass', 'transmission'], desc: 'Glass dragon demonstrating volume attenuation and transmission.' },
	DragonDispersion: { tags: ['creature', 'glass', 'transmission'], desc: 'Glass dragon with chromatic dispersion for prismatic light.' },
	Duck: { tags: ['animal', 'iconic', 'classic'], desc: 'The Khronos Duck — every 3D dev has met this duck.' },
	Fox: { tags: ['animal', 'animated', 'rigged', 'iconic'], desc: 'Stylized fox with three baked animations — Survey, Walk, Run.' },
	GlamVelvetSofa: { tags: ['furniture', 'fabric', 'pbr'], desc: 'Velvet sofa demonstrating sheen for fabric materials.' },
	GlassBrokenWindow: { tags: ['object', 'glass', 'transmission'], desc: 'Shattered window pane with refraction and transmission.' },
	GlassHurricaneCandleHolder: { tags: ['object', 'glass', 'transmission'], desc: 'Hurricane candle holder with thick glass and a flickering candle.' },
	GlassVaseFlowers: { tags: ['object', 'glass', 'plant'], desc: 'Cut-glass vase with flowers — refraction through curved glass.' },
	IridescenceLamp: { tags: ['object', 'pbr', 'iridescent'], desc: 'Lamp shade with iridescent thin-film effect.' },
	IridescenceAbalone: { tags: ['object', 'pbr', 'iridescent'], desc: 'Abalone shell with natural iridescence.' },
	IridescenceSuzanne: { tags: ['classic', 'iridescent'], desc: 'Blender Suzanne with iridescent thin-film material.' },
	IridescentDishWithOlives: { tags: ['food', 'pbr', 'iridescent'], desc: 'Iridescent ceramic dish holding olives.' },
	Lantern: { tags: ['object', 'metal', 'pbr', 'classic'], desc: 'Traditional lantern with intricate metalwork — a Khronos PBR benchmark.' },
	MaterialsVariantsShoe: { tags: ['fashion', 'shoe', 'variants'], desc: 'Shoe with material variants — swap colorways at runtime.' },
	MetalRoughSpheres: { tags: ['material', 'pbr', 'test'], desc: 'Spheres demonstrating the full metallic-roughness range.' },
	MetalRoughSpheresNoTextures: { tags: ['material', 'pbr', 'test'], desc: 'Untextured metallic-roughness sphere grid.' },
	MorphPrimitivesTest: { tags: ['test', 'morph'], desc: 'Morph target test for blend shapes on primitives.' },
	MorphStressTest: { tags: ['test', 'morph'], desc: 'Stress test for many simultaneous morph targets.' },
	NegativeScaleTest: { tags: ['test'], desc: 'Negative scaling and winding-order test.' },
	NormalTangentMirrorTest: { tags: ['test', 'normals'], desc: 'Mirror-symmetry test for normal and tangent vectors.' },
	NormalTangentTest: { tags: ['test', 'normals'], desc: 'Normal/tangent space correctness test.' },
	OrientationTest: { tags: ['test'], desc: 'Coordinate system orientation test for glTF importers.' },
	PointLightIntensityTest: { tags: ['test', 'lighting'], desc: 'Point light intensity falloff test.' },
	PotOfCoals: { tags: ['object', 'fire', 'emissive'], desc: 'Glowing pot of coals demonstrating emissive strength.' },
	ReciprocatingSaw: { tags: ['tool', 'object', 'pbr'], desc: 'Reciprocating saw with detailed mechanical parts.' },
	RecursiveSkeletons: { tags: ['test', 'skinning'], desc: 'Stress test for deeply nested skeletal hierarchies.' },
	RiggedFigure: { tags: ['humanoid', 'rigged', 'classic'], desc: 'Bare-bones rigged humanoid for testing skinning.' },
	RiggedSimple: { tags: ['rigged', 'test'], desc: 'Minimal rigged figure — the smallest possible skinned mesh.' },
	SimpleInstancing: { tags: ['test', 'instancing'], desc: 'EXT_mesh_gpu_instancing demonstration.' },
	SpecGlossVsMetalRough: { tags: ['material', 'test'], desc: 'Spec-gloss vs metallic-roughness workflow comparison.' },
	SpecularSilkPouf: { tags: ['furniture', 'fabric', 'pbr'], desc: 'Silk pouf footstool with specular sheen.' },
	SpecularTest: { tags: ['material', 'test'], desc: 'KHR_materials_specular extension test.' },
	StainedGlassLamp: { tags: ['object', 'glass', 'emissive'], desc: 'Tiffany-style stained glass lamp with internal light source.' },
	TextureCoordinateTest: { tags: ['test', 'textures'], desc: 'UV coordinate correctness test.' },
	TextureLinearInterpolationTest: { tags: ['test', 'textures'], desc: 'Linear texture interpolation test.' },
	TextureSettingsTest: { tags: ['test', 'textures'], desc: 'Texture sampler settings test.' },
	ToyCar: { tags: ['vehicle', 'toy', 'pbr'], desc: 'Stylized toy car with chunky proportions and shiny paint.' },
	TransmissionRoughnessTest: { tags: ['material', 'test', 'transmission'], desc: 'Transmission with varying roughness test.' },
	TransmissionTest: { tags: ['material', 'test', 'transmission'], desc: 'KHR_materials_transmission extension test.' },
	TransmissionThinwallTestGrid: { tags: ['material', 'test', 'transmission'], desc: 'Thin-wall transmission grid test.' },
	UnlitTest: { tags: ['material', 'test'], desc: 'KHR_materials_unlit extension test — flat shading.' },
	VertexColorTest: { tags: ['test', 'colors'], desc: 'Per-vertex color test plane.' },
	VirtualCity: { tags: ['scene', 'environment', 'urban'], desc: 'Stylized low-poly city block — buildings, streets, props.' },
	WaterBottle: { tags: ['object', 'pbr', 'transmission'], desc: 'Water bottle with translucent plastic body and embossed label.' },
	XmpMetadataRoundedCube: { tags: ['test', 'metadata'], desc: 'Rounded cube embedding XMP metadata for attribution.' },
};

// Curated metadata for three.js example models
const THREEJS_META = {
	Soldier: { tags: ['humanoid', 'rigged', 'animated', 'character'], desc: 'Soldier character with walk, run, and idle animations — three.js classic.' },
	Horse: { tags: ['animal', 'animated', 'rigged'], desc: 'Galloping horse with skeletal animation.' },
	Parrot: { tags: ['animal', 'bird', 'animated'], desc: 'Flying parrot with wing-flap animation.' },
	Flamingo: { tags: ['animal', 'bird', 'animated'], desc: 'Pink flamingo in flight.' },
	Stork: { tags: ['animal', 'bird', 'animated'], desc: 'Stork mid-flight with wing animation.' },
	Michelle: { tags: ['humanoid', 'rigged', 'character'], desc: 'Michelle character with Mixamo-compatible rig.' },
	Xbot: { tags: ['robot', 'rigged', 'animated', 'character'], desc: 'X-Bot rigged humanoid robot, ready for retargeting.' },
	LittlestTokyo: { tags: ['scene', 'environment', 'urban', 'animated'], desc: 'Animated Tokyo street scene by Glen Fox — cars driving, neon, atmosphere.' },
	Ferrari: { tags: ['vehicle', 'car', 'pbr'], desc: 'Detailed Ferrari with full PBR materials and accurate proportions.' },
	'duck': { tags: ['animal', 'iconic'], desc: 'Three.js duck — slightly different vibe than the Khronos one.' },
	'facecap': { tags: ['humanoid', 'face', 'animated', 'morph'], desc: 'Face capture sample with blendshape animation.' },
	'kira': { tags: ['humanoid', 'character', 'rigged'], desc: 'Kira character model.' },
	'nemetona': { tags: ['humanoid', 'character'], desc: 'Nemetona character bust.' },
	'ShaderBall': { tags: ['material', 'test'], desc: 'Shader ball — the standard material test sphere with reflective base.' },
	'ShaderBall2': { tags: ['material', 'test'], desc: 'Alternate shader ball variant.' },
	'PrimaryIonDrive': { tags: ['scifi', 'vehicle', 'animated'], desc: 'Primary ion drive engine module with animated pulse.' },
	'collision-world': { tags: ['scene', 'environment', 'test'], desc: 'Test scene with collision geometry.' },
	'pool': { tags: ['scene', 'water', 'environment'], desc: 'Pool scene with water reflections.' },
	'minimalistic_modern_bedroom': { tags: ['scene', 'interior', 'architecture'], desc: 'Minimalist modern bedroom interior.' },
	'space_ship_hallway': { tags: ['scene', 'scifi', 'interior'], desc: 'Sci-fi spaceship corridor scene.' },
	'dungeon_warkarma': { tags: ['scene', 'fantasy', 'environment'], desc: 'Fantasy dungeon scene by Warkarma.' },
	'venice_mask': { tags: ['object', 'mask', 'pbr'], desc: 'Ornate Venetian carnival mask with gold leaf detailing.' },
	'steampunk_camera': { tags: ['object', 'steampunk', 'pbr'], desc: 'Steampunk-style camera with brass fittings and leather wrap.' },
	'rolex': { tags: ['object', 'watch', 'luxury', 'pbr'], desc: 'Detailed Rolex-style timepiece with metallic finish.' },
	'godrays_demo': { tags: ['scene', 'lighting', 'demo'], desc: 'God rays / volumetric lighting demonstration scene.' },
	'readyplayer.me': { tags: ['humanoid', 'avatar', 'character'], desc: 'Ready Player Me avatar sample — humanoid character ready for VR/AR.' },
	'bath_day': { tags: ['scene', 'animated', 'character'], desc: 'Bath day animated scene — quirky character moment.' },
	'coffeeMug': { tags: ['object', 'pbr'], desc: 'Ceramic coffee mug.' },
	'coffeemat': { tags: ['object', 'machine', 'pbr'], desc: 'Coffee machine with detailed dispenser.' },
	'gears': { tags: ['object', 'mechanical', 'animated'], desc: 'Interlocking gears with mechanical animation.' },
	'SheenChair': { tags: ['furniture', 'fabric', 'pbr'], desc: 'Armchair upholstered in sheen-fabric demonstrating KHR_materials_sheen.' },
	'AnisotropyBarnLamp': { tags: ['object', 'lighting', 'pbr'], desc: 'Barn lamp with brushed-metal anisotropic shading.' },
	'BoomBox': { tags: ['object', 'audio', 'pbr'], desc: 'Three.js variant of the iconic boombox.' },
	'DispersionTest': { tags: ['material', 'test', 'glass'], desc: 'Chromatic dispersion test — refraction splitting light.' },
	'DragonAttenuation': { tags: ['creature', 'glass'], desc: 'Three.js dragon with volume attenuation.' },
	'IridescentDishWithOlives': { tags: ['food', 'pbr', 'iridescent'], desc: 'Iridescent dish, three.js packaging.' },
	'IridescenceLamp': { tags: ['object', 'pbr', 'iridescent'], desc: 'Iridescent lamp from three.js examples.' },
	'ShadowmappableMesh': { tags: ['test', 'shadows'], desc: 'Mesh with high-frequency detail for shadow-mapping tests.' },
};

function classifyByName(name) {
	const n = name.toLowerCase();
	const tags = [];
	let desc = '';
	if (/anim|morph|interpol/i.test(name)) tags.push('animated');
	if (/transmission|glass|disperion|attenuation/i.test(name)) tags.push('glass', 'transmission');
	if (/iridescen|anisotropy|sheen|specular|clearcoat/i.test(name)) tags.push('material', 'pbr');
	if (/test|grid|reference/i.test(name)) tags.push('test');
	if (/box|cube|triangle|primitive|simple|compare/i.test(name)) tags.push('primitive');
	if (/light|emissive/i.test(name)) tags.push('lighting');
	if (/ior|alpha|texture/i.test(name)) tags.push('material', 'test');
	if (/instanc|stress/i.test(name)) tags.push('test');
	if (tags.length === 0) tags.push('object');
	desc = `Khronos reference asset — ${name.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}.`;
	return { tags: [...new Set(tags)], desc };
}

const lines = [];
const seenSlugs = new Set();
let idx = 0;

const baseDate = new Date('2025-04-01T00:00:00Z').getTime();

function addItem({ id, slug, name, glbUrl, image, tags, desc, attribution }) {
	if (seenSlugs.has(slug)) {
		// Disambiguate duplicates by source
		slug = slug + '-' + attribution.handle;
	}
	seenSlugs.add(slug);
	// Stagger created dates so the feed doesn't all bunch up.
	const sortDate = new Date(baseDate - idx * 3_600_000).toISOString();
	idx += 1;
	const tagsStr = JSON.stringify(tags);
	const descStr = JSON.stringify(desc);
	const nameStr = JSON.stringify(name);
	const slugStr = JSON.stringify(slug);
	const idStr = JSON.stringify(id);
	const glbStr = JSON.stringify(glbUrl);
	const imgStr = image ? JSON.stringify(image) : 'null';
	const attrStr = JSON.stringify(attribution);
	const authorStr = JSON.stringify({ handle: attribution.handle, displayName: attribution.displayName, profileUrl: attribution.url });
	lines.push(`	demoItem({ id: ${idStr}, slug: ${slugStr}, name: ${nameStr}, description: ${descStr}, tags: ${tagsStr}, glbUrl: ${glbStr}, image: ${imgStr}, sortDate: ${JSON.stringify(sortDate)}, attribution: ${attrStr}, author: ${authorStr} }),`);
}

const KHRONOS_ATTR = { handle: 'khronos', displayName: 'Khronos Group', url: 'https://github.com/KhronosGroup/glTF-Sample-Assets', license: 'CC-BY 4.0' };
const THREEJS_ATTR = { handle: 'threejs', displayName: 'three.js examples', url: 'https://github.com/mrdoob/three.js', license: 'MIT' };
const ONDISK_ATTR = { handle: 'three.ws', displayName: 'three.ws starter', url: 'https://three.ws', license: 'CC-BY 4.0' };

// On-disk first
for (const m of ON_DISK) {
	addItem({
		id: `avatar_demo_disk_${m.slug}`,
		slug: `demo-${m.slug}`,
		name: m.name,
		glbUrl: `https://three.ws${m.path}`,
		image: null,
		tags: m.tags,
		desc: m.desc,
		attribution: ONDISK_ATTR,
	});
}

// Khronos
for (const name of KHRONOS) {
	const meta = KHRONOS_META[name] || classifyByName(name);
	const slug = 'demo-' + name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
	addItem({
		id: `avatar_demo_k_${name.toLowerCase()}`,
		slug,
		name: name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2'),
		glbUrl: `${KHRONOS_BASE}/${name}/glTF-Binary/${name}.glb`,
		image: null, // jsdelivr can't serve thumbnails reliably; let the model-viewer poster handle it
		tags: meta.tags,
		desc: meta.desc,
		attribution: KHRONOS_ATTR,
	});
}

// three.js — skip ones already in Khronos to avoid duplicates
const KHRONOS_LOWER = new Set(KHRONOS.map((s) => s.toLowerCase()));
for (const baseName of THREEJS) {
	if (KHRONOS_LOWER.has(baseName.toLowerCase())) continue; // skip dupes
	const meta = THREEJS_META[baseName] || classifyByName(baseName);
	const niceName = baseName
		.replace(/[-_]+/g, ' ')
		.replace(/\.glb$/, '')
		.replace(/^(.)/, (m) => m.toUpperCase())
		.replace(/\b([a-z])/g, (m) => m.toUpperCase());
	addItem({
		id: `avatar_demo_t_${baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
		slug: 'demo-' + baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
		name: niceName,
		glbUrl: `${THREEJS_BASE}/${baseName}.glb`,
		image: null,
		tags: meta.tags,
		desc: meta.desc,
		attribution: THREEJS_ATTR,
	});
}

const file = `/**
 * Demo avatar fixtures for /api/explore.
 *
 * These appear in the marketplace + 3D viewer to demonstrate the platform with
 * a curated catalogue of public-domain glTF assets:
 *   - Khronos glTF Sample Assets         (CC-BY 4.0)
 *   - three.js example models            (MIT)
 *   - On-disk starter avatars            (shipped with three.ws)
 *
 * Generated by scripts/gen-demo-avatars.mjs from a verified GLB URL list —
 * every entry has been HEAD-checked for 200 + correct Content-Type. Edit the
 * generator, not this file, when adding sources.
 *
 * IDs prefixed with \`avatar_demo_\` so they never collide with DB UUIDs.
 */

import { env } from './env.js';

function demoItem({ id, slug, name, description, tags, glbUrl, image, sortDate, attribution, author }) {
	const explicitGlb = glbUrl;
	const finalGlb = explicitGlb.startsWith('http')
		? explicitGlb
		: \`\${env.APP_ORIGIN}\${explicitGlb}\`;
	return {
		kind: 'avatar',
		sortDate,
		avatarId: id,
		slug,
		name,
		description,
		image,
		glbUrl: finalGlb,
		has3d: true,
		tags,
		createdAt: sortDate,
		viewerUrl: \`/avatars/\${id}\`,
		attribution,
		author,
	};
}

export const DEMO_AVATARS = [
${lines.join('\n')}
];
`;

const target = path.join(HERE, '..', 'api', '_lib', 'demo-avatars.js');
fs.writeFileSync(target, file);
console.log('wrote', lines.length, 'demo entries to', target);
