import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Heading, Text, useCursor, useLoadable, useRecords, useSettingsButton, useWatchable } from '@airtable/blocks/ui';
import { AbortedError, ForgeClient, ForgeError } from './forge-client.js';
import { cellUpdatesFor, failureNoteFor, hasModel, hasUsablePrompt, promptOf } from './fields.js';
import { ForgeQueue } from './queue.js';
import { readApiKey } from './api-key.js';
import { useSettings } from './settings.js';
import SettingsView from './SettingsView.jsx';
import RecordList from './RecordList.jsx';
import ApiKeyForm from './ApiKeyForm.jsx';

export default function ForgeApp({ clientOptions = null }) {
	const settings = useSettings();
	const [apiKey, setApiKey] = useState(() => readApiKey());
	const [showSettings, setShowSettings] = useState(false);
	const [keyRejected, setKeyRejected] = useState(false);
	useSettingsButton(() => setShowSettings((open) => !open));

	function changeKey(key) {
		setApiKey(key);
		setKeyRejected(false);
	}

	if (showSettings || !settings.isValid || !apiKey) {
		return (
			<SettingsView
				settings={settings}
				apiKey={apiKey}
				onApiKeyChange={changeKey}
				onDone={() => setShowSettings(false)}
			/>
		);
	}

	if (keyRejected) {
		return (
			<Box padding={3} maxWidth="560px">
				<ApiKeyForm apiKey={apiKey} onChange={changeKey} rejected />
			</Box>
		);
	}

	return (
		<Generator
			settings={settings}
			apiKey={apiKey}
			clientOptions={clientOptions}
			onOpenSettings={() => setShowSettings(true)}
			onKeyRejected={() => setKeyRejected(true)}
		/>
	);
}

function Generator({ settings, apiKey, clientOptions, onOpenSettings, onKeyRejected }) {
	const { table, view, promptField, modelField, linkField, statusField, tier } = settings;
	const records = useRecords(view || table, {
		fields: [table.primaryField, promptField, modelField, linkField, statusField].filter(Boolean),
	});
	const cursor = useCursor();
	useLoadable(cursor);
	useWatchable(cursor, ['selectedRecordIds', 'activeTableId']);

	// The queue outlives renders; it reads the newest settings and records through refs.
	const live = useRef({});
	live.current = { settings, records, client: new ForgeClient({ apiKey, ...(clientOptions || {}) }), onKeyRejected };

	const queue = useMemo(
		() =>
			new ForgeQueue({
				concurrency: 2,
				runJob: async (entry, { signal, onStatus, onSaving }) => {
					const { client, settings: s } = live.current;
					try {
						const result = await client.generate(entry.prompt, s.tier, { signal, onStatus });
						onSaving();
						const record = live.current.records?.find((r) => r.id === entry.id);
						if (!record) {
							throw new ForgeError(
								'The record was deleted or left the view before its model finished. The model is still in your three.ws account.',
								'record_gone',
							);
						}
						await s.table.updateRecordAsync(
							record,
							cellUpdatesFor({
								record,
								prompt: entry.prompt,
								result,
								modelField: s.modelField,
								linkField: s.linkField,
								statusField: s.statusField,
							}),
						);
						return result;
					} catch (error) {
						if (error instanceof ForgeError && error.isAuth) live.current.onKeyRejected();
						if (!(error instanceof AbortedError) && s.statusField && error.code !== 'record_gone') {
							const fields = { [s.statusField.id]: failureNoteFor(error.message) };
							if (s.table.hasPermissionToUpdateRecord(entry.id, fields)) {
								await s.table.updateRecordAsync(entry.id, fields).catch(() => {});
							}
						}
						throw error;
					}
				},
			}),
		[],
	);

	const [jobs, setJobs] = useState(() => queue.snapshot());
	useEffect(() => queue.subscribe(setJobs), [queue]);
	useEffect(() => () => queue.stop(), [queue]);

	const writeFields = { [modelField.id]: undefined };
	if (linkField) writeFields[linkField.id] = undefined;
	if (statusField) writeFields[statusField.id] = undefined;
	const permission = table.checkPermissionsForUpdateRecord(undefined, writeFields);

	const withPrompt = (records || []).filter((r) => hasUsablePrompt(r, promptField));
	const todo = withPrompt.filter((r) => !hasModel(r, modelField) && !queue.isActive(r.id));
	const selectedIds = cursor.activeTableId === table.id ? new Set(cursor.selectedRecordIds) : new Set();
	const selectedTodo = withPrompt.filter((r) => selectedIds.has(r.id) && !queue.isActive(r.id));
	const active = queue.activeCount;

	const start = (list) => queue.enqueue(list.map((r) => ({ id: r.id, prompt: promptOf(r, promptField) })));

	return (
		<Box display="flex" flexDirection="column" height="100vh">
			<Box padding={3} borderBottom="default">
				<Box display="flex" alignItems="flex-start" justifyContent="space-between">
					<Box marginRight={2}>
						<Heading size="small" marginBottom={1}>
							Forge 3D models
						</Heading>
						<Text textColor="light">
							{promptField.name} → {modelField.name} in {table.name}
							{view ? ` (${view.name})` : ''} · {tier} quality
						</Text>
					</Box>
					<Button size="small" variant="secondary" icon="cog" onClick={onOpenSettings} aria-label="Settings">
						Settings
					</Button>
				</Box>

				<Box display="flex" flexWrap="wrap" alignItems="center" marginTop={3}>
					<Button
						variant="primary"
						icon={todo.length === 0 ? 'check' : 'play'}
						marginRight={2}
						marginBottom={1}
						disabled={!permission.hasPermission || todo.length === 0}
						onClick={() => start(todo)}
					>
						{todo.length === 0
							? 'All models generated'
							: todo.length === 1
								? 'Generate 1 model'
								: `Generate ${todo.length} models`}
					</Button>
					{selectedTodo.length > 0 && (
						<Button
							variant="secondary"
							marginRight={2}
							marginBottom={1}
							disabled={!permission.hasPermission}
							onClick={() => start(selectedTodo)}
						>
							Generate selected ({selectedTodo.length})
						</Button>
					)}
					{active > 0 && (
						<Button variant="danger" icon="x" marginBottom={1} onClick={() => queue.stop()}>
							Stop ({active})
						</Button>
					)}
				</Box>
				{!permission.hasPermission && (
					<Text textColor="light" marginTop={1} role="status">
						{permission.reasonDisplayString || 'You need edit access to these fields to save models.'}
					</Text>
				)}
			</Box>

			<RecordList
				loading={!records}
				records={withPrompt}
				totalRecords={records ? records.length : 0}
				jobs={jobs}
				settings={settings}
				canWrite={permission.hasPermission}
				onGenerate={(record) => start([record])}
			/>

			<Box padding={2} borderTop="default" backgroundColor="lightGray1">
				<Text size="small" textColor="light">
					Each prompt is sent to three.ws to generate its model. Up to two run at once; stopping leaves models
					already started in your three.ws account.
				</Text>
			</Box>
		</Box>
	);
}
