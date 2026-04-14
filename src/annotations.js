import { prepare, measureLineStats } from '@chenglou/pretext';
import {
	prepareRichInline,
	walkRichInlineLineRanges,
	materializeRichInlineLineRange,
} from '@chenglou/pretext/rich-inline';
import { Vector3, Box3 } from 'three';

const FONT_NAME = '500 11px Inter, sans-serif';
const FONT_DETAIL = '300 10px Inter, sans-serif';
const LABEL_PAD_X = 10;
const LABEL_PAD_Y = 6;
const LINE_HEIGHT = 14;
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const MAX_LABELS = 8;

/**
 * Build annotation data for key meshes in the scene.
 * Uses pretext rich-inline to render mixed-style labels (name + type).
 */
export function buildAnnotations(object) {
	const annotations = [];

	object.traverse((node) => {
		if (annotations.length >= MAX_LABELS) return;
		if (!node.isMesh) return;
		if (!node.name || node.name.startsWith('_')) return;

		const geo = node.geometry;
		const mat = Array.isArray(node.material) ? node.material[0] : node.material;

		const vertCount = geo && geo.attributes.position ? geo.attributes.position.count : 0;
		const matType = mat ? mat.type.replace('Material', '') : '';

		// Rich inline: mesh name (bold) + vertex count (light)
		const items = [
			{ text: node.name, font: FONT_NAME },
		];
		if (vertCount > 0) {
			items.push({ text: '  ' + formatShort(vertCount) + ' verts', font: FONT_DETAIL });
		}
		if (matType) {
			items.push({ text: '  ' + matType, font: FONT_DETAIL });
		}

		// Measure with pretext
		const prepared = prepareRichInline(items);
		let totalWidth = 0;
		let lineCount = 0;
		walkRichInlineLineRanges(prepared, 300, (range) => {
			const line = materializeRichInlineLineRange(prepared, range);
			totalWidth = Math.max(totalWidth, line.width);
			lineCount++;
		});

		const labelWidth = totalWidth + LABEL_PAD_X * 2;
		const labelHeight = lineCount * LINE_HEIGHT + LABEL_PAD_Y * 2;

		// Get world position from bounding box center
		if (geo) geo.computeBoundingBox();
		const box = geo ? geo.boundingBox : null;
		const pos = new Vector3();
		if (box) {
			box.getCenter(pos);
			pos.applyMatrix4(node.matrixWorld);
		} else {
			node.getWorldPosition(pos);
		}

		annotations.push({
			name: node.name,
			items,
			prepared,
			labelWidth,
			labelHeight,
			position: pos,
			vertCount,
			matType,
		});
	});

	return annotations;
}

/**
 * Render a single annotation label to a canvas element.
 */
export function renderAnnotationCanvas(annotation) {
	const { labelWidth, labelHeight, items, prepared } = annotation;

	const canvas = document.createElement('canvas');
	canvas.width = labelWidth * DPR;
	canvas.height = labelHeight * DPR;
	canvas.style.width = labelWidth + 'px';
	canvas.style.height = labelHeight + 'px';

	const ctx = canvas.getContext('2d');
	ctx.scale(DPR, DPR);

	// Background
	ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
	roundRect(ctx, 0, 0, labelWidth, labelHeight, 6);
	ctx.fill();

	// Border
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
	ctx.lineWidth = 1;
	roundRect(ctx, 0.5, 0.5, labelWidth - 1, labelHeight - 1, 6);
	ctx.stroke();

	// Render rich inline text
	ctx.textBaseline = 'top';
	let y = LABEL_PAD_Y;

	walkRichInlineLineRanges(prepared, labelWidth - LABEL_PAD_X * 2, (range) => {
		const line = materializeRichInlineLineRange(prepared, range);
		let x = LABEL_PAD_X;

		line.fragments.forEach((frag) => {
			x += frag.gapBefore;
			const item = items[frag.itemIndex];
			ctx.font = item.font;
			ctx.fillStyle = frag.itemIndex === 0 ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.45)';
			ctx.fillText(frag.text, x, y);
			x += frag.occupiedWidth;
		});

		y += LINE_HEIGHT;
	});

	return canvas;
}

function formatShort(n) {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
	if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
	return n.toString();
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
