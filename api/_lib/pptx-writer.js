// Minimal, spec-correct PowerPoint (PresentationML) writer for 3D model slides.
//
// Each slide carries a title and an interactive 3D model: PowerPoint's own
// `am3d:model3d` graphic frame (MS-ODRAWXML 2.5.1 / 5.29) wrapped in the
// markup-compatibility AlternateContent PowerPoint writes, with a `p:pic`
// fallback that shows the poster PNG to any reader without 3D support
// (LibreOffice, older Office, python-pptx, previews).
//
// Every part, content type and relationship below is copied from a deck
// saved by PowerPoint 16.0 itself (pptx-ts test fixture model3d.pptx), not
// inferred: the model content type is `model/gltf.binary` on the `.glb`
// extension, the model relationship is the 2017/06 `model3d` type, and the
// raster poster and the fallback picture share one ordinary image
// relationship. The camera follows PowerPoint's insert behaviour, measured
// from that fixture: the model's largest extent is normalized to one metre
// (meterPerModelUnit), and the camera sits on +Z far enough back that the
// bounding sphere fills a 45 degree field of view.
//
// Zipped with fflate; no proprietary library.

import { zipSync, strToU8 } from 'fflate';

export const PPTX_MIME =
	'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const SLIDE_CX = 12192000; // 13.333 in, 16:9
const SLIDE_CY = 6858000; // 7.5 in
const EMU_PER_METRE = 36000000; // DrawingML positive-coordinate unit per metre
const FOV = 2700000; // 45 degrees in 60000ths
const MARGIN_X = 838200;
const TITLE_Y = 365125;
const TITLE_CY = 914400;
const STAGE_Y = 1417320;
const STAGE_CY = 4663440;
const CAPTION_Y = 6172200;
const CAPTION_CY = 457200;
// The fixture's frame (3048000 x 2286000 EMU) has viewportSz 3338805.
// PowerPoint recomputes it when the model is first touched; this scales the
// measured ratio by the frame's geometric mean so the first paint matches.
const VIEWPORT_PER_EMU = 3338805 / Math.sqrt(3048000 * 2286000);

const NS = {
	a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
	r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
	p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
	mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
	am3d: 'http://schemas.microsoft.com/office/drawing/2017/model3d',
	rels: 'http://schemas.openxmlformats.org/package/2006/relationships',
	ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
};

export const REL = {
	officeDocument:
		'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
	core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
	app: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
	slideMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
	slideLayout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
	slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
	theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
	presProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps',
	viewProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps',
	tableStyles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles',
	image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
	model3d: 'http://schemas.microsoft.com/office/2017/06/relationships/model3d',
};

export const CONTENT_TYPE = {
	glb: 'model/gltf.binary',
	png: 'image/png',
	rels: 'application/vnd.openxmlformats-package.relationships+xml',
	xml: 'application/xml',
	presentation:
		'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
	slideMaster: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
	slideLayout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
	slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
	theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
	presProps: 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml',
	viewProps: 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml',
	tableStyles: 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml',
	core: 'application/vnd.openxmlformats-package.core-properties+xml',
	app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
};

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// XML 1.0 forbids most C0 controls even when escaped; drop them.
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function xmlEscape(value) {
	return String(value ?? '')
		.replace(XML_INVALID, '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function relsXml(rels) {
	return (
		DECL +
		`<Relationships xmlns="${NS.rels}">` +
		rels
			.map(
				(r) =>
					`<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlEscape(r.target)}"/>`,
			)
			.join('') +
		'</Relationships>'
	);
}

// ---- geometry -----------------------------------------------------------------

/**
 * Camera and model transform for a model whose bounds are centred on the
 * origin, matching what PowerPoint writes on insert.
 */
export function cameraFor(bounds) {
	const half = [0, 1, 2].map((i) => (bounds.max[i] - bounds.min[i]) / 2);
	const extent = 2 * Math.max(...half);
	if (!(extent > 0) || !Number.isFinite(extent))
		throw new Error('model bounds must have a positive size');
	const radius = Math.hypot(...half) / extent; // bounding-sphere radius once normalized to 1 m
	const distance = radius / Math.sin(((FOV / 60000) * Math.PI) / 360);
	return {
		cameraZ: Math.round(distance * EMU_PER_METRE),
		meterPerModelUnit: Math.max(1, Math.round(1e6 / extent)),
	};
}

/** Largest box of the poster's aspect ratio that fits the stage, centred. */
export function frameFor(posterWidth, posterHeight) {
	const aspect = posterWidth > 0 && posterHeight > 0 ? posterWidth / posterHeight : 4 / 3;
	const maxCx = SLIDE_CX - 2 * MARGIN_X;
	let cy = STAGE_CY;
	let cx = Math.round(cy * aspect);
	if (cx > maxCx) {
		cx = maxCx;
		cy = Math.round(cx / aspect);
	}
	return {
		x: Math.round((SLIDE_CX - cx) / 2),
		y: STAGE_Y + Math.round((STAGE_CY - cy) / 2),
		cx,
		cy,
	};
}

// ---- slide parts ----------------------------------------------------------------

function titleShape(id, text) {
	return (
		`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Title ${id - 1}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
		`<p:spPr><a:xfrm><a:off x="${MARGIN_X}" y="${TITLE_Y}"/><a:ext cx="${SLIDE_CX - 2 * MARGIN_X}" cy="${TITLE_CY}"/></a:xfrm></p:spPr>` +
		`<p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${xmlEscape(text)}</a:t></a:r></a:p></p:txBody></p:sp>`
	);
}

function captionShape(id, text) {
	return (
		`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Caption ${id - 1}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
		`<p:spPr><a:xfrm><a:off x="${MARGIN_X}" y="${CAPTION_Y}"/><a:ext cx="${SLIDE_CX - 2 * MARGIN_X}" cy="${CAPTION_CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
		`<p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1200" dirty="0"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr></a:solidFill></a:rPr><a:t>${xmlEscape(text)}</a:t></a:r></a:p></p:txBody></p:sp>`
	);
}

// PowerPoint's default three-point light rig, verbatim from its own insert.
const LIGHT_RIG =
	'<am3d:ambientLight><am3d:clr><a:scrgbClr r="50000" g="50000" b="50000"/></am3d:clr><am3d:illuminance n="500000" d="1000000"/></am3d:ambientLight>' +
	'<am3d:ptLight rad="0"><am3d:clr><a:scrgbClr r="100000" g="75000" b="50000"/></am3d:clr><am3d:intensity n="9765625" d="1000000"/><am3d:pos x="21959998" y="70920001" z="16344003"/></am3d:ptLight>' +
	'<am3d:ptLight rad="0"><am3d:clr><a:scrgbClr r="40000" g="60000" b="95000"/></am3d:clr><am3d:intensity n="12250000" d="1000000"/><am3d:pos x="-37964106" y="51130435" z="57631972"/></am3d:ptLight>' +
	'<am3d:ptLight rad="0"><am3d:clr><a:scrgbClr r="86837" g="72700" b="100000"/></am3d:clr><am3d:intensity n="3125000" d="1000000"/><am3d:pos x="-37739122" y="58056624" z="-34769649"/></am3d:ptLight>';

function modelShape(id, { name, descr, frame, cameraZ, meterPerModelUnit, modelRel, imageRel }) {
	const nv = `<p:cNvPr id="${id}" name="${xmlEscape(name)}" descr="${xmlEscape(descr)}"/>`;
	const xfrm = `<a:off x="${frame.x}" y="${frame.y}"/><a:ext cx="${frame.cx}" cy="${frame.cy}"/>`;
	const viewport = Math.round(VIEWPORT_PER_EMU * Math.sqrt(frame.cx * frame.cy));
	return (
		`<mc:AlternateContent xmlns:mc="${NS.mc}"><mc:Choice xmlns:am3d="${NS.am3d}" Requires="am3d">` +
		`<p:graphicFrame><p:nvGraphicFramePr>${nv}<p:cNvGraphicFramePr><a:graphicFrameLocks/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
		`<p:xfrm>${xfrm}</p:xfrm><a:graphic><a:graphicData uri="${NS.am3d}"><am3d:model3d r:embed="${modelRel}">` +
		`<am3d:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${frame.cx}" cy="${frame.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></am3d:spPr>` +
		`<am3d:camera><am3d:pos x="0" y="0" z="${cameraZ}"/><am3d:up dx="0" dy="${EMU_PER_METRE}" dz="0"/><am3d:lookAt x="0" y="0" z="0"/><am3d:perspective fov="${FOV}"/></am3d:camera>` +
		`<am3d:trans><am3d:meterPerModelUnit n="${meterPerModelUnit}" d="1000000"/><am3d:preTrans dx="0" dy="0" dz="0"/>` +
		'<am3d:scale><am3d:sx n="1000000" d="1000000"/><am3d:sy n="1000000" d="1000000"/><am3d:sz n="1000000" d="1000000"/></am3d:scale>' +
		'<am3d:rot/><am3d:postTrans dx="0" dy="0" dz="0"/></am3d:trans>' +
		`<am3d:raster rName="Office3DRenderer" rVer="16.0.8326"><am3d:blip r:embed="${imageRel}"/></am3d:raster>` +
		`<am3d:objViewport viewportSz="${viewport}"/>${LIGHT_RIG}` +
		'</am3d:model3d></a:graphicData></a:graphic></p:graphicFrame></mc:Choice>' +
		`<mc:Fallback><p:pic><p:nvPicPr>${nv}<p:cNvPicPr><a:picLocks noGrp="1" noRot="1" noChangeAspect="1" noMove="1" noResize="1" noEditPoints="1" noAdjustHandles="1" noChangeArrowheads="1" noChangeShapeType="1" noCrop="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
		`<p:blipFill><a:blip r:embed="${imageRel}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
		`<p:spPr><a:xfrm>${xfrm}</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></mc:Fallback></mc:AlternateContent>`
	);
}

function slideXml(slide, ids) {
	const parts = [];
	let id = 2;
	if (slide.title) parts.push(titleShape(id++, slide.title));
	if (slide.model) {
		const { cameraZ, meterPerModelUnit } = cameraFor(slide.model.bounds);
		parts.push(
			modelShape(id++, {
				name: slide.model.name || '3D Model',
				descr: slide.model.descr || slide.title || '3D model',
				frame: frameFor(slide.model.poster.width, slide.model.poster.height),
				cameraZ,
				meterPerModelUnit,
				modelRel: ids.model,
				imageRel: ids.image,
			}),
		);
	}
	if (slide.caption) parts.push(captionShape(id++, slide.caption));
	return (
		DECL +
		`<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree>` +
		'<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
		'<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
		parts.join('') +
		'</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
	);
}

// ---- package-level parts ------------------------------------------------------------

function presentationXml(slideCount) {
	const ids = Array.from(
		{ length: slideCount },
		(_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`,
	).join('');
	return (
		DECL +
		`<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" saveSubsetFonts="1">` +
		'<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
		`<p:sldIdLst>${ids}</p:sldIdLst>` +
		`<p:sldSz cx="${SLIDE_CX}" cy="${SLIDE_CY}"/><p:notesSz cx="6858000" cy="9144000"/>` +
		'<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr>' +
		'<a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr>' +
		'</p:defaultTextStyle></p:presentation>'
	);
}

const PLACEHOLDER_TXT = (text) =>
	`<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p></p:txBody>`;

const TREE_HEAD =
	'<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
	'<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

const TEXT_LEVEL = (sz, font) =>
	`<a:defRPr sz="${sz}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+${font}-lt"/><a:ea typeface="+${font}-ea"/><a:cs typeface="+${font}-cs"/></a:defRPr>`;

const SLIDE_MASTER =
	DECL +
	`<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>` +
	TREE_HEAD +
	'<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
	`<p:spPr><a:xfrm><a:off x="${MARGIN_X}" y="${TITLE_Y}"/><a:ext cx="${SLIDE_CX - 2 * MARGIN_X}" cy="1325563"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
	'<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master title style</a:t></a:r></a:p></p:txBody></p:sp>' +
	'<p:sp><p:nvSpPr><p:cNvPr id="3" name="Text Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
	`<p:spPr><a:xfrm><a:off x="${MARGIN_X}" y="1825625"/><a:ext cx="${SLIDE_CX - 2 * MARGIN_X}" cy="4351338"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
	'<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp>' +
	'</p:spTree></p:cSld>' +
	'<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
	'<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
	'<p:txStyles>' +
	`<p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/>${TEXT_LEVEL(4000, 'mj')}</a:lvl1pPr></p:titleStyle>` +
	`<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>${TEXT_LEVEL(2800, 'mn')}</a:lvl1pPr></p:bodyStyle>` +
	`<p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">${TEXT_LEVEL(1800, 'mn')}</a:lvl1pPr></p:otherStyle>` +
	'</p:txStyles></p:sldMaster>';

const SLIDE_LAYOUT =
	DECL +
	`<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="titleOnly" preserve="1"><p:cSld name="Title Only"><p:spTree>` +
	TREE_HEAD +
	'<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>' +
	PLACEHOLDER_TXT('Click to edit Master title style') +
	'</p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

const SOLID = (val, mods = '') =>
	`<a:solidFill><a:schemeClr val="${val}">${mods}</a:schemeClr></a:solidFill>`;
const LINE = (w) =>
	`<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${SOLID('phClr')}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;

const THEME =
	DECL +
	`<a:theme xmlns:a="${NS.a}" name="three.ws"><a:themeElements>` +
	'<a:clrScheme name="three.ws">' +
	'<a:dk1><a:srgbClr val="111318"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
	'<a:dk2><a:srgbClr val="1E2230"/></a:dk2><a:lt2><a:srgbClr val="EEF0F5"/></a:lt2>' +
	'<a:accent1><a:srgbClr val="6366F1"/></a:accent1><a:accent2><a:srgbClr val="22C55E"/></a:accent2>' +
	'<a:accent3><a:srgbClr val="F59E0B"/></a:accent3><a:accent4><a:srgbClr val="EC4899"/></a:accent4>' +
	'<a:accent5><a:srgbClr val="06B6D4"/></a:accent5><a:accent6><a:srgbClr val="A855F7"/></a:accent6>' +
	'<a:hlink><a:srgbClr val="4F46E5"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>' +
	'</a:clrScheme>' +
	'<a:fontScheme name="three.ws">' +
	'<a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
	'<a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
	'</a:fontScheme>' +
	'<a:fmtScheme name="three.ws">' +
	`<a:fillStyleLst>${SOLID('phClr')}${SOLID('phClr', '<a:tint val="50000"/>')}${SOLID('phClr', '<a:shade val="80000"/>')}</a:fillStyleLst>` +
	`<a:lnStyleLst>${LINE(12700)}${LINE(19050)}${LINE(25400)}</a:lnStyleLst>` +
	'<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
	`<a:bgFillStyleLst>${SOLID('phClr')}${SOLID('phClr', '<a:tint val="95000"/>')}${SOLID('phClr', '<a:shade val="90000"/>')}</a:bgFillStyleLst>` +
	'</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';

const PRES_PROPS =
	DECL + `<p:presentationPr xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"/>`;
const VIEW_PROPS =
	DECL +
	`<p:viewPr xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`;
const TABLE_STYLES =
	DECL + `<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;

function coreXml({ title, author, created }) {
	const stamp = created.toISOString().replace(/\.\d{3}Z$/, 'Z');
	return (
		DECL +
		'<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
		`<dc:title>${xmlEscape(title)}</dc:title><dc:creator>${xmlEscape(author)}</dc:creator><cp:lastModifiedBy>${xmlEscape(author)}</cp:lastModifiedBy><cp:revision>1</cp:revision>` +
		`<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>` +
		'</cp:coreProperties>'
	);
}

function appXml(slideCount) {
	return (
		DECL +
		'<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
		`<Application>three.ws</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${slideCount}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides>` +
		'<ScaleCrop>false</ScaleCrop><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion>' +
		'</Properties>'
	);
}

function contentTypesXml(slideCount) {
	const overrides = [
		['/ppt/presentation.xml', CONTENT_TYPE.presentation],
		['/ppt/slideMasters/slideMaster1.xml', CONTENT_TYPE.slideMaster],
		['/ppt/slideLayouts/slideLayout1.xml', CONTENT_TYPE.slideLayout],
		...Array.from({ length: slideCount }, (_, i) => [
			`/ppt/slides/slide${i + 1}.xml`,
			CONTENT_TYPE.slide,
		]),
		['/ppt/theme/theme1.xml', CONTENT_TYPE.theme],
		['/ppt/presProps.xml', CONTENT_TYPE.presProps],
		['/ppt/viewProps.xml', CONTENT_TYPE.viewProps],
		['/ppt/tableStyles.xml', CONTENT_TYPE.tableStyles],
		['/docProps/core.xml', CONTENT_TYPE.core],
		['/docProps/app.xml', CONTENT_TYPE.app],
	];
	return (
		DECL +
		`<Types xmlns="${NS.ct}">` +
		['glb', 'png', 'rels', 'xml']
			.map((ext) => `<Default Extension="${ext}" ContentType="${CONTENT_TYPE[ext]}"/>`)
			.join('') +
		overrides
			.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
			.join('') +
		'</Types>'
	);
}

// ---- entry point ------------------------------------------------------------------

/**
 * Build a .pptx.
 *
 * @param {object} deck
 * @param {string} deck.title
 * @param {string} [deck.author]
 * @param {Date}   [deck.created]
 * @param {Array<{ title?: string, caption?: string, model?: {
 *   glb: Uint8Array, bounds: { min: number[], max: number[] },
 *   poster: { png: Uint8Array, width: number, height: number },
 *   name?: string, descr?: string } }>} deck.slides
 * @returns {Uint8Array} the zipped package
 */
export function buildPptx({ title, author = 'three.ws', created = new Date(), slides }) {
	if (!Array.isArray(slides) || slides.length === 0)
		throw new Error('a deck needs at least one slide');
	const files = {};
	const xml = (path, text) => {
		files[path] = [strToU8(text), { level: 6 }];
	};
	// [Content_Types].xml first, as Office writes it; some readers sniff it.
	xml('[Content_Types].xml', contentTypesXml(slides.length));
	xml(
		'_rels/.rels',
		relsXml([
			{ id: 'rId1', type: REL.officeDocument, target: 'ppt/presentation.xml' },
			{ id: 'rId2', type: REL.core, target: 'docProps/core.xml' },
			{ id: 'rId3', type: REL.app, target: 'docProps/app.xml' },
		]),
	);
	xml('docProps/core.xml', coreXml({ title, author, created }));
	xml('docProps/app.xml', appXml(slides.length));
	xml('ppt/presentation.xml', presentationXml(slides.length));
	const n = slides.length;
	xml(
		'ppt/_rels/presentation.xml.rels',
		relsXml([
			{ id: 'rId1', type: REL.slideMaster, target: 'slideMasters/slideMaster1.xml' },
			...slides.map((_, i) => ({
				id: `rId${i + 2}`,
				type: REL.slide,
				target: `slides/slide${i + 1}.xml`,
			})),
			{ id: `rId${n + 2}`, type: REL.presProps, target: 'presProps.xml' },
			{ id: `rId${n + 3}`, type: REL.viewProps, target: 'viewProps.xml' },
			{ id: `rId${n + 4}`, type: REL.theme, target: 'theme/theme1.xml' },
			{ id: `rId${n + 5}`, type: REL.tableStyles, target: 'tableStyles.xml' },
		]),
	);
	xml('ppt/presProps.xml', PRES_PROPS);
	xml('ppt/viewProps.xml', VIEW_PROPS);
	xml('ppt/tableStyles.xml', TABLE_STYLES);
	xml('ppt/theme/theme1.xml', THEME);
	xml('ppt/slideMasters/slideMaster1.xml', SLIDE_MASTER);
	xml(
		'ppt/slideMasters/_rels/slideMaster1.xml.rels',
		relsXml([
			{ id: 'rId1', type: REL.slideLayout, target: '../slideLayouts/slideLayout1.xml' },
			{ id: 'rId2', type: REL.theme, target: '../theme/theme1.xml' },
		]),
	);
	xml('ppt/slideLayouts/slideLayout1.xml', SLIDE_LAYOUT);
	xml(
		'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
		relsXml([
			{ id: 'rId1', type: REL.slideMaster, target: '../slideMasters/slideMaster1.xml' },
		]),
	);

	slides.forEach((slide, i) => {
		const num = i + 1;
		const rels = [
			{ id: 'rId1', type: REL.slideLayout, target: '../slideLayouts/slideLayout1.xml' },
		];
		const ids = {};
		if (slide.model) {
			const { glb, poster } = slide.model;
			if (!glb?.byteLength) throw new Error(`slide ${num}: model.glb is empty`);
			if (!poster?.png?.byteLength)
				throw new Error(`slide ${num}: a 3D slide needs a poster PNG fallback`);
			ids.model = 'rId2';
			ids.image = 'rId3';
			rels.push({ id: ids.model, type: REL.model3d, target: `../media/model3d${num}.glb` });
			rels.push({ id: ids.image, type: REL.image, target: `../media/image${num}.png` });
			files[`ppt/media/model3d${num}.glb`] = [glb, { level: 6 }];
			files[`ppt/media/image${num}.png`] = [poster.png, { level: 0 }];
		}
		xml(`ppt/slides/slide${num}.xml`, slideXml(slide, ids));
		xml(`ppt/slides/_rels/slide${num}.xml.rels`, relsXml(rels));
	});

	return zipSync(files);
}
