'use strict';

/** Host adapters for local files: open a file for ranged reads, pick a file, list a folder, save downloads. */

const { baseName, findSplitPair } = require('../core/detect');
const { ApiError, MESSAGES } = require('../core/errors');

function fsModule() {
	return require('fs');
}

async function openLocalFile(nativePath, contentType) {
	const fs = fsModule();
	const st = await fs.lstat(nativePath);
	const size = Number(st.size);
	const mtime = st.mtimeMs !== undefined ? Number(st.mtimeMs) : Date.parse(st.mtime) || 0;
	return {
		name: baseName(nativePath),
		nativePath,
		size,
		mtimeMs: mtime,
		contentType,
		async readRange(start, end) {
			const length = end - start;
			const buffer = new ArrayBuffer(length);
			const fd = await fs.open(nativePath, 'r');
			try {
				let got = 0;
				while (got < length) {
					const { bytesRead } = await fs.read(fd, buffer, got, length - got, start + got);
					if (!bytesRead) break;
					got += bytesRead;
				}
				if (got !== length) throw new ApiError('corrupt_input', MESSAGES.corrupt_input);
			} finally {
				await fs.close(fd);
			}
			return buffer;
		},
	};
}

async function pickFile() {
	const { localFileSystem } = require('uxp').storage;
	const entry = await localFileSystem.getFileForOpening({
		types: ['insv', 'insp', 'mp4', 'mov', 'm4v', 'jpg', 'jpeg', 'png'],
	});
	return entry ? entry.nativePath : '';
}

async function siblingNames(nativePath) {
	try {
		const dir = nativePath.slice(0, Math.max(nativePath.lastIndexOf('/'), nativePath.lastIndexOf('\\')));
		return await fsModule().readdir(dir);
	} catch {
		return [];
	}
}

/** Native paths for the file and, for raw Insta360 lens files, its partner lens file. */
async function expandSplitPair(nativePath) {
	const name = baseName(nativePath);
	const names = findSplitPair(name, await siblingNames(nativePath));
	const dir = nativePath.slice(0, nativePath.length - name.length);
	return names.map((n) => `${dir}${n}`);
}

async function ensureFolder(dir, levels, sep) {
	const fs = fsModule();
	let current = dir;
	for (const level of levels) {
		current = `${current}${sep}${level}`;
		try {
			await fs.mkdir(current);
		} catch (err) {
			let exists = false;
			try {
				exists = (await fs.lstat(current)).isDirectory();
			} catch {
				exists = false;
			}
			if (!exists) throw err;
		}
	}
	return current;
}

/** Chunked file writer for streamed downloads (see core/stream.js). */
const fileSink = {
	async open(path) {
		return fsModule().open(path, 'w');
	},
	async write(fd, chunk) {
		const buf = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
		await fsModule().write(fd, buf);
	},
	async close(fd) {
		await fsModule().close(fd);
	},
	async remove(path) {
		await fsModule().unlink(path);
	},
};

async function dataFolderTarget(jobId) {
	const { localFileSystem } = require('uxp').storage;
	const root = await localFileSystem.getDataFolder();
	const sep = root.nativePath.includes('\\') ? '\\' : '/';
	const safeJob = String(jobId).replace(/[^A-Za-z0-9_-]/g, '_');
	const folder = await ensureFolder(root.nativePath, ['captures', safeJob], sep);
	return { folder, sep };
}

async function fetchStream(url) {
	return fetch(url);
}

module.exports = { openLocalFile, pickFile, expandSplitPair, ensureFolder, fileSink, dataFolderTarget, fetchStream };
