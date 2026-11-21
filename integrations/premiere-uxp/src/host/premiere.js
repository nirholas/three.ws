'use strict';

/**
 * Premiere Pro host calls (`require("premierepro")`, available from Premiere Pro 25.6).
 * Everything here talks to the host; every decision lives in src/core so it runs under Node tests.
 */

const { ApiError, MESSAGES } = require('../core/errors');
const { BIN_NAME } = require('../core/results');

function ppro() {
	return require('premierepro');
}

async function activeProject() {
	try {
		return await ppro().Project.getActiveProject();
	} catch {
		return null;
	}
}

async function projectInfo() {
	const project = await activeProject();
	if (!project) return { open: false, path: '', name: '' };
	return { open: true, path: project.path || '', name: project.name || '' };
}

function ticksToSeconds(time) {
	if (!time) return NaN;
	if (typeof time.seconds === 'number') return time.seconds;
	if (typeof time.ticksNumber === 'number') return time.ticksNumber / 254016000000;
	return NaN;
}

async function clipDuration(clip) {
	const media = await clip.getMedia();
	if (!media) return NaN;
	const t = typeof media.getDuration === 'function' ? await media.getDuration() : await media.duration;
	return ticksToSeconds(t);
}

/** The first clip in the Project panel selection that has a media file, with its in and out points. */
async function selectedClip() {
	const p = ppro();
	const project = await activeProject();
	if (!project) return null;
	const selection = await p.ProjectUtils.getSelection(project);
	const items = selection ? await selection.getItems() : [];
	for (const item of items) {
		let clip;
		try {
			clip = p.ClipProjectItem.cast(item);
		} catch {
			continue;
		}
		if (!clip) continue;
		let path = '';
		try {
			path = await clip.getMediaFilePath();
		} catch {
			path = '';
		}
		if (!path) continue;
		const video = p.Constants && p.Constants.MediaType ? p.Constants.MediaType.VIDEO : undefined;
		let inSeconds = NaN;
		let outSeconds = NaN;
		try {
			inSeconds = ticksToSeconds(await clip.getInPoint(video));
			outSeconds = ticksToSeconds(await clip.getOutPoint(video));
		} catch {
			/* no in/out points readable: send the whole clip */
		}
		let durationSeconds = NaN;
		try {
			durationSeconds = await clipDuration(clip);
		} catch {
			/* duration comes from the file header instead */
		}
		return { name: item.name || '', path, inSeconds, outSeconds, durationSeconds };
	}
	return null;
}

async function transact(project, label, build) {
	let ok = false;
	project.lockedAccess(() => {
		ok = project.executeTransaction((compound) => build(compound), label);
	});
	return ok;
}

/** Find (or create) the bin that holds everything this panel imports. */
async function ensureBin(project) {
	const p = ppro();
	const find = async () => {
		const root = await project.getRootItem();
		const items = await root.getItems();
		for (const item of items) {
			if (item.name !== BIN_NAME) continue;
			try {
				const folder = p.FolderItem.cast(item);
				if (folder) return folder;
			} catch {
				/* a clip with the same name: keep looking */
			}
		}
		return null;
	};
	const existing = await find();
	if (existing) return existing;
	const root = await project.getRootItem();
	await transact(project, 'Create three.ws captures bin', (compound) => {
		compound.addAction(p.FolderItem.cast(root).createBinAction(BIN_NAME, true));
	});
	const created = await find();
	if (!created) throw new ApiError('import_failed', MESSAGES.import_failed);
	return created;
}

/** Import files into the three.ws captures bin. Returns the number of files Premiere accepted. */
async function importIntoBin(paths) {
	const project = await activeProject();
	if (!project) throw new ApiError('import_failed', 'Open a Premiere Pro project first, then import again.');
	const bin = await ensureBin(project);
	const ok = await project.importFiles(paths, true, bin, false);
	if (!ok) throw new ApiError('import_failed', MESSAGES.import_failed);
	return paths.length;
}

/** Insert an imported clip at the playhead of the active sequence. */
async function insertAtPlayhead(mediaPath) {
	const p = ppro();
	const project = await activeProject();
	if (!project) throw new ApiError('no_sequence', MESSAGES.no_sequence);
	const sequence = await project.getActiveSequence();
	if (!sequence) throw new ApiError('no_sequence', MESSAGES.no_sequence);
	const bin = await ensureBin(project);
	const items = await bin.getItems();
	let target = null;
	for (const item of items) {
		try {
			const clip = p.ClipProjectItem.cast(item);
			if (clip && (await clip.getMediaFilePath()) === mediaPath) target = item;
		} catch {
			/* not a clip */
		}
	}
	if (!target) throw new ApiError('import_failed', MESSAGES.import_failed);
	const position = await sequence.getPlayerPosition();
	const editor = p.SequenceEditor.getEditor(sequence);
	const ok = await transact(project, 'Insert three.ws preview', (compound) => {
		compound.addAction(editor.createInsertProjectItemAction(target, position, 0, 0, false));
	});
	if (!ok) throw new ApiError('import_failed', MESSAGES.import_failed);
}

async function hasActiveSequence() {
	try {
		const project = await activeProject();
		return Boolean(project && (await project.getActiveSequence()));
	} catch {
		return false;
	}
}

module.exports = { projectInfo, selectedClip, importIntoBin, insertAtPlayhead, hasActiveSequence };
