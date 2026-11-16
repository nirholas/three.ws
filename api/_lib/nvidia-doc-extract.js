// NVIDIA NeMo Retriever extraction models (the Nemotron document-understanding
// family) on the hosted API, for reading PDF pages as layout rather than as a
// flat text stream. Used by api/_lib/pdf-extract.js.
//
//   pageElements(image)     nvidia/nemotron-page-elements-v3: boxes for table,
//                           chart, infographic, title, paragraph, header_footer
//   tableStructure(image)   nvidia/nemotron-table-structure-v1: row, column and
//                           cell boxes inside a cropped table
//   graphicElements(image)  nvidia/nemotron-graphic-elements-v1: chart_title,
//                           x_title, y_title, xlabel, ylabel, legend_label,
//                           value_label, mark_label inside a cropped chart
//   ocr(image)              nvidia/nemotron-ocr-v2: text lines with polygons
//   readChart(image, hints) nvidia/nemotron-3.5-super-vl-120b-a12b: the values a
//                           chart plots, grounded on the labels above
//
// Every box comes back normalised to 0..1 of the image that was sent. Images
// go inline as data URLs (probed: a 1.4 MB JPEG is accepted). Model ids were
// probed live on 2026-11-16 with our NVIDIA_API_KEY: the older
// nvidia/nemoretriever-{page-elements-v2,v3, table-structure-v1,
// graphic-elements-v1, ocr-v1} ids answer 410 Gone (end of life 2026-05-18 and
// 2026-08-25). docs/nvidia/evals/pdf-extraction-2026-11-16.md has the table.
//
// Failure contract: a call throws NvidiaExtractError. 404/410 mean the model
// was retired: the error is marked `retired`, ops is paged once per model, and
// the PDF pipeline falls back to text extraction for that document.

import { sendOpsAlert } from './alerts.js';

const CV_BASE = 'https://ai.api.nvidia.com/v1/cv';
const CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

export const MODELS = Object.freeze({
	pageElements: 'nvidia/nemotron-page-elements-v3',
	tableStructure: 'nvidia/nemotron-table-structure-v1',
	graphicElements: 'nvidia/nemotron-graphic-elements-v1',
	ocr: 'nvidia/nemotron-ocr-v2',
	chartReader: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
});

const CV_TIMEOUT_MS = 30_000;
const VL_TIMEOUT_MS = 45_000;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const alerted = new Set();

export class NvidiaExtractError extends Error {
	constructor(model, status, message, { retired = false } = {}) {
		super(message);
		this.model = model;
		this.status = status;
		this.retired = retired;
	}
}

export function nvidiaExtractConfigured() {
	return !!process.env.NVIDIA_API_KEY;
}

function headers() {
	return {
		Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
		Accept: 'application/json',
		'Content-Type': 'application/json',
	};
}

function dataUrl(image) {
	return `data:${image.mime || 'image/jpeg'};base64,${Buffer.from(image.bytes).toString('base64')}`;
}

async function postJson(model, url, body, timeoutMs) {
	let lastStatus = 0;
	let lastText = '';
	for (let attempt = 0; attempt < 3; attempt++) {
		let res;
		try {
			res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
		} catch (err) {
			lastStatus = 0;
			lastText = err?.name === 'TimeoutError' ? 'timed out' : String(err?.message || err);
			if (attempt < 2) {
				await pause(attempt);
				continue;
			}
			break;
		}
		if (res.ok) return res.json();
		lastStatus = res.status;
		lastText = (await res.text().catch(() => '')).slice(0, 400);
		if (res.status === 404 || res.status === 410) {
			reportRetired(model, res.status, lastText);
			throw new NvidiaExtractError(model, res.status, `${model} answered ${res.status}`, { retired: true });
		}
		if (!RETRY_STATUSES.has(res.status) || attempt === 2) break;
		await pause(attempt, res.headers.get('retry-after'));
	}
	throw new NvidiaExtractError(model, lastStatus, `${model} failed (${lastStatus || 'network'}): ${lastText}`);
}

function pause(attempt, retryAfter) {
	const hinted = Number(retryAfter);
	const ms = Number.isFinite(hinted) && hinted > 0 ? Math.min(hinted * 1000, 8000) : 600 * 2 ** attempt;
	return new Promise((r) => setTimeout(r, ms));
}

function reportRetired(model, status, detail) {
	if (alerted.has(model)) return;
	alerted.add(model);
	console.warn(`[nvidia-doc-extract] ${model} answered ${status}; PDF uploads fall back to text extraction`);
	void sendOpsAlert(
		`NVIDIA extraction model ${model} answered ${status}: PDF knowledge falls back to text extraction`,
		`${detail ? `${detail.slice(0, 300)}\n` : ''}Uploads still succeed through the text-layer fallback. Probe the current id on build.nvidia.com and update MODELS in api/_lib/nvidia-doc-extract.js.`,
		{ signature: `nvidia-doc-extract:retired:${model}` },
	);
}

async function cv(model, image) {
	const out = await postJson(model, `${CV_BASE}/${model}`, { input: [{ type: 'image_url', url: dataUrl(image) }] }, CV_TIMEOUT_MS);
	const first = Array.isArray(out?.data) ? out.data[0] : null;
	if (!first) throw new NvidiaExtractError(model, 200, `${model} returned no data`);
	return first;
}

function boxesByClass(first) {
	const out = {};
	for (const [cls, list] of Object.entries(first.bounding_boxes || {})) {
		out[cls] = (Array.isArray(list) ? list : []).map((b) => ({
			x0: clamp01(b.x_min),
			y0: clamp01(b.y_min),
			x1: clamp01(b.x_max),
			y1: clamp01(b.y_max),
			confidence: Number(b.confidence) || 0,
		}));
	}
	return out;
}

/** @returns {Promise<Record<string, {x0,y0,x1,y1,confidence}[]>>} */
export async function pageElements(image) {
	return boxesByClass(await cv(MODELS.pageElements, image));
}

/** @returns {Promise<{ row: Box[], column: Box[], cell: Box[] }>} */
export async function tableStructure(image) {
	const b = boxesByClass(await cv(MODELS.tableStructure, image));
	return { row: b.row || [], column: b.column || [], cell: b.cell || [] };
}

export async function graphicElements(image) {
	return boxesByClass(await cv(MODELS.graphicElements, image));
}

/** @returns {Promise<{ text: string, confidence: number, x0, y0, x1, y1 }[]>} */
export async function ocr(image) {
	const first = await cv(MODELS.ocr, image);
	return (first.text_detections || [])
		.map((d) => {
			const pts = d.bounding_box?.points || [];
			const xs = pts.map((p) => Number(p.x));
			const ys = pts.map((p) => Number(p.y));
			return {
				text: String(d.text_prediction?.text || '').trim(),
				confidence: Number(d.text_prediction?.confidence) || 0,
				x0: clamp01(Math.min(...xs)),
				y0: clamp01(Math.min(...ys)),
				x1: clamp01(Math.max(...xs)),
				y1: clamp01(Math.max(...ys)),
			};
		})
		.filter((d) => d.text && Number.isFinite(d.x0) && Number.isFinite(d.y0));
}

/**
 * Read the values a chart plots. `hints` is the structure graphic elements and
 * OCR found (title, axes, categories, legend), so the model names series and
 * categories exactly as the chart prints them.
 * @returns {Promise<string>} plain-text value readout
 */
export async function readChart(image, hints) {
	const prompt = [
		'You are indexing a chart from a document so a search system can answer questions about it.',
		hints ? `Labels detected on the chart:\n${hints}` : '',
		'For every category on the x axis (or every slice or point), give each series value read from the chart, using the label text exactly as printed. If the figure has several panels, read each panel separately and start its lines with the panel title or y-axis title. Mark estimates read from bar heights or line positions with "about". One line per category, plain text, no preamble, no markdown.',
	]
		.filter(Boolean)
		.join('\n\n');
	const out = await postJson(
		MODELS.chartReader,
		CHAT_URL,
		{
			model: MODELS.chartReader,
			temperature: 0,
			max_tokens: 900,
			chat_template_kwargs: { enable_thinking: false },
			messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl(image) } }] }],
		},
		VL_TIMEOUT_MS,
	);
	const text = String(out?.choices?.[0]?.message?.content || '').trim();
	if (!text) throw new NvidiaExtractError(MODELS.chartReader, 200, 'chart reader returned no text');
	return text;
}

function clamp01(v) {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : NaN;
}
