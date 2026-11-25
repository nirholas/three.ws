const BUNDLE_PREFIX = 'THREE_WS_ENV_';
const CONTROLS = new Set(['THREE_WS_INSTANCE', 'THREE_WS_SLEEP_MS']);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function bundledEnvironment(workerEnv) {
	const count = workerEnv.THREE_WS_ENV_PARTS;
	if (count === undefined) return {};
	if (typeof count !== 'string' || !/^(?:[1-9]|[1-8][0-9]|9[0-5])$/.test(count)) {
		throw new Error('Invalid environment bundle part count');
	}
	let serialized = '';
	for (let index = 0; index < Number(count); index++) {
		const part = workerEnv[`${BUNDLE_PREFIX}${String(index).padStart(3, '0')}`];
		if (typeof part !== 'string') throw new Error('Missing environment bundle part');
		serialized += part;
	}
	let values;
	try {
		values = JSON.parse(serialized);
	} catch {
		// Do not propagate parser messages that can contain secret text.
		throw new Error('Invalid environment bundle JSON');
	}
	if (values === null || typeof values !== 'object' || Array.isArray(values)) {
		throw new Error('Environment bundle must contain an object');
	}
	for (const [name, value] of Object.entries(values)) {
		if (!ENV_NAME.test(name) || typeof value !== 'string' || value.includes('\0')) {
			throw new Error('Environment bundle contains an invalid entry');
		}
	}
	return values;
}

export function runtimeEnvironment(workerEnv, origin) {
	// Individual Worker bindings can override an imported value without copying
	// the entire configuration again. Object bindings never enter the container.
	const configured = Object.fromEntries(Object.entries({
		...bundledEnvironment(workerEnv),
		...workerEnv,
	}).filter(([name, value]) =>
		typeof value === 'string' && !CONTROLS.has(name) && !name.startsWith(BUNDLE_PREFIX),
	));
	return {
		...configured,
		NODE_ENV: 'production',
		PORT: '8080',
		PUBLIC_APP_ORIGIN: configured.PUBLIC_APP_ORIGIN || origin,
	};
}
