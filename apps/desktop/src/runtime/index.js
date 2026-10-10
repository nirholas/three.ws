// Runtime bootstrap for the desktop app: wires the keychain-backed keystore,
// the state file and the redacted log under one directory and returns the
// runtime plus the IPC-facing facade. Electron-free so the smoke test can run
// it headless.

import { join } from 'node:path';
import { createSecureStore } from '../main/secure-store.js';
import { createKeystore } from './keystore.js';
import { createLogger } from './log.js';
import { createRuntime } from './runtime.js';
import { createLiveExecutor } from './live.js';
import { createPumpFeed } from './feed.js';

export function createLocalRuntime({ dir, safeStorage, apiBase, token = () => null, onEvent, feed = createPumpFeed(), fetchImpl, now }) {
	const log = createLogger({ file: join(dir, 'runtime.log') });
	const keys = createSecureStore({ file: join(dir, 'keys.bin'), safeStorage });
	const stateFile = createSecureStore({ file: join(dir, 'state.bin'), safeStorage: null });
	const keystore = createKeystore({ store: keys });
	const live = createLiveExecutor({ keystore, apiBase, token, fetchImpl });
	const runtime = createRuntime({ stateStore: stateFile, keystore, log, feed, live, onEvent, now });
	return { runtime, keystore, log, keysEncrypted: () => keystore.encrypted() };
}
