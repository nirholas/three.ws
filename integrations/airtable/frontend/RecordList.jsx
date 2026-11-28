import React, { useState } from 'react';
import { Box, Button, Icon, Link, Loader, Text, expandRecord } from '@airtable/blocks/ui';
import { hasModel, promptOf, storedModelUrl, storedThumbnailUrl } from './fields.js';
import { ACTIVE_PHASES, PHASES } from './queue.js';
import { DEFAULT_BASE_URL, modelPageUrl, posterUrl } from './forge-client.js';

const PAGE = 100;

export default function RecordList({ loading, records, totalRecords, jobs, settings, canWrite, onGenerate }) {
	const [limit, setLimit] = useState(PAGE);
	const { promptField, modelField, view, table } = settings;

	if (loading) {
		return (
			<Box flex="auto" overflow="auto" aria-busy="true" aria-label="Loading records">
				{[0, 1, 2, 3].map((i) => (
					<Box key={i} display="flex" alignItems="center" padding={2} borderBottom="default">
						<Box width="56px" height="56px" borderRadius="large" backgroundColor="lightGray2" marginRight={2} />
						<Box flex="auto">
							<Box height="12px" width="60%" borderRadius="default" backgroundColor="lightGray2" marginBottom={1} />
							<Box height="10px" width="30%" borderRadius="default" backgroundColor="lightGray1" />
						</Box>
					</Box>
				))}
			</Box>
		);
	}

	if (records.length === 0) {
		return (
			<Box flex="auto" display="flex" flexDirection="column" alignItems="center" justifyContent="center" padding={4}>
				<Icon name="cube" size={28} fillColor="gray" marginBottom={2} />
				<Text textAlign="center" maxWidth="360px" marginBottom={1}>
					{totalRecords === 0
						? `${view ? `The "${view.name}" view` : `The ${table.name} table`} has no records yet.`
						: `None of the ${totalRecords} records has a prompt in "${promptField.name}" yet.`}
				</Text>
				<Text textAlign="center" textColor="light" maxWidth="360px">
					Type a short description of one object, like "a brass desk lamp with a green glass shade", into{' '}
					{promptField.name}. It appears here, ready to generate.
				</Text>
			</Box>
		);
	}

	const done = records.filter((r) => hasModel(r, modelField)).length;

	return (
		<Box flex="auto" overflow="auto">
			<Box paddingX={3} paddingY={2} borderBottom="default">
				<Text size="small" textColor="light">
					{done} of {records.length} records with a prompt have a model.
				</Text>
			</Box>
			{records.slice(0, limit).map((record) => (
				<Row
					key={record.id}
					record={record}
					job={jobs.get(record.id)}
					settings={settings}
					canWrite={canWrite}
					onGenerate={onGenerate}
				/>
			))}
			{records.length > limit && (
				<Box padding={2} display="flex" justifyContent="center">
					<Button variant="secondary" size="small" onClick={() => setLimit(limit + PAGE)}>
						Show {Math.min(PAGE, records.length - limit)} more
					</Button>
				</Box>
			)}
		</Box>
	);
}

function Thumbnail({ src, busy }) {
	// A poster that fails to load (no poster stored, offline) falls back to the cube.
	const [failedSrc, setFailedSrc] = useState(null);
	const shown = src && src !== failedSrc ? src : null;
	return (
		<Box
			width="56px"
			height="56px"
			flex="none"
			borderRadius="large"
			backgroundColor="lightGray1"
			marginRight={2}
			display="flex"
			alignItems="center"
			justifyContent="center"
			overflow="hidden"
		>
			{shown ? (
				<img
					src={shown}
					alt=""
					width="56"
					height="56"
					style={{ objectFit: 'cover', display: 'block' }}
					onError={() => setFailedSrc(shown)}
				/>
			) : busy ? (
				<Loader scale={0.3} />
			) : (
				<Icon name="cube" size={20} fillColor="gray" />
			)}
		</Box>
	);
}

function Row({ record, job, settings, canWrite, onGenerate }) {
	const { promptField, modelField } = settings;
	const prompt = promptOf(record, promptField);
	const phase = job?.phase;
	const busy = ACTIVE_PHASES.has(phase);
	const stored = hasModel(record, modelField);
	const result = phase === 'done' ? job.result : null;
	const storedUrl = storedModelUrl(record, modelField);
	const pageUrl = result?.pageUrl || (storedUrl ? modelPageUrl(DEFAULT_BASE_URL, storedUrl, null) : null);
	const thumb =
		result?.previewImageUrl ||
		storedThumbnailUrl(record, modelField) ||
		posterUrl(DEFAULT_BASE_URL, result?.glbUrl || storedUrl);
	const title = record.name && record.name !== prompt ? record.name : null;

	let status;
	if (busy) {
		const seconds = Math.round((job.elapsedMs || 0) / 1000);
		status = (
			<Text size="small" textColor="light" role="status">
				{PHASES[phase]}
				{seconds > 0 ? ` · ${seconds}s` : ''}
			</Text>
		);
	} else if (phase === 'failed') {
		status = (
			<Text size="small" textColor="red" role="alert">
				{job.error?.message || 'Generation failed.'}
			</Text>
		);
	} else if (phase === 'stopped') {
		status = (
			<Text size="small" textColor="light">
				Stopped
			</Text>
		);
	} else if (stored || result) {
		status = (
			<Text size="small" textColor="green">
				Model saved
			</Text>
		);
	} else {
		status = (
			<Text size="small" textColor="light">
				No model yet
			</Text>
		);
	}

	return (
		<Box display="flex" alignItems="center" paddingX={3} paddingY={2} borderBottom="default">
			<Thumbnail src={thumb} busy={busy} />
			<Box flex="auto" minWidth="0" marginRight={2}>
				<button type="button" onClick={() => expandRecord(record)} title="Open record" className="forge-record-link">
					{prompt}
				</button>
				{title && (
					<Text size="small" textColor="light" marginTop="2px">
						{title}
					</Text>
				)}
				<Box marginTop="2px">{status}</Box>
			</Box>
			<Box flex="none" display="flex" alignItems="center">
				{pageUrl && !busy && (
					<Link href={pageUrl} target="_blank" rel="noopener noreferrer" icon="share1" marginRight={2}>
						Open 3D
					</Link>
				)}
				{!busy && (!stored || phase === 'failed') && !result && (
					<Button
						size="small"
						variant={phase === 'failed' ? 'secondary' : 'primary'}
						disabled={!canWrite}
						onClick={() => onGenerate(record)}
						aria-label={`${phase === 'failed' ? 'Retry' : 'Generate'}: ${prompt}`}
					>
						{phase === 'failed' ? 'Retry' : 'Generate'}
					</Button>
				)}
			</Box>
		</Box>
	);
}
