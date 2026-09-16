// Markdown to X Article content_state.
//
// X's Articles API (POST /2/articles/draft) takes a DraftJS-style body: an
// ordered list of blocks (paragraphs, headings, list items, quotes, atomic
// embeds) plus an entities array those blocks point into. Articles are authored
// as Markdown in data/x-content/articles/, so they diff cleanly in review and
// the same file can be rendered anywhere else; this module is the one place
// that turns that Markdown into the wire format.
//
// Mapping:
//   # / ## / ###+            header-one / header-two / header-three
//   paragraph                unstyled, with bold / italic / strikethrough ranges
//   [text](url)              link entity over the range
//   - item / 1. item         unordered-list-item / ordered-list-item
//   > quote                  blockquote
//   ![caption](path)         atomic block + image entity (uploaded at publish)
//   ---                      atomic block + divider entity
//   ```code``` and tables    atomic block + markdown entity (X renders both)
//
// Offsets are JavaScript string indexes, matching the DraftJS composer.

import { dirname, normalize } from 'node:path';
import { marked } from 'marked';
import { parse as parseHtml } from 'node-html-parser';

export const MARKDOWN_ENTITY_BUDGET = 10_000;

// Decode character references (&amp;, &#39;) without letting the parser eat
// literal angle-bracket text such as `<agent-3d>`.
const decode = (value) => parseHtml(`<p>${String(value || '').replace(/</g, '&lt;')}</p>`).textContent;

const HEADER = { 1: 'header-one', 2: 'header-two' };

class ContentStateBuilder {
	constructor(resolveImage) {
		this.blocks = [];
		this.entities = [];
		this.images = [];
		this.markdownWeight = 0;
		this.warnings = [];
		this.resolveImage = resolveImage;
	}

	entity(type, mutability, data) {
		this.entities.push({ key: String(this.entities.length), value: { type, mutability, data } });
		return this.entities.length - 1;
	}

	text(type, runs) {
		let text = '';
		const inline_style_ranges = [];
		const entity_ranges = [];
		let link = null;
		const closeLink = () => {
			if (!link) return;
			const key = this.entity('link', 'mutable', { url: link.url });
			entity_ranges.push({ key, offset: link.offset, length: text.length - link.offset });
			link = null;
		};
		for (const run of runs) {
			if (!run.text) continue;
			if (link && link.url !== run.href) closeLink();
			if (run.href && !link) link = { url: run.href, offset: text.length };
			const offset = text.length;
			text += run.text;
			for (const style of ['bold', 'italic', 'strikethrough']) {
				if (run[style]) inline_style_ranges.push({ offset, length: run.text.length, style });
			}
		}
		closeLink();
		const trimmed = text.replace(/\s+$/, '');
		if (!trimmed.trim()) return;
		const block = { type, text: trimmed };
		if (inline_style_ranges.length) block.inline_style_ranges = mergeRanges(inline_style_ranges, trimmed.length);
		const ranges = entity_ranges
			.map((range) => ({ ...range, length: Math.min(range.length, trimmed.length - range.offset) }))
			.filter((range) => range.length > 0);
		if (ranges.length) block.entity_ranges = ranges;
		this.blocks.push(block);
	}

	atomic(type, mutability, data, text = ' ') {
		const key = this.entity(type, mutability, data);
		this.blocks.push({ type: 'atomic', text, entity_ranges: [{ key, offset: 0, length: text.length }] });
		return key;
	}

	image(href, caption) {
		const path = this.resolveImage(href);
		if (!path) {
			this.warnings.push(`image ${href} is not a local file under public/ or data/; it was left out`);
			return;
		}
		const data = { media_items: [] };
		if (caption) data.caption = caption;
		const entityIndex = this.atomic('image', 'immutable', data);
		this.images.push({ entityIndex, path, caption });
	}

	markdown(source) {
		this.markdownWeight += source.length;
		this.atomic('markdown', 'mutable', { markdown: source });
	}
}

// DraftJS stores one range per styled span; collapse adjacent spans of the same
// style that the tokenizer split across text nodes.
function mergeRanges(ranges, limit) {
	const sorted = [...ranges].sort((a, b) => a.style.localeCompare(b.style) || a.offset - b.offset);
	const merged = [];
	for (const range of sorted) {
		const previous = merged[merged.length - 1];
		if (previous && previous.style === range.style && previous.offset + previous.length === range.offset) previous.length += range.length;
		else merged.push({ ...range });
	}
	return merged
		.map((range) => ({ ...range, length: Math.min(range.length, limit - range.offset) }))
		.filter((range) => range.length > 0);
}

function inlineRuns(tokens, style = {}) {
	const runs = [];
	for (const token of tokens || []) {
		switch (token.type) {
			case 'strong':
				runs.push(...inlineRuns(token.tokens, { ...style, bold: true }));
				break;
			case 'em':
				runs.push(...inlineRuns(token.tokens, { ...style, italic: true }));
				break;
			case 'del':
				runs.push(...inlineRuns(token.tokens, { ...style, strikethrough: true }));
				break;
			case 'link':
				runs.push(...inlineRuns(token.tokens, { ...style, href: token.href }));
				break;
			case 'br':
				runs.push({ ...style, text: '\n' });
				break;
			case 'codespan':
				runs.push({ ...style, text: decode(token.text) });
				break;
			case 'html':
				// Articles have no HTML. A line break tag is a break; anything else
				// (an element name written in prose, like <agent-3d>) is literal text.
				runs.push({ ...style, text: /^<br\s*\/?>$/i.test(token.text.trim()) ? '\n' : token.text });
				break;
			case 'text':
				if (token.tokens?.length) runs.push(...inlineRuns(token.tokens, style));
				else runs.push({ ...style, text: decode(token.text) });
				break;
			case 'escape':
				runs.push({ ...style, text: token.text });
				break;
			default:
				if (token.tokens) runs.push(...inlineRuns(token.tokens, style));
				else if (token.text) runs.push({ ...style, text: decode(token.text) });
		}
	}
	return runs;
}

// A paragraph may mix prose with images. Images become their own atomic blocks
// in reading order; the prose around them stays a paragraph.
function paragraph(builder, tokens, type = 'unstyled') {
	let pending = [];
	const flush = () => {
		builder.text(type, inlineRuns(pending));
		pending = [];
	};
	for (const token of tokens || []) {
		if (token.type === 'image') {
			flush();
			builder.image(token.href, decode(token.text));
		} else {
			pending.push(token);
		}
	}
	flush();
}

function list(builder, token) {
	const type = token.ordered ? 'ordered-list-item' : 'unordered-list-item';
	for (const item of token.items) {
		const inline = [];
		for (const child of item.tokens || []) {
			if (child.type === 'list') {
				if (inline.length) builder.text(type, inlineRuns(inline.splice(0)));
				list(builder, child);
			} else if (child.type === 'text' || child.type === 'paragraph') {
				if (inline.length) inline.push({ type: 'br' });
				inline.push(...(child.tokens || [{ type: 'text', text: child.text }]));
			}
		}
		if (inline.length) builder.text(type, inlineRuns(inline));
	}
}

function walk(builder, tokens, context = null) {
	for (const token of tokens) {
		switch (token.type) {
			case 'space':
				break;
			case 'heading':
				builder.text(HEADER[token.depth] || 'header-three', inlineRuns(token.tokens));
				break;
			case 'paragraph':
				paragraph(builder, token.tokens, context || 'unstyled');
				break;
			case 'text':
				paragraph(builder, token.tokens || [{ type: 'text', text: token.text }], context || 'unstyled');
				break;
			case 'blockquote':
				walk(builder, token.tokens, 'blockquote');
				break;
			case 'list':
				list(builder, token);
				break;
			case 'hr':
				builder.atomic('divider', 'immutable', {});
				break;
			case 'code':
				builder.markdown(`\`\`\`${token.lang || ''}\n${token.text}\n\`\`\``);
				break;
			case 'table':
				builder.markdown(token.raw.trim());
				break;
			case 'html': {
				const text = token.text.trim();
				if (text) builder.text(context || 'unstyled', [{ text }]);
				break;
			}
			default:
				builder.warnings.push(`unsupported markdown token ${token.type} was left out`);
		}
	}
}

// Image references resolve to repo paths the publisher can upload. `articlePath`
// is the Markdown file's repo-relative path.
export function imageResolver(articlePath) {
	const base = dirname(articlePath);
	return (href) => {
		const ref = decodeURI(String(href || '').trim());
		if (!ref || /^[a-z]+:/i.test(ref)) return null;
		let path;
		if (ref.startsWith('public/') || ref.startsWith('data/')) path = ref;
		else if (ref.startsWith('/')) path = `public${ref}`;
		else path = normalize(`${base}/${ref}`);
		return path.startsWith('public/') || path.startsWith('data/') ? path : null;
	};
}

export function markdownToContentState(markdown, { articlePath = 'data/x-content/articles/article.md' } = {}) {
	const builder = new ContentStateBuilder(imageResolver(articlePath));
	walk(builder, marked.lexer(String(markdown || '')));
	return {
		content_state: { blocks: builder.blocks, entities: builder.entities },
		images: builder.images,
		markdownWeight: builder.markdownWeight,
		warnings: builder.warnings,
	};
}

// Fill each image entity with its uploaded media id.
export function attachArticleMedia(contentState, images, mediaIds) {
	const entities = contentState.entities.map((entity) => structuredClone(entity));
	images.forEach((image, index) => {
		entities[image.entityIndex].value.data.media_items = [{ media_category: 'tweet_image', media_id: mediaIds[index] }];
	});
	return { blocks: contentState.blocks, entities };
}
