// One JSON object on disk, encrypted with the OS keychain when the platform
// offers one (Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux)
// through Electron's safeStorage. With no keychain the file is still written
// owner-only (0600), and `encrypted` in the status says so.

import { readFileSync, writeFileSync, rmSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

const MAGIC_ENCRYPTED = 'tws1:';
const MAGIC_PLAIN = 'tws0:';

export function createSecureStore({ file, safeStorage }) {
	const canEncrypt = () => {
		try {
			return Boolean(safeStorage?.isEncryptionAvailable());
		} catch {
			return false;
		}
	};

	function read() {
		let raw;
		try {
			raw = readFileSync(file, 'utf8');
		} catch {
			return null;
		}
		try {
			if (raw.startsWith(MAGIC_ENCRYPTED)) {
				if (!canEncrypt()) return null;
				return JSON.parse(safeStorage.decryptString(Buffer.from(raw.slice(MAGIC_ENCRYPTED.length), 'base64')));
			}
			if (raw.startsWith(MAGIC_PLAIN)) return JSON.parse(raw.slice(MAGIC_PLAIN.length));
		} catch {
			// A file encrypted under another OS user or a wiped keychain cannot be
			// read back: treat it as signed out rather than crash on launch.
			return null;
		}
		return null;
	}

	function write(value) {
		const json = JSON.stringify(value);
		const payload = canEncrypt()
			? MAGIC_ENCRYPTED + safeStorage.encryptString(json).toString('base64')
			: MAGIC_PLAIN + json;
		mkdirSync(dirname(file), { recursive: true });
		const tmp = `${file}.${process.pid}.tmp`;
		writeFileSync(tmp, payload, { mode: 0o600 });
		renameSync(tmp, file);
	}

	function clear() {
		rmSync(file, { force: true });
	}

	return { read, write, clear, encrypted: canEncrypt };
}
