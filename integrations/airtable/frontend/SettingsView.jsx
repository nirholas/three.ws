import React from 'react';
import {
	Box,
	Button,
	FieldPickerSynced,
	FormField,
	Heading,
	SelectButtonsSynced,
	TablePickerSynced,
	Text,
	ViewPickerSynced,
	useGlobalConfig,
} from '@airtable/blocks/ui';
import { CONFIG, FIELD_KEYS } from './settings.js';
import { LINK_FIELD_TYPES, MODEL_FIELD_TYPES, PROMPT_FIELD_TYPES, STATUS_FIELD_TYPES } from './fields.js';
import ApiKeyForm from './ApiKeyForm.jsx';

const TIER_OPTIONS = [
	{ value: 'draft', label: 'Draft' },
	{ value: 'standard', label: 'Standard' },
	{ value: 'high', label: 'High' },
];

const TIER_NOTES = {
	draft: 'Fastest. A model usually lands in under a minute.',
	standard: 'More geometry and texture detail. Takes a little longer.',
	high: 'The most detail Forge offers. Takes the longest.',
};

export default function SettingsView({ settings, apiKey, onApiKeyChange, onDone }) {
	const globalConfig = useGlobalConfig();
	const canEdit = globalConfig.hasPermissionToSet();
	const { table } = settings;

	function clearFieldsForNewTable() {
		if (!canEdit) return;
		globalConfig.setPathsAsync(FIELD_KEYS.map((key) => ({ path: [key], value: null })));
	}

	return (
		<Box padding={3} maxWidth="560px">
			<Heading size="small" marginBottom={1}>
				Set up Forge
			</Heading>
			<Text textColor="light" marginBottom={3}>
				Each record's prompt (for example "a brass desk lamp with a green glass shade") becomes a textured 3D
				model (GLB), saved back into the record.
			</Text>

			{!canEdit && (
				<Box backgroundColor="lightGray1" borderRadius="large" padding={2} marginBottom={3}>
					<Text>Only base editors can change the field mapping. Ask an editor if a field below is wrong.</Text>
				</Box>
			)}

			<FormField label="Table">
				<TablePickerSynced globalConfigKey={CONFIG.table} onChange={clearFieldsForNewTable} />
			</FormField>
			<FormField label="View (optional)" description="Only generate for records in this view. Leave empty for the whole table.">
				<ViewPickerSynced table={table} globalConfigKey={CONFIG.view} shouldAllowPickingNone placeholder="Whole table" />
			</FormField>
			<FormField label="Prompt field" description="Text describing one object per record.">
				<FieldPickerSynced
					table={table}
					globalConfigKey={CONFIG.promptField}
					allowedTypes={PROMPT_FIELD_TYPES}
					placeholder="Pick a text field"
				/>
			</FormField>
			<FormField
				label="Model field"
				description="Where the GLB is saved. An attachment field stores the file in the base; a URL or text field stores its link."
			>
				<FieldPickerSynced
					table={table}
					globalConfigKey={CONFIG.modelField}
					allowedTypes={MODEL_FIELD_TYPES}
					placeholder="Pick an attachment, URL or text field"
				/>
			</FormField>
			<FormField label="3D page field (optional)" description="Gets a link to the model's interactive 3D page on three.ws.">
				<FieldPickerSynced
					table={table}
					globalConfigKey={CONFIG.linkField}
					allowedTypes={LINK_FIELD_TYPES}
					shouldAllowPickingNone
					placeholder="None"
				/>
			</FormField>
			<FormField label="Status field (optional)" description='Gets "Done" or the reason a generation failed.'>
				<FieldPickerSynced
					table={table}
					globalConfigKey={CONFIG.statusField}
					allowedTypes={STATUS_FIELD_TYPES}
					shouldAllowPickingNone
					placeholder="None"
				/>
			</FormField>
			<FormField label="Quality" description={TIER_NOTES[settings.tier]}>
				<SelectButtonsSynced globalConfigKey={CONFIG.tier} options={TIER_OPTIONS} width="320px" />
			</FormField>

			<Box borderTop="default" paddingTop={3} marginTop={3}>
				<ApiKeyForm apiKey={apiKey} onChange={onApiKeyChange} />
			</Box>

			<Box display="flex" alignItems="center" marginTop={3}>
				<Button variant="primary" onClick={onDone} disabled={!settings.isValid || !apiKey} marginRight={2}>
					Done
				</Button>
				<Text textColor="light" role="status">
					{settings.message || (!apiKey ? 'Add your three.ws API key to finish.' : 'Ready.')}
				</Text>
			</Box>
		</Box>
	);
}
