import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.three-ws');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
	apiKey: '',
	network: 'mainnet',
	spendLimitUsdc: 1.0,
	cache: { enabled: true },
	remote: 'https://three.ws',
};

export function loadConfig() {
	// Env vars override file config
	const cfg = { ...DEFAULTS };
	if (existsSync(CONFIG_FILE)) {
		try {
			Object.assign(cfg, JSON.parse(readFileSync(CONFIG_FILE, 'utf8')));
		} catch {
			// ignore malformed config
		}
	}
	if (process.env.THREE_WS_API_KEY) cfg.apiKey = process.env.THREE_WS_API_KEY;
	if (process.env.THREE_WS_NETWORK) cfg.network = process.env.THREE_WS_NETWORK;
	if (process.env.THREE_WS_REMOTE) cfg.remote = process.env.THREE_WS_REMOTE;
	if (process.env.THREE_WS_SPEND_LIMIT) cfg.spendLimitUsdc = parseFloat(process.env.THREE_WS_SPEND_LIMIT) || cfg.spendLimitUsdc;
	return cfg;
}

export function saveConfig(cfg) {
	mkdirSync(CONFIG_DIR, { recursive: true });
	writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

export function configPath() {
	return CONFIG_FILE;
}
