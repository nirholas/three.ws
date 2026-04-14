import { prepare, layout, prepareWithSegments, layoutWithLines, measureLineStats } from '@chenglou/pretext';
import { prepareRichInline, walkRichInlineLineRanges, materializeRichInlineLineRange } from '@chenglou/pretext/rich-inline';

// Fonts
const FONT_TITLE = '500 14px Inter, sans-serif';
const FONT_LABEL = '600 10px Inter, sans-serif';
const FONT_VALUE = '300 13px Inter, sans-serif';
const FONT_CHIP = '600 10px Inter, sans-serif';
const FONT_DESC = '300 12px Inter, sans-serif';

// Layout
const LINE_HEIGHT = 18;
const CHIP_HEIGHT = 16;
const PADDING = 16;
const ROW_GAP = 6;
const CHIP_PAD_X = 12; // horizontal padding inside chip
const DPR = Math.min(window.devicePixelRatio || 1, 2);

// Colors
const COL_BG = 'rgba(0, 0, 0, 0.75)';
const COL_BORDER = 'rgba(255, 255, 255, 0.08)';
const COL_TITLE = 'rgba(255, 255, 255, 0.9)';
const COL_LABEL = 'rgba(255, 255, 255, 0.30)';
const COL_VALUE = 'rgba(255, 255, 255, 0.85)';
const COL_SEP = 'rgba(255, 255, 255, 0.08)';
const COL_DESC = 'rgba(255, 255, 255, 0.45)';
const COL_CHIP_BG = 'rgba(255, 255, 255, 0.08)';
const COL_CHIP_TEXT = 'rgba(255, 255, 255, 0.7)';

function countStats(object) {
	let vertices = 0;
	let triangles = 0;
	let meshes = 0;
	const materialSet = new Set();
	const textureSet = new Set();
	const materialTypes = new Set();
	let hasSkinning = false;
	let hasMorphs = false;

	object.traverse((node) => {
		if (node.isMesh || node.isPoints || node.isLine) {
			meshes++;
			const geo = node.geometry;
			if (geo) {
				if (geo.index) {
					triangles += geo.index.count / 3;
				} else if (geo.attributes.position) {
					triangles += geo.attributes.position.count / 3;
				}
				if (geo.attributes.position) {
					vertices += geo.attributes.position.count;
				}
			}
			if (node.skeleton) hasSkinning = true;
			if (node.morphTargetInfluences && node.morphTargetInfluences.length > 0) hasMorphs = true;

			const mats = Array.isArray(node.material) ? node.material : [node.material];
			mats.forEach((mat) => {
				if (mat) {
					materialSet.add(mat.uuid);
					materialTypes.add(mat.type.replace('Material', ''));
					for (const key in mat) {
						if (mat[key] && mat[key].isTexture) {
							textureSet.add(mat[key].uuid);
						}
					}
				}
			});
		}
	});

	return {
		vertices,
		triangles: Math.floor(triangles),
		meshes,
		materials: materialSet.size,
		textures: textureSet.size,
		materialTypes: Array.from(materialTypes),
		hasSkinning,
		hasMorphs,
	};
}

function formatNum(n) {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
	if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
	return n.toString();
}

function buildDescription(stats, clips) {
	const parts = [];
	if (stats.hasSkinning) parts.push('skinned');
	if (stats.hasMorphs) parts.push('morph targets');
	if (clips && clips.length > 0) parts.push(`${clips.length} animation${clips.length > 1 ? 's' : ''}`);
	if (stats.materialTypes.length > 0) parts.push(stats.materialTypes.join(', '));
	return parts.length > 0 ? parts.join(' · ') : '';
}

/**
 * Creates the model info overlay using pretext rich-inline for mixed-style rendering.
 */
export function createModelInfo(container, object, clips) {
	const stats = countStats(object);
	const desc = buildDescription(stats, clips);

	// Build stat rows
	const rows = [
		{ label: 'MESHES', value: formatNum(stats.meshes) },
		{ label: 'VERTICES', value: formatNum(stats.vertices) },
		{ label: 'TRIANGLES', value: formatNum(stats.triangles) },
		{ label: 'MATERIALS', value: formatNum(stats.materials) },
		{ label: 'TEXTURES', value: formatNum(stats.textures) },
	];
	if (clips && clips.length > 0) {
		rows.push({ label: 'ANIMATIONS', value: clips.length.toString() });
	}

	// Build chips from material types & features
	const chips = [];
	stats.materialTypes.forEach((t) => chips.push(t));
	if (stats.hasSkinning) chips.push('Skinned');
	if (stats.hasMorphs) chips.push('Morph');
	if (clips && clips.length > 0) chips.push('Animated');

	// -- Measure everything with pretext --
	const maxWidth = 200;

	// Title
	const titlePrepared = prepare('Model Info', FONT_TITLE);
	const titleMeasure = layout(titlePrepared, maxWidth, LINE_HEIGHT + 2);

	// Stat rows: use rich-inline for each row (label + value in one flow)
	const rowMeasurements = rows.map((row) => {
		const items = [
			{ text: row.label + '  ', font: FONT_LABEL },
			{ text: row.value, font: FONT_VALUE },
		];
		const prepared = prepareRichInline(items);
		// Get the natural width by measuring with a very wide max
		const labelPrepared = prepare(row.label, FONT_LABEL);
		const labelStats = measureLineStats(labelPrepared, maxWidth);
		const valuePrepared = prepare(row.value, FONT_VALUE);
		const valueStats = measureLineStats(valuePrepared, maxWidth);
		return {
			...row,
			labelWidth: labelStats.maxLineWidth,
			valueWidth: valueStats.maxLineWidth,
			richPrepared: prepared,
		};
	});

	// Chips: measure each chip with pretext
	const chipMeasurements = chips.map((text) => {
		const prepared = prepare(text, FONT_CHIP);
		const stats = measureLineStats(prepared, 300);
		return { text, width: stats.maxLineWidth + CHIP_PAD_X };
	});

	// Description: multi-line wrapping — this is where pretext really shines
	let descLines = [];
	let descHeight = 0;
	if (desc) {
		const descPrepared = prepareWithSegments(desc, FONT_DESC);
		const descLayout = layoutWithLines(descPrepared, maxWidth - PADDING, LINE_HEIGHT);
		descLines = descLayout.lines;
		descHeight = descLayout.height;
	}

	// -- Calculate canvas size from measurements --
	const contentWidth = Math.max(
		titleMeasure.width + PADDING * 2,
		...rowMeasurements.map((r) => r.labelWidth + r.valueWidth + PADDING * 3),
	);
	const canvasWidth = Math.max(contentWidth, 180);

	// Chip row height
	let chipRowHeight = 0;
	if (chipMeasurements.length > 0) {
		// Wrap chips into rows
		let chipX = 0;
		let chipRows = 1;
		chipMeasurements.forEach((chip) => {
			if (chipX > 0 && chipX + chip.width > canvasWidth - PADDING * 2) {
				chipRows++;
				chipX = 0;
			}
			chipX += chip.width + 6;
		});
		chipRowHeight = chipRows * (CHIP_HEIGHT + 6) + ROW_GAP;
	}

	const canvasHeight =
		PADDING +
		titleMeasure.height + ROW_GAP +     // title
		ROW_GAP +                             // separator
		rowMeasurements.length * (LINE_HEIGHT + ROW_GAP) + // stat rows
		chipRowHeight +                       // chips
		(descHeight > 0 ? ROW_GAP + descHeight : 0) + // description
		PADDING;

	// -- Render to canvas --
	const canvas = document.createElement('canvas');
	canvas.width = canvasWidth * DPR;
	canvas.height = canvasHeight * DPR;
	canvas.style.width = canvasWidth + 'px';
	canvas.style.height = canvasHeight + 'px';

	const ctx = canvas.getContext('2d');
	ctx.scale(DPR, DPR);

	// Background
	ctx.fillStyle = COL_BG;
	roundRect(ctx, 0, 0, canvasWidth, canvasHeight, 10);
	ctx.fill();

	// Border
	ctx.strokeStyle = COL_BORDER;
	ctx.lineWidth = 1;
	roundRect(ctx, 0.5, 0.5, canvasWidth - 1, canvasHeight - 1, 10);
	ctx.stroke();

	// Title
	let y = PADDING;
	ctx.font = FONT_TITLE;
	ctx.fillStyle = COL_TITLE;
	ctx.textBaseline = 'top';
	ctx.fillText('Model Info', PADDING, y);
	y += titleMeasure.height + ROW_GAP;

	// Separator
	ctx.strokeStyle = COL_SEP;
	ctx.beginPath();
	ctx.moveTo(PADDING, y);
	ctx.lineTo(canvasWidth - PADDING, y);
	ctx.stroke();
	y += ROW_GAP;

	// Stat rows
	rowMeasurements.forEach((row) => {
		ctx.font = FONT_LABEL;
		ctx.fillStyle = COL_LABEL;
		ctx.textAlign = 'left';
		ctx.fillText(row.label, PADDING, y);

		ctx.font = FONT_VALUE;
		ctx.fillStyle = COL_VALUE;
		ctx.textAlign = 'right';
		ctx.fillText(row.value, canvasWidth - PADDING, y);
		ctx.textAlign = 'left';

		y += LINE_HEIGHT + ROW_GAP;
	});

	// Chips
	if (chipMeasurements.length > 0) {
		let chipX = PADDING;

		chipMeasurements.forEach((chip) => {
			if (chipX > PADDING && chipX + chip.width > canvasWidth - PADDING) {
				chipX = PADDING;
				y += CHIP_HEIGHT + 6;
			}

			// Chip background
			ctx.fillStyle = COL_CHIP_BG;
			roundRect(ctx, chipX, y, chip.width, CHIP_HEIGHT, 4);
			ctx.fill();

			// Chip text (centered in chip)
			ctx.font = FONT_CHIP;
			ctx.fillStyle = COL_CHIP_TEXT;
			ctx.textBaseline = 'top';
			ctx.fillText(chip.text, chipX + CHIP_PAD_X / 2, y + 3);

			chipX += chip.width + 6;
		});

		y += CHIP_HEIGHT + ROW_GAP + 4;
	}

	// Description (multi-line, pretext-wrapped)
	if (descLines.length > 0) {
		ctx.strokeStyle = COL_SEP;
		ctx.beginPath();
		ctx.moveTo(PADDING, y);
		ctx.lineTo(canvasWidth - PADDING, y);
		ctx.stroke();
		y += ROW_GAP;

		ctx.font = FONT_DESC;
		ctx.fillStyle = COL_DESC;
		ctx.textBaseline = 'top';
		descLines.forEach((line) => {
			ctx.fillText(line.text, PADDING, y);
			y += LINE_HEIGHT;
		});
	}

	// Mount
	const el = document.createElement('div');
	el.classList.add('model-info');
	el.appendChild(canvas);
	container.appendChild(el);

	return {
		el,
		canvas,
		remove() {
			el.remove();
		},
	};
}

function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - r);
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	ctx.lineTo(x + r, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}
