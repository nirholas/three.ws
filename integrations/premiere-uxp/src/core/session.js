'use strict';

const { ApiError, MESSAGES, normalise } = require('./errors');
const { classifyFile, buildTrim, buildCaptureBody, baseName } = require('./detect');
const { probeDimensions } = require('./probe');
const { uploadFile } = require('./upload');
const { pollJob } = require('./poll');
const { fetchResults, viewerLink } = require('./results');
const { streamToFile } = require('./stream');

/**
 * One send-and-return run: classify, upload, create the job, poll, download, import.
 *
 * `host` supplies everything that touches Premiere or the disk:
 *   openFile(nativePath, contentType) -> file for ranged reads
 *   expandSplitPair(nativePath) -> [nativePath, ...]
 *   fetchStream(url) -> fetch Response (body is streamed to disk)
 *   resultTarget(jobId, fileName) -> { path, sink } (also creates the folder)
 *   importFiles(paths) -> Promise
 *   resumeStore -> { load, save, remove }
 *
 * `onEvent({ phase, progress, label, ... })` drives the panel; `phase` is one of
 * inspect, upload, process, download, import, done.
 */

/** Everything the panel needs to show before the user presses Send. */
async function inspectInput({ host, path, clip }) {
	const probeKind = classifyFile({ name: baseName(path) });
	if (probeKind.error) return { ...probeKind, path, name: baseName(path) };
	const file = await host.openFile(path, probeKind.contentType);
	const dims = await probeDimensions(file.name, file.size, file.readRange);
	const kind = classifyFile({ name: file.name, width: dims.width, height: dims.height });
	const duration = dims.durationSeconds > 0 ? dims.durationSeconds : clip && clip.durationSeconds;
	const trim = clip && clip.path === path ? buildTrim(clip.inSeconds, clip.outSeconds, duration) : null;
	return { ...kind, path, name: file.name, size: file.size, width: dims.width || 0, height: dims.height || 0, durationSeconds: duration || 0, trim };
}

async function runSend({ client, host, input, token, onEvent = () => {}, sleep, uploadFetch }) {
	const emit = (e) => onEvent(e);
	emit({ phase: 'inspect', progress: 0, label: 'Reading the file' });
	const info = await inspectInput({ host, path: input.path, clip: input.clip });
	if (info.error) throw info.error;
	if (info.is360 === false || info.is360 === null) {
		if (!input.confirm360) throw new ApiError('not_360', MESSAGES.not_360);
	}

	const paths = info.source_kind === 'insv' ? await host.expandSplitPair(input.path) : [input.path];
	const sourceUrls = [];
	let doneBytes = 0;
	const totalBytes = (
		await Promise.all(paths.map(async (p) => (await host.openFile(p, info.contentType)).size))
	).reduce((a, b) => a + b, 0);

	for (const p of paths) {
		const file = await host.openFile(p, info.contentType);
		const out = await uploadFile({
			client,
			file,
			store: host.resumeStore,
			token,
			sleep,
			fetchImpl: uploadFetch,
			onProgress: ({ sentBytes, resumedParts }) =>
				emit({
					phase: 'upload',
					progress: Math.min(1, (doneBytes + sentBytes) / totalBytes),
					label: resumedParts ? `Resuming upload (${resumedParts} parts already sent)` : 'Uploading',
					sentBytes: doneBytes + sentBytes,
					totalBytes,
				}),
		});
		doneBytes += file.size;
		sourceUrls.push(out.source_url);
	}

	token.throwIfCancelled();
	let jobId;
	let statusFn;
	if (info.lane === 'scene') {
		const started = await client.startScene({ image_url: sourceUrls[0], source_kind: info.source_kind });
		jobId = started.job_id;
		statusFn = () => client.getScene(jobId);
	} else {
		const started = await client.startCapture(
			buildCaptureBody({ sourceUrls, sourceKind: info.source_kind, trim: input.useTrim === false ? null : info.trim, quality: input.quality }),
		);
		jobId = started.job_id;
		statusFn = () => client.getCapture(jobId);
	}
	if (!jobId) throw new ApiError('unexpected_response', MESSAGES.unexpected_response);
	emit({ phase: 'process', progress: 0, label: 'Queued', jobId });

	token.onCancel(() => {
		if (info.lane !== 'scene') client.cancelCapture(jobId).catch(() => {});
	});

	const final = await pollJob({
		fetchStatus: statusFn,
		token,
		sleep,
		onUpdate: (u) => emit({ phase: 'process', progress: u.progress, label: u.label, stage: u.stage, jobId }),
	});

	return deliver({ client, host, lane: info.lane, jobId, result: final.result, token, onEvent, sleep });
}

/** Download a finished job's files, import them, and describe what landed. Also used by "Your captures". */
async function deliver({ client, host, lane, jobId, result, token, onEvent = () => {}, sleep }) {
	const emit = (e) => onEvent(e);
	emit({ phase: 'download', progress: 0, label: 'Downloading results', jobId });
	const { paths, missing } = await fetchResults({
		lane,
		result,
		token,
		sleep,
		save: async (url, fileName, onBytes) => {
			const { path, sink } = await host.resultTarget(jobId, fileName);
			const response = await host.fetchStream(url);
			await streamToFile({ response, sink, path, token, onBytes });
			return path;
		},
		onFile: ({ index, total, file }) => emit({ phase: 'download', progress: index / total, label: `Downloading ${file}`, jobId }),
	});
	emit({ phase: 'import', progress: 0.9, label: 'Adding to the project', jobId });
	let imported = 0;
	let importError = null;
	try {
		await host.importFiles(paths);
		imported = paths.length;
	} catch (raw) {
		importError = normalise(raw);
	}
	const outcome = {
		lane,
		jobId,
		paths,
		missing,
		imported,
		importError,
		previewPath: paths.find((p) => p.endsWith('preview.mp4')) || '',
		viewerUrl: viewerLink(client.origin, result),
		folder: host.folderFor ? host.folderFor(jobId) : '',
	};
	emit({ phase: 'done', progress: 1, label: 'Done', jobId, outcome });
	return outcome;
}

module.exports = { runSend, deliver, inspectInput };
