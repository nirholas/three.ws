// The minimal PowerPoint writer (api/_lib/pptx-writer.js): the package is
// unzipped and checked part by part, the way a strict OPC reader would.
// Every part must be well-formed XML, own a content type, and be reachable
// through a relationship whose target exists; the 3D slide must carry the
// am3d:model3d frame PowerPoint writes, with its PNG fallback.

import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

import {
	buildPptx,
	cameraFor,
	CONTENT_TYPE,
	frameFor,
	PPTX_MIME,
	REL,
	xmlEscape,
} from '../api/_lib/pptx-writer.js';

// A real 1x1 PNG and a real (empty-scene) GLB header are enough for the
// package checks; the writer stores bytes, it does not interpret them.
const PNG = Uint8Array.from(
	Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
		'base64',
	),
);
function tinyGlb() {
	const json = Buffer.from(
		JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0 }),
	);
	const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
	const header = Buffer.alloc(20);
	header.write('glTF', 0, 'latin1');
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(20 + padded.length, 8);
	header.writeUInt32LE(padded.length, 12);
	header.write('JSON', 16, 'latin1');
	return new Uint8Array(Buffer.concat([header, padded]));
}

const BOUNDS = { min: [-0.5, -1, -0.25], max: [0.5, 1, 0.25] };

function deck(overrides = {}) {
	return buildPptx({
		title: 'A brass lantern',
		created: new Date('2026-11-11T12:00:00Z'),
		slides: [
			{
				title: 'A brass lantern <with> "quotes" & more',
				caption: 'Made with three.ws. Drag the model to rotate it.',
				model: {
					glb: tinyGlb(),
					bounds: BOUNDS,
					poster: { png: PNG, width: 1280, height: 960 },
					name: '3D Model',
					descr: 'A brass lantern',
				},
			},
		],
		...overrides,
	});
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
const ordered = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '',
	preserveOrder: true,
});
const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Resolve an OPC relationship target against the part that owns the .rels. */
function resolveTarget(relsPath, target) {
	// "_rels/.rels" belongs to the package root; "a/_rels/b.xml.rels" to "a/b.xml".
	const owner = relsPath.replace(/(^|\/)_rels\/([^/]*)\.rels$/, '$1$2');
	const base = owner.includes('/') ? owner.slice(0, owner.lastIndexOf('/') + 1) : '';
	const parts = (base + target).split('/');
	const out = [];
	for (const p of parts) {
		if (p === '..') out.pop();
		else if (p !== '.' && p !== '') out.push(p);
	}
	return out.join('/');
}

function relsOf(files, relsPath) {
	return asArray(parser.parse(strFromU8(files[relsPath])).Relationships.Relationship);
}

/** Depth-first search in a preserveOrder tree for the first element named `name`. */
function find(nodes, name) {
	for (const node of nodes) {
		if (node[name]) return node;
		for (const key of Object.keys(node)) {
			if (key === ':@' || !Array.isArray(node[key])) continue;
			const hit = find(node[key], name);
			if (hit) return hit;
		}
	}
	return null;
}
const childNames = (node, name) =>
	node[name].map((c) => Object.keys(c).find((k) => k !== ':@')).filter(Boolean);

describe('buildPptx package', () => {
	const files = unzipSync(deck());
	const names = Object.keys(files);

	it('writes [Content_Types].xml first and every part a presentation needs', () => {
		expect(names[0]).toBe('[Content_Types].xml');
		expect(names.sort()).toEqual(
			[
				'[Content_Types].xml',
				'_rels/.rels',
				'docProps/app.xml',
				'docProps/core.xml',
				'ppt/_rels/presentation.xml.rels',
				'ppt/media/image1.png',
				'ppt/media/model3d1.glb',
				'ppt/presProps.xml',
				'ppt/presentation.xml',
				'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
				'ppt/slideLayouts/slideLayout1.xml',
				'ppt/slideMasters/_rels/slideMaster1.xml.rels',
				'ppt/slideMasters/slideMaster1.xml',
				'ppt/slides/_rels/slide1.xml.rels',
				'ppt/slides/slide1.xml',
				'ppt/tableStyles.xml',
				'ppt/theme/theme1.xml',
				'ppt/viewProps.xml',
			].sort(),
		);
	});

	it('every XML part is well-formed', () => {
		for (const name of names.filter((n) => /\.(xml|rels)$/.test(n))) {
			const result = XMLValidator.validate(strFromU8(files[name]));
			expect(result, name).toBe(true);
		}
	});

	it('every part has exactly the content type Office expects', () => {
		const types = parser.parse(strFromU8(files['[Content_Types].xml'])).Types;
		const defaults = Object.fromEntries(
			asArray(types.Default).map((d) => [d.Extension, d.ContentType]),
		);
		const overrides = Object.fromEntries(
			asArray(types.Override).map((o) => [o.PartName, o.ContentType]),
		);
		expect(defaults).toMatchObject({
			glb: CONTENT_TYPE.glb,
			png: CONTENT_TYPE.png,
			rels: CONTENT_TYPE.rels,
			xml: CONTENT_TYPE.xml,
		});
		expect(CONTENT_TYPE.glb).toBe('model/gltf.binary');
		expect(overrides).toMatchObject({
			'/ppt/presentation.xml': CONTENT_TYPE.presentation,
			'/ppt/slides/slide1.xml': CONTENT_TYPE.slide,
			'/ppt/slideMasters/slideMaster1.xml': CONTENT_TYPE.slideMaster,
			'/ppt/slideLayouts/slideLayout1.xml': CONTENT_TYPE.slideLayout,
			'/ppt/theme/theme1.xml': CONTENT_TYPE.theme,
			'/ppt/presProps.xml': CONTENT_TYPE.presProps,
			'/ppt/viewProps.xml': CONTENT_TYPE.viewProps,
			'/ppt/tableStyles.xml': CONTENT_TYPE.tableStyles,
			'/docProps/core.xml': CONTENT_TYPE.core,
			'/docProps/app.xml': CONTENT_TYPE.app,
		});
		for (const name of names) {
			const ext = name.split('.').pop();
			expect(overrides['/' + name] || defaults[ext], name).toBeTruthy();
		}
		// No override points at a part that is not in the zip.
		for (const part of Object.keys(overrides)) expect(names).toContain(part.slice(1));
	});

	it('every relationship target exists and every part is reachable from the root', () => {
		const reached = new Set(['[Content_Types].xml']);
		const queue = ['_rels/.rels'];
		while (queue.length) {
			const relsPath = queue.shift();
			reached.add(relsPath);
			for (const rel of relsOf(files, relsPath)) {
				const target = resolveTarget(relsPath, rel.Target);
				expect(names, `${relsPath} -> ${rel.Target}`).toContain(target);
				if (reached.has(target)) continue;
				reached.add(target);
				const dir = target.includes('/')
					? target.slice(0, target.lastIndexOf('/') + 1)
					: '';
				const own = `${dir}_rels/${target.slice(dir.length)}.rels`;
				if (files[own]) queue.push(own);
			}
		}
		expect([...reached].sort()).toEqual([...names].sort());
	});

	it('wires the root, presentation and slide relationships with the right types', () => {
		const root = relsOf(files, '_rels/.rels');
		expect(root.map((r) => r.Type).sort()).toEqual(
			[REL.officeDocument, REL.core, REL.app].sort(),
		);
		const pres = relsOf(files, 'ppt/_rels/presentation.xml.rels');
		expect(pres.map((r) => r.Type)).toEqual(
			expect.arrayContaining([
				REL.slideMaster,
				REL.slide,
				REL.theme,
				REL.presProps,
				REL.viewProps,
				REL.tableStyles,
			]),
		);
		const slide = Object.fromEntries(
			relsOf(files, 'ppt/slides/_rels/slide1.xml.rels').map((r) => [r.Id, r]),
		);
		expect(slide.rId1).toMatchObject({
			Type: REL.slideLayout,
			Target: '../slideLayouts/slideLayout1.xml',
		});
		expect(slide.rId2).toMatchObject({
			Type: 'http://schemas.microsoft.com/office/2017/06/relationships/model3d',
			Target: '../media/model3d1.glb',
		});
		expect(slide.rId3).toMatchObject({ Type: REL.image, Target: '../media/image1.png' });
		// Unique ids within each .rels part.
		for (const relsPath of names.filter((n) => n.endsWith('.rels'))) {
			const ids = relsOf(files, relsPath).map((r) => r.Id);
			expect(new Set(ids).size, relsPath).toBe(ids.length);
		}
	});

	it('stores the GLB and poster byte for byte', () => {
		expect(Buffer.from(files['ppt/media/model3d1.glb']).equals(Buffer.from(tinyGlb()))).toBe(
			true,
		);
		expect(Buffer.from(files['ppt/media/image1.png']).equals(Buffer.from(PNG))).toBe(true);
	});

	it('puts the am3d:model3d frame in an mc:Choice with a p:pic fallback, in schema order', () => {
		const slide = strFromU8(files['ppt/slides/slide1.xml']);
		const tree = ordered.parse(slide);
		const choice = find(tree, 'mc:Choice');
		expect(choice[':@'].Requires).toBe('am3d');
		expect(choice[':@']['xmlns:am3d']).toBe(
			'http://schemas.microsoft.com/office/drawing/2017/model3d',
		);
		const data = find(choice['mc:Choice'], 'a:graphicData');
		expect(data[':@'].uri).toBe('http://schemas.microsoft.com/office/drawing/2017/model3d');
		const model = find(data['a:graphicData'], 'am3d:model3d');
		expect(model[':@']['r:embed']).toBe('rId2');
		expect(childNames(model, 'am3d:model3d')).toEqual([
			'am3d:spPr',
			'am3d:camera',
			'am3d:trans',
			'am3d:raster',
			'am3d:objViewport',
			'am3d:ambientLight',
			'am3d:ptLight',
			'am3d:ptLight',
			'am3d:ptLight',
		]);
		const raster = find(model['am3d:model3d'], 'am3d:blip');
		expect(raster[':@']['r:embed']).toBe('rId3');

		const fallback = find(tree, 'mc:Fallback');
		const blip = find(fallback['mc:Fallback'], 'a:blip');
		expect(find(fallback['mc:Fallback'], 'p:pic')).toBeTruthy();
		expect(blip[':@']['r:embed']).toBe('rId3');
	});

	it('escapes the title text and keeps the camera numbers in the slide', () => {
		const slide = strFromU8(files['ppt/slides/slide1.xml']);
		expect(slide).toContain('A brass lantern &lt;with&gt; &quot;quotes&quot; &amp; more');
		const { cameraZ, meterPerModelUnit } = cameraFor(BOUNDS);
		expect(slide).toContain(`<am3d:pos x="0" y="0" z="${cameraZ}"/>`);
		expect(slide).toContain(`<am3d:meterPerModelUnit n="${meterPerModelUnit}" d="1000000"/>`);
		const core = strFromU8(files['docProps/core.xml']);
		expect(core).toContain('<dc:title>A brass lantern</dc:title>');
		expect(core).toContain('2026-11-11T12:00:00Z');
	});

	it('numbers slides, media and relationships for a multi-slide deck', () => {
		const one = {
			title: 'x',
			model: {
				glb: tinyGlb(),
				bounds: BOUNDS,
				poster: { png: PNG, width: 4, height: 3 },
			},
		};
		const multi = unzipSync(buildPptx({ title: 'two', slides: [one, { ...one, title: 'y' }] }));
		expect(Object.keys(multi)).toEqual(
			expect.arrayContaining([
				'ppt/slides/slide2.xml',
				'ppt/media/model3d2.glb',
				'ppt/media/image2.png',
			]),
		);
		const pres = parser.parse(strFromU8(multi['ppt/presentation.xml']));
		const ids = asArray(pres['p:presentation']['p:sldIdLst']['p:sldId']);
		expect(ids.map((s) => s['r:id'])).toEqual(['rId2', 'rId3']);
	});
});

describe('pptx-writer helpers', () => {
	it('exports the PowerPoint MIME type', () => {
		expect(PPTX_MIME).toBe(
			'application/vnd.openxmlformats-officedocument.presentationml.presentation',
		);
	});

	it('drops characters XML 1.0 forbids and escapes the rest', () => {
		expect(xmlEscape('a\u0001b\u000bc<&>"\'')).toBe('abc&lt;&amp;&gt;&quot;&apos;');
	});

	it('scales any model to one metre and backs the camera off to fit it', () => {
		const small = cameraFor({ min: [-0.01, -0.01, -0.01], max: [0.01, 0.01, 0.01] });
		const huge = cameraFor({ min: [-50, -50, -50], max: [50, 50, 50] });
		// Normalized the same, so the camera sits at the same distance.
		expect(small.cameraZ).toBe(huge.cameraZ);
		expect(small.meterPerModelUnit).toBe(50_000_000);
		expect(huge.meterPerModelUnit).toBe(10_000);
		expect(() => cameraFor({ min: [0, 0, 0], max: [0, 0, 0] })).toThrow();
	});

	it('fits the frame to the poster aspect inside a 16:9 slide', () => {
		const frame = frameFor(1280, 960);
		expect(frame.cx / frame.cy).toBeCloseTo(4 / 3, 2);
		expect(frame.x + frame.cx).toBeLessThanOrEqual(12192000);
		expect(frame.x).toBeCloseTo(12192000 - frame.x - frame.cx, -1);
	});

	it('refuses a deck with no slides or a 3D slide with no poster', () => {
		expect(() => buildPptx({ title: 'x', slides: [] })).toThrow(/at least one slide/);
		expect(() =>
			buildPptx({
				title: 'x',
				slides: [{ title: 'x', model: { glb: tinyGlb(), bounds: BOUNDS, poster: {} } }],
			}),
		).toThrow(/poster/);
	});
});
