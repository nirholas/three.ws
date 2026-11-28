// Which Airtable field types each mapped role accepts, and how a Forge result is
// written into each type. Plain strings match the SDK's FieldType enum values
// (tests/fields.test.js pins them), so this module loads without the SDK.

export const PROMPT_FIELD_TYPES = [
	'singleLineText',
	'multilineText',
	'richText',
	'singleSelect',
	'formula',
	'multipleLookupValues',
	'rollup',
	'aiText',
];

export const MODEL_FIELD_TYPES = ['multipleAttachments', 'url', 'singleLineText', 'multilineText'];
export const LINK_FIELD_TYPES = ['url', 'singleLineText', 'multilineText'];
export const STATUS_FIELD_TYPES = ['singleLineText', 'multilineText'];

export const MIN_PROMPT_LENGTH = 3;

/** The prompt text for a record, or '' when the cell is empty. */
export function promptOf(record, promptField) {
	if (!record || !promptField) return '';
	return String(record.getCellValueAsString(promptField) || '').trim();
}

export function hasUsablePrompt(record, promptField) {
	return promptOf(record, promptField).length >= MIN_PROMPT_LENGTH;
}

/** A model cell counts as filled when it holds any attachment or any text. */
export function hasModel(record, modelField) {
	if (!record || !modelField) return false;
	const value = record.getCellValue(modelField);
	if (Array.isArray(value)) return value.length > 0;
	return Boolean(value && String(value).trim());
}

/** The GLB link already stored in a record's model cell, or null. */
export function storedModelUrl(record, modelField) {
	if (!record || !modelField) return null;
	const value = record.getCellValue(modelField);
	if (Array.isArray(value)) {
		const glb = value.find((a) => /\.glb($|\?)/i.test(a?.filename || '') || /\.glb($|\?)/i.test(a?.url || ''));
		return (glb || value[0])?.url || null;
	}
	const text = value ? String(value).trim() : '';
	return /^https:\/\//.test(text) ? text : null;
}

/** A stored attachment's thumbnail, when Airtable has rendered one. */
export function storedThumbnailUrl(record, modelField) {
	if (!record || !modelField || modelField.type !== 'multipleAttachments') return null;
	const value = record.getCellValue(modelField);
	if (!Array.isArray(value)) return null;
	for (const attachment of value) {
		const thumb = attachment?.thumbnails?.large?.url || attachment?.thumbnails?.small?.url;
		if (thumb) return thumb;
	}
	return null;
}

export function fileNameFor(prompt) {
	const slug = String(prompt || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	return `${slug || 'model'}.glb`;
}

/**
 * The cell writes for one finished generation. Attachments are appended to what the
 * cell already holds (Airtable copies the GLB into the base from its URL); text and
 * URL cells take the GLB link. The optional link and status fields get the model page
 * and a short "Done" note.
 */
export function cellUpdatesFor({ record, prompt, result, modelField, linkField, statusField }) {
	const updates = {};
	if (modelField.type === 'multipleAttachments') {
		const existing = (record && record.getCellValue(modelField)) || [];
		updates[modelField.id] = [
			...existing.map(({ id, url, filename }) => ({ id, url, filename })),
			{ url: result.glbUrl, filename: fileNameFor(prompt) },
		];
	} else {
		updates[modelField.id] = result.glbUrl;
	}
	if (linkField && linkField.id !== modelField.id) updates[linkField.id] = result.pageUrl;
	if (statusField && statusField.id !== modelField.id && (!linkField || statusField.id !== linkField.id)) {
		updates[statusField.id] = 'Done';
	}
	return updates;
}

export function failureNoteFor(message) {
	return `Failed: ${String(message || 'unknown error').slice(0, 200)}`;
}
