import { useBase, useGlobalConfig } from '@airtable/blocks/ui';
import { MODEL_FIELD_TYPES, PROMPT_FIELD_TYPES, LINK_FIELD_TYPES, STATUS_FIELD_TYPES } from './fields.js';
import { TIERS } from './forge-client.js';

// Field mapping is stored in globalConfig so every collaborator sees the same setup.
export const CONFIG = {
	table: 'tableId',
	view: 'viewId',
	promptField: 'promptFieldId',
	modelField: 'modelFieldId',
	linkField: 'linkFieldId',
	statusField: 'statusFieldId',
	tier: 'tier',
};

export const FIELD_KEYS = [CONFIG.view, CONFIG.promptField, CONFIG.modelField, CONFIG.linkField, CONFIG.statusField];

function typed(field, allowed) {
	return field && allowed.includes(field.type) ? field : null;
}

/** Resolve the stored ids into live models and say what, if anything, is still missing. */
export function resolveSettings(base, globalConfig) {
	const table = base.getTableByIdIfExists(globalConfig.get(CONFIG.table) || '');
	const field = (key) => (table ? table.getFieldByIdIfExists(globalConfig.get(key) || '') : null);
	const view = table ? table.getViewByIdIfExists(globalConfig.get(CONFIG.view) || '') : null;
	const promptRaw = field(CONFIG.promptField);
	const modelRaw = field(CONFIG.modelField);
	const linkField = typed(field(CONFIG.linkField), LINK_FIELD_TYPES);
	const statusField = typed(field(CONFIG.statusField), STATUS_FIELD_TYPES);
	const promptField = typed(promptRaw, PROMPT_FIELD_TYPES);
	const modelField = typed(modelRaw, MODEL_FIELD_TYPES);
	const tierValue = globalConfig.get(CONFIG.tier);
	const tier = TIERS.includes(tierValue) ? tierValue : 'draft';

	let message = '';
	if (!table) message = 'Pick the table whose records should become 3D models.';
	else if (!promptRaw) message = 'Pick the field that describes each object (the prompt).';
	else if (!promptField) message = `"${promptRaw.name}" can't be read as a prompt. Pick a text field.`;
	else if (!modelRaw) message = 'Pick the field where each finished model is saved.';
	else if (!modelField) message = `"${modelRaw.name}" can't hold a model. Pick an attachment, URL or text field.`;
	else if (modelField.id === promptField.id) message = 'The prompt and the model need two different fields.';

	return { table, view, promptField, modelField, linkField, statusField, tier, isValid: !message, message };
}

export function useSettings() {
	const base = useBase();
	const globalConfig = useGlobalConfig();
	return resolveSettings(base, globalConfig);
}
