'use strict';

/** Host adapters for UXP storage: the API key (secure storage) and upload resume state (plugin data folder). */

const KEY_NAME = 'three-ws-api-key';

function uxpStorage() {
	return require('uxp').storage;
}

async function getApiKey() {
	try {
		const raw = await uxpStorage().secureStorage.getItem(KEY_NAME);
		if (!raw || !raw.byteLength) return '';
		return new TextDecoder().decode(raw).trim();
	} catch {
		return '';
	}
}

async function setApiKey(value) {
	const trimmed = String(value || '').trim();
	if (!trimmed) {
		await clearApiKey();
		return;
	}
	await uxpStorage().secureStorage.setItem(KEY_NAME, trimmed);
}

async function clearApiKey() {
	try {
		await uxpStorage().secureStorage.removeItem(KEY_NAME);
	} catch {
		/* nothing stored */
	}
}

function hashKey(text) {
	let h = 5381;
	for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
	return h.toString(16).padStart(8, '0');
}

/** Resume store: one small JSON file per in-flight upload under plugin-data:/uploads/. */
function createResumeStore() {
	const fs = require('fs');
	const { localFileSystem, types } = uxpStorage();
	let dirPromise = null;
	const dir = () => {
		dirPromise = dirPromise || localFileSystem.createEntryWithUrl('plugin-data:/uploads', { type: types.folder, overwrite: false }).catch(() => localFileSystem.getEntryWithUrl('plugin-data:/uploads'));
		return dirPromise;
	};
	const pathFor = async (key) => `${(await dir()).nativePath}/${hashKey(key)}.json`;
	return {
		async load(key) {
			try {
				const text = await fs.readFile(await pathFor(key), { encoding: 'utf-8' });
				const state = JSON.parse(text);
				return state && state.upload && state.upload.upload_id ? state : null;
			} catch {
				return null;
			}
		},
		async save(key, state) {
			await fs.writeFile(await pathFor(key), JSON.stringify(state), { encoding: 'utf-8' });
		},
		async remove(key) {
			try {
				await fs.unlink(await pathFor(key));
			} catch {
				/* already gone */
			}
		},
	};
}

module.exports = { getApiKey, setApiKey, clearApiKey, createResumeStore, hashKey };
